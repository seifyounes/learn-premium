// The fresh reviewer. Once a Module's gates are green on its preview, a reviewer subagent that never
// saw the writing compares the preview's screenshots (every section open, phone and laptop) with the
// rendered pages of the Materials, and reads the content adversarially against them, hunting the
// meaning slips no gate can see. It writes its findings; the main agent re-verifies each one itself,
// on a crop of the Materials or on the screenshot, before it blocks. Everything here quotes the
// Professor, so it lives in the Private folder, under `waves/<NN>/review/`.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { commitSha } from "../ledger/model.ts";
import { arr, fail, nonEmpty, nullable, obj, oneOf, type Infer } from "../ledger/schema.ts";
import { box, pageNumber, readJsonFile, waveFolder } from "./reading.ts";

export const REVIEW = "learn-premium review v1";
export const SHOTS = "learn-premium review shots v1";
export const REVIEW_JOB = "review";

export const reviewFolder = (privateFolder: string, module: string) =>
  join(waveFolder(privateFolder, module), "review");
const SHOTS_MANIFEST = join("shots", "shots.json");

/**
 * One thing the reviewer says is wrong. A `meaning` finding is the adversarial read's: what the
 * content file says against what the Materials region says. A `visual` one is the eyes loop's: what
 * a screenshot shows against the Professor's page (a redrawn figure or table that isn't the source's).
 */
const findingSchema = obj({
  kind: oneOf("meaning", "visual"),
  /** The content file, relative to the Course's content folder (`modules/01-x/summary/2.md`). */
  content: nullable(nonEmpty),
  /** The screenshot it is seen in, relative to the Private folder. */
  screenshot: nullable(nonEmpty),
  /** Where in the Materials: the file as the Build ledger names it, its page, and the region. */
  materials: nullable(obj({ file: nonEmpty, page: nullable(pageNumber), box: nullable(box) })),
  site: nonEmpty,
  source: nonEmpty,
  why: nonEmpty,
});
type Finding = Infer<typeof findingSchema>;

const reviewSchema = obj({
  review: (v, p) => (v === REVIEW ? REVIEW : fail(p, JSON.stringify(REVIEW), v)),
  module: (v, p) => (typeof v === "string" && /^\d{2}$/.test(v) ? v : fail(p, "a two-digit Module number", v)),
  /** The commit whose preview the reviewer looked at. */
  commit: commitSha,
  findings: arr(findingSchema),
});

/** The main agent's verdict on one finding, after looking at it again itself. */
const verdictSchema = obj({
  key: nonEmpty,
  verdict: oneOf("confirmed", "rejected"),
  /** What it was re-verified on: a crop of the Materials or a screenshot, relative to the Private folder. */
  evidence: nullable(nonEmpty),
  /** For a confirmed finding: the job that made it and fixes it (`writer`, `sim-ramp`…). */
  fix: nullable(nonEmpty),
  reason: nonEmpty,
});
const verdictsSchema = obj({ verdicts: arr(verdictSchema) });

const shotsSchema = obj({
  shots: (v, p) => (v === SHOTS ? SHOTS : fail(p, JSON.stringify(SHOTS), v)),
  module: nonEmpty,
  url: nonEmpty,
  commit: commitSha,
  files: arr(
    obj({
      device: oneOf("phone", "laptop"),
      width: (v, p) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : fail(p, "a width in px", v)),
      view: (v, p) => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : fail(p, "a view number", v)),
      file: nonEmpty,
    }),
  ),
});

/** A finding's key: a hash of everything it says, so a verdict stands only for the finding it was made on. */
const findingKey = (f: Finding) => `r-${createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 10)}`;

/** A path the reviewer or the main agent names, which must be a file in the Private folder. */
function inPrivate(privateFolder: string, path: string, what: string): string {
  const full = join(privateFolder, path);
  const rel = relative(privateFolder, full);
  if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(full))
    throw new LedgerError("invalid", `${what} names ${path}, which isn't in the Private folder`);
  return full;
}

export interface ReviewState {
  /** Why the review isn't there to judge yet (no review, no screenshots of its commit). */
  problems: string[];
  commit: string | null;
  unverified: (Finding & { key: string })[];
  confirmed: (Finding & { key: string; fix: string; evidence: string })[];
  rejected: number;
}

