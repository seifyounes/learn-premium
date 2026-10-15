// The readable status page and the build report, generated from the ledger. They are rewritten on
// every ledger write, so they never drift from it; nobody edits them by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_PAGE } from "../media/model.ts";
import {
  BUILD_RECORDS_DIR,
  current,
  GATE_GAP_REPO,
  LEDGER_FILE,
  sittingState,
  type Assignment,
  type Ledger,
} from "./model.ts";
import { supersededRows } from "./rows.ts";

export const STATUS_PAGE = "status.md";
export const BUILD_REPORT = "build-report.md";

export function writePages(project: string, ledger: Ledger): void {
  const dir = join(project, BUILD_RECORDS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STATUS_PAGE), statusPage(ledger));
  writeFileSync(join(dir, BUILD_REPORT), buildReport(ledger, project));
}

const GENERATED = `Generated from \`${LEDGER_FILE}\` on every change to it. Don't edit.`;

export function table(header: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return "None.\n";
  const line = (cells: (string | number)[]) =>
    `| ${cells.map((c) => String(c).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n") + "\n";
}

function statusPage(ledger: Ledger): string {
  const materials = current(ledger.materials);
  const waves = current(ledger.waves);
  const lock = ledger.lock === null ? "free" : `held by ${ledger.lock.holder} since ${ledger.lock.since}`;
  return [
    `# ${ledger.intake.courseName}: build status`,
    "",
    GENERATED,
    "",
    `Template release: ${ledger.template.release} · Lock: ${lock}`,
    "",
    "## Modules",
    "",
    table(
      ["Module", "Title", "State", "Materials"],
      current(ledger.modules).map((m) => [m.id, m.title, m.state, materials.filter((f) => f.module === m.id).length]),
    ),
    "## Exam sittings",
    "",
    table(
      ["Sitting", "Name", "Date", "State"],
      ledger.intake.sittings.map((s) => [s.id, s.name, s.date ?? "not known", sittingState(ledger, s.id)]),
    ),
    "## Waves running",
    "",
    table(
      ["Wave", "Branch", "Started"],
      waves.filter((w) => w.state === "running").map((w) => [w.id, w.branch, w.startedAt]),
    ),
    "## Checkpoint answers",
    "",
    table(
      ["Item", "Ruling", "Answer"],
      current(ledger.checkpoints).map((c) => [c.key, c.ruling ?? "", c.answer]),
    ),
    "## Course overrides",
    "",
    table(
      ["Template file", "Gate gap"],
      current(ledger.template.overrides).map((o) => [o.path, `${GATE_GAP_REPO}#${o.gateGap}`]),
    ),
    "## Gate gaps",
    "",
    ledger.done === null
      ? "The Course build isn't marked done."
      : `The Course build was marked done ${ledger.done.at}.`,
    "",
    table(
      ["Gate gap", "Title", "Issue"],
      current(ledger.gateGaps).map((g) => [
        g.id,
        g.title,
        g.issue === null ? "unfiled" : `${GATE_GAP_REPO}#${g.issue}`,
      ]),
    ),
    "## Module media",
    "",
    `The Media pass writes each item's state to \`${MEDIA_PAGE}\` beside this page.`,
    "",
    "## Materials outside the Module map",
    "",
    table(
      ["File", "Kind"],
      materials.filter((f) => f.module === null).map((f) => [f.path, f.kind]),
    ),
    "## Superseded",
    "",
    "Rows a later row replaced. They stay in the ledger as history; nothing is deleted.",
    "",
    table(
      ["Row", "Id", "Superseded", "Reason"],
      supersededRows(ledger).map((s) => [s.row, s.id, s.at, s.reason]),
    ),
  ].join("\n");
}

function buildReport(ledger: Ledger, project: string): string {
  const sections = current(ledger.waves).map((wave) => {
    const ended =
      wave.endedAt === null ? "still running" : `ended ${wave.endedAt} (${duration(wave.startedAt, wave.endedAt)})`;
    const commit = wave.commit === null ? "no commit" : `commit ${wave.commit}`;
    const jobs = current(ledger.jobs).filter((j) => j.wave === wave.id);
    return [
      `## ${wave.id}: ${wave.kind} ${wave.target}, ${wave.state}`,
      "",
      `Branch ${wave.branch} · release ${wave.release} · ${commit} · started ${wave.startedAt} · ${ended}`,
      "",
      table(
        ["Job", "Result", "Time", "Detail"],
        jobs.map((j) => [
          j.job,
          j.result,
          j.startedAt === null ? "not measured" : duration(j.startedAt, j.recordedAt),
          j.detail ?? "",
        ]),
      ),
      ...relaunched(ledger, wave.id),
      ...tools(ledger, wave.id),
    ].join("\n");
  });
  return [
    `# ${ledger.intake.courseName}: build report`,
    "",
    GENERATED,
    "",
    ...sections,
    ...disciplinesConfirmed(ledger),
    ...padFixes(project),
  ].join("\n");
}

