// The Build ledger file: its schema, and where it and the areas it watches sit in a Course project.
import {
  arr,
  bool,
  isoDate,
  isoTime,
  nonEmpty,
  nullable,
  obj,
  oneOf,
  record,
  SchemaError,
  sha256,
  fail,
  type Infer,
  type Schema,
} from "./schema.ts";

export const LEDGER_FILE = "build-ledger.json";
/** The Site template's files, copied in at the pinned release. Read-only. */
export const TEMPLATE_DIR = "template";
/** Committed, never deployed: the generated status page and build report, recompute logs, Gate reports. */
export const BUILD_RECORDS_DIR = "build-records";

export const SCHEMA_VERSION = 1;

/** How many Modules the Owner expects this semester, for the media budget check: 1–99 (two-digit ids). */
export const moduleCount: Schema<number> = (v, p) =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 99 ? (v as number) : fail(p, "a whole number 1–99", v);

const intakeShape = obj({
  courseName: nonEmpty,
  materialsPath: nonEmpty,
  disciplines: arr(nonEmpty),
  pad: nonEmpty,
  arabicNotes: bool,
  sittings: arr(obj({ id: nonEmpty, name: nonEmpty, date: nullable(isoDate) })),
  /** Null when the intake didn't record it (a ledger made before the media budget check). */
  expectedModules: nullable(moduleCount),
});

/** Intake answers recorded before the media budget check read as expecting no particular Module count. */
export const intakeSchema: Schema<Infer<typeof intakeShape>> = (v, p) =>
  intakeShape(
    typeof v === "object" && v !== null && !Array.isArray(v) && !("expectedModules" in v)
      ? { ...v, expectedModules: null }
      : v,
    p,
  );

/** The one driving session's claim on the Course. A take-over of a dead session's lock keeps who had it and why. */
const lock = obj({
  holder: nonEmpty,
  since: isoTime,
  tookOverFrom: nullable(obj({ holder: nonEmpty, since: isoTime, reason: nonEmpty })),
});

export const MATERIAL_KINDS = ["pdf", "slides", "document", "image", "audio", "video", "other"] as const;

/** Why a row stopped being current. Superseded rows stay in the ledger as its history. */
const superseded = nullable(obj({ at: isoTime, reason: nonEmpty }));

/** The rows still in force: everything not superseded. */
export function current<T extends { superseded: unknown }>(rows: T[]): T[] {
  return rows.filter((row) => row.superseded === null);
}

/** One Materials file as last built from. `module` is null for a file the Module map leaves out. */
const material = obj({
  path: nonEmpty,
  hash: sha256,
  kind: oneOf(...MATERIAL_KINDS),
  module: nullable(nonEmpty),
  recordedAt: isoTime,
  superseded,
});

/** A Module's two-digit number, which also keys its route. */
export const moduleId: Schema<string> = (v, p) =>
  typeof v === "string" && /^\d{2}$/.test(v) ? v : fail(p, "a two-digit Module number", v);

const moduleRow = obj({
  id: moduleId,
  slug: nonEmpty,
  title: nonEmpty,
  state: oneOf("planned", "building", "live", "failed"),
  recordedAt: isoTime,
  superseded,
});

/** A git commit id (sha1 or sha256 object format). */
export const commitSha: Schema<string> = (v, p) =>
  typeof v === "string" && /^([0-9a-f]{40}|[0-9a-f]{64})$/.test(v) ? v : fail(p, "a full git commit SHA", v);

export const WAVE_KINDS = ["module", "sitting"] as const;
/** How a running wave can end. */
export const WAVE_RESULTS = ["merged", "failed"] as const;

/** One run of a Module or Sitting wave, with the release it built at and the commit it merged. */
const wave = obj({
  id: nonEmpty,
  kind: oneOf(...WAVE_KINDS),
  /** The Module number or the Exam sitting id. */
  target: nonEmpty,
  branch: nonEmpty,
  release: nonEmpty,
  state: oneOf("running", ...WAVE_RESULTS),
  startedAt: isoTime,
  endedAt: nullable(isoTime),
  commit: nullable(commitSha),
  superseded,
});

