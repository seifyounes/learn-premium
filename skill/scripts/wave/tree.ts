// Where a Module wave's files are. After Module 1 each Module wave runs in its own git worktree of the
// Course project, on its own branch, while the Build ledger stays in the project's main checkout (on
// `main`), the one place every wave writes it through the ledger's mutex. `ready` judges a wave in its
// own checkout; the checks here keep the branches mergeable one by one: no two branches touch the same
// files, and none touches the ledger.
import { spawnSync } from "node:child_process";
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

/** Why the wave's branch can't merge into `main` as it stands, beyond what the wave's own work lacks. */
export function treeProblems(project: string, wave: Wave, tree: WaveTree): string[] {
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
  const diff = git(tree.path, ["diff", "--name-only", "--no-renames", base.stdout.trim(), "HEAD"]);
  if (diff.status !== 0)
    return [
      ...problems,
      `can't list what ${wave.branch} changes against ${MAIN_BRANCH}: ${diff.stderr.trim() || "git failed"}`,
    ];
  const changed = diff.stdout.split(/\r?\n/).filter(Boolean);
  const ledgerFiles = tree.linked ? changed.filter((path) => LEDGER_FILES.includes(path)) : [];
  if (ledgerFiles.length > 0)
    problems.push(
      `the wave's branch changes the Build ledger's files (${ledgerFiles.join(", ")}): they're written only in the Course project's main checkout; drop them from the branch`,
    );
  return problems;
}
