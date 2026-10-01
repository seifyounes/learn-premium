// The Media pass's files: each Course's media file (part of its Build ledger, written only by the Media
// pass), and the machine state folder's Course registry and quota/usage log.
import { homedir } from "node:os";
import { join } from "node:path";
import { moduleId } from "../ledger/model.ts";
import {
  arr,
  fail,
  isoDate,
  isoTime,
  nonEmpty,
  nullable,
  obj,
  oneOf,
  SchemaError,
  sha256,
  type Infer,
  type Schema,
} from "../ledger/schema.ts";

/** Beside `build-ledger.json` in a Course project: the media items' states. Only the Media pass writes it. */
export const MEDIA_FILE = "build-media.json";
/** The generated page for one Course's media, in its build-records area. */
export const MEDIA_PAGE = "media.md";
/** In the machine state folder: the Course registry and the quota/usage log. */
export const REGISTRY_FILE = "courses.json";
export const USAGE_FILE = "media-usage.json";
/** In the machine state folder: the dedicated Chrome profile the Media pass drives NotebookLM in. */
export const CHROME_FILE = "chrome.json";
/** In a Course project: where downloaded and hand-made media wait for `ingest`. It ignores itself in git. */
export const INBOX_DIR = "media-inbox";

/** Where the installer puts the machine state folder (machine_install.py's `Layout.state`). */
export const DEFAULT_STATE_DIR = join(homedir(), ".claude", "learn-premium", "state");

export const SCHEMA_VERSION = 1;

/** A Module gets these three; an Exam sitting gets a sitting audio once its Sitting wave merged. */
export const MODULE_MEDIA = ["video", "audio", "infographic"] as const;
export const MEDIA_KINDS = [...MODULE_MEDIA, "sitting-audio"] as const;

/** queued → generating → downloaded → checked → placed; a failure goes back to queued once, then to dropped. */
export const ITEM_STATES = ["queued", "generating", "downloaded", "checked", "placed", "dropped"] as const;
/** Started and not yet placed or dropped: the quota for these is already spent. */
export const IN_FLIGHT = ["generating", "downloaded", "checked"] as const;
/** A failed item is made again this many times before it is dropped. */
export const MAX_REGENERATIONS = 1;

/** NotebookLM's two limits: a rolling 5-hour window that refreshes, and a weekly cap. */
export const LIMITS = ["5-hour", "weekly"] as const;
export const WINDOW_MS: Record<Limit, number> = { "5-hour": 5 * 3_600_000, weekly: 7 * 24 * 3_600_000 };

function version(value: unknown, path: string): typeof SCHEMA_VERSION {
  if (value === SCHEMA_VERSION) return SCHEMA_VERSION;
  throw new SchemaError(
    `${path}: this file is schema ${JSON.stringify(value)}; these scripts read schema ${SCHEMA_VERSION}`,
  );
}

const count =
  (min: number, max: number): Schema<number> =>
  (v, p) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      ? (v as number)
      : fail(p, `a whole number ${min}–${max}`, v);

/** An amount of NotebookLM usage, in whatever unit Settings → Usage shows. */
export const units: Schema<number> = (v, p) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fail(p, "a positive number", v);

const itemShape = obj({
  /** `module-01-video`, `sitting-final-audio`: stable across passes. */
  id: nonEmpty,
  /** Exactly one of `module` and `sitting` is set: a sitting audio belongs to its sitting, the rest to a Module. */
  module: nullable(moduleId),
  sitting: nullable(nonEmpty),
  kind: oneOf(...MEDIA_KINDS),
  state: oneOf(...ITEM_STATES),
  regenerations: count(0, MAX_REGENERATIONS),
  /** The date of the nearest Exam sitting it serves, refreshed at every gather; null when none is dated ahead. */
  nearestSitting: nullable(isoDate),
  /** Where the placed file sits in the Course project. */
  file: nullable(nonEmpty),
  failures: arr(obj({ at: isoTime, state: oneOf(...IN_FLIGHT), reason: nonEmpty })),
  queuedAt: isoTime,
  updatedAt: isoTime,
});

const item: Schema<Infer<typeof itemShape>> = (v, p) => {
  const row = itemShape(v, p);
  const forSitting = row.kind === "sitting-audio";
  if (forSitting ? row.sitting === null || row.module !== null : row.module === null || row.sitting !== null) {
    fail(
      p,
      forSitting ? "a sitting audio with its sitting and no Module" : "a Module item with its Module and no sitting",
      v,
    );
  }
  if ((row.state === "placed") !== (row.file !== null))
    fail(`${p}.file`, "a file exactly when the item is placed", row.file);
  return row;
};

/** A NotebookLM notebook address. */
export const notebookUrl: Schema<string> = (v, p) =>
  typeof v === "string" && /^https:\/\/(notebook|notebooklm)\.google\.com\/notebook\/[\w-]+$/.test(v)
    ? v
    : fail(p, "a NotebookLM notebook address (https://notebook.google.com/notebook/<id>)", v);

/** The Course notebook: where it is, and each Material uploaded to it at the hash its Module was built from. */
const notebookShape = obj({
  url: notebookUrl,
  sources: arr(obj({ material: nonEmpty, hash: sha256, title: nonEmpty, addedAt: isoTime })),
});

const mediaFileShape = obj({
  schema: version,
  course: nonEmpty,
  /** Null until the Course notebook is made. */
  notebook: nullable(notebookShape),
  items: arr(item),
});

/** A media file written before the Course notebook was recorded reads as having none. */
export const mediaFileSchema: Schema<Infer<typeof mediaFileShape>> = (v, p) =>
  mediaFileShape(typeof v === "object" && v !== null && !("notebook" in v) ? { ...v, notebook: null } : v, p);

export const chromeSchema = obj({ schema: version, profile: nonEmpty });

export const registrySchema = obj({
  schema: version,
  courses: arr(obj({ project: nonEmpty, course: nonEmpty, addedAt: isoTime })),
});

const perKind = obj({
  video: nullable(units),
  audio: nullable(units),
  infographic: nullable(units),
  "sitting-audio": nullable(units),
});

export const usageSchema = obj({
  schema: version,
  /** The Owner's measured numbers, from NotebookLM's Settings → Usage; null until measured. */
  limits: obj({ "5-hour": nullable(units), weekly: nullable(units) }),
  costs: perKind,
  /** One per generation started. `attempt` is 1, then 2 for the regeneration. A generation NotebookLM refused is voided. */
  spends: arr(
    obj({
      at: isoTime,
      project: nonEmpty,
      item: nonEmpty,
      kind: oneOf(...MEDIA_KINDS),
      attempt: count(1, MAX_REGENERATIONS + 1),
      voided: nullable(obj({ at: isoTime, reason: nonEmpty })),
    }),
  ),
  /** Each time NotebookLM said a limit was reached, and when it lifts. */
  stops: arr(obj({ at: isoTime, limit: oneOf(...LIMITS), until: isoTime })),
});

export type MediaFile = Infer<typeof mediaFileSchema>;
export type MediaItem = MediaFile["items"][number];
export type MediaKind = MediaItem["kind"];
export type ItemState = MediaItem["state"];
export type CourseNotebook = Infer<typeof notebookShape>;
export type Registry = Infer<typeof registrySchema>;
export type Usage = Infer<typeof usageSchema>;
export type Limit = (typeof LIMITS)[number];
