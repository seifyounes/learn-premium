// The Template release sequence: CI green → the Fixture Course's Tool gallery deployed with its
// live gates green → the Owner's real-phone pass → tag. Every step is checked on one exact commit,
// the candidate, and a tag is cut only when all three hold on it.
import type { Git } from "./git.ts";
import { overridesOnIssue, type Bump, type ClosedGateGap, type NotesInput, type PhonePass } from "./notes.ts";

/** The workflows whose newest run on the candidate must be green. */
export const REQUIRED_WORKFLOWS = [
  ".github/workflows/template-ci.yml",
  ".github/workflows/skill-ci.yml",
  ".github/workflows/migration-harness.yml",
] as const;

/** Set by the Fixture live gates run once production serves the commit and its live gates pass. */
export const LIVE_CONTEXT = "learn-premium/live-gates";
/** Set by the Owner's `record-phone-pass`: the Tool gallery tried on a real phone. */
export const PHONE_PASS_CONTEXT = "learn-premium/real-phone-pass";

export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface WorkflowRun {
  /** The workflow file's path, e.g. `.github/workflows/template-ci.yml`. */
  workflow: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
}

export interface CommitStatus {
  context: string;
  state: string;
  description: string | null;
  targetUrl: string | null;
  creator: string | null;
  createdAt: string;
}

export interface GateGapIssue {
  number: number;
  title: string;
  body: string | null;
  stateReason: string | null;
}

/** GitHub, as the release sequence uses it. */
export interface Forge {
  /** Workflow runs on exactly this commit. */
  runs(sha: string): Promise<WorkflowRun[]>;
  /** The commit's statuses, newest first. */
  statuses(sha: string): Promise<CommitStatus[]>;
  setStatus(
    sha: string,
    status: { state: "success"; context: string; description: string; targetUrl: string | null },
  ): Promise<void>;
  /** The repo owner's login: the Owner. */
  owner(): Promise<string>;
  /** Who the gh CLI is signed in as. */
  viewer(): Promise<string>;
  /** Closed issues labelled `gate-gap`. */
  closedGateGaps(): Promise<GateGapIssue[]>;
  /** The Tool gallery of this commit's Fixture Course deployment, when one is known. */
  galleryUrl(sha: string): Promise<string | null>;
  /** Publishes the GitHub Release for an existing tag; returns its URL. */
  createRelease(tag: string, title: string, notes: string): Promise<string>;
}

export interface Deps {
  git: Git;
  forge: Forge;
}

export interface Step {
  ok: boolean;
  lines: string[];
}

export interface Steps {
  ci: Step;
  gallery: Step & { url: string | null };
  pass: Step & { pass: PhonePass | null };
}

const workflowFile = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Step 1: the newest run of every required workflow on the candidate is green. */
export async function ciStep(forge: Forge, sha: string, onMainTip: boolean): Promise<Step> {
  const runs = await forge.runs(sha);
  const lines: string[] = [];
  let ok = true;
  for (const workflow of REQUIRED_WORKFLOWS) {
    const newest = runs
      .filter((r) => r.workflow === workflow)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const file = workflowFile(workflow);
    if (newest === undefined) {
      ok = false;
      lines.push(
        onMainTip
          ? `${file}: no run on this commit; start one with: gh workflow run ${file} --ref main`
          : `${file}: no run on this commit`,
      );
    } else if (newest.status !== "completed") {
      ok = false;
      lines.push(`${file}: still running (${newest.url})`);
    } else if (newest.conclusion !== "success") {
      ok = false;
      lines.push(`${file}: ${newest.conclusion ?? "no conclusion"} (${newest.url})`);
    } else {
      lines.push(`${file}: success`);
    }
  }
  return { ok, lines };
}

/** The newest status of one context on a commit. */
const newest = (statuses: CommitStatus[], context: string) => statuses.find((s) => s.context === context);

/** Step 2: the Fixture Course deployed from the candidate, and its live gates passed. */
export async function galleryStep(forge: Forge, sha: string): Promise<Steps["gallery"]> {
  const live = newest(await forge.statuses(sha), LIVE_CONTEXT);
  const url = await forge.galleryUrl(sha);
  const ok = live?.state === "success";
  const lines = [
    live === undefined
      ? `no ${LIVE_CONTEXT} status on this commit: it hasn't deployed, or the live gates haven't run (fixture-live.yml)`
      : `${LIVE_CONTEXT}: ${live.state}${live.description ? ` (${live.description})` : ""}`,
    `Tool gallery: ${url ?? "no deployment URL known for this commit"}`,
  ];
  return { ok, lines, url };
}

/** Step 3: the Owner's real-phone pass, recorded on exactly this commit by the Owner. */
export async function passStep(forge: Forge, sha: string): Promise<Steps["pass"]> {
  const status = newest(await forge.statuses(sha), PHONE_PASS_CONTEXT);
  if (status === undefined) return { ok: false, lines: ["no real-phone pass recorded on this commit"], pass: null };
  const owner = await forge.owner();
  if (status.state !== "success") {
    return { ok: false, lines: [`the newest real-phone pass record is ${status.state}`], pass: null };
  }
  if (status.creator !== owner) {
    return {
      ok: false,
      lines: [`a real-phone pass was recorded by @${status.creator ?? "unknown"}, not the Owner (@${owner})`],
      pass: null,
    };
  }
  const pass: PhonePass = {
    description: status.description ?? "",
    by: status.creator,
    at: status.createdAt,
    url: status.targetUrl,
  };
  return { ok: true, lines: [`${pass.description} · recorded by @${pass.by} at ${pass.at}`], pass };
}

