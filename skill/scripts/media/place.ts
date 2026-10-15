// Placing checked media. A media pass puts one Module's checked re-encodes on a branch of the Course project,
// `media/NN-<slug>-<n>`, in a worktree of its own: `stage` copies a re-encode in and writes its slot into the
// Module's `media.yaml`, `ready` is that branch's merge gate (it may change media and nothing else, and the
// template's gates verify it like any branch), and the merge is a fast-forward of `main`. Placed media never
// blocks a Module: the Module was live already, and nothing here is read by a Module wave's own gate.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { hashFile } from "../ledger/hash.ts";
import { requireLedger, runningUpgrade, verifyIntegrity } from "../ledger/ledger.ts";
import { current, type Ledger } from "../ledger/model.ts";
import { readJsonFile } from "../wave/reading.ts";
import { inventoryProblems, MAIN_BRANCH, treeProblems, waveTree } from "../wave/tree.ts";
import { MERGE_POINTS, moduleFolder, type Verifier } from "../wave/wave.ts";
import { checkPath, moduleItem } from "./kit.ts";
import { checkSchema } from "./check.ts";
import { readMediaFile } from "./store.ts";
import { PLACED_NAME } from "./model.ts";
import { requirePrivateFolder } from "./notebook.ts";

const CONTENT = "content";

function git(cwd: string, ...args: string[]) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

const branchOf = (tree: string): string | null => {
  const head = git(tree, "symbolic-ref", "--short", "-q", "HEAD");
  return head.status === 0 ? head.stdout.trim() : null;
};

/** The module's running re-run wave, if any: its media waits. */
function rebuilding(ledger: Ledger, module: string) {
  return current(ledger.waves).find((w) => w.kind === "module" && w.target === module && w.state === "running");
}

const rebuildingMessage = (module: string, wave: string) =>
  `Module ${module} is being rebuilt (wave ${wave}): its media waits until it is live again`;

/** A length as `media.yaml` writes it: `m:ss`, or `h:mm:ss` from an hour, at least a second. */
export function clock(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds));
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type Slot = "video" | "audio" | "infographic";
const SLOTS: readonly Slot[] = ["video", "audio", "infographic"];

const TOP_LEVEL_KEY = /^[A-Za-z_][\w-]*:/;

/**
 * `media.yaml` with the given slots' blocks swapped in, and nothing else touched: its header (the lines
 * before the first key), then video, audio and infographic (the new block, or the old one if the slot isn't
 * given), then every other block, such as the Watch page's `youtube:` cards, as it was. A block runs to the
 * next top-level key, except for the comment lines right above that key, which are the next block's. No YAML
 * library: the installed skill has no node_modules, and a parse and dump would reflow what it didn't touch.
 */
export function mergeMediaYaml(existing: string, slots: Partial<Record<Slot, string>>): string {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = existing === "" ? [] : existing.replace(/\r?\n$/, "").split(/\r?\n/);
  const keys = lines.flatMap((line, at) => (TOP_LEVEL_KEY.test(line) ? [at] : []));
  // A block starts at its key, pulled up over the comment lines right above it (not the first key's: the
  // header keeps those) and runs to the next block's start.
  const starts = keys.map((key, n) => {
    let start = key;
    while (n > 0 && start - 1 > (keys[n - 1] ?? 0) && lines[start - 1]?.startsWith("#")) start -= 1;
    return start;
  });
  const header = lines.slice(0, keys[0] ?? lines.length);
  const blocks = new Map<string, string[]>();
  keys.forEach((key, n) => {
    const name = /^[^:]+/.exec(lines[key] ?? "")?.[0] ?? "";
    blocks.set(name, lines.slice(starts[n], starts[n + 1] ?? lines.length));
  });
  const out = [...header];
  for (const slot of SLOTS) {
    const given = slots[slot];
    out.push(...(given === undefined ? (blocks.get(slot) ?? []) : given.replace(/\r?\n$/, "").split(/\r?\n/)));
  }
  for (const [name, block] of blocks) if (!(SLOTS as readonly string[]).includes(name)) out.push(...block);
  while (out.length > 0 && out.at(-1)?.trim() === "") out.pop();
  return `${out.join(eol)}${eol}`;
}

export interface StageResult {
  /** The staged copy, relative to the media branch's worktree. */
  file: string;
  bytes: number;
  slot: Slot;
  module: string;
}

