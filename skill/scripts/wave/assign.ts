// The Module wave's tool assignment. The main agent decides, for each Worked example, whether its
// model is computable (it gets a tool) or an illustration (its figure stays static or animates), and
// for each tool its Discipline, its interaction and the Toolkit tool it is built as. `assign` checks
// that against the Disciplines' Toolkits and the Owner's confirmed Disciplines, then records it in
// the Build ledger; one builder job runs per tool. `ready` later holds the Module's content to the
// assignment (`toolProblems`), so a tool no assignment names, or an example left without its tool,
// can't merge. A tool whose builder can't pass its gates after two fix rounds falls back (`fallback`).
import { assignmentOf, recordAssignment, recordDiscipline, updateTool } from "../ledger/assignments.ts";
import { LedgerError } from "../ledger/file.ts";
import { recordJob, requireLedger } from "../ledger/ledger.ts";
import {
  count,
  current,
  FIGURE_KINDS,
  moduleId,
  WORKED_MODELS,
  type AssignedTool,
  type Job,
  type Ledger,
} from "../ledger/model.ts";
import { arr, bool, nonEmpty, nullable, obj, oneOf, type Infer } from "../ledger/schema.ts";
import { FIX_ROUNDS } from "../ledger/fix-loop.ts";
import {
  builderJob,
  disciplineOf,
  nextTool,
  TOOLKITS,
  toolsFor,
  type StartingDiscipline,
  type ToolName,
} from "./toolkits.ts";

/** What a sim falls back to once its fix rounds are spent. */
export const STEP_THROUGH = "step-through";

const SAFE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const assignmentInput = obj({
  module: moduleId,
  worked: arr(obj({ n: nonEmpty, model: oneOf(...WORKED_MODELS), figure: nullable(oneOf(...FIGURE_KINDS)) })),
  tools: arr(
    obj({ name: nonEmpty, worked: nullable(nonEmpty), discipline: nonEmpty, interaction: nonEmpty, tool: nonEmpty }),
  ),
});
export type AssignmentInput = Infer<typeof assignmentInput>;
export { assignmentInput };

/**
 * The Module's Worked examples and tools as the template layer reads its content
 * (`template/gates/inventory.ts`; the skill carries no YAML parser). Held to the template's by its
 * test, which checks the Fixture Module's inventory against this one's fixture.
 */
export const toolInventorySchema = obj({
  module: nonEmpty,
  worked: arr(obj({ n: nonEmpty, entry: nonEmpty, figure: oneOf("none", "static", "animated") })),
  tools: arr(
    obj({
      name: nonEmpty,
      entry: nonEmpty,
      collection: oneOf("sims", "python", "parts"),
      kind: nonEmpty,
      worked: nullable(nonEmpty),
      live: bool,
      counts: nullable(obj({ parts: count, nets: count })),
    }),
  ),
  problems: arr(nonEmpty),
});
export type ToolInventory = Infer<typeof toolInventorySchema>;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A Discipline's Checkpoint key: `03/discipline/heat-transfer`. */
export const disciplineKey = (module: string, name: string) => `${module}/discipline/${slug(name)}`;

/** The question asked about a Discipline the intake didn't list. It names no Materials text. */
export const disciplineQuestion = (module: string, name: string, onList: boolean) =>
  onList
    ? `Module ${module} needs tools from ${name}, a Discipline this Course's intake didn't list. Add ${name} to this Course?`
    : `Module ${module} needs tools from "${name}", which the Toolkit doesn't list: adding a Discipline waits for ticket #79.`;

/** The label a Worked example goes by on the site: `W03.1`. */
export const workedLabel = (module: string, n: string) => `W${module}.${n}`;