/** The wave's relaunched subagents: each dead predecessor's file, re-gated, and what became of it. */
function relaunched(ledger: Ledger, wave: string): string[] {
  const rows = current(ledger.relaunches).filter((r) => r.wave === wave);
  if (rows.length === 0) return [];
  return [
    "",
    "Relaunched subagents (their predecessors' files, re-gated before reuse):",
    "",
    table(
      ["Job", "File", "Outcome", "Re-gate findings"],
      rows.flatMap((r) =>
        r.files.map((f) => [r.job, f.path, f.outcome ?? "not settled", f.covered ? f.findings : "no gate covers it"]),
      ),
    ),
  ];
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * The wave's tool assignment: each Worked example's model, and each tool with its Discipline, the
 * Toolkit tool it was assigned, what it ships (a fallback shows where it fell back from), its builder
 * job's result and measured time, and the counts of its hand-back. The Owner can overrule any of it.
 */
function tools(ledger: Ledger, wave: string): string[] {
  const row: Assignment | undefined = current(ledger.assignments).find((a) => a.wave === wave);
  if (row === undefined) return [];
  const jobs = current(ledger.jobs).filter((j) => j.wave === wave);
  const label = (n: string) => `W${row.module}.${n}`;
  const worked = row.worked.map(
    (w) => `${label(w.n)} ${w.model}${w.model === "illustration" && w.figure !== null ? ` (${w.figure})` : ""}`,
  );
  return [
    "",
    `Tool assignment${worked.length === 0 ? "" : ` (${worked.join("; ")})`}:`,
    "",
    table(
      [
        "Worked example",
        "Tool",
        "Discipline",
        "Interaction",
        "Assigned",
        "Ships",
        "Job",
        "Result",
        "Time",
        "Hand-back",
      ],
      row.tools.map((t) => {
        const job = jobs.find((j) => j.job === t.job);
        // A sim recorded fell-back by a plain `record job` ships its step-through, as `ready` judges it.
        const ships = t.job.startsWith("sim-") && job?.result === "fell-back" ? "step-through" : t.ships;
        const from = t.fallbacks.length > 0 ? t.fallbacks.map((f) => f.from) : ships === t.ships ? [] : [t.ships];
        const fell = from.length === 0 ? "" : ` (fell back from ${from.join(", then ")})`;
        return [
          t.worked === null ? "Lab" : label(t.worked),
          t.name,
          t.discipline,
          t.interaction,
          t.tool,
          `${ships}${fell}`,
          t.job,
          job?.result ?? "not run",
          job === undefined || job.startedAt === null ? "not measured" : duration(job.startedAt, job.recordedAt),
          t.handback === null
            ? "no hand-back"
            : [
                plural(t.handback.files, "file"),
                plural(t.handback.parts, "part"),
                plural(t.handback.nets, "net"),
                plural(t.handback.assumptions, "assumption"),
              ].join(" · "),
        ];
      }),
    ),
    "The Owner can overrule any assignment or fallback; the wave re-assigns it.",
  ];
}

/** The Disciplines the Owner added to the Course while it was built: his answer, not its text. */
function disciplinesConfirmed(ledger: Ledger): string[] {
  const answers = current(ledger.disciplines);
  if (answers.length === 0) return [];
  return [
    "",
    "## Disciplines confirmed during the build",
    "",
    table(
      ["Discipline", "Wave", "Answer", "Answered"],
      answers.map((d) => [d.name, d.wave, d.confirmed ? "confirmed" : "declined", d.answeredAt]),
    ),
  ];
}

/** The pad's contrast auto-fixes, as the deploy Gate report records them: reported, never decided here. */
function padFixes(project: string): string[] {
  // The content folder's name is written out: intake imports the ledger, so its constant would be an import cycle.
  const path = join(project, "content", BUILD_RECORDS_DIR, "gate-reports", "deploy.json");
  const head = ["", "## Pad auto-fixes (deploy gates, reported only)", ""];
  if (!existsSync(path)) return [...head, "No deploy Gate report yet.", ""];
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as { gates?: { fixes?: unknown }[] };
    const fixes = (report.gates ?? []).flatMap((g) =>
      Array.isArray(g.fixes) ? g.fixes.filter((f): f is string => typeof f === "string") : [],
    );
    return [...head, ...(fixes.length === 0 ? ["None.", ""] : [...fixes.map((f) => `- ${f}`), ""])];
  } catch {
    return [...head, "The deploy Gate report isn't readable.", ""];
  }
}

/** Wall-clock time the main agent measured between two ledger timestamps. */
function duration(from: string, to: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${m} min`;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}