/** The Module's review as it stands: its findings, each verified or not, and the screenshots it was made on. */
export function reviewState(privateFolder: string, module: string): ReviewState {
  const folder = reviewFolder(privateFolder, module);
  const empty: ReviewState = { problems: [], commit: null, unverified: [], confirmed: [], rejected: 0 };
  if (!existsSync(join(folder, "review.json")))
    return {
      ...empty,
      problems: [
        `no review.json in ${folder}: launch a fresh reviewer (briefs/reviewer.md) on the preview's screenshots`,
      ],
    };
  const review = readJsonFile(join(folder, "review.json"), reviewSchema, "review.json");
  if (review.module !== module)
    throw new LedgerError("invalid", `review.json reviews Module ${review.module}, not ${module}`);
  review.findings.forEach((f, i) => {
    const at = `review.json: finding ${i + 1}`;
    if (f.kind === "meaning" && (f.content === null || f.materials === null))
      throw new LedgerError(
        "invalid",
        `${at} is a meaning finding: it names the content file and the Materials region`,
      );
    if (f.kind === "visual") {
      if (f.screenshot === null) throw new LedgerError("invalid", `${at} is a visual finding: it names its screenshot`);
      inPrivate(privateFolder, f.screenshot, at);
    }
  });

  const problems = shotsProblems(folder, review.commit);
  const verdicts = existsSync(join(folder, "verdicts.json"))
    ? readJsonFile(join(folder, "verdicts.json"), verdictsSchema, "verdicts.json").verdicts
    : [];
  const byKey = new Map(verdicts.map((v) => [v.key, v]));
  const state: ReviewState = { ...empty, problems, commit: review.commit };
  for (const finding of review.findings) {
    const key = findingKey(finding);
    const verdict = byKey.get(key);
    if (verdict === undefined) {
      state.unverified.push({ key, ...finding });
      continue;
    }
    if (verdict.verdict === "rejected") {
      state.rejected += 1;
      continue;
    }
    if (verdict.evidence === null)
      throw new LedgerError("invalid", `the verdict on ${key} confirms it on no evidence: name the crop or screenshot`);
    inPrivate(privateFolder, verdict.evidence, `the verdict on ${key}`);
    if (verdict.fix === null) throw new LedgerError("invalid", `the verdict on ${key} names no job to fix it`);
    state.confirmed.push({ key, ...finding, fix: verdict.fix, evidence: verdict.evidence });
  }
  return state;
}

/** Why the screenshots don't stand behind the review: missing, of another commit, or short of a device. */
function shotsProblems(folder: string, commit: string): string[] {
  const manifest = join(folder, SHOTS_MANIFEST);
  if (!existsSync(manifest))
    return [
      `no screenshots at ${manifest}: take them with the template's \`npm run gates -- shots\` before the review`,
    ];
  const shots = readJsonFile(manifest, shotsSchema, "shots.json");
  if (shots.commit !== commit)
    return [`the screenshots are of ${shots.commit}, not ${commit}, the commit the review says it reviewed`];
  return (["phone", "laptop"] as const).flatMap((device) =>
    shots.files.some((f) => f.device === device && existsSync(join(folder, "shots", f.file)))
      ? []
      : [`no ${device} screenshot in ${join(folder, "shots")}`],
  );
}

/** What `wave.ts review` reports: the review's state and the next step. */
export function reviewReport(privateFolder: string, module: string) {
  const state = reviewState(privateFolder, module);
  const open = state.problems.length + state.unverified.length + state.confirmed.length > 0;
  const next =
    state.problems.length > 0
      ? state.problems[0]
      : state.unverified.length > 0
        ? "re-verify each finding yourself before it blocks: crop its Materials region (or open its screenshot), look, and record a verdict in verdicts.json"
        : state.confirmed.length > 0
          ? "record the review job blocked; each confirmed finding goes back to the job named in fix, then the gates re-run and a fresh reviewer reviews the new commit"
          : "the review is settled: record the review job passed";
  return { code: open ? 1 : 0, ...state, next };
}

/**
 * Why the Module's review doesn't let the wave merge: missing, not of HEAD's Module content (a fix
 * since needs a fresh reviewer), a finding the main agent hasn't re-verified, or a confirmed one.
 */
export function reviewReadyProblems(project: string, privateFolder: string, module: string, folder: string): string[] {
  let state: ReviewState;
  try {
    state = reviewState(privateFolder, module);
  } catch (error) {
    if (error instanceof LedgerError) return [`the fresh reviewer's files don't read: ${error.message}`];
    throw error;
  }
  if (state.commit !== null) {
    // What the Module page renders from: its content, the Course config and style sheet, the
    // template layer and the Course overrides that shadow it. Another Module's content, the ledger
    // and the Gate reports don't change this page.
    const rendersFrom = [
      `content/modules/${folder}`,
      "content/course.yaml",
      "content/style-sheet.yaml",
      "template",
      "overrides",
    ];
    const diff = spawnSync("git", ["-C", project, "diff", "--name-only", state.commit, "HEAD", "--", ...rendersFrom], {
      encoding: "utf8",
    });
    if (diff.status !== 0)
      return [`can't compare the review's commit ${state.commit} with HEAD: ${diff.stderr.trim() || "git failed"}`];
    const changed = diff.stdout.split(/\r?\n/).filter(Boolean);
    if (changed.length > 0)
      return [
        `the review is of ${state.commit}, but what the Module page renders from changed since (${changed.join(", ")}): have a fresh reviewer review HEAD's preview`,
      ];
  }
  return [
    ...state.problems,
    ...state.unverified.map(
      (f) =>
        `the fresh reviewer's finding ${f.key} isn't re-verified: look at it yourself and record a verdict (wave.ts review)`,
    ),
    ...state.confirmed.map(
      (f) =>
        `the fresh reviewer's confirmed finding ${f.key} (${f.content ?? f.screenshot}) goes back to ${f.fix}: fix it, re-run the gates, and have a fresh reviewer review the new commit`,
    ),
  ];
}
