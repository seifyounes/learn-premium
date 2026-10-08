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
  /** When its latest attempt started: a re-run keeps the run's createdAt but moves this. */
  startedAt: string;
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
  /**
   * The Tool gallery on this commit's newest successful Production deployment, and when that
   * deployment went live (GitHub's clock), or null when GitHub knows none.
   */
  gallery(sha: string): Promise<{ url: string; deployedAt: string } | null>;
  /** Publishes the GitHub Release for an existing tag; returns its URL. */
  createRelease(tag: string, title: string, notes: string): Promise<string>;
  /**
   * When GitHub published the release's GitHub Release (its server clock, made right after the
   * tag's push), or null when there's none. A tag's own date comes from the Owner's clock.
   */
  releasePublishedAt(tag: string): Promise<string | null>;
}

/** The workflow whose result depends on which release is the latest: it upgrades that one's Fixture Course. */
export const HARNESS_WORKFLOW = ".github/workflows/migration-harness.yml";

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

/**
 * Step 1: the latest attempt of every required workflow on the candidate is green. The migration
 * harness must also have started after the latest release was published (GitHub's own clock on
 * both sides): it upgrades the Fixture Course of whichever release was latest when it ran, so an
 * older run proved the wrong upgrade.
 */
export async function ciStep(
  forge: Forge,
  sha: string,
  onMainTip: boolean,
  latestRelease: { name: string; publishedAt: string | null } | null = null,
): Promise<Step> {
  const runs = await forge.runs(sha);
  const lines: string[] = [];
  let ok = true;
  for (const workflow of REQUIRED_WORKFLOWS) {
    const newest = runs
      .filter((r) => r.workflow === workflow)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.createdAt.localeCompare(a.createdAt))[0];
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
    } else if (workflow === HARNESS_WORKFLOW && latestRelease !== null && latestRelease.publishedAt === null) {
      ok = false;
      lines.push(
        `${file}: ${latestRelease.name} has no published GitHub Release to date it by; publish it ` +
          `(gh release create ${latestRelease.name} --verify-tag --notes-from-tag), then re-run this workflow`,
      );
    } else if (
      workflow === HARNESS_WORKFLOW &&
      latestRelease?.publishedAt != null &&
      // GitHub's timestamps have whole seconds: a run in the same second may have come first.
      Date.parse(newest.startedAt) <= Date.parse(latestRelease.publishedAt)
    ) {
      ok = false;
      lines.push(
        `${file}: its run predates ${latestRelease.name}, so it upgraded an older release's Fixture Course; ` +
          (onMainTip ? `re-run it: gh workflow run ${file} --ref main` : "re-run it on this commit"),
      );
    } else {
      lines.push(`${file}: success`);
    }
  }
  return { ok, lines };
}

/** The newest status of one context on a commit. */
const newest = (statuses: CommitStatus[], context: string) => statuses.find((s) => s.context === context);

/**
 * Step 2: the Fixture Course deployed from the candidate, and its live gates passed on that
 * deployment: the green status must be newer than the deployment whose gallery the Owner tests.
 * A redeploy of the same commit needs its own green run.
 */
export async function galleryStep(forge: Forge, sha: string): Promise<Steps["gallery"]> {
  const live = newest(await forge.statuses(sha), LIVE_CONTEXT);
  const gallery = await forge.gallery(sha);
  const url = gallery?.url ?? null;
  // The phone pass needs a URL that serves this commit's build and nothing newer.
  const greenOnIt =
    live?.state === "success" && gallery !== null && Date.parse(live.createdAt) > Date.parse(gallery.deployedAt);
  const lines = [
    live === undefined
      ? `no ${LIVE_CONTEXT} status on this commit: it hasn't deployed, or the live gates haven't run (fixture-live.yml)`
      : `${LIVE_CONTEXT}: ${live.state}${live.description ? ` (${live.description})` : ""}`,
    `Tool gallery: ${url ?? "GitHub knows no deployment URL of this commit's own build, so there's nothing to test"}`,
    ...(live?.state === "success" && gallery !== null && !greenOnIt
      ? [`the live gates' green predates this deployment (${gallery.deployedAt}); wait for its own live-gates run`]
      : []),
  ];
  return { ok: greenOnIt, lines, url };
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
  const latest = latestRelease(deps.git);
  const released = latest === null ? null : { name: latest, publishedAt: await deps.forge.releasePublishedAt(latest) };
  return {
    ci: await ciStep(deps.forge, sha, onMainTip, released),
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

/** Origin's release tags, oldest version first. */
function releasesOn(git: Git): { name: string; v: Version }[] {
  return [...git.originTags().keys()]
    .map((name) => ({ name, v: parse(name) }))
    .filter((t): t is { name: string; v: Version } => t.v !== null)
    .sort((a, b) => compare(a.v, b.v));
}

/** Origin's latest release tag, or null before the first release. */
export const latestRelease = (git: Git): string | null => releasesOn(git).at(-1)?.name ?? null;

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
  const latest = releasesOn(git).at(-1) ?? null;
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
  // Before the first release the base is v0.0.0, which is never a release itself.
  if (compare(next, base) <= 0) {
    problems.push(`${version} is not newer than ${latest ? `the latest release ${latest.name}` : "v0.0.0"}`);
  }
  if (tags.has(version)) problems.push(`origin already has a tag ${version}`);
  const carried = git.migrations(sha);
  if (latest !== null) {
    const released = tags.get(latest.name) ?? "";
    if (!git.isAncestor(released, sha))
      problems.push(`the candidate isn't on top of the latest release ${latest.name}`);
    // A release keeps every migration an earlier one shipped, unchanged: a Course on an older
    // release still upgrades through them, and the harness only replays the latest release's.
    for (const old of git.migrations(released)) {
      const now = carried.find((m) => m.file === old.file);
      if (now === undefined) {
        problems.push(
          `the candidate drops ${old.file}, which ${latest.name} shipped; a Course upgrading through it needs it`,
        );
      } else if (now.blob !== old.blob) {
        problems.push(`the candidate changes ${old.file}, which ${latest.name} shipped; a shipped migration is final`);
      }
    }
  }
  // A major ships the migration for every major it crosses; nothing else ships one. Before the
  // first release the base is v0.0.0, so a first release can't carry a migration for a later major.
  const shipped = carried.filter((m) => m.major > base[0]);
  for (let major = base[0] + 1; major <= next[0]; major++) {
    if (!shipped.some((m) => m.major === major)) {
      problems.push(`${version} is a major release but ships no template/migrations/v${major}.ts`);
    }
  }
  for (const m of shipped.filter((m) => m.major > next[0])) {
    problems.push(`the candidate ships ${m.file}, so it must be a major release (v${m.major}.0.0)`);
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
