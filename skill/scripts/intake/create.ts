// Creating a Course project at intake, the /newproject way: its own folder in the workspace with a
// README, a CLAUDE.md, a .gitignore, a first commit and a row in the workspace catalog, plus the Site
// template at the pinned release (its files hashed in the ledger), the course config, the Build ledger holding the intake
// answers, the Private folder beside the Materials and a place in the Course registry. GitHub and
// Vercel come after, in the host step, only on the Owner's word.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { LedgerError, withMutex } from "../ledger/file.ts";
import { hashTree } from "../ledger/hash.ts";
import { init } from "../ledger/ledger.ts";
import { TEMPLATE_DIR, type Ledger } from "../ledger/model.ts";
import { readLedger } from "../ledger/store.ts";
import { register } from "../media/media.ts";
import { readRegistry } from "../media/store.ts";
import { ledgerIntake, type Answers } from "./answers.ts";
import { samePath } from "./find.ts";
import { requireFolder } from "./propose.ts";
import { templateAt } from "./release.ts";
import { claudeMd, CONTENT_DIR, courseConfig, GITIGNORE, OVERRIDES_DIR, readme, type Paths } from "./scaffold.ts";
import { MEMORY_FILE, readCatalog, withCatalogRow } from "./workspace.ts";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface CreateOptions {
  answers: Answers;
  /** The workspace folder the Course project is made in (its MEMORY.md holds the project catalog). */
  workspace: string;
  /** The release repo: the git repo the installed Template release was checked out from. */
  source: string;
  /** The Template release tag the Course project is pinned to. */
  release: string;
  /** This run's holder id: it holds the new ledger's lock. */
  holder: string;
  stateDir: string;
}

/** Whether `path` is `folder` or inside it. */
export function within(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The nearest folder at or above `path` that is a git repo's root, or null. */
function enclosingRepo(path: string): string | null {
  for (let folder = path; ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) return folder;
    if (dirname(folder) === folder) return null;
  }
}

/** The Private folder: beside the Materials, named after them. */
export function privateFolderOf(materials: string): string {
  return join(dirname(materials), `${basename(materials)} (private)`);
}