export const JOB_RESULTS = ["passed", "blocked", "fell-back", "checkpoint"] as const;

/**
 * One job's result inside a wave (a Blind reader, the recompute, a gate run…). `startedAt` is when the
 * main agent launched it and `recordedAt` when the result came back, so the time is measured, not
 * self-reported. A job re-run in the same wave supersedes its earlier row.
 */
const job = obj({
  wave: nonEmpty,
  job: nonEmpty,
  result: oneOf(...JOB_RESULTS),
  startedAt: nullable(isoTime),
  recordedAt: isoTime,
  detail: nullable(nonEmpty),
  superseded,
});

export const RULINGS = ["slip", "divergence"] as const;

/**
 * The Owner's answer to one Checkpoint item, under a key stable across runs (e.g. "01/sheet2-q3"), so
 * a re-run looks it up instead of asking again. `ruling` is set for sheet-vs-recompute items.
 */
const checkpoint = obj({
  key: nonEmpty,
  wave: nonEmpty,
  question: nonEmpty,
  answer: nonEmpty,
  ruling: nullable(oneOf(...RULINGS)),
  answeredAt: isoTime,
  superseded,
});

export const RELAUNCH_OUTCOMES = ["kept", "fixed", "discarded"] as const;

/**
 * A subagent relaunched after its predecessor died mid-job: the predecessor's files, each re-gated
 * before reuse (its hash then, and how many findings the re-gate had on it), and what the relaunched
 * subagent did with it. `closedAt` is null until every file has its outcome. A path is relative to
 * the Course project, or `private:<path>` in the Private folder. No finding's text is kept here: a
 * Blind reader's file quotes the Professor.
 */
const relaunch = obj({
  wave: nonEmpty,
  job: nonEmpty,
  openedAt: isoTime,
  closedAt: nullable(isoTime),
  files: arr(
    obj({
      path: nonEmpty,
      before: sha256,
      /** Whether a gate covers this kind of file at all; an uncovered one is only reviewed. */
      covered: bool,
      findings: (v, p) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fail(p, "a count", v)),
      outcome: nullable(oneOf(...RELAUNCH_OUTCOMES)),
      /** The file's hash once kept or fixed; null when discarded or not settled yet. */
      after: nullable(sha256),
    }),
  ),
  superseded,
});

/** A whole number, 0 or more. */
export const count: Schema<number> = (v, p) =>
  Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fail(p, "a count", v);

export const WORKED_MODELS = ["computable", "illustration"] as const;
/** What an illustration-only figure does on the site: no figure, one that stays as the Materials draw it, or one that animates step by step. */
export const FIGURE_KINDS = ["none", "static", "animate"] as const;

/**
 * A Module wave's tool assignment: each Worked example is computable (it gets a tool) or an
 * illustration (its figure stays static or animates), and each tool names its Discipline, its
 * interaction, and the Toolkit tool it is built as. `ships` is what the Module ends up with: the
 * assigned tool, a step-through, or the next Toolkit tool, each fallback kept in `fallbacks`. The
 * sim builder's hand-back leaves only its counts here: the hand-back itself quotes the Professor and
 * stays in the Private folder. A re-assignment supersedes the wave's row.
 */
const assignment = obj({
  wave: nonEmpty,
  module: moduleId,
  recordedAt: isoTime,
  worked: arr(obj({ n: nonEmpty, model: oneOf(...WORKED_MODELS), figure: nullable(oneOf(...FIGURE_KINDS)) })),
  tools: arr(
    obj({
      name: nonEmpty,
      worked: nullable(nonEmpty),
      discipline: nonEmpty,
      interaction: nonEmpty,
      tool: nonEmpty,
      job: nonEmpty,
      ships: nonEmpty,
      fallbacks: arr(obj({ from: nonEmpty, to: nonEmpty, at: isoTime })),
      handback: nullable(obj({ at: isoTime, files: count, parts: count, nets: count, assumptions: count })),
    }),
  ),
  superseded,
});

/**
 * The Owner's answer on a Discipline the intake didn't list: confirmed (its Toolkit's tools may be
 * assigned for this Course) or declined. The answer is also a Checkpoint row under
 * `NN/discipline/<name>`. A later answer supersedes the earlier one.
 */