function moduleWave(ledger: Ledger, waveId: string) {
  const wave = current(ledger.waves).find((w) => w.id === waveId);
  if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${waveId}`);
  if (wave.kind !== "module") throw new LedgerError("invalid", `${waveId} is a ${wave.kind} wave, not a Module wave`);
  return wave;
}

/** Whether the Course may use a Discipline's Toolkit: its intake lists it, or the Owner confirmed it; his latest answer wins. */
function confirmation(ledger: Ledger, discipline: StartingDiscipline): "confirmed" | "declined" | "unasked" {
  const answer = current(ledger.disciplines).find((d) => d.name === discipline);
  if (answer !== undefined) return answer.confirmed ? "confirmed" : "declined";
  return ledger.intake.disciplines.some((d) => disciplineOf(d) === discipline) ? "confirmed" : "unasked";
}

export interface DisciplineAsk {
  key: string;
  question: string;
  discipline: string;
  /** The tools that wait on it. */
  tools: string[];
}

/** Everything wrong with the assignment as written, before any Discipline is asked about. */
function inputProblems(input: AssignmentInput, target: string, waveId: string): string[] {
  const problems: string[] = [];
  if (input.module !== target)
    problems.push(`the assignment is for Module ${input.module}, but wave ${waveId} builds Module ${target}`);
  const dup = (what: string, values: string[]) => {
    for (const value of new Set(values.filter((v, i) => values.indexOf(v) !== i)))
      problems.push(`${what} ${value} is listed twice`);
  };
  dup(
    "Worked example",
    input.worked.map((w) => w.n),
  );
  dup(
    "tool",
    input.tools.map((t) => t.name),
  );
  const planned = new Set(input.worked.map((w) => w.n));
  for (const tool of input.tools) {
    if (!SAFE_NAME.test(tool.name))
      problems.push(
        `tool name "${tool.name}" must be lower-case words joined by dashes (it is the content file's name)`,
      );
    if (tool.worked !== null && !planned.has(tool.worked))
      problems.push(`tool ${tool.name} sits in Worked example ${tool.worked}, which the assignment doesn't plan`);
  }
  for (const w of input.worked) {
    const sits = input.tools.filter((t) => t.worked === w.n);
    if (w.model === "computable" && sits.length === 0)
      problems.push(
        `${workedLabel(input.module, w.n)} is computable, so it needs a tool: assign one, or call it an illustration`,
      );
    if (w.model === "illustration") {
      if (sits.length > 0)
        problems.push(
          `${workedLabel(input.module, w.n)} is an illustration, so no tool sits in it (${sits.map((t) => t.name).join(", ")}): its figure stays static or animates`,
        );
      if (w.figure === null)
        problems.push(
          `${workedLabel(input.module, w.n)} is an illustration: say whether its figure is none, static or animate`,
        );
    }
  }
  return problems;
}

/** What is wrong with a tool's interaction and Toolkit tool in its Discipline's Toolkit. */
function toolkitProblem(discipline: StartingDiscipline, tool: AssignmentInput["tools"][number]): string | null {
  const toolkit = TOOLKITS[discipline];
  if (Object.keys(toolkit).length === 0)
    return `${discipline} has no built tool for ${tool.interaction} (tool ${tool.name}): ask the Owner`;
  const list = toolsFor(toolkit, tool.interaction);
  if (list === null)
    return `tool ${tool.name}: ${discipline}'s Toolkit has no interaction "${tool.interaction}" (it has ${Object.keys(toolkit).join(", ")})`;
  if (!(list as readonly string[]).includes(tool.tool))
    return `tool ${tool.name}: ${tool.tool} isn't in ${discipline}'s Toolkit for ${tool.interaction} (it has ${list.join(", ")})`;
  return null;
}

/**
 * `assign`: checks the assignment and records it, returning one builder job per tool. Exit 2 for
 * an assignment the Toolkit or the rules refuse; exit 1, with nothing recorded, while a tool's
 * Discipline isn't the Course's (the Owner is asked at that point, and its builders wait).
 */
export function assign(project: string, holder: string, waveId: string, given: unknown) {
  const input = assignmentInput(given, "assignment");
  const ledger = requireLedger(project);
  const wave = moduleWave(ledger, waveId);
  const problems = inputProblems(input, wave.target, waveId);
  const resolved = input.tools.map((tool) => ({ tool, discipline: disciplineOf(tool.discipline) }));
  for (const { tool, discipline } of resolved) {
    const problem = discipline === null ? null : toolkitProblem(discipline, tool);
    if (problem !== null) problems.push(problem);
  }
  if (problems.length > 0) throw new LedgerError("invalid", problems.join("; "));

  const asks = new Map<string, DisciplineAsk>();
  for (const { tool, discipline } of resolved) {
    const state = discipline === null ? "unasked" : confirmation(ledger, discipline);
    if (state === "confirmed") continue;
    const name = discipline ?? tool.discipline;
    const base = disciplineQuestion(wave.target, name, discipline !== null);
    const ask = asks.get(name) ?? {
      key: disciplineKey(wave.target, name),
      question:
        state === "declined"
          ? `${base} The Owner declined ${name} for this Course: change the tools' Discipline, or ask him again.`
          : base,
      discipline: name,
      tools: [],
    };
    ask.tools.push(tool.name);
    asks.set(name, ask);
  }
  if (asks.size > 0)
    return {
      code: 1,
      ask: [...asks.values()],
      next: "ask the Owner each question now, in chat; record his answer with wave.ts discipline, then run assign again. No builder starts before it",
    };

  recordAssignment(project, holder, {
    wave: waveId,
    module: input.module,
    worked: input.worked,
    tools: input.tools.map((tool) => ({ ...tool, job: builderJob(tool.tool as ToolName, tool.name) })),
  });
  return {
    builders: input.tools.map((tool) => ({
      job: builderJob(tool.tool as ToolName, tool.name),
      name: tool.name,
      tool: tool.tool,
      worked: tool.worked,
    })),
    next: "launch one builder per entry with briefs/sim-builder.md and record the launch time; when each hands back, wave.ts handback, then record job with --started-at",
  };
}

