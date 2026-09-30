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

export const intakeSchema = obj({
  courseName: nonEmpty,
  materialsPath: nonEmpty,
  disciplines: arr(nonEmpty),
  pad: nonEmpty,
  arabicNotes: bool,
  sittings: arr(obj({ id: nonEmpty, name: nonEmpty, date: nullable(isoDate) })),
});

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

export const ledgerSchema = obj({
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
});

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

/** An Exam sitting's state, from its Sitting waves: open until one runs, live once one merges. */
export function sittingState(ledger: Ledger, id: string): "open" | "building" | "live" {
  const waves = current(ledger.waves).filter((w) => w.kind === "sitting" && w.target === id);
  if (waves.some((w) => w.state === "running")) return "building";
  return waves.some((w) => w.state === "merged") ? "live" : "open";
}
