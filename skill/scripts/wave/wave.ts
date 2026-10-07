// The Module wave's batched Checkpoint and its merge gate. The Checkpoint gathers every open item
// of one Module (the gates' Checkpoint items from its Gate reports, each linked to its spot on the
// Vercel preview, and the settled reading's unreadable regions and Materials conflicts) minus what
// the Owner already answered in the Build ledger. `ready` is the merge gate: a Module wave merges to
// `main` only when every job ran, its Gate reports are green for the branch's commit, every
// Checkpoint item is answered (a sheet-vs-recompute one with a Slip or Divergence ruling the content
// carries), the Course style sheet exists and the pre-commit gate guards the repo.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOOKS_PATH, privateFolderOf } from "../intake/create.ts";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { current, TEMPLATE_DIR, type Ledger, type ModuleRow } from "../ledger/model.ts";
import { readingCheckpointItems, settledReadingProblem, waveFolder } from "./reading.ts";

/** The gate points a Module merges on: per job and per Module scoped to it, per deploy on the whole Course. */
export const MERGE_POINTS = ["job", "module", "deploy"] as const;
export type MergePoint = (typeof MERGE_POINTS)[number];

/** A Slip or Divergence the content ships, by the magnitudes of the sheet's value it rules on. */
export interface ContentRuling {
  entry: string;
  kind: "slip" | "divergence";
  printed: number[];
}

/**
 * The Course project's own template layer, as the merge gate uses it. A seam: faked in tests.
 * `verify` re-derives a Gate report's verdict for the repo's HEAD; `rulings` lists the Slips and
 * Divergences the Module's content ships (or says why it can't).
 */
export interface Verifier {
  verify(project: string, point: MergePoint, module: string | undefined): { green: boolean; problems: string[] };
  rulings(project: string, module: string): ContentRuling[] | string;
}

/** Runs `node template/gates/cli.ts <args…>` in the Course project, from its template folder. */
function gateCli(given: string, args: string[]) {
  // Absolute before the child runs from the template folder, so --content names the project's content.
  const project = resolve(given);
  if (!existsSync(join(project, TEMPLATE_DIR, "gates", "cli.ts")))
    return { ok: false, out: "", said: [`the template layer has no gate runner (${TEMPLATE_DIR}/gates/cli.ts)`] };
  const child = spawnSync(
    process.execPath,
    [join("gates", "cli.ts"), ...args, "--content", join(project, CONTENT_DIR)],
    { cwd: join(project, TEMPLATE_DIR), encoding: "utf8" },
  );
  if (child.error !== undefined) return { ok: false, out: "", said: [child.error.message] };
  const said = `${child.stdout ?? ""}\n${child.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: child.status === 0, out: child.stdout ?? "", said };
}

/** Runs the Course project's own template layer: `node template/gates/cli.ts verify|rulings …`. */
export const templateVerifier: Verifier = {
  verify(project, point, module) {
    const run = gateCli(project, ["verify", "--point", point, ...(module === undefined ? [] : ["--module", module])]);
    return { green: run.ok, problems: run.ok ? [] : run.said };
  },
  rulings(project, module) {
    const run = gateCli(project, ["rulings", "--module", module]);
    if (!run.ok) return `the template can't list the content's rulings: ${run.said.join("; ")}`;
    try {
      return (JSON.parse(run.out) as { rulings: ContentRuling[] }).rulings;
    } catch (error) {
      return `the template's rulings aren't JSON: ${(error as Error).message}`;
    }
  },
};

/** The gates whose Checkpoint items are sheet-vs-recompute: the Owner rules each a Slip or a Divergence. */
export const SHEET_GATES = new Set(["sim-numbers", "truth-table", "worked-numbers"]);

/** The jobs every Module wave records before it merges; the first Module's wave also writes the style sheet. */
export const WAVE_JOBS = [
  "blind-reader-a",
  "blind-reader-b",
  "reconcile",
  "writer",
  "recompute",
  "job-gates",
  "consistency",
  "module-gates",
  "deploy-gates",
] as const;
export const STYLE_SHEET_JOB = "style-sheet";
export const STYLE_SHEET_FILE = "style-sheet.yaml";

export interface CheckpointItem {
  key: string;
  kind: "gate" | "unreadable" | "conflict";
  question: string;
  /** For a gate's item: the gate, and whether it is a sheet-vs-recompute item needing a ruling. */
  gate?: string;
  sheet: boolean;
  /** Where to judge it: its spot on the preview, or the crop of an unreadable region. */
  link?: string;
  crop?: string;
}

interface ReportItem {
  gate: string;
  message: string;
  at?: string;
  spot?: string;
}

/** The Module's folder in the content (`01-linear-regression`), from the Module map. */
export function moduleFolder(ledger: Ledger, id: string): { row: ModuleRow; folder: string } {
  const row = current(ledger.modules).find((m) => m.id === id);
  if (row === undefined) throw new LedgerError("invalid", `Module ${id} isn't in the Module map`);
  return { row, folder: `${row.id}-${row.slug}` };
}

