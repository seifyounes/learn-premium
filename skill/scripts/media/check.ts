// The media fact check's judge. A fact-check subagent reads the evidence (transcript and sampled frames, or the
// infographic) against the Module's verified content and writes a check file; this judges it, with no model
// in the loop: every number said or shown must round from a number the Module holds (minus the Professor's
// Slips, whose printed value is the wrong one), and any claim the subagent marked wrong or unsupported fails.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { hashFile } from "../ledger/hash.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { arr, fail, nonEmpty, nullable, obj, oneOf, sha256, type Infer, type Schema } from "../ledger/schema.ts";
import { readJsonFile } from "../wave/reading.ts";
import { moduleFolder, type ContentRuling, type Verifier } from "../wave/wave.ts";
import { checkPath, masterOf, moduleItem, readEvidence } from "./kit.ts";
import { advance, fail as failItem } from "./media.ts";
import { type ItemState } from "./model.ts";
import { requirePrivateFolder } from "./notebook.ts";

export const CHECK_FORMAT = "learn-premium media check v1";

const num: Schema<number> = (v, p) => (typeof v === "number" && Number.isFinite(v) ? v : fail(p, "a number", v));

/** The subagent's file: what it read off the media, and a verdict on every claim, each against the Module's content. */
export const checkSchema = obj({
  check: (v, p) => (v === CHECK_FORMAT ? CHECK_FORMAT : fail(p, CHECK_FORMAT, v)),
  item: nonEmpty,
  attempt: num,
  masterHash: sha256,
  /** An infographic's alt text (for the Summary's tap-to-zoom image); null for the other kinds. */
  alt: nullable(nonEmpty),
  /** What it read on each sampled frame (`at` names the frame) or on the infographic (`at` is `infographic`); "" when no text. */
  readings: arr(obj({ at: nonEmpty, text: (v, p) => (typeof v === "string" ? v : fail(p, "a string", v)) })),
  claims: arr(
    obj({
      at: nonEmpty,
      said: nonEmpty,
      kind: oneOf("number", "symbol", "claim"),
      value: nullable(num),
      verdict: oneOf("matches", "wrong", "unsupported"),
      content: nullable(nonEmpty),
      why: nonEmpty,
    }),
  ),
});
export type CheckFile = Infer<typeof checkSchema>;

export interface Finding {
  kind: "number" | "claim";
  at: string;
  said: string;
  why: string;
}

export interface CheckResult {
  verdict: "pass" | "fail";
  findings: Finding[];
  state: ItemState;
  regenerations: number;
}

/** A number as written: `1,250.5` is 1250.5 with one decimal. Not inside a word or after a point (`R1`, `v2.0`). */
const NUMBER = /(?<![\w.])(?:\d{1,3}(?:(?:,|\\,)\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;
const POWER = /(\d+(?:\.\d+)?)\s*(?:\\times|×)\s*10\s*\^\s*\{?\s*([-−]?\d+)\s*\}?/g;

interface Written {
  raw: string;
  value: number;
  decimals: number;
}

function numbersIn(text: string): Written[] {
  return [...text.matchAll(NUMBER)].map(([raw]) => {
    const plain = raw.replace(/\\?,/g, "");
    return { raw, value: Number(plain), decimals: plain.split(".")[1]?.length ?? 0 };
  });
}

/** `a \times 10^{n}` written out is the value a·10^n, which no single digit run of it is. */
function powersIn(text: string): number[] {
  return [...text.matchAll(POWER)].map(([, a = "", n = ""]) => Number(`${a}e${n.replace("−", "-")}`));
}

const TEXT_LIMIT_BYTES = 5_000_000;

/** The text files under `dir` (any depth), except binaries (a NUL in the first 8 KB) and files over 5 MB. */
function textFiles(dir: string, skip: (relative: string) => boolean, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    const relative = full.slice(base.length + 1).replaceAll("\\", "/");
    if (skip(relative)) return [];
    if (entry.isDirectory()) return textFiles(full, skip, base);
    if (!entry.isFile() || statSync(full).size > TEXT_LIMIT_BYTES) return [];
    return readFileSync(full).subarray(0, 8192).includes(0) ? [] : [full];
  });
}