/** The slot's block in `media.yaml`. Captions aren't kept: they were the old video's. */
function slotBlock(slot: Slot, duration: number | null, alt: string | null): string {
  const file = PLACED_NAME[slot];
  if (slot === "infographic") return `infographic:\n  file: ${file}\n  alt: ${JSON.stringify(alt)}\n`;
  return `${slot}:\n  file: ${file}\n  duration: '${clock(duration ?? 0)}'\n`;
}

/**
 * Copies a checked item's re-encode into the media branch's worktree, as the Module's `media/` file, and
 * writes its slot into the Module's `media.yaml` (the other blocks untouched). Never commits: the pass does.
 */
export function stage(project: string, tree: string, id: string, privateFolder: string): StageResult {
  const root = resolve(project);
  const dir = resolve(tree);
  const priv = requirePrivateFolder(root, privateFolder);
  const { item, module } = moduleItem(root, id);
  const ledger = requireLedger(root);
  const { row, folder } = moduleFolder(ledger, module);
  const running = rebuilding(ledger, module);
  if (running !== undefined) throw new LedgerError("refused", rebuildingMessage(module, running.id));
  if (row.state !== "live")
    throw new LedgerError("refused", `Module ${module} isn't live (it is ${row.state}): its media waits`);
  const branch = branchOf(dir);
  if (branch === null || !branch.startsWith("media/")) {
    throw new LedgerError(
      "refused",
      `${dir} is on ${branch ?? "no branch"}, not a media/ branch: stage media on a branch of its own (media/NN-<slug>-<n>)`,
    );
  }
  if (item.state !== "checked") throw new LedgerError("refused", `${id} is ${item.state}; staging needs it checked`);
  const attempt = item.regenerations + 1;
  const encoded = item.encoded;
  if (encoded === null || encoded.attempt !== attempt) {
    throw new LedgerError("refused", `${id} has no re-encode of attempt ${attempt}: run encode first`);
  }
  const web = join(priv, encoded.file);
  if (!existsSync(web) || hashFile(web) !== encoded.hash) {
    throw new LedgerError("refused", `${id}'s re-encode ${web} is missing or isn't the one recorded: run encode again`);
  }
  let alt: string | null = null;
  if (item.kind === "infographic") {
    const path = checkPath(priv, id, attempt);
    if (!existsSync(path))
      throw new LedgerError("refused", `no check file ${path}: the infographic's alt text is in it`);
    const check = readJsonFile(path, checkSchema, "check file");
    if (check.item !== id || check.attempt !== attempt || check.alt === null) {
      throw new LedgerError("refused", `${path} has no alt text for ${id} attempt ${attempt}`);
    }
    alt = check.alt;
  }
  const slot = item.kind;
  const moduleDir = join(dir, CONTENT, "modules", folder);
  const target = join(moduleDir, "media", PLACED_NAME[slot]);
  mkdirSync(join(moduleDir, "media"), { recursive: true });
  copyFileSync(web, target);
  const yaml = join(moduleDir, "media.yaml");
  const existing = existsSync(yaml) ? readFileSync(yaml, "utf8") : "";
  writeFileSync(yaml, mergeMediaYaml(existing, { [slot]: slotBlock(slot, encoded.duration, alt) }));
  return {
    file: `${CONTENT}/modules/${folder}/media/${PLACED_NAME[slot]}`,
    bytes: statSync(target).size,
    slot,
    module,
  };
}