const reportsDir = (project: string) => join(project, CONTENT_DIR, "build-records", "gate-reports");
const reportFile = (point: MergePoint, folder: string) =>
  point === "deploy" ? "deploy.json" : `${point}-${folder}.json`;

function readReport(project: string, point: MergePoint, folder: string): Record<string, unknown> | null {
  const path = join(reportsDir(project), reportFile(point, folder));
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * A gate's Checkpoint item's key: the Module it sits in (`course` for the whole Course's, such as a
 * licence), the gate and a hash of where and what, stable while the content is.
 */
const gateItemKey = (item: ReportItem) =>
  `${/^modules\/(\d{2})-/.exec(item.at ?? "")?.[1] ?? "course"}/${item.gate}/${createHash("sha256")
    .update(`${item.at ?? ""}\n${item.message}`)
    .digest("hex")
    .slice(0, 10)}`;

/** The preview the Module's gates ran on: where its links point. */
function previewOf(project: string, folder: string, given: string | undefined): string | null {
  const url = given ?? readReport(project, "module", folder)?.["url"];
  return typeof url === "string" ? url.replace(/\/+$/, "") : null;
}

/** Every Checkpoint item the Module's Gate reports and settled reading raise, each once. */
export function raisedItems(project: string, id: string, preview?: string) {
  const ledger = requireLedger(project);
  const { folder } = moduleFolder(ledger, id);
  const base = previewOf(project, folder, preview);
  const items = new Map<string, CheckpointItem>();
  for (const point of MERGE_POINTS) {
    const report = readReport(project, point, folder);
    const raised = Array.isArray(report?.["checkpointItems"]) ? (report["checkpointItems"] as ReportItem[]) : [];
    // The deploy point checks the whole Course: its items (a licence, another Module's) are asked
    // once under their own key, so one answered in an earlier wave stays answered.
    for (const item of raised) {
      const key = gateItemKey(item);
      items.set(key, {
        key,
        kind: "gate",
        question: item.at === undefined ? item.message : `${item.at}: ${item.message}`,
        gate: item.gate,
        sheet: SHEET_GATES.has(item.gate),
        ...(base !== null && item.spot !== undefined ? { link: `${base}${item.spot}` } : {}),
      });
    }
  }
  for (const item of readingCheckpointItems(privateFolderOf(ledger.intake.materialsPath), id)) {
    items.set(item.key, { ...item, sheet: false });
  }
  return { ledger, folder, preview: base, items: [...items.values()] };
}

export interface CheckpointState {
  module: string;
  preview: string | null;
  /** Still to ask the Owner. */
  open: CheckpointItem[];
  /** Ruled a Slip or Divergence, but the gate still raises it: the content doesn't carry the ruling yet. */
  unapplied: (CheckpointItem & { ruling: string })[];
  answered: number;
  markdown: string;
}

/** The Module's batched Checkpoint: what is still open, ready to post in chat, and what the Owner already answered. */
export function checkpoint(project: string, id: string, preview?: string): CheckpointState {
  const { ledger, preview: base, items } = raisedItems(project, id, preview);
  const answers = new Map(current(ledger.checkpoints).map((c) => [c.key, c]));
  const open: CheckpointItem[] = [];
  const unapplied: CheckpointState["unapplied"] = [];
  let answered = 0;
  for (const item of items) {
    const answer = answers.get(item.key);
    if (answer === undefined || (item.sheet && answer.ruling === null)) open.push(item);
    else if (item.sheet && answer.ruling !== null) unapplied.push({ ...item, ruling: answer.ruling });
    else answered += 1;
  }
  return { module: id, preview: base, open, unapplied, answered, markdown: markdownOf(id, open, base) };
}

function markdownOf(id: string, open: CheckpointItem[], preview: string | null): string {
  if (open.length === 0) return `**Checkpoint, Module ${id}**: nothing open.`;
  const lines = [
    `**Checkpoint, Module ${id}**: ${open.length} item${open.length === 1 ? "" : "s"}${preview === null ? "" : ` (preview: ${preview})`}. Answer each by its number.`,
    "",
  ];
  open.forEach((item, i) => {
    const ask = item.sheet
      ? ". (**Slip**: the site ships the corrected value and shows both. **Divergence**: it ships the Professor's value as the exam answer, with a note.)"
      : "";
    const where =
      item.link !== undefined
        ? ` [See it on the preview](${item.link}).`
        : item.crop !== undefined
          ? ` Crop: \`${item.crop}\``
          : "";
    lines.push(`${i + 1}. \`${item.key}\` ${item.question}${ask}${where}`);
  });
  return lines.join("\n");
}

/**
 * A sheet-vs-recompute item's question as the Checkpoint gives it: the content file it sits in and
 * the sheet value it asks about (`modules/01-x/worked/1.json: sheet cell D4 prints 1.45, but …`).
 */
const SHEET_QUESTION = /^(modules\/\S+?): .*?\bprints\s+(.+?), (?:but|which)\b/;

/** A printed value's magnitude: `1.45`, `−1,250.5` or `5.0 \times 10^{-2}`; null when it isn't one. */
function magnitude(written: string): number | null {
  const match =
    /^[-−]?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*(?:\\times|\\cdot|×)\s*10\s*\^\s*\{?\s*([-−]?\d+)\s*\}?)?$/.exec(
      written.trim(),
    );
  if (!match) return null;
  const [, digits = "", power] = match;
  return Number(`${digits.replace(/,/g, "")}e${(power ?? "0").replace("−", "-")}`);
}