/** `discipline`: stores the Owner's answer on a Discipline the intake didn't list, and the Checkpoint row for it. */
export function confirmDiscipline(
  project: string,
  holder: string,
  waveId: string,
  name: string,
  confirmed: boolean,
  answer: string,
) {
  const wave = moduleWave(requireLedger(project), waveId);
  const discipline = disciplineOf(name);
  if (discipline === null)
    throw new LedgerError(
      "refused",
      `${name} isn't a Discipline the Toolkit lists: adding a Discipline waits for ticket #79`,
    );
  recordDiscipline(project, holder, {
    wave: waveId,
    name: discipline,
    confirmed,
    answer,
    key: disciplineKey(wave.target, discipline),
    question: disciplineQuestion(wave.target, discipline, true),
  });
  return { discipline, confirmed, key: disciplineKey(wave.target, discipline) };
}

/** The tool the wave's `job` falls back to: a sim's step-through, a tool's next Toolkit tool; null when there is none. */
function fallbackTarget(tool: AssignedTool): string | null {
  if (tool.job.startsWith("sim-")) return tool.ships === STEP_THROUGH ? null : STEP_THROUGH;
  const discipline = disciplineOf(tool.discipline);
  return discipline === null ? null : nextTool(TOOLKITS[discipline], tool.interaction, tool.ships as ToolName);
}

/**
 * `fallback`: a builder job that is blocked after its two fix rounds falls back, a sim to its
 * step-through and a tool to the next tool in its Discipline's Toolkit. A tool with none goes to
 * the Owner as a Checkpoint item. The job's `fell-back` result is recorded here, so the fix loop's
 * own rounds are enforced.
 */
export function fallback(project: string, holder: string, waveId: string, job: string, startedAt: string) {
  const ledger = requireLedger(project);
  moduleWave(ledger, waveId);
  const row = assignmentOf(ledger, waveId)?.tools.find((t) => t.job === job);
  if (row === undefined)
    throw new LedgerError(
      "invalid",
      `${job} isn't a builder job of the wave's tool assignment (sim-<name> or tool-<name>)`,
    );
  const to = fallbackTarget(row);
  if (to === null)
    throw new LedgerError(
      "refused",
      row.job.startsWith("sim-")
        ? `${job} already ships its ${STEP_THROUGH}: nothing is left to fall back to`
        : `${job} has no next tool after ${row.ships} in the ${row.discipline} Toolkit for ${row.interaction}: record --result checkpoint with what it needs from the Owner`,
    );
  const last = current(ledger.jobs).find((j) => j.wave === waveId && j.job === job);
  // An interrupted fallback finishes on a re-run: the job's result is already in.
  if (last?.result !== "fell-back")
    recordJob(project, holder, {
      wave: waveId,
      job,
      result: "fell-back",
      startedAt,
      detail: `${to} (fell back from ${row.ships} after ${FIX_ROUNDS} fix rounds)`,
    });
  updateTool(project, holder, waveId, row.name, (tool) => {
    tool.fallbacks.push({ from: tool.ships, to, at: new Date().toISOString() });
    tool.ships = to;
  });
  return { job, from: row.ships, to };
}

/** The jobs a subagent runs: the main agent measures each, so `ready` refuses one recorded without a launch time. */
export const SUBAGENT_JOBS = [
  "blind-reader-a",
  "blind-reader-b",
  "style-sheet",
  "writer",
  "recompute",
  "review",
] as const;

/** What a row's tool ships as: a sim that fell back ships its step-through, however its fallback was recorded. */
function effectiveShips(tool: AssignedTool, job: Job | undefined): string {
  return tool.job.startsWith("sim-") && job?.result === "fell-back" ? STEP_THROUGH : tool.ships;
}

/** Whether the inventory's tool is what `ships` says: a sim kind live, a step-through a sim that isn't, a Pyodide tool or a part. */
function isShipped(found: ToolInventory["tools"][number], ships: string): boolean {
  if (ships === STEP_THROUGH) return found.collection === "sims" && !found.live;
  if (ships === "pyodide") return found.collection === "python";
  if (ships === "part") return found.collection === "parts";
  return found.collection === "sims" && found.kind === ships && found.live;
}

