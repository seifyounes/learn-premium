// The Media pass's state commands. The Media pass is the only writer of the media files, the Course
// registry and the usage log; it only reads Build ledgers, so it never needs (or waits on) a ledger lock.
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { current, sittingState, type Ledger } from "../ledger/model.ts";
import { LedgerError, readLedger } from "../ledger/store.ts";
import {
  IN_FLIGHT,
  MAX_REGENERATIONS,
  MEDIA_KINDS,
  MODULE_MEDIA,
  SCHEMA_VERSION,
  WINDOW_MS,
  type ItemState,
  type Limit,
  type MediaFile,
  type MediaItem,
  type MediaKind,
  type Usage,
} from "./model.ts";
import { capacity, price, stopFor, type Stop } from "./quota.ts";
import { writeMediaPage } from "./render.ts";
import {
  noMediaFile,
  readMediaFile,
  readRegistry,
  readUsage,
  updateMediaFile,
  updateRegistry,
  updateUsage,
} from "./store.ts";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Adds a Course to the machine's Course registry (at intake), so every Media pass gathers it. */
export function register(stateDir: string, project: string): { course: string; added: boolean } {
  const path = resolve(project);
  const ledger = readLedger(path);
  if (ledger === null) throw new LedgerError("refused", `no Build ledger in ${path}: run intake first`);
  const course = ledger.intake.courseName;
  return updateRegistry(stateDir, (registry) => {
    if (registry.courses.some((c) => c.project === path)) return { course, added: false };
    registry.courses.push({ project: path, course, addedAt: iso(Date.now()) });
    return { course, added: true };
  });
}

/** An item a Course's Build ledger calls for now: every live Module's three, and each live sitting's audio. */
interface Wanted {
  id: string;
  module: string | null;
  sitting: string | null;
  kind: MediaKind;
  nearestSitting: string | null;
}

function wanted(ledger: Ledger, today: string): Wanted[] {
  const ahead = (date: string | null) => (date !== null && date >= today ? date : null);
  const dates = ledger.intake.sittings.flatMap((s) => ahead(s.date) ?? []).sort();
  const nearest = dates[0] ?? null;
  const modules = current(ledger.modules)
    .filter((m) => m.state === "live")
    .sort((a, b) => a.id.localeCompare(b.id));
  return [
    ...modules.flatMap((m) =>
      MODULE_MEDIA.map((kind) => ({
        id: `module-${m.id}-${kind}`,
        module: m.id,
        sitting: null,
        kind,
        nearestSitting: nearest,
      })),
    ),
    ...ledger.intake.sittings
      .filter((s) => sittingState(ledger, s.id) === "live")
      .map((s) => ({
        id: `sitting-${s.id}-audio`,
        module: null,
        sitting: s.id,
        kind: "sitting-audio" as const,
        nearestSitting: ahead(s.date),
      })),
  ];
}

/** Adds what the ledger newly calls for, as queued, and refreshes every wanted item's nearest sitting. */
function merge(file: MediaFile, want: Wanted[], at: string): void {
  for (const w of want) {
    const item = file.items.find((i) => i.id === w.id);
    if (item !== undefined) item.nearestSitting = w.nearestSitting;
    else {
      file.items.push({
        ...w,
        state: "queued",
        regenerations: 0,
        file: null,
        failures: [],
        queuedAt: at,
        updatedAt: at,
      });
    }
  }
}

export interface QueueEntry {
  project: string;
  course: string;
  item: string;
  module: string | null;
  sitting: string | null;
  kind: MediaKind;
  state: ItemState;
  regenerations: number;
  nearestSitting: string | null;
}

export interface Report {
  queue: QueueEntry[];
  /** The item to move next, or null: the queue is drained, or a limit stops the rest (see `stopped`). */
  next: QueueEntry | null;
  stopped: Stop | null;
  /** What is still to generate: queued items by kind, and their cost once NotebookLM's usage is measured. */
  demand: { items: Record<MediaKind, number>; units: number | null };
  capacity: ReturnType<typeof capacity>;
  skipped: { project: string; course: string; error: string }[];
}

const inFlight = (state: ItemState) => (IN_FLIGHT as readonly string[]).includes(state);

/**
 * The Media queue, gathered afresh from every registered Course's Build ledger: each wanted item not yet
 * placed or dropped. Items already under way come first (their quota is spent), then nearest Exam
 * sitting first, then by Course, then in Module order. A gather (`persist`) writes the new items into
 * each Course's media file; a status report only reads.
 */