/**
 * Every Slip or Divergence the Module's content ships without the Owner's matching answer: a
 * sheet-vs-recompute item of this Module, answered with that ruling, about that sheet value. Only
 * the Owner rules on the Professor's numbers; a ruling the gates no longer raise must still be his.
 */
function unruled(ledger: Ledger, id: string, rulings: ContentRuling[] | string): string[] {
  if (typeof rulings === "string") return [rulings];
  const answered = current(ledger.checkpoints).flatMap((c) => {
    const [module, gate] = c.key.split("/");
    const [, entry, written] = SHEET_QUESTION.exec(c.question) ?? [];
    const printed = written === undefined ? null : magnitude(written);
    if (module !== id || gate === undefined || !SHEET_GATES.has(gate) || c.ruling === null || printed === null)
      return [];
    return [{ ruling: c.ruling, entry, printed }];
  });
  // Bound to the item: the same kind of ruling, in the same content file, on the same sheet value.
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a));
  return rulings
    .filter(
      (r) =>
        !answered.some((a) => a.ruling === r.kind && a.entry === r.entry && r.printed.some((n) => close(n, a.printed))),
    )
    .map(
      (r) =>
        `${r.entry} ships a ${r.kind} on ${r.printed.join(", ") || "no number"} that no Owner answer rules: record his ${r.kind} ruling on the item that raised it, with its question as the Checkpoint gives it`,
    );
}

