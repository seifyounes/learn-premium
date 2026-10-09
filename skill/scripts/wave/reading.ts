// The Blind readers' readings and their reconciliation. Two Blind readers transcribe a Module's
// Materials independently into the Private folder; reconcile compares them item by item. Where they
// disagree, the main agent looks at the rendered region (a crop it cuts with the Materials reader)
// and settles the dispute in `resolutions.json`, beside the readings. A region the render can't
// decide, and a quantity the Materials give two values for, become Checkpoint items: only the Owner
// rules on them. Everything here carries the Professor's text, so it is read from and written to the
// Private folder only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { arr, fail, nonEmpty, nullable, obj, oneOf, SchemaError, type Infer, type Schema } from "../ledger/schema.ts";

export const READING = "learn-premium blind reading v1";
export const READERS = ["a", "b"] as const;
export const ITEM_KINDS = ["number", "formula", "text", "annotation", "figure"] as const;

const fraction: Schema<number> = (v, p) =>
  typeof v === "number" && v >= 0 && v <= 1 ? v : fail(p, "a fraction 0–1", v);
export const pageNumber: Schema<number> = (v, p) =>
  Number.isInteger(v) && (v as number) >= 1 ? (v as number) : fail(p, "a page or slide number", v);
/** A region of the page as fractions of its width and height: x0, y0, x1, y1. */
export const box: Schema<[number, number, number, number]> = (v, p) => {
  if (!Array.isArray(v) || v.length !== 4) fail(p, "a box [x0, y0, x1, y1]", v);
  const [x0, y0, x1, y1] = arr(fraction)(v, p) as [number, number, number, number];
  if (!(x0 < x1 && y0 < y1)) fail(p, "a box with x0 < x1 and y0 < y1", v);
  return [x0, y0, x1, y1];
};

/**
 * One thing a Blind reader read: a number, formula, line of text, pen annotation or figure label,
 * keyed so both readers name the same thing alike. `value` is null where the reader couldn't read
 * it. `quantity` names what a number or formula is (the learning rate), so places where the
 * Materials give it different values are found.
 */
const itemSchema = obj({
  key: nonEmpty,
  file: nonEmpty,
  page: nullable(pageNumber),
  box: nullable(box),
  quantity: nullable(nonEmpty),
  kind: oneOf(...ITEM_KINDS),
  value: nullable(nonEmpty),
});
export type ReadItem = Infer<typeof itemSchema>;

export const readingSchema = obj({
  reading: (v, p) => (v === READING ? READING : fail(p, JSON.stringify(READING), v)),
  reader: oneOf(...READERS),
  module: (v, p) => (typeof v === "string" && /^\d{2}$/.test(v) ? v : fail(p, "a two-digit Module number", v)),
  items: arr(itemSchema),
});

/** The main agent's ruling on one dispute, made on its crop: reader A's value, B's, its own reading, or unreadable. */
const resolutionSchema = obj({
  key: nonEmpty,
  /** What reader A and reader B read, as the dispute listed them: the ruling stands only while they do. */
  a: nullable(nonEmpty),
  b: nullable(nonEmpty),
  /** The crop of the rendered region, relative to the Private folder. */
  crop: nonEmpty,
  ruling: oneOf("a", "b", "read", "unreadable"),
  /** What the render shows, for `read`; null otherwise. */
  value: nullable(nonEmpty),
});
const resolutionsSchema = obj({ resolutions: arr(resolutionSchema) });

export interface Dispute {
  key: string;
  file: string;
  page: number | null;
  box: ReadItem["box"];
  a: string | null;
  b: string | null;
}

export interface ReadingCheckpointItem {
  key: string;
  kind: "unreadable" | "conflict";
  question: string;
  /** The crop the Owner judges an unreadable region on. */
  crop?: string;
}

/** Where a Module's wave keeps its readings in the Private folder. */
export const waveFolder = (privateFolder: string, module: string) => join(privateFolder, "waves", module);
export const SETTLED_FILE = "reading.json";
export const CHECKPOINT_ITEMS_FILE = "checkpoint-items.json";

export function readJsonFile<T>(path: string, schema: Schema<T>, what: string): T {
  if (!existsSync(path)) throw new LedgerError("invalid", `no ${what} at ${path}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new LedgerError("invalid", `can't read ${path} as JSON: ${(error as Error).message}`);
  }
  try {
    return schema(data, what);
  } catch (error) {
    if (error instanceof SchemaError) throw new LedgerError("invalid", `${path}: ${error.message}`);
    throw error;
  }
}

/** Whitespace and trailing zeros aside, the same reading: "0.250" is "0.25", "a  b" is "a b". */
function same(a: string, b: string): boolean {
  const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
  const number = (s: string) => (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tidy(s)) ? Number(tidy(s)) : null);
  const [x, y] = [number(a), number(b)];
  return x !== null && y !== null ? x === y : tidy(a) === tidy(b);
}

