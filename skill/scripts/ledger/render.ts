// The readable status page and the build report, generated from the ledger. They are rewritten on
// every ledger write, so they never drift from it; nobody edits them by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_PAGE } from "../media/model.ts";
import { BUILD_RECORDS_DIR, current, GATE_GAP_REPO, LEDGER_FILE, sittingState, type Ledger } from "./model.ts";

export const STATUS_PAGE = "status.md";
export const BUILD_REPORT = "build-report.md";

export function writePages(project: string, ledger: Ledger): void {
  const dir = join(project, BUILD_RECORDS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, STATUS_PAGE), statusPage(ledger));
  writeFileSync(join(dir, BUILD_REPORT), buildReport(ledger));
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
  ].join("\n");
}

function buildReport(ledger: Ledger): string {
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
    ].join("\n");
  });
  return [`# ${ledger.intake.courseName}: build report`, "", GENERATED, "", ...sections].join("\n");
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