export function survey(stateDir: string, persist: boolean): Report {
  const at = Date.now();
  const today = iso(at).slice(0, 10);
  const usage = readUsage(stateDir);
  const ranked: { entry: QueueEntry; order: number }[] = [];
  const skipped: Report["skipped"] = [];
  for (const { project, course: registered } of readRegistry(stateDir).courses) {
    try {
      const ledger = readLedger(project);
      if (ledger === null) throw new LedgerError("refused", `no Build ledger in ${project}`);
      const course = ledger.intake.courseName;
      const want = wanted(ledger, today);
      const file = persist
        ? updateMediaFile(
            project,
            (f) => {
              merge(f, want, iso(at));
              return structuredClone(f);
            },
            (f) => writeMediaPage(project, f, usage, at),
            course,
          )
        : withWanted(
            readMediaFile(project) ?? { schema: SCHEMA_VERSION, course, notebook: null, items: [] },
            want,
            iso(at),
          );
      want.forEach((w, order) => {
        const item = file.items.find((i) => i.id === w.id);
        if (item === undefined || item.state === "placed" || item.state === "dropped") return;
        ranked.push({ entry: entryOf(project, course, item), order });
      });
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      skipped.push({ project, course: registered, error: error.message });
    }
  }
  const queue = ranked.sort(byRank).map(({ entry }) => entry);
  const queued = queue.filter((e) => e.state === "queued");
  const stopped = queued[0] === undefined ? null : stopFor(usage, queued[0].kind, at);
  const head = queue[0] ?? null;
  const items = Object.fromEntries(MEDIA_KINDS.map((k) => [k, queued.filter((e) => e.kind === k).length]));
  return {
    queue,
    next: head === null || (head.state === "queued" && stopped !== null) ? null : head,
    stopped,
    demand: {
      items: items as Record<MediaKind, number>,
      units: price(
        usage,
        queued.map((e) => e.kind),
      ),
    },
    capacity: capacity(usage, at),
    skipped,
  };
}

function withWanted(file: MediaFile, want: Wanted[], at: string): MediaFile {
  const copy = structuredClone(file);
  merge(copy, want, at);
  return copy;
}

function entryOf(project: string, course: string, item: MediaItem): QueueEntry {
  const { id, module, sitting, kind, state, regenerations, nearestSitting } = item;
  return { project, course, item: id, module, sitting, kind, state, regenerations, nearestSitting };
}

/** Under way first, then nearest sitting (none ahead goes last), then Course, then the ledger's own order. */
function byRank(a: { entry: QueueEntry; order: number }, b: { entry: QueueEntry; order: number }): number {
  const sitting = (e: QueueEntry) => e.nearestSitting ?? "9999-12-31";
  return (
    Number(inFlight(b.entry.state)) - Number(inFlight(a.entry.state)) ||
    sitting(a.entry).localeCompare(sitting(b.entry)) ||
    a.entry.course.localeCompare(b.entry.course) ||
    a.entry.project.localeCompare(b.entry.project) ||
    a.order - b.order
  );
}

function findItem(file: MediaFile, id: string): MediaItem {
  const item = file.items.find((i) => i.id === id);
  if (item === undefined) throw new LedgerError("invalid", `no media item ${id} in ${file.course}`);
  return item;
}

function requireMediaFile(project: string): MediaFile {
  const file = readMediaFile(project);
  if (file === null) throw noMediaFile(project);
  return file;
}

/** The live spend of an item's current attempt, if the usage log has one. */
function spendOf(usage: Usage, project: string, item: MediaItem) {
  return usage.spends.find(
    (s) => s.project === project && s.item === item.id && s.attempt === item.regenerations + 1 && s.voided === null,
  );
}

export type StartResult = { started: true; attempt: number } | { started: false; stopped: Stop };

/**
 * queued → generating: logs the generation in the usage log, then moves the item. Refused while a limit
 * stops new generations, unless it was `made` already (by hand, from a Notebook recipe): that one is
 * only counted. Safe to repeat after a crash between the two writes: the spend is counted once.
 */
export function start(stateDir: string, project: string, id: string, made = false): StartResult {
  const path = resolve(project);
  const at = Date.now();
  return updateUsage(
    stateDir,
    (usage): StartResult => {
      const item = findItem(requireMediaFile(path), id);
      const spent = spendOf(usage, path, item);
      const attempt = item.regenerations + 1;
      if (item.state === "generating" && spent !== undefined) return { started: true, attempt };
      if (item.state !== "queued") throw new LedgerError("refused", `${id} is ${item.state}, not queued`);
      if (spent === undefined) {
        const stopped = made ? null : stopFor(usage, item.kind, at);
        if (stopped !== null) return { started: false, stopped };
        usage.spends.push({ at: iso(at), project: path, item: id, kind: item.kind, attempt, voided: null });
      }
      return { started: true, attempt };
    },
    (result) => {
      if (result.started) move(stateDir, path, id, ["queued", "generating"], (item) => (item.state = "generating"));
    },
  );
}