/**
 * Every number the Module's verified content holds: its own content (not its media), its build records (the
 * recompute logs and the rest, not the Gate reports) and the Course style sheet. Then the Slips' printed
 * values come out: the Professor's sheet is wrong there, and media must not repeat it.
 */
export function verifiedNumbers(project: string, folder: string, rulings: ContentRuling[]): number[] {
  const content = join(project, CONTENT_DIR);
  const records = join(content, "build-records");
  const sources = [
    ...textFiles(
      join(content, "modules", folder),
      (r) => r === "media.yaml" || r === "media" || r.startsWith("media/"),
    ),
    ...(existsSync(records)
      ? readdirSync(records, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name !== "gate-reports")
          .flatMap((e) => textFiles(join(records, e.name, folder), () => false))
      : []),
    ...(existsSync(join(content, "style-sheet.yaml")) ? [join(content, "style-sheet.yaml")] : []),
  ];
  const values: number[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    values.push(...numbersIn(text).map((n) => n.value), ...powersIn(text));
  }
  const slipped = rulings.filter((r) => r.kind === "slip").flatMap((r) => r.printed);
  return values.filter((v) => !slipped.some((s) => Math.abs(s - v) <= 1e-9 * Math.max(1, Math.abs(s))));
}

/** The factors a said number may differ from a verified one by: a percentage, a thousandth or thousand (k, m, mK). */
const FACTORS = [1, 100, 1000, 0.01, 0.001];

