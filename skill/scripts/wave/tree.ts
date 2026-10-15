// Where a Module wave's files are. After Module 1 each Module wave runs in its own git worktree of the
// Course project, on its own branch, while the Build ledger stays in the project's main checkout (on
// `main`), the one place every wave writes it through the ledger's mutex. `ready` judges a wave in its
// own checkout; the checks here keep the branches mergeable one by one: no two branches touch the same
// files, and none touches the ledger.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_RECORDS_DIR, current, LEDGER_FILE, type Ledger, type Wave } from "../ledger/model.ts";
import { BUILD_REPORT, STATUS_PAGE } from "../ledger/render.ts";
import { MEDIA_FILE, MEDIA_PAGE } from "../media/model.ts";

export const MAIN_BRANCH = "main";

/** The Build ledger and the pages generated from it: written only in the main checkout, never on a wave's branch. */
export const LEDGER_FILES: readonly string[] = [
  LEDGER_FILE,
  MEDIA_FILE,
  `${BUILD_RECORDS_DIR}/${STATUS_PAGE}`,
  `${BUILD_RECORDS_DIR}/${BUILD_REPORT}`,
  `${BUILD_RECORDS_DIR}/${MEDIA_PAGE}`,
];

export interface WaveTree {
  path: string;
  /** Whether it is a linked worktree: false for the project's own checkout (the single-checkout mode). */
  linked: boolean;
}

function git(cwd: string, args: string[]) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

/**
 * The checkout git lists for `branch`. `git worktree list --porcelain -z` gives one record per worktree,
 * the main one first, fields NUL-ended and records split by an empty field. Not a repo, or the branch
 * checked out nowhere: the project itself, as the single-checkout mode has it.
 */
export function waveTree(project: string, branch: string): WaveTree {
  const listed = git(project, ["worktree", "list", "--porcelain", "-z"]);
  if (listed.status !== 0) return { path: project, linked: false };
  const records: string[][] = [[]];
  for (const field of listed.stdout.split("\0")) {
    if (field === "") records.push([]);
    else records.at(-1)?.push(field);
  }
  const found = records
    .filter((fields) => fields.length > 0)
    .findIndex((fields) => fields.includes(`branch refs/heads/${branch}`));
  if (found === -1) return { path: project, linked: false };
  const path = records.filter((fields) => fields.length > 0)[found]?.find((f) => f.startsWith("worktree "));
  return path === undefined
    ? { path: project, linked: false }
    : { path: path.slice("worktree ".length), linked: found > 0 };
}

/** Where the running wave of `module` has its files; the project itself when none runs. */
export function moduleTree(project: string, ledger: Ledger, module: string): string {
  const running = current(ledger.waves).find(
    (w) => w.kind === "module" && w.target === module && w.state === "running",
  );
  return running === undefined ? project : waveTree(project, running.branch).path;
}

/**
 * What every Module follows, and no Module wave changes: the Course config, the style sheet (Module 1's
 * wave writes it, alone), the Course overrides and the gate gap records. A wave rebases onto `main` to
 * pick a change up.
 */
const COURSE_YAML = "content/course.yaml";
const COURSE_WIDE = [
  /^content\/course\.yaml$/,
  /^content\/style-sheet\.yaml$/,
  /^overrides\//,
  new RegExp(`^${BUILD_RECORDS_DIR}/gate-gaps/`),
];
const isCourseWide = (path: string) => COURSE_WIDE.some((pattern) => pattern.test(path));

/** Where the running Sitting wave of `id` has its files; the project itself when none runs. */
export function sittingTree(project: string, ledger: Ledger, id: string): string {
  const running = current(ledger.waves).find((w) => w.kind === "sitting" && w.target === id && w.state === "running");
  return running === undefined ? project : waveTree(project, running.branch).path;
}

/**
 * Paths that belong to an Exam sitting other than `sitting` (every sitting's, when none is given): its
 * content, its recompute logs, its Gate report.
 */
export function otherSittingFiles(paths: string[], sitting?: string): string[] {
  const owners = [
    /^content\/sittings\/([^/]+)\//,
    /^content\/build-records\/recompute\/sittings\/([^/]+)\//,
    /^content\/build-records\/gate-reports\/sitting-(.+)\.json$/,
  ];
  return paths.filter((path) =>
    owners.some((owner) => {
      const id = owner.exec(path)?.[1];
      return id !== undefined && id !== sitting;
    }),
  );
}

/** Paths that belong to a Module other than `module`: its content, its build records, its Gate reports. */
export function otherModuleFiles(paths: string[], module: string): string[] {
  const owners = [
    /^content\/modules\/(\d{2})-[^/]+\//,
    /^content\/build-records\/(?!gate-reports\/)[^/]+\/(\d{2})-[^/]+\//,
    /^content\/build-records\/gate-reports\/(?:job|module)-(\d{2})-[^/]+\.json$/,
  ];
  return paths.filter((path) =>
    owners.some((owner) => {
      const id = owner.exec(path)?.[1];
      return id !== undefined && id !== module;
    }),
  );
}

/**
 * The deploy gates run in the wave's worktree and read the Materials inventory (every hash, superseded
 * rows too) from the nearest `build-ledger.json`: the worktree's own committed copy, since the live
 * ledger sits in the main checkout. A copy that predates a Material would let a build step ship that
 * file past the privacy gate, so the worktree must hold every hash the live ledger has.
 */