/**
 * A key for a Checkpoint item, safe on a command line: `01/unreadable/eq-3-1a2b3c`. The hash covers
 * the name and the question's `facts` (the values and places it asks about), so the same question
 * keeps its key across runs, and a changed one gets a new key and is asked again.
 */
export function itemKey(module: string, kind: string, name: string, facts: readonly string[] = []): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "item";
  const hash = createHash("sha256")
    .update([name, ...facts].join("\n"))
    .digest("hex")
    .slice(0, 6);
  return `${module}/${kind}/${slug}-${hash}`;
}

const place = (i: ReadItem) => (i.page === null ? i.file : `${i.file}, page ${i.page}`);
const said = (reader: string, value: string | null) =>
  value === null ? `reader ${reader} couldn't read it` : `reader ${reader} read "${value}"`;

export type ReconcileResult =
  | { settledNow: false; agreed: number; disputes: Dispute[] }
  | { settledNow: true; agreed: number; disputes: number; settled: number; checkpointItems: ReadingCheckpointItem[] };

/**
 * Reconciles the two readings of `module` in the Private folder. With disputes and no ruling on each,
 * returns them; once every dispute is ruled on its crop, writes the settled reading and the
 * Checkpoint items it raises beside the readings.
 */
export function reconcile(privateFolder: string, module: string): ReconcileResult {
  const folder = waveFolder(privateFolder, module);
  const readingA = readJsonFile(join(folder, "reading-a.json"), readingSchema, "reading-a.json");
  const readingB = readJsonFile(join(folder, "reading-b.json"), readingSchema, "reading-b.json");
  for (const [r, reader] of [
    [readingA, "a"],
    [readingB, "b"],
  ] as const) {
    if (r.reader !== reader) throw new LedgerError("invalid", `reading-${reader}.json is reader ${r.reader}'s reading`);
    if (r.module !== module)
      throw new LedgerError("invalid", `reading-${reader}.json reads Module ${r.module}, not ${module}`);
    const keys = new Set<string>();
    for (const i of r.items) {
      if (keys.has(i.key)) throw new LedgerError("invalid", `reading-${reader}.json names ${i.key} twice`);
      keys.add(i.key);
    }
  }
  const byKey = (items: ReadItem[]) => new Map(items.map((i) => [i.key, i]));
  const [a, b] = [byKey(readingA.items), byKey(readingB.items)];
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const agreed: ReadItem[] = [];
  const disputes: Dispute[] = [];
  for (const key of keys) {
    const [ia, ib] = [a.get(key), b.get(key)];
    if (ia && ib && ia.value !== null && ib.value !== null && same(ia.value, ib.value)) {
      agreed.push(ia);
      continue;
    }
    const where = (ia ?? ib) as ReadItem;
    disputes.push({
      key,
      file: where.file,
      page: where.page,
      box: where.box,
      a: ia?.value ?? null,
      b: ib?.value ?? null,
    });
  }

  const resolutionsPath = join(folder, "resolutions.json");
  const rulings = existsSync(resolutionsPath)
    ? readJsonFile(resolutionsPath, resolutionsSchema, "resolutions.json").resolutions
    : [];
  for (const r of rulings) {
    if (!disputes.some((d) => d.key === r.key))
      throw new LedgerError("invalid", `resolutions.json rules on ${r.key}, which the readers didn't dispute`);
  }
  // A ruling made on other values (a reader changed a disputed item since) no longer stands: the
  // dispute is open again until the region is looked at afresh.
  const ruled = new Map(
    rulings.filter((r) => disputes.some((d) => d.key === r.key && d.a === r.a && d.b === r.b)).map((r) => [r.key, r]),
  );
  if (disputes.some((d) => !ruled.has(d.key))) {
    // An earlier settled reading no longer stands: nothing may be written from it.
    for (const file of [SETTLED_FILE, CHECKPOINT_ITEMS_FILE]) rmSync(join(folder, file), { force: true });
    return { settledNow: false, agreed: agreed.length, disputes: disputes.filter((d) => !ruled.has(d.key)) };
  }

  const settled: ReadItem[] = [...agreed];
  const checkpointItems: ReadingCheckpointItem[] = [];
  for (const d of disputes) {
    const r = ruled.get(d.key) as Infer<typeof resolutionSchema>;
    const crop = join(privateFolder, r.crop);
    const rel = relative(privateFolder, crop);
    if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(crop)) {
      throw new LedgerError(
        "invalid",
        `the ruling on ${d.key} names the crop ${r.crop}, which isn't in the Private folder: a dispute is settled on the rendered region (cut it with the Materials reader's crop)`,
      );
    }
    const base = (a.get(d.key) ?? b.get(d.key)) as ReadItem;
    if (r.ruling === "read" && r.value === null)
      throw new LedgerError("invalid", `the ruling on ${d.key} reads the render but gives no value`);
    const value = r.ruling === "a" ? d.a : r.ruling === "b" ? d.b : r.ruling === "read" ? r.value : null;
    if ((r.ruling === "a" || r.ruling === "b") && value === null)
      throw new LedgerError(
        "invalid",
        `the ruling on ${d.key} takes reader ${r.ruling.toUpperCase()}'s value, but it read nothing`,
      );
    settled.push({ ...base, value });
    if (r.ruling === "unreadable") {
      const what = base.quantity === null ? base.kind : `${base.kind} (${base.quantity})`;
      checkpointItems.push({
        key: itemKey(module, "unreadable", d.key, [place(base), d.a ?? "", d.b ?? ""]),
        kind: "unreadable",
        question: `Unreadable ${what} in ${place(base)}: ${said("A", d.a)}, ${said("B", d.b)}, and the render doesn't settle it. What does it say?`,
        crop,
      });
    }
  }
  settled.sort((x, y) => keys.indexOf(x.key) - keys.indexOf(y.key));
  checkpointItems.push(...conflicts(module, settled));

  const write = (file: string, data: unknown) => {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), `${JSON.stringify(data, null, 2)}\n`);
  };
  // Both bound to the same inputs, the Checkpoint items written first: a settled reading stands only
  // with the Checkpoint items it raised beside it (an interrupted write leaves it stale, not short).
  const inputs = inputsHash(folder);
  write(CHECKPOINT_ITEMS_FILE, { module, inputs, items: checkpointItems });
  write(SETTLED_FILE, { reading: READING, reader: "settled", module, inputs, items: settled });
  return {
    settledNow: true,
    agreed: agreed.length,
    disputes: disputes.length,
    settled: settled.length,
    checkpointItems,
  };
}