export async function steps(deps: Deps, sha: string): Promise<Steps> {
  const onMainTip = deps.git.resolve(deps.git.mainRef) === sha;
  return {
    ci: await ciStep(deps.forge, sha, onMainTip),
    gallery: await galleryStep(deps.forge, sha),
    pass: await passStep(deps.forge, sha),
  };
}

// --- Versions ---

type Version = [number, number, number];

const parse = (tag: string): Version | null => {
  const m = RELEASE_TAG.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const format = (v: Version) => `v${v.join(".")}`;
const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export interface Plan {
  previous: string | null;
  version: string | null;
  kind: Bump | null;
  problems: string[];
}

/**
 * The version to cut and whether it may be cut on `sha`: newer than origin's latest release, on
 * top of it, and a major exactly when the commit ships the new major's migration.
 */
export function plan(git: Git, sha: string, wanted: { bump?: Bump; version?: string }): Plan {
  const problems: string[] = [];
  const tags = git.originTags();
  const releases = [...tags.keys()]
    .map((name) => ({ name, v: parse(name) }))
    .filter((t): t is { name: string; v: Version } => t.v !== null)
    .sort((a, b) => compare(a.v, b.v));
  const latest = releases.at(-1) ?? null;
  const base: Version = latest?.v ?? [0, 0, 0];

  let next: Version | null = null;
  if (wanted.version !== undefined) {
    next = parse(wanted.version);
    if (next === null) problems.push(`"${wanted.version}" is not a release version (vX.Y.Z)`);
  } else if (wanted.bump === "major") next = [base[0] + 1, 0, 0];
  else if (wanted.bump === "minor") next = [base[0], base[1] + 1, 0];
  else if (wanted.bump === "patch") next = [base[0], base[1], base[2] + 1];
  if (next === null) return { previous: latest?.name ?? null, version: null, kind: null, problems };

  const version = format(next);
  const kind: Bump = next[0] !== base[0] ? "major" : next[1] !== base[1] ? "minor" : "patch";
  if (latest !== null && compare(next, latest.v) <= 0) {
    problems.push(`${version} is not newer than the latest release ${latest.name}`);
  }
  if (tags.has(version)) problems.push(`origin already has a tag ${version}`);
  if (latest !== null) {
    const released = tags.get(latest.name) ?? "";
    if (!git.isAncestor(released, sha))
      problems.push(`the candidate isn't on top of the latest release ${latest.name}`);
    // A major ships the migration for every major it crosses; nothing else ships one.
    const shipped = git.migrations(sha).filter((m) => m.major > base[0]);
    for (let major = base[0] + 1; major <= next[0]; major++) {
      if (!shipped.some((m) => m.major === major)) {
        problems.push(`${version} is a major release but ships no template/migrations/v${major}.ts`);
      }
    }
    for (const m of shipped.filter((m) => m.major > next[0])) {
      problems.push(`the candidate ships ${m.file}, so it must be a major release (v${m.major}.0.0)`);
    }
  }
  return { previous: latest?.name ?? null, version, kind, problems };
}

// --- Notes ---

export interface NotesDraft {
  input: NotesInput;
  /** Things the Owner should look at before tagging; they don't block. */
  checks: string[];
}

/**
 * The notes for cutting `version` on `sha`: the `gate-gap` issues closed as completed that a
 * commit since the previous release names (`#N`), with the Course overrides on each issue.
 */
export async function draftNotes(
  deps: Deps,
  sha: string,
  release: { version: string; previous: string | null; kind: Bump },
  pass: PhonePass | null,
): Promise<NotesDraft> {
  const previousSha = release.previous === null ? null : (deps.git.originTags().get(release.previous) ?? null);
  const named = (messages: string[]) =>
    new Set(messages.flatMap((m) => [...m.matchAll(/(?<![\w/])#(\d+)\b/g)].map((x) => Number(x[1]))));
  const inRange = named(deps.git.messages(previousSha, sha));
  const ever = named(deps.git.messages(null, sha));
  const completed = (await deps.forge.closedGateGaps())
    .filter((g) => g.stateReason !== "not_planned")
    .sort((a, b) => a.number - b.number);
  const gateGaps: ClosedGateGap[] = completed
    .filter((g) => inRange.has(g.number))
    .map((g) => ({ number: g.number, title: g.title, ...overridesOnIssue(g.body) }));
  const checks = completed
    .filter((g) => !ever.has(g.number))
    .map(
      (g) =>
        `gate gap #${g.number} is closed but no commit up to ${sha.slice(0, 7)} names it, so it isn't in these notes`,
    );
  const migrations =
    release.kind === "major"
      ? deps.git
          .migrations(sha)
          .filter((m) => release.previous === null || m.major > (parse(release.previous)?.[0] ?? 0))
          .map(({ major, describe }) => ({ major, describe }))
      : [];
  return {
    input: { ...release, sha, gateGaps, migrations, phonePass: pass },
    checks,
  };
}
