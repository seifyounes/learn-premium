// The pre-commit gate: before anything is committed to a Course project, every staged file is
// checked. One that is a Materials file (its bytes, or its text with other line endings, hash to a
// Materials file the Build ledger lists or the Materials folder holds) or that sits in an
// evidence-shaped path blocks the commit. The hook (`hooks/pre-commit`, which intake makes the
// Course project's `core.hooksPath`) runs it through `pre-commit-cli.ts`.
//
// Node built-ins only, so it runs before the template's packages are installed. A check that can't
// run (no Build ledger, git failing) blocks too: a gate that didn't run counts as failed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { evidenceShape } from "./evidence.ts";

export const LEDGER_FILE = "build-ledger.json";

export interface CommitFinding {
  /** The staged path, relative to the repo root. */
  path: string;
  message: string;
}

export interface CommitCheck {
  /** What the check looked at: staged files, and the Materials hashes it compared them with. */
  coverage: { stagedFiles: number; materialsHashes: number };
  findings: CommitFinding[];
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A staged file's possible original bytes: as staged, and for text its LF and CRLF forms (git may convert line endings). */
function variants(bytes: Buffer): Buffer[] {
  if (bytes.includes(0)) return [bytes];
  const lf = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  const crlf = Buffer.from(lf.toString("latin1").replace(/\n/g, "\r\n"), "latin1");
  return [bytes, lf, crlf];
}

function git(repo: string, args: string[], input?: string) {
  const child = spawnSync("git", ["-C", repo, ...args], {
    input,
    maxBuffer: 2 ** 31 - 1,
  });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${child.stderr.toString().trim()}`);
  return child.stdout;
}

/** The staged files (added, copied, modified, renamed; not deleted) and their staged bytes. */
function stagedFiles(repo: string): { path: string; bytes: Buffer }[] {
  const paths = git(repo, ["diff", "--cached", "--name-only", "-z", "--no-renames", "--diff-filter=d"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (paths.length === 0) return [];
  // Each one's staged blob id from the index (`<mode> <id> <stage>\t<path>`), all read in one
  // `git cat-file --batch` by id, so no path needs quoting.
  const ids = new Map<string, string>();
  for (const line of git(repo, ["ls-files", "--stage", "-z"]).toString("utf8").split("\0")) {
    const tab = line.indexOf("\t");
    if (tab !== -1) ids.set(line.slice(tab + 1), line.slice(0, tab).split(" ")[1] ?? "");
  }
  const blobs = paths.map((path) => {
    const id = ids.get(path);
    if (!id) throw new Error(`can't find the staged ${path} in the index`);
    return id;
  });
  const out = git(repo, ["cat-file", "--batch"], `${blobs.join("\n")}\n`);
  const files: { path: string; bytes: Buffer }[] = [];
  let at = 0;
  for (const path of paths) {
    const end = out.indexOf(10, at);
    const header = out.subarray(at, end).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isInteger(size)) throw new Error(`can't read the staged ${path} (${header})`);
    files.push({ path, bytes: out.subarray(end + 1, end + 1 + size) });
    at = end + 1 + size + 1;
  }
  return files;
}

interface LedgerMaterials {
  /** Materials file → its sha256, superseded rows too (an old version is still the Professor's). */
  hashes: Map<string, string>;
  /** The Materials folders the ledgers name. */
  folders: string[];
}

/** One Build ledger's Materials inventory and folder; null when its text isn't one. */
function ledgerMaterials(text: string): LedgerMaterials | null {
  let ledger: { materials?: { path?: unknown; hash?: unknown }[]; intake?: { materialsPath?: unknown } };
  try {
    ledger = JSON.parse(text) as typeof ledger;
  } catch {
    return null;
  }
  if (!Array.isArray(ledger.materials)) return null;
  const hashes = new Map<string, string>();
  for (const m of ledger.materials)
    if (typeof m.hash === "string" && typeof m.path === "string") hashes.set(m.hash.toLowerCase(), m.path);
  const folder = ledger.intake?.materialsPath;
  return { hashes, folders: typeof folder === "string" ? [folder] : [] };
}

/**
 * The Materials the commit is checked against: the ledger as committed at HEAD, as staged (what
 * this commit records) and as it stands in the working tree, together, so a commit that also
 * empties or repoints the ledger, staged or not, can't switch off its own check.
 */
function readLedger(repo: string): LedgerMaterials {
  const show = (spec: string) => {
    const child = spawnSync("git", ["-C", repo, "show", spec], { maxBuffer: 2 ** 31 - 1 });
    return child.status === 0 ? child.stdout.toString("utf8") : null;
  };
  const path = join(repo, LEDGER_FILE);
  const texts = [
    existsSync(path) ? readFileSync(path, "utf8") : null,
    show(`:${LEDGER_FILE}`),
    show(`HEAD:${LEDGER_FILE}`),
  ];
  const present = texts.filter((t): t is string => t !== null);
  if (present.length === 0)
    throw new Error(`no Build ledger at ${LEDGER_FILE}, so the staged files can't be checked against the Materials`);
  const ledgers = present.map(ledgerMaterials).filter((l): l is LedgerMaterials => l !== null);
  if (ledgers.length === 0) throw new Error(`${LEDGER_FILE} has no Materials inventory`);
  return {
    hashes: new Map(ledgers.flatMap((l) => [...l.hashes])),
    folders: [...new Set(ledgers.flatMap((l) => l.folders))],
  };
}

/**
 * Hashes the Materials folder's files whose size one of `sizes` could match, so a file not yet in
 * the Module map is caught too, without hashing every lecture video on each commit.
 */
function hashFolder(folder: string, sizes: Set<number>, into: Map<string, string>): void {
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(dir, entry.name);
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, path);
      else if (entry.isFile() && sizes.has(statSync(full).size)) {
        const hash = sha256(readFileSync(full));
        if (!into.has(hash)) into.set(hash, path);
      }
    }
  };
  walk(folder, "");
}

export function checkCommit(repo: string): CommitCheck {
  const staged = stagedFiles(repo);
  const findings: CommitFinding[] = [];
  const ledger = readLedger(repo);
  const known = new Map(ledger.hashes);
  const forms = staged.map(({ path, bytes }) => ({ path, forms: variants(bytes) }));
  const sizes = new Set(forms.flatMap((f) => f.forms.map((b) => b.length)));
  // A Material not yet in the Module map is caught only by scanning the folder: none reachable (a
  // disconnected drive, a moved folder) means the check can't be complete, so it blocks.
  const reachable = ledger.folders.filter((folder) => existsSync(folder));
  if (reachable.length === 0)
    throw new Error(
      `can't reach the Materials folder (${ledger.folders.join(", ") || "the ledger names none"}), so a Material not yet mapped can't be caught`,
    );
  for (const folder of reachable) hashFolder(folder, sizes, known);
  // An empty Material matches every empty file (a .gitkeep), so it carries nothing to leak.
  known.delete(EMPTY_SHA256);
  for (const { path, forms: bytes } of forms) {
    const shape = evidenceShape(path);
    if (shape !== null)
      findings.push({ path, message: `evidence-shaped path (${shape.reason}): it belongs in the Private folder` });
    const material = bytes.map((b) => known.get(sha256(b))).find((m) => m !== undefined);
    if (material !== undefined)
      findings.push({
        path,
        message: `is the Materials file ${material}: Materials are referenced by path, never committed`,
      });
  }
  return { coverage: { stagedFiles: staged.length, materialsHashes: known.size }, findings };
}