const discipline = obj({
  name: nonEmpty,
  wave: nonEmpty,
  confirmed: bool,
  answer: nonEmpty,
  answeredAt: isoTime,
  superseded,
});

/** The Owner-confirmed Module map, or an addition to it: Modules with their Materials, and the files left out. */
export const moduleMapSchema = obj({
  modules: arr(obj({ id: moduleId, slug: nonEmpty, title: nonEmpty, materials: arr(nonEmpty) })),
  unmapped: arr(nonEmpty),
});

/** Where gate gaps are filed: a Course override's gate gap is an issue number here. */
export const GATE_GAP_REPO = "seifyounes/learn-premium";

/** An issue number on learn-premium's tracker. */
export const issueNumber: Schema<number> = (v, p) =>
  Number.isInteger(v) && (v as number) > 0 ? (v as number) : fail(p, "an issue number", v);

/** A gate gap's id in the ledger: lower-case words and dashes, also its fixture folder's name. */
export const gateGapId: Schema<string> = (v, p) =>
  typeof v === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? v : fail(p, "lower-case words joined by dashes", v);

/** Where each gate gap's synthetic minimal broken fixture sits: `<this>/<id>/`, committed with the ledger. */
export const GATE_GAPS_DIR = `${BUILD_RECORDS_DIR}/gate-gaps`;

/**
 * A new kind of defect this Course's build found that no gate caught. Recorded first (`issue` null:
 * unfiled), then filed on learn-premium's tracker with its fixture, the Course and the Course
 * overrides it declares; filing records those overrides against the issue.
 */
const gateGap = obj({
  id: gateGapId,
  title: nonEmpty,
  defect: nonEmpty,
  /** The template-layer paths this Course overrides to work around it. */
  overrides: arr(nonEmpty),
  issue: nullable(issueNumber),
  recordedAt: isoTime,
  filedAt: nullable(isoTime),
  superseded,
});

/** A migration's major release number. */
const major: Schema<number> = (v, p) =>
  Number.isInteger(v) && (v as number) > 0 ? (v as number) : fail(p, "a major release number", v);

export const UPGRADE_STATES = ["running", "merged", "failed"] as const;

/**
 * One Upgrade wave: the Course's template layer moved from release `from` to `to` on its own branch.
 * `base` is `main`'s commit before the wave started; `files` the target release's template hashes.
 * `retire` is the Course overrides the release retires (each tied to the gate gap it closed), `kept` the
 * ones a failing gate put back. `migrations` and `content` are null until the migrations have run:
 * `content` is then the content's hashes, which nothing but a migration may change.
 */
const upgrade = obj({
  id: nonEmpty,
  from: nonEmpty,
  to: nonEmpty,
  branch: nonEmpty,
  base: commitSha,
  /** The Owner's yes, in their words. */
  answer: nonEmpty,
  state: oneOf(...UPGRADE_STATES),
  startedAt: isoTime,
  endedAt: nullable(isoTime),
  commit: nullable(commitSha),
  files: record(sha256),
  retire: arr(obj({ path: nonEmpty, gateGap: issueNumber })),
  kept: arr(obj({ path: nonEmpty, gateGap: issueNumber, reason: nonEmpty, at: isoTime })),
  migrations: nullable(arr(obj({ major, describe: nonEmpty }))),
  content: nullable(record(sha256)),
  /** The gate gap a red wave filed. */
  gateGap: nullable(gateGapId),
  superseded,
});

/** A past paper's name in the content and the Private folder: lower-case words and digits joined by dashes (`2025`, `midterm-2024`). */
export const paperSlug: Schema<string> = (v, p) =>
  typeof v === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? v : fail(p, "lower-case words joined by dashes", v);

/**
 * What the Owner says when a sitting is complete (`sitting complete`): the Modules it covers, the
 * past papers (files in the Materials, each with its name) and the format the Professor announced
 * (the Owner's own words; null when none was). Only his word starts a Sitting wave. A new one
 * supersedes the last for the sitting.
 */