const INPUT_FILES = ["reading-a.json", "reading-b.json", "resolutions.json"];

/** A hash of what a settled reading was settled from: both readings and the rulings. */
function inputsHash(folder: string): string {
  const hash = createHash("sha256");
  for (const file of INPUT_FILES) {
    const path = join(folder, file);
    hash
      .update(`${file}\n`)
      .update(existsSync(path) ? readFileSync(path) : "(none)")
      .update("\n");
  }
  return hash.digest("hex");
}

/**
 * Why the Module's settled reading can't be trusted, or null when it stands: missing, or settled
 * from readings or rulings that have changed since (reconcile must run again).
 */
export function settledReadingProblem(privateFolder: string, module: string): string | null {
  const folder = waveFolder(privateFolder, module);
  if (!existsSync(join(folder, SETTLED_FILE)))
    return `no ${SETTLED_FILE} in the Private folder (${folder}): run reconcile`;
  const inputsOf = (file: string) => {
    try {
      return (JSON.parse(readFileSync(join(folder, file), "utf8")) as { inputs?: unknown }).inputs;
    } catch {
      return undefined;
    }
  };
  const expected = inputsHash(folder);
  return inputsOf(SETTLED_FILE) === expected && inputsOf(CHECKPOINT_ITEMS_FILE) === expected
    ? null
    : `the settled reading is stale or incomplete: the readings or rulings in ${folder} changed after it was settled, or its Checkpoint items are missing; re-run reconcile`;
}

/** A quantity the settled reading gives different values for in different places: the Materials disagree. */
function conflicts(module: string, settled: ReadItem[]): ReadingCheckpointItem[] {
  // Quantities are compared by name, case and spacing aside.
  const groups = new Map<string, ReadItem[]>();
  for (const i of settled) {
    if (i.quantity === null || i.value === null) continue;
    const id = i.quantity.trim().toLowerCase().replace(/\s+/g, " ");
    groups.set(id, [...(groups.get(id) ?? []), i]);
  }
  const found: ReadingCheckpointItem[] = [];
  for (const [id, items] of groups) {
    const first = items[0]?.value ?? "";
    if (items.every((i) => same(i.value ?? "", first))) continue;
    found.push({
      key: itemKey(
        module,
        "conflict",
        id,
        items.map((i) => `${i.value} (${place(i)})`),
      ),
      kind: "conflict",
      question: `The Materials disagree on ${id}: ${items.map((i) => `${i.value} (${place(i)})`).join(", ")}. Which does the Module follow?`,
    });
  }
  return found;
}

/** The Checkpoint items a Module's settled reading raised, or none before it is settled. */
export function readingCheckpointItems(privateFolder: string, module: string): ReadingCheckpointItem[] {
  const path = join(waveFolder(privateFolder, module), CHECKPOINT_ITEMS_FILE);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as { items: ReadingCheckpointItem[] };
  return data.items;
}