function git(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${repo}: ${child.stderr.trim()}`);
  return child.stdout.trim();
}

/** A git config value as `repo` sees it (its own, else the global one), or null. */
function configured(repo: string, key: string): string | null {
  const child = spawnSync("git", ["-C", repo, "config", key], { encoding: "utf8" });
  const value = child.status === 0 ? child.stdout.trim() : "";
  return value === "" ? null : value;
}

/** Who the Course project's commits are by: the identity the release repo commits with (its own or the global one). */
function authorOf(source: string): { name: string; email: string } {
  const name = configured(source, "user.name");
  const email = configured(source, "user.email");
  if (name === null || email === null) {
    throw new LedgerError(
      "invalid",
      `git has no user.name and user.email to commit the Course project with (globally, or in ${source})`,
    );
  }
  return { name, email };
}

function write(root: string, path: string, content: string | Buffer): string {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/** On Windows a folder just written can be held for a moment (an indexer, an antivirus scan). */
function renameRetrying(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 50 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

export function createProject(options: CreateOptions) {
  const { answers, holder, release, stateDir } = options;
  const materials = requireFolder(answers.materialsPath, "Materials folder");
  const workspace = requireFolder(options.workspace, "workspace");
  const project = join(workspace, answers.slug);
  const privateFolder = privateFolderOf(materials);

  // Everything is checked before anything is made.
  if (within(project, materials)) {
    throw new LedgerError("refused", `the Course project ${project} would be inside the Materials folder ${materials}`);
  }
  if (within(materials, project)) {
    throw new LedgerError(
      "refused",
      `the Materials folder ${materials} is inside the Course project's folder ${project}`,
    );
  }
  const repo = enclosingRepo(privateFolder);
  if (repo !== null) {
    throw new LedgerError(
      "refused",
      `the Private folder ${privateFolder} would be inside the repo ${repo}; it sits outside any repo`,
    );
  }
  readCatalog(workspace);
  readRegistry(stateDir);
  if (existsSync(project)) {
    // This Course's own project, from a create that stopped after moving it into place: finish it.
    const ledger = madeBefore(project, answers, materials);
    if (ledger === null) {
      throw new LedgerError("refused", `${project} already exists; a Course project is never made over it`);
    }
    if (ledger.lock?.holder !== options.holder) {
      const held = ledger.lock === null ? "nobody holds it" : `${ledger.lock.holder} holds it`;
      throw new LedgerError(
        "refused",
        `${project} was made by an earlier run; claim its ledger lock first (${held}; take over only on the Owner's word), then run create again`,
      );
    }
    return {
      ...finish(options, workspace, project, privateFolder, materials, ledger.template.release),
      templateFiles: Object.keys(ledger.template.files).length,
      commit: git(project, "rev-parse", "HEAD"),
      resumed: true,
    };
  }
  const author = authorOf(options.source);
  const template = templateAt(options.source, release);
  const materialsByHash = new Map(
    Object.entries(hashTree(materials))
      .filter(([, hash]) => hash !== EMPTY_SHA256)
      .map(([path, hash]) => [hash, path]),
  );

  // Made in a staging folder and moved into place whole, so a failure leaves nothing half-made.
  // A fresh, uniquely named one: a leftover or another run's staging folder is never touched.
  const stage = mkdtempSync(join(workspace, `.${answers.slug}.creating-`));
  let commit: string;
  try {
    for (const [path, content] of template) write(stage, join(TEMPLATE_DIR, path), content);
    const paths: Paths = { materials, private: privateFolder, release };
    write(stage, join(OVERRIDES_DIR, ".gitkeep"), "");
    write(stage, join(CONTENT_DIR, "course.yaml"), courseConfig(answers));
    write(stage, join(CONTENT_DIR, "modules", ".gitkeep"), "");
    write(stage, "README.md", readme(answers, paths));
    write(stage, "CLAUDE.md", claudeMd(answers, paths));
    write(stage, ".gitignore", GITIGNORE);
    init(stage, holder, release, ledgerIntake(answers, materials));

    // Materials are referenced by path, never copied: no file of the Course project may be one.
    for (const [path, hash] of Object.entries(hashTree(stage))) {
      const material = materialsByHash.get(hash);
      if (material !== undefined) {
        throw new LedgerError(
          "refused",
          `${path} would put the Material ${material} in the Course project; Materials are never copied`,
        );
      }
    }

    git(stage, "init", "-q", "-b", "main");
    // With no identity of its own (no global one), the Course project commits as the release repo does.
    if (configured(stage, "user.name") === null || configured(stage, "user.email") === null) {
      git(stage, "config", "user.name", author.name);
      git(stage, "config", "user.email", author.email);
    }
    git(stage, "add", "-A");
    git(stage, "commit", "-q", "-m", `chore: create the ${answers.courseName} Course project`);
    commit = git(stage, "rev-parse", "HEAD");
    renameRetrying(stage, project);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }

  return {
    ...finish(options, workspace, project, privateFolder, materials, release),
    templateFiles: template.size,
    commit,
  };
}

/**
 * The steps after the Course project is in place, each safe to repeat: the Private folder, the Course
 * registry, the workspace catalog. A create that stopped among them is finished by running it again.
 */
function finish(
  { answers, stateDir }: CreateOptions,
  workspace: string,
  project: string,
  privateFolder: string,
  materials: string,
  release: string,
) {
  mkdirSync(privateFolder, { recursive: true });
  const registry = register(stateDir, project);
  // Under a mutex, so two intakes running at once can't each write back a catalog missing the other's row.
  const memoryPath = join(workspace, MEMORY_FILE);
  const catalog = withMutex(memoryPath, () => {
    const updated = withCatalogRow(readCatalog(workspace), answers.slug, [
      `${answers.courseName} study site`,
      "Study site (learn-premium)",
      "Scaffolded",
      `learn-premium Course project at ${release}; Materials at ${materials}`,
    ]);
    if (updated.added) writeFileSync(memoryPath, updated.memory);
    return updated;
  });
  return {
    project,
    privateFolder,
    release,
    registry: { added: registry.added },
    catalog: { added: catalog.added },
  };
}

/** The Course project already made for these answers (same Course, same Materials), or null. */
function madeBefore(project: string, answers: Answers, materials: string): Ledger | null {
  let ledger: Ledger | null = null;
  try {
    ledger = readLedger(project);
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
  }
  return ledger !== null &&
    ledger.intake.courseName === answers.courseName &&
    samePath(ledger.intake.materialsPath, materials)
    ? ledger
    : null;
}