/** Whether the Course project's commits go through the template's pre-commit gate. */
function hookInstalled(project: string): boolean {
  const child = spawnSync("git", ["-C", project, "config", "core.hooksPath"], { encoding: "utf8" });
  return (
    child.status === 0 && child.stdout.trim() === HOOKS_PATH && existsSync(join(project, HOOKS_PATH, "pre-commit"))
  );
}

/** Every reason the Module wave `waveId` may not merge yet; none means it may. */
export function readyProblems(project: string, waveId: string, verifier: Verifier): string[] {
  const ledger = requireLedger(project);
  const wave = current(ledger.waves).find((w) => w.id === waveId);
  if (wave === undefined) throw new LedgerError("invalid", `no current wave ${waveId}`);
  if (wave.kind !== "module") throw new LedgerError("invalid", `${waveId} is a ${wave.kind} wave, not a Module wave`);
  if (wave.state !== "running") throw new LedgerError("refused", `wave ${waveId} already ended ${wave.state}`);
  const id = wave.target;
  const { folder } = moduleFolder(ledger, id);
  const problems: string[] = [];

  // Every job of the wave ran, and none is left blocked.
  const firstWave = !ledger.waves.some((w) => w.kind === "module" && w.state === "merged");
  const jobs = new Map(
    current(ledger.jobs)
      .filter((j) => j.wave === waveId)
      .map((j) => [j.job, j]),
  );
  for (const name of [...WAVE_JOBS, ...(firstWave ? [STYLE_SHEET_JOB] : [])]) {
    const job = jobs.get(name);
    if (job === undefined) problems.push(`job ${name} hasn't been recorded for ${waveId}`);
    else if (job.result === "blocked") problems.push(`job ${name} is blocked: its job fixes it, or it falls back`);
  }

  if (!existsSync(join(project, CONTENT_DIR, STYLE_SHEET_FILE)))
    problems.push(
      `no Course style sheet at ${CONTENT_DIR}/${STYLE_SHEET_FILE}: Module 1's wave writes it before any other Module`,
    );
  if (!existsSync(join(project, CONTENT_DIR, "modules", folder, "module.yaml")))
    problems.push(`no Module page content at ${CONTENT_DIR}/modules/${folder}/`);

  const privateFolder = privateFolderOf(ledger.intake.materialsPath);
  const readings = waveFolder(privateFolder, id);
  for (const file of ["reading-a.json", "reading-b.json"]) {
    if (!existsSync(join(readings, file)))
      problems.push(`no ${file} in the Private folder (${readings}): both Blind readers read, then reconcile settles`);
  }
  const settledProblem = settledReadingProblem(privateFolder, id);
  if (settledProblem !== null) problems.push(settledProblem);

  for (const point of MERGE_POINTS) {
    const verdict = verifier.verify(project, point, point === "deploy" ? undefined : folder);
    if (!verdict.green)
      problems.push(`the ${point} Gate report isn't green for HEAD: ${verdict.problems.join("; ") || "red"}`);
  }
  const preview = readReport(project, "module", folder)?.["url"];
  if (typeof preview !== "string" || !/^https:\/\//.test(preview))
    problems.push("the Module's gates didn't run on its Vercel preview: run the module point with --url <preview URL>");

  const state = checkpoint(project, id);
  for (const item of state.open)
    problems.push(
      `Checkpoint item ${item.key} is unanswered${item.sheet ? " (it needs a Slip or Divergence ruling)" : ""}`,
    );
  for (const item of state.unapplied)
    problems.push(
      `Checkpoint item ${item.key} was ruled a ${item.ruling}, but the content doesn't carry the ruling yet (provenance ${item.ruling === "slip" ? "slips" : "divergences"})`,
    );

  problems.push(...unruled(ledger, id, verifier.rulings(project, folder)));

  if (!hookInstalled(project))
    problems.push(`the pre-commit gate isn't the repo's hook: git config core.hooksPath ${HOOKS_PATH}`);
  return problems;
}