export function inventoryProblems(ledger: Ledger, tree: WaveTree): string[] {
  if (!tree.linked) return [];
  let held = new Set<string>();
  try {
    const parsed = JSON.parse(readFileSync(join(tree.path, LEDGER_FILE), "utf8")) as {
      materials?: { hash?: string }[];
    };
    held = new Set((parsed.materials ?? []).map((m) => m.hash ?? ""));
  } catch {
    // no readable ledger in the worktree: every Material is missing from it
  }
  const missing = ledger.materials.filter((m) => !held.has(m.hash)).map((m) => m.path);
  if (missing.length === 0) return [];
  return [
    `the wave's worktree holds a Build ledger that predates Materials the live ledger has (${[...new Set(missing)].join(", ")}): the deploy gates there read the Materials inventory from it. Commit the ledger files on ${MAIN_BRANCH}, rebase the wave onto ${MAIN_BRANCH}, and run ready again`,
  ];
}

/** Why the wave's branch can't merge into `main` as it stands, beyond what the wave's own work lacks. */
export function treeProblems(
  project: string,
  wave: Pick<Wave, "branch" | "target"> & Partial<Pick<Wave, "kind">>,
  tree: WaveTree,
): string[] {
  const problems: string[] = [];
  if (tree.linked) {
    const head = git(project, ["symbolic-ref", "--short", "-q", "HEAD"]);
    const on = head.status === 0 ? head.stdout.trim() : null;
    if (on !== MAIN_BRANCH)
      problems.push(
        `the Course project's main checkout is on ${on ?? "no branch"}, not ${MAIN_BRANCH}: the merge fast-forwards ${MAIN_BRANCH} there`,
      );
  }
  const hasMain = git(project, ["rev-parse", "--verify", "-q", `refs/heads/${MAIN_BRANCH}`]).status === 0;
  if (!hasMain) {
    // The single-checkout mode (a project with no `main`) has nothing to compare with.
    return tree.linked ? [...problems, `there's no ${MAIN_BRANCH} branch to merge the wave into`] : problems;
  }
  // Where the branch left main. A branch with no history in common with main has nothing to compare:
  // the single-checkout mode's, where there is no main to merge into.
  const base = git(tree.path, ["merge-base", MAIN_BRANCH, "HEAD"]);
  if (base.status !== 0) {
    return tree.linked
      ? [...problems, `${wave.branch} shares no history with ${MAIN_BRANCH}: it must be a branch of it`]
      : problems;
  }
  // The branch merges by fast-forward only while main is still where it left it; otherwise it rebases.
  const tip = git(project, ["rev-parse", "--verify", "-q", `refs/heads/${MAIN_BRANCH}`]).stdout.trim();
  if (base.stdout.trim() !== tip)
    problems.push(
      `${MAIN_BRANCH} has moved since ${wave.branch} left it: rebase onto ${MAIN_BRANCH}, re-run the gates on the new commit, then run ready again`,
    );
  // NUL-separated, so a name git would quote (non-ASCII, a newline) reaches the checks as it is.
  const diff = git(tree.path, ["diff", "--name-only", "-z", "--no-renames", base.stdout.trim(), "HEAD"]);
  if (diff.status !== 0)
    return [
      ...problems,
      `can't list what ${wave.branch} changes against ${MAIN_BRANCH}: ${diff.stderr.trim() || "git failed"}`,
    ];
  const changed = diff.stdout.split("\0").filter(Boolean);
  const ledgerFiles = tree.linked ? changed.filter((path) => LEDGER_FILES.includes(path)) : [];
  if (ledgerFiles.length > 0)
    problems.push(
      `the wave's branch changes the Build ledger's files (${ledgerFiles.join(", ")}): they're written only in the Course project's main checkout; drop them from the branch`,
    );
  // A Sitting wave marks its sitting complete in course.yaml (`sitting.ts` checks it changes nothing else there).
  const sittingWave = wave.kind === "sitting";
  const shared = tree.linked
    ? changed.filter((path) => isCourseWide(path) && !(sittingWave && path === COURSE_YAML))
    : [];
  if (shared.length > 0)
    problems.push(
      `the wave's branch changes Course-wide files (${shared.join(", ")}): every Module follows them, so they change in the Course project's main checkout, are committed on ${MAIN_BRANCH}, and the waves rebase onto it`,
    );
  if (sittingWave) {
    // A sitting's wave changes its own sitting's files and no Module's.
    const others = [...otherSittingFiles(changed, wave.target), ...otherModuleFiles(changed, "")];
    if (others.length > 0)
      problems.push(
        `the wave's branch changes files that aren't sitting ${wave.target}'s (${others.join(", ")}): a Sitting wave changes only its own sitting, never a Module's or another sitting's`,
      );
    return problems;
  }
  const others = otherModuleFiles(changed, wave.target);
  if (others.length > 0)
    problems.push(
      `the wave's branch changes another Module's files (${others.join(", ")}): a Module wave changes only its own Module`,
    );
  // A Module wave builds Modules: an Exam sitting's content is a Sitting wave's.
  const sittings = otherSittingFiles(changed);
  if (sittings.length > 0)
    problems.push(
      `the wave's branch changes an Exam sitting's files (${sittings.join(", ")}): a Module wave changes only its own Module; a Sitting wave builds a sitting`,
    );
  return problems;
}