const FIGURE_OF = { animate: "animated", static: "static", none: "none" } as const;

/**
 * Why the Module's content doesn't match its wave's tool assignment: an example or tool the
 * assignment doesn't know, one it plans that the content lacks, a tool that isn't what it ships, a
 * builder job that didn't pass, wasn't timed or left no hand-back, and any subagent job recorded
 * without its launch time. Empty when the Module has no Worked example and no tool.
 */
export function toolProblems(
  ledger: Ledger,
  waveId: string,
  folder: string,
  inventory: ToolInventory | string,
): string[] {
  if (typeof inventory === "string") return [inventory];
  const problems = [...inventory.problems];
  const row = assignmentOf(ledger, waveId);
  const jobs = new Map(
    current(ledger.jobs)
      .filter((j) => j.wave === waveId)
      .map((j) => [j.job, j]),
  );
  const untimed = (job: string) => `job ${job} wasn't timed: record it with --started-at <when you launched it>`;

  if (row === undefined) {
    const [w, t] = [inventory.worked.length, inventory.tools.length];
    if (w > 0 || t > 0)
      problems.push(
        `no tool assignment for ${waveId}: ${folder} has ${w} Worked example${w === 1 ? "" : "s"} and ${t} tool${t === 1 ? "" : "s"}; the main agent writes the assignment (wave.ts assign) before the builders run`,
      );
  } else {
    const label = (n: string) => workedLabel(row.module, n);
    for (const w of inventory.worked)
      if (!row.worked.some((p) => p.n === w.n))
        problems.push(`${label(w.n)} has no entry in the tool assignment (${w.entry})`);
    for (const plan of row.worked) {
      const found = inventory.worked.find((w) => w.n === plan.n);
      if (found === undefined) {
        problems.push(`the tool assignment plans ${label(plan.n)}, which the Module doesn't have`);
        continue;
      }
      const sits = inventory.tools.filter((t) => t.worked === plan.n);
      if (plan.model === "computable" && sits.length === 0)
        problems.push(`${label(plan.n)} is computable, but no tool in the content sits in it`);
      if (plan.model === "illustration") {
        if (sits.length > 0)
          problems.push(
            `${label(plan.n)} is an illustration, but the content puts a tool in it (${sits.map((t) => t.name).join(", ")})`,
          );
        const wanted = plan.figure === null ? null : FIGURE_OF[plan.figure];
        if (found.figure !== wanted)
          problems.push(
            `${label(plan.n)} is planned as an illustration whose figure is ${plan.figure ?? "unsaid"}, but its figure in the content is ${found.figure}`,
          );
      }
    }
    for (const found of inventory.tools)
      if (!row.tools.some((t) => t.name === found.name))
        problems.push(`the content has a tool ${found.name} (${found.entry}) that no assignment names`);
    for (const tool of row.tools) {
      const job = jobs.get(tool.job);
      // A blocked job is already held by ready's own check: a second message would only repeat it.
      if (job?.result === "blocked") continue;
      const found = inventory.tools.find((t) => t.name === tool.name);
      const ships = effectiveShips(tool, job);
      if (found === undefined) problems.push(`the assigned tool ${tool.name} has no file in the content`);
      else {
        if (found.worked !== tool.worked)
          problems.push(
            `tool ${tool.name} sits in ${found.worked === null ? "no Worked example" : label(found.worked)} in the content, but the assignment says ${tool.worked === null ? "none (Lab only)" : label(tool.worked)}`,
          );
        if (!isShipped(found, ships))
          problems.push(
            `tool ${tool.name} should ship as ${ships}, but the content has a ${found.collection === "sims" ? `${found.kind} sim${found.live ? "" : " that isn't live"}` : found.kind}`,
          );
      }
      if (job === undefined) problems.push(`job ${tool.job} hasn't been recorded for ${waveId}`);
      else {
        const isSim = tool.job.startsWith("sim-");
        if (!(isSim ? ["passed", "fell-back"] : ["passed"]).includes(job.result))
          problems.push(`job ${tool.job} is ${job.result}: it must pass${isSim ? " or fall back" : ""}`);
        if (job.startedAt === null) problems.push(untimed(tool.job));
      }
      if (tool.handback === null)
        problems.push(`tool ${tool.name} has no hand-back: wave.ts handback --name ${tool.name}`);
    }
  }
  for (const name of jobs.keys())
    if (/^(sim|tool)-/.test(name) && !row?.tools.some((t) => t.job === name))
      problems.push(`job ${name} builds a tool that no assignment names`);
  for (const name of SUBAGENT_JOBS) if (jobs.get(name)?.startedAt === null) problems.push(untimed(name));
  return problems;
}
