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
import { join } from "node:path";
import { HOOKS_PATH, privateFolderOf } from "../intake/create.ts";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { current, TEMPLATE_DIR, type Ledger, type ModuleRow } from "../ledger/model.ts";
import { readingCheckpointItems, SETTLED_FILE, waveFolder } from "./reading.ts";

/** The gate points a Module merges on: per job and per Module scoped to it, per deploy on the whole Course. */
export const MERGE_POINTS = ["job", "module", "deploy"] as const;
export type MergePoint = (typeof MERGE_POINTS)[number];

/** The template's gate verify, which re-derives a Gate report's verdict for the repo's HEAD. A seam: faked in tests. */
export interface Verifier {
  verify(project: string, point: MergePoint, module: string | undefined): { green: boolean; problems: string[] };
}

/** Runs the Course project's own template layer: `node template/gates/cli.ts verify …`. */
export const templateVerifier: Verifier = {
  verify(project, point, module) {
    if (!existsSync(join(project, TEMPLATE_DIR, "gates", "cli.ts")))
      return { green: false, problems: [`the template layer has no gate runner (${TEMPLATE_DIR}/gates/cli.ts)`] };
    const child = spawnSync(
      process.execPath,
      [
        join("gates", "cli.ts"),
        "verify",
        "--point",
        point,
        ...(module === undefined ? [] : ["--module", module]),
        "--content",
        join(project, CONTENT_DIR),
      ],
      { cwd: join(project, TEMPLATE_DIR), encoding: "utf8" },
    );
    const said = `${child.stdout ?? ""}\n${child.stderr ?? ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (child.error !== undefined) return { green: false, problems: [child.error.message] };
    return { green: child.status === 0, problems: child.status === 0 ? [] : said };
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

  const readings = waveFolder(privateFolderOf(ledger.intake.materialsPath), id);
  for (const file of ["reading-a.json", "reading-b.json", SETTLED_FILE]) {
    if (!existsSync(join(readings, file)))
      problems.push(`no ${file} in the Private folder (${readings}): both Blind readers read, then reconcile settles`);
  }

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

  if (!hookInstalled(project))
    problems.push(`the pre-commit gate isn't the repo's hook: git config core.hooksPath ${HOOKS_PATH}`);
  return problems;
}
