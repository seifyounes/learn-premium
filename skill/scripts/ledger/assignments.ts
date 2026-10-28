// A Module wave's tool assignment and the Owner's Discipline answers, in the Build ledger. `wave.ts
// assign`, `fallback`, `handback` and `discipline` write these rows; nothing else does.
import { sameDiscipline } from "./disciplines.ts";
import { LedgerError } from "./file.ts";
import { mutate } from "./ledger.ts";
import { current, type AssignedTool, type Assignment, type DisciplineAnswer, type Ledger } from "./model.ts";

/** The wave's current tool assignment, if it has one. */
export function assignmentOf(ledger: Pick<Ledger, "assignments">, wave: string): Assignment | undefined {
  return current(ledger.assignments).find((a) => a.wave === wave);
}

/**
 * Records the wave's tool assignment. It supersedes the wave's earlier row, carrying over the
 * fallbacks, hand-back and `ships` of each tool whose name and tool are unchanged.
 */
export function recordAssignment(
  project: string,
  holder: string,
  row: Pick<Assignment, "wave" | "module" | "worked"> & {
    tools: Omit<AssignedTool, "ships" | "fallbacks" | "handback">[];
  },
): void {
  mutate(project, holder, (ledger) => {
    const wave = current(ledger.waves).find((w) => w.id === row.wave);
    if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${row.wave}`);
    const at = new Date().toISOString();
    const before = assignmentOf(ledger, row.wave);
    if (before !== undefined) before.superseded = { at, reason: "assigned again" };
    ledger.assignments.push({
      ...row,
      recordedAt: at,
      tools: row.tools.map((tool) => {
        const kept = before?.tools.find((t) => t.name === tool.name && t.tool === tool.tool);
        return {
          ...tool,
          ships: kept?.ships ?? tool.tool,
          fallbacks: kept?.fallbacks ?? [],
          handback: kept?.handback ?? null,
        };
      }),
      superseded: null,
    });
  });
}

/** Changes the wave's current row of the tool `name`. */
export function updateTool(
  project: string,
  holder: string,
  wave: string,
  name: string,
  change: (tool: AssignedTool) => void,
): void {
  mutate(project, holder, (ledger) => {
    const tool = assignmentOf(ledger, wave)?.tools.find((t) => t.name === name);
    if (tool === undefined) throw new LedgerError("invalid", `wave ${wave} has no assigned tool ${name}`);
    change(tool);
  });
}

/**
 * Records the Owner's answer on a Discipline: its row, and the Checkpoint row under `key` with the
 * question as `assign` asked it, in one write. A later answer supersedes the earlier ones.
 */
export function recordDiscipline(
  project: string,
  holder: string,
  row: { wave: string; name: string; confirmed: boolean; answer: string; key: string; question: string },
): void {
  mutate(project, holder, (ledger) => {
    const wave = current(ledger.waves).find((w) => w.id === row.wave);
    if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${row.wave}`);
    const at = new Date().toISOString();
    for (const earlier of current(ledger.disciplines)) {
      if (earlier.name === row.name) earlier.superseded = { at, reason: "answered again" };
    }
    for (const earlier of current(ledger.checkpoints)) {
      if (earlier.key === row.key) earlier.superseded = { at, reason: "answered again" };
    }
    const { key, question, ...answered } = row;
    ledger.disciplines.push({ ...answered, answeredAt: at, superseded: null });
    ledger.checkpoints.push({
      key,
      wave: row.wave,
      question,
      answer: row.answer,
      ruling: null,
      answeredAt: at,
      superseded: null,
    });
  });
}

/**
 * Records the Owner's word that a Discipline added at intake met the bar, superseding his earlier
 * word. Refused (exit 2) for a Discipline this Course didn't add at intake, and (exit 3) until a
 * Module wave has merged with a tool of it: its first real build is what proves it.
 */
export function recordProven(project: string, holder: string, name: string, answer: string) {
  return mutate(project, holder, (ledger) => {
    const added = ledger.intake.added.find((a) => sameDiscipline(a.name, name));
    if (added === undefined)
      throw new LedgerError(
        "invalid",
        `${name} isn't a Discipline this Course added at intake: only an added Discipline is flagged unproven`,
      );
    const built = current(ledger.waves).some(
      (w) =>
        w.kind === "module" &&
        w.state === "merged" &&
        assignmentOf(ledger, w.id)?.tools.some((t) => sameDiscipline(t.discipline, added.name)),
    );
    if (!built)
      throw new LedgerError(
        "refused",
        `${added.name} has no merged Module with its tools yet: its first real build proves it`,
      );
    const at = new Date().toISOString();
    for (const earlier of current(ledger.proven))
      if (sameDiscipline(earlier.name, added.name)) earlier.superseded = { at, reason: "said again" };
    ledger.proven.push({ name: added.name, answer, at, superseded: null });
    return { discipline: added.name, provenAt: at };
  });
}

/** The Disciplines the Owner confirmed during the build, by registry name (the current rows, newest answer wins). */
export const confirmedDuringBuild = (ledger: Pick<Ledger, "disciplines">): DisciplineAnswer[] =>
  current(ledger.disciplines).filter((d) => d.confirmed);