/** Every reason a media branch may not merge into `main` yet; none means it may. */
export function mediaReadyProblems(project: string, tree: string, module: string, verifier: Verifier): string[] {
  const root = resolve(project);
  const dir = resolve(tree);
  const ledger = requireLedger(root);
  const { row, folder } = moduleFolder(ledger, module);
  const problems: string[] = [];
  const branch = branchOf(dir);
  if (branch === null || !branch.startsWith("media/")) {
    problems.push(`${dir} is on ${branch ?? "no branch"}, not a media/ branch`);
  }
  const named = branch ?? "HEAD";
  const where = waveTree(root, named);
  problems.push(...treeProblems(root, { branch: named, target: module }, where), ...inventoryProblems(ledger, where));

  // The branch changes this Module's media, its slot file and its own Gate reports, and nothing else.
  const base = git(dir, "merge-base", MAIN_BRANCH, "HEAD");
  if (base.status === 0) {
    // A merge commit's own diff is empty, so what came in with it would never be judged: rebase, never merge.
    const merges = git(dir, "rev-list", "--merges", `${base.stdout.trim()}..HEAD`)
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    if (merges.length > 0) {
      problems.push(
        `the media branch has a merge commit (${merges.map((m) => m.slice(0, 7)).join(", ")}): rebase it onto ${MAIN_BRANCH} instead`,
      );
    }
    // Every commit being merged, not just the branch's end state: a fast-forward publishes each commit's blobs.
    // `--raw -z` gives `:<modes> <old blob> <new blob> <status>` and then the path, NUL-separated.
    const log = git(dir, "log", "--raw", "-z", "--no-renames", "--format=", `${base.stdout.trim()}..HEAD`);
    const fields = log.status === 0 ? log.stdout.split("\0").filter(Boolean) : [];
    const touched: { path: string; blob: string }[] = [];
    for (let i = 0; i < fields.length; i += 2) {
      const blob = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) /.exec(fields[i] ?? "")?.[1];
      const path = fields[i + 1];
      if (blob !== undefined && path !== undefined) touched.push({ path, blob });
    }
    const mine = `${CONTENT}/modules/${folder}/`;
    const reports = `${CONTENT}/build-records/gate-reports/`;
    const allowed = (path: string) =>
      path.startsWith(`${mine}media/`) ||
      path === `${mine}media.yaml` ||
      [`job-${folder}.json`, `module-${folder}.json`, "deploy.json"].some((name) => path === `${reports}${name}`);
    const stray = [...new Set(touched.map((t) => t.path).filter((path) => !allowed(path)))];
    if (stray.length > 0) problems.push(`a media branch places media only: ${stray.join(", ")}`);
    // Each file it puts in media/ is, in every commit, this Module's checked item of that kind: its own name and its
    // own re-encode, so a rejected output, or another Module's checked media, can't ride along.
    const wanted = new Map(
      (readMediaFile(root)?.items ?? [])
        .filter((i) => i.state === "checked" && i.encoded !== null && i.module === module && i.kind !== "sitting-audio")
        .map((i) => [`${mine}media/${PLACED_NAME[i.kind as Slot]}`, i.encoded?.hash]),
    );
    const zero = /^0+$/;
    const bad = new Set<string>();
    for (const { path, blob } of touched.filter((t) => t.path.startsWith(`${mine}media/`) && !zero.test(t.blob))) {
      const content = spawnSync("git", ["-C", dir, "cat-file", "blob", blob], { maxBuffer: 2 ** 31 - 1 });
      const hash = content.status === 0 ? createHash("sha256").update(content.stdout).digest("hex") : null;
      if (hash === null || wanted.get(path) !== hash)
        bad.add(`${path.slice(mine.length)} isn't a checked item's re-encode`);
    }
    problems.push(...bad);
  }
  const status = git(dir, "status", "--porcelain");
  const dirty = status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : null;
  if (dirty === null) problems.push("can't read the media branch's git status");
  else if (dirty.length > 0) {
    problems.push(`the media branch has uncommitted changes (${dirty.map((l) => l.slice(3)).join(", ")}): commit them`);
  }

  // Media yields: it merges only while nothing else is being built, so its merge never makes a wave rebase and re-gate.
  const waves = current(ledger.waves).filter((w) => w.state === "running");
  const rebuilt = rebuilding(ledger, module);
  if (rebuilt !== undefined) problems.push(rebuildingMessage(module, rebuilt.id));
  else if (row.state !== "live") problems.push(`Module ${module} isn't live (it is ${row.state}): its media waits`);
  for (const wave of waves.filter((w) => w !== rebuilt)) {
    problems.push(
      `wave ${wave.id} is running: a media branch merges only while no wave runs, so its merge never makes a wave rebase and re-gate`,
    );
  }
  const upgrade = runningUpgrade(ledger);
  if (upgrade !== undefined) {
    problems.push(`the Upgrade wave ${upgrade.id} is running: a media branch merges only after it ends`);
  }

  // The template layer's own gates verify the branch, as for a Module wave.
  const integrity = verifyIntegrity(root, dir);
  if (!integrity.intact) {
    const changes = [
      ...integrity.modified.map((p) => `modified ${p}`),
      ...integrity.added.map((p) => `added ${p}`),
      ...integrity.missing.map((p) => `missing ${p}`),
      ...integrity.unrecordedOverrides.map((p) => `unrecorded override ${p}`),
      ...integrity.missingOverrides.map((p) => `recorded override ${p} missing from the overrides area`),
    ];
    problems.push(
      `the template layer isn't the pinned release's: ${changes.join(", ")}; its gates can't verify this branch`,
    );
  } else {
    for (const point of MERGE_POINTS) {
      const verdict = verifier.verify(dir, point, point === "deploy" ? undefined : folder);
      if (!verdict.green) {
        problems.push(`the ${point} Gate report isn't green for HEAD: ${verdict.problems.join("; ") || "red"}`);
      }
    }
  }
  return problems;
}