/** Moves one item under its media file's mutex, if it is in one of the `from` states. */
function move<T>(stateDir: string, project: string, id: string, from: ItemState[], change: (item: MediaItem) => T): T {
  const at = Date.now();
  return updateMediaFile(
    project,
    (file) => {
      const item = findItem(file, id);
      if (!from.includes(item.state)) {
        throw new LedgerError("refused", `${id} is ${item.state}; this step needs it ${from.join(" or ")}`);
      }
      const result = change(item);
      item.updatedAt = iso(at);
      return result;
    },
    (file) => writeMediaPage(project, file, readUsage(stateDir), at),
  );
}

/** generating → downloaded, or downloaded → checked (the fact check passed). */
export function advance(stateDir: string, project: string, id: string, to: "downloaded" | "checked"): void {
  const from = to === "downloaded" ? "generating" : "downloaded";
  move(stateDir, resolve(project), id, [from], (item) => (item.state = to));
}

/** checked → placed: `file` is the published copy, already in the Course project. */
export function place(stateDir: string, project: string, id: string, file: string): void {
  const root = resolve(project);
  const inside = relative(root, resolve(root, file));
  if (isAbsolute(file) || inside.startsWith("..") || !existsSync(resolve(root, file))) {
    throw new LedgerError("invalid", `${file} isn't a file in the Course project`);
  }
  move(stateDir, root, id, ["checked"], (item) => {
    item.state = "placed";
    item.file = file;
  });
}

/**
 * A failed generation, download, fact check or re-encode. The item is made again once (back to queued),
 * then dropped; `final` drops it at once, for a failure a regeneration can't fix.
 */
export function fail(
  stateDir: string,
  project: string,
  id: string,
  reason: string,
  final: boolean,
): { state: ItemState; regenerations: number } {
  return move(stateDir, resolve(project), id, [...IN_FLIGHT], (item) => {
    item.failures.push({ at: iso(Date.now()), state: item.state as (typeof IN_FLIGHT)[number], reason });
    if (!final && item.regenerations < MAX_REGENERATIONS) {
      item.regenerations += 1;
      item.state = "queued";
    } else item.state = "dropped";
    return { state: item.state, regenerations: item.regenerations };
  });
}

/**
 * NotebookLM said a limit is reached: nothing new starts until `until` (default: one window from now).
 * With `item`, the generation it refused goes back to the queue and its spend is voided.
 */
export function limit(
  stateDir: string,
  which: Limit,
  until: string | null,
  refused: { project: string; item: string } | null,
): { until: string } {
  const at = Date.now();
  const lifts = until ?? iso(at + WINDOW_MS[which]);
  if (Date.parse(lifts) <= at) throw new LedgerError("invalid", `--until ${lifts} has already passed`);
  const path = refused === null ? null : resolve(refused.project);
  // The refused item goes back to the queue before the usage log voids its spend. A crash in between
  // leaves it queued with its spend still counted: its next start reuses that spend, and NotebookLM's
  // next refusal voids it. Never the other way round, which would leave it generating with nothing made.
  return updateUsage(stateDir, (usage) => {
    if (refused !== null && path !== null) {
      const item = move(stateDir, path, refused.item, ["generating", "queued"], (moved) => {
        moved.state = "queued";
        return moved;
      });
      const spent = spendOf(usage, path, item);
      if (spent !== undefined) spent.voided = { at: iso(at), reason: `NotebookLM refused it at its ${which} limit` };
    }
    usage.stops.push({ at: iso(at), limit: which, until: lifts });
    return { until: lifts };
  });
}

/**
 * Records the Owner's measured numbers from NotebookLM's Settings → Usage. Flags left out keep their
 * value. A cost over a limit is refused: that item could never start, and would stall the queue.
 */
export function setQuota(
  stateDir: string,
  numbers: { limits: Partial<Usage["limits"]>; costs: Partial<Usage["costs"]> },
): Pick<Usage, "limits" | "costs"> {
  return updateUsage(stateDir, (usage) => {
    Object.assign(usage.limits, numbers.limits);
    Object.assign(usage.costs, numbers.costs);
    for (const [kind, cost] of Object.entries(usage.costs)) {
      for (const [which, max] of Object.entries(usage.limits)) {
        if (cost !== null && max !== null && cost > max) {
          throw new LedgerError("invalid", `a ${kind} costs ${cost}, more than the whole ${which} limit of ${max}`);
        }
      }
    }
    return { limits: usage.limits, costs: usage.costs };
  });
}