export const sittingCompleteInput = obj({
  sitting: nonEmpty,
  modules: arr(moduleId),
  papers: arr(obj({ slug: paperSlug, path: nonEmpty })),
  announced: nullable(nonEmpty),
  /** The Owner's words, as he said them. */
  answer: nonEmpty,
});

const sittingComplete = obj({
  sitting: nonEmpty,
  modules: arr(moduleId),
  papers: arr(obj({ slug: paperSlug, path: nonEmpty })),
  announced: nullable(nonEmpty),
  answer: nonEmpty,
  at: isoTime,
  superseded,
});

const ledgerShape = obj({
  schema: (v, p) => (v === SCHEMA_VERSION ? SCHEMA_VERSION : failVersion(p, v)),
  intake: intakeSchema,
  template: obj({
    release: nonEmpty,
    /** Path under the template layer → sha256 of its contents. */
    files: record(sha256),
    /** Course overrides: a template-layer path shadowed from the overrides area, and the gate-gap issue it works around. */
    overrides: arr(obj({ path: nonEmpty, gateGap: issueNumber, recordedAt: isoTime, superseded })),
  }),
  materials: arr(material),
  modules: arr(moduleRow),
  waves: arr(wave),
  jobs: arr(job),
  checkpoints: arr(checkpoint),
  lock: nullable(lock),
  gateGaps: arr(gateGap),
  /** The Course build marked done: refused while a gate gap is unfiled; a new wave or gate gap clears it. */
  done: nullable(obj({ holder: nonEmpty, at: isoTime })),
  relaunches: arr(relaunch),
  upgrades: arr(upgrade),
  assignments: arr(assignment),
  disciplines: arr(discipline),
  /** The Owner's word that a sitting is complete, each time he said it. */
  sittingsComplete: arr(sittingComplete),
});

/**
 * A ledger written before gate gaps, relaunches, Upgrade waves or the Owner's complete-sitting word
 * were recorded reads as having none, and not done.
 */
export const ledgerSchema: Schema<Infer<typeof ledgerShape>> = (v, p) =>
  ledgerShape(
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? {
          gateGaps: [],
          done: null,
          relaunches: [],
          upgrades: [],
          assignments: [],
          disciplines: [],
          sittingsComplete: [],
          ...v,
        }
      : v,
    p,
  );

function failVersion(path: string, value: unknown): never {
  throw new SchemaError(
    `${path}: this ledger is schema ${JSON.stringify(value)}; these scripts read schema ${SCHEMA_VERSION}`,
  );
}

export type Ledger = Infer<typeof ledgerSchema>;
export type Intake = Infer<typeof intakeSchema>;
export type Material = Infer<typeof material>;
export type MaterialKind = Material["kind"];
export type ModuleRow = Infer<typeof moduleRow>;
export type Wave = Infer<typeof wave>;
export type WaveKind = Wave["kind"];
export type WaveResult = (typeof WAVE_RESULTS)[number];
export type Job = Infer<typeof job>;
export type JobResult = Job["result"];
export type Checkpoint = Infer<typeof checkpoint>;
export type Ruling = NonNullable<Checkpoint["ruling"]>;
export type ModuleMap = Infer<typeof moduleMapSchema>;
export type GateGap = Infer<typeof gateGap>;
export type Relaunch = Infer<typeof relaunch>;
export type Upgrade = Infer<typeof upgrade>;
export type SittingComplete = Infer<typeof sittingComplete>;
export type SittingCompleteInput = Infer<typeof sittingCompleteInput>;
export type RelaunchOutcome = (typeof RELAUNCH_OUTCOMES)[number];
export type Assignment = Infer<typeof assignment>;
export type AssignedTool = Assignment["tools"][number];
export type DisciplineAnswer = Infer<typeof discipline>;

/** An Exam sitting's state, from its Sitting waves: open until one runs, live once one merges. */
export function sittingState(ledger: Ledger, id: string): "open" | "building" | "live" {
  const waves = current(ledger.waves).filter((w) => w.kind === "sitting" && w.target === id);
  if (waves.some((w) => w.state === "running")) return "building";
  return waves.some((w) => w.state === "merged") ? "live" : "open";
}