/** Whether `said`, as rounded to the digits it was written with, is some verified value (or ×100, ×1000, ÷100, ÷1000). */
export function roundsTo(said: Written, verified: number[]): boolean {
  const tolerance = 0.5 * 10 ** -said.decimals + 1e-9;
  return verified.some((v) => FACTORS.some((f) => Math.abs(said.value - Math.abs(v) * f) <= tolerance));
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

interface Transcript {
  segments: { start: number; text: string }[];
}

/** Whisper's own dict (model, language, text, segments with their ends): only the segments are read. */
const segment = obj({ start: num, text: (x, q) => (typeof x === "string" ? x : fail(q, "a string", x)) });
const transcriptSchema: Schema<Transcript> = (v, p) => {
  const segments = typeof v === "object" && v !== null ? (v as { segments?: unknown }).segments : undefined;
  if (!Array.isArray(segments)) return fail(`${p}.segments`, "a list", segments);
  return {
    segments: segments.map((s, i) => {
      const { start, text } = (s ?? {}) as { start?: unknown; text?: unknown };
      return segment({ start, text }, `${p}.segments[${i}]`);
    }),
  };
};

/** Every number the media says or shows, with where: the transcript's segments, the readings, the claims' values. */
function said(transcript: Transcript | null, check: CheckFile): (Written & { at: string })[] {
  const all: (Written & { at: string })[] = [];
  for (const segment of transcript?.segments ?? []) {
    all.push(...numbersIn(segment.text).map((n) => ({ ...n, at: clock(segment.start) })));
  }
  for (const reading of check.readings) all.push(...numbersIn(reading.text).map((n) => ({ ...n, at: reading.at })));
  for (const claim of check.claims) {
    if (claim.value === null) continue;
    // A sign isn't part of a number as the text gives it (`-0.65` reads as 0.65), so a claim's isn't either.
    const value = Math.abs(claim.value);
    // Written out in full: JavaScript gives a small value as `4e-7`, which has no digits after a point.
    const raw = /e/i.test(String(value)) ? value.toFixed(20).replace(/\.?0+$/, "") : String(value);
    all.push({ raw, value, decimals: raw.split(".")[1]?.length ?? 0, at: claim.at });
  }
  return all;
}

/** A frame is named by a reading whose `at` is its path in the evidence folder or just its file name. */
const names = (frame: string, at: string) => at === frame || at === basename(frame);

const REASON_LIMIT = 600;

/**
 * The judge. Refused (nothing moves) when there is nothing sound to judge: the item isn't downloaded, it is a
 * sitting audio, the evidence or the check is missing, of another master, or incomplete. Otherwise a pass
 * moves the item to `checked`, a failure to `fail` (made again once, then dropped) with the findings as reason.
 */
export function check(
  stateDir: string,
  project: string,
  id: string,
  privateFolder: string,
  verifier: Verifier,
): CheckResult {
  const root = resolve(project);
  const priv = requirePrivateFolder(root, privateFolder);
  const { item, module } = moduleItem(root, id);
  if (item.state !== "downloaded")
    throw new LedgerError("refused", `${id} is ${item.state}; the fact check needs it downloaded`);
  const attempt = item.regenerations + 1;
  const master = masterOf(priv, item);
  const { folder: evidenceFolder, evidence } = readEvidence(priv, item, master);
  const path = checkPath(priv, id, attempt);
  if (!existsSync(path)) {
    throw new LedgerError(
      "refused",
      `no check file for ${id} (attempt ${attempt}): the fact-check subagent writes ${path}`,
    );
  }
  const file = readJsonFile(path, checkSchema, "check file");
  if (file.item !== id || file.attempt !== attempt) {
    throw new LedgerError(
      "refused",
      `${path} is the check of ${file.item} attempt ${file.attempt}, not ${id} attempt ${attempt}`,
    );
  }
  if (file.masterHash !== hashFile(master)) {
    throw new LedgerError(
      "refused",
      `${path} checked another master than ${id}'s attempt ${attempt}: the subagent checks again`,
    );
  }
  let transcript: Transcript | null = null;
  if (evidence.transcript !== null) {
    transcript = readJsonFile(join(evidenceFolder, evidence.transcript), transcriptSchema, "transcript");
  } else if (item.kind === "audio") {
    throw new LedgerError("refused", `the evidence for ${id} has no transcript: an audio is checked on what it says`);
  }
  for (const frame of evidence.frames) {
    if (!file.readings.some((r) => names(frame, r.at))) {
      throw new LedgerError("refused", `${path} has no reading of ${frame}: every sampled frame is read`);
    }
  }
  if (item.kind === "infographic") {
    if (!file.readings.some((r) => r.at === "infographic")) {
      throw new LedgerError("refused", `${path} has no reading of the infographic (at: "infographic")`);
    }
    if (file.alt === null)
      throw new LedgerError("refused", `${path} has no alt text: the infographic needs one for the Summary`);
  }

  const { folder } = moduleFolder(requireLedger(root), module);
  const rulings = verifier.rulings(root, folder);
  if (typeof rulings === "string") throw new LedgerError("refused", rulings);
  const verified = verifiedNumbers(root, folder, rulings);
  const own = Number(module);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const n of said(transcript, file)) {
    const exempt = (n.decimals === 0 && n.value <= 10) || n.value === own;
    const key = `${n.raw}\0${n.at}`;
    if (exempt || seen.has(key) || roundsTo(n, verified)) continue;
    seen.add(key);
    findings.push({
      kind: "number",
      at: n.at,
      said: n.raw,
      why: `said ${n.raw} at ${n.at}, which no verified value of Module ${module} rounds to`,
    });
  }
  for (const claim of file.claims.filter((c) => c.verdict !== "matches")) {
    findings.push({
      kind: "claim",
      at: claim.at,
      said: claim.said,
      why: `${claim.verdict} at ${claim.at}: ${claim.said} (${claim.why})`,
    });
  }

  if (findings.length === 0) {
    advance(stateDir, root, id, "checked");
    return { verdict: "pass", findings, state: "checked", regenerations: item.regenerations };
  }
  const reason = `fact check: ${findings.map((f) => f.why).join("; ")}`;
  const failed = failItem(
    stateDir,
    root,
    id,
    reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT - 1)}…` : reason,
    false,
  );
  return { verdict: "fail", findings, ...failed };
}
