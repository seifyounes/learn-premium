// The state-table gate, per job: every FSM and GRAFCET sim's whole table (each reachable situation under
// each input combination: where the clock takes it, and its outputs) agrees with the independent
// recompute's (`fixture-course/tools/recompute-*.py` work it from the figure by hand, apart from the
// engine). The four broken engines (`src/sims/state-machine/mutants.ts`) are each caught wherever the
// example reaches their defect. The timing strip's own bits are the `timing-key` gate's, checked
// against the key.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { stringify } from "yaml";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { isLive, isStateDiagram } from "../src/sims/kinds.ts";
import { machineOf, machineTable, MachineError } from "../src/sims/state-machine/engine.ts";
import { compareTable, stateMachineLog, type StateMachineLog } from "../src/sims/state-machine/log.ts";
import { runControls } from "../src/sims/state-machine/mutants.ts";
import { differences } from "../src/sims/three-way.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems, readSim, recomputeLogEntry } from "./sims.ts";

/** How many disagreements a finding lists before it counts the rest. */
const SHOWN = 3;

export const stateTableGate: Gate = {
  id: "state-table",
  checks:
    "every FSM and GRAFCET sim's whole table (each reachable situation under each input combination: where the clock takes it and its outputs) agrees with the independent recompute's, from the same inputs; four broken engines, each caught where the example reaches its defect",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      sims: 0,
      stepThroughs: 0,
      situations: 0,
      rows: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
    };
    const findings: Finding[] = [];
    for (const file of files.filter((f) => f.collection === "sims")) {
      const read = readSim(file);
      if (read.raw?.kind !== "fsm" && read.raw?.kind !== "grafcet") continue;
      coverage.sims += 1;
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      const { sim: s, problem } = read;
      if (!s) {
        block(problem);
        continue;
      }
      if (!isStateDiagram(s)) continue;
      if (!isLive(s)) {
        coverage.stepThroughs += 1;
        continue;
      }
      const logEntry = recomputeLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry));
      const logPath = join(input.contentDir, logEntry);
      if (!existsSync(logPath)) {
        block(
          `no recompute log at ${logEntry}: a state machine ships live only when an independent recompute works its table; if it can't be recomputed, mark it recompute: none`,
        );
        continue;
      }
      let log;
      try {
        log = stateMachineLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
      } catch (error) {
        block(`can't read the recompute log ${logEntry}: ${(error as Error).message}`);
        continue;
      }
      if (!log.success) {
        block(`the recompute log ${logEntry} isn't one: ${problems(log.error)}`);
        continue;
      }
      const changed = [
        ...differences(log.data.inputs.model, s.model, "model"),
        ...differences(log.data.inputs.start, s.start, "start"),
      ];
      if (changed.length > 0) {
        block(
          `the recompute log was worked from other inputs (${changed.join("; ")}): the sim opens on the example's values, so fix the sim or recompute from the Materials`,
        );
        continue;
      }
      let machine;
      let table;
      try {
        machine = machineOf(s.kind, s.model);
        table = machineTable(machine);
      } catch (error) {
        if (!(error instanceof MachineError)) throw error;
        block(`can't run the machine: ${error.message}`);
        continue;
      }
      const agreement = compareTable(machine, table, log.data.table);
      coverage.situations += agreement.situations;
      coverage.rows += agreement.rows;
      if (agreement.mismatches.length > 0) {
        const more = agreement.mismatches.length - SHOWN;
        block(
          `the engine disagrees with the independent recompute: ${agreement.mismatches.slice(0, SHOWN).join("; ")}${more > 0 ? `; and ${more} more` : ""}`,
        );
        continue;
      }
      for (const control of runControls(s.kind, s.model, log.data)) {
        if (control.outcome === "caught") coverage.controlsCaught += 1;
        else if (control.outcome === "not-reached") coverage.controlsNotReached += 1;
        else
          block(
            `the gate is blind to a broken engine: ${control.defect}; its run differs from the engine's, yet the recompute's log agrees with it`,
          );
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a recompute table that sends one situation elsewhere",
      plant: (good, scratch) =>
        plantInMachine(good, scratch, (site) => {
          const row = site.log.table[0];
          const elsewhere = (site.raw.model as Model).states.find((st) => !row?.to.includes(st.id));
          if (!row || !elsewhere) throw new Error("the recompute table has no row to send elsewhere");
          row.to = [elsewhere.id];
          site.saveLog();
        }),
    },
    {
      defect: "a recompute table missing a reachable row",
      plant: (good, scratch) =>
        plantInMachine(good, scratch, (site) => {
          site.log.table.pop();
          site.saveLog();
        }),
    },
    {
      defect: "a model edge re-aimed in the model, the figure's table unchanged",
      plant: (good, scratch) =>
        plantInMachine(good, scratch, (site) => {
          for (const m of [site.raw.model as Model, (site.log.inputs as { model: Model }).model]) {
            const edges = m.edges;
            const found = edges.findIndex(
              (e) =>
                e.from !== e.to &&
                m.states.some(
                  (s) => s.id !== e.from && s.id !== e.to && !edges.some((q) => q.from === e.from && q.to === s.id),
                ),
            );
            const e = edges[found];
            const third =
              e &&
              m.states.find(
                (s) => s.id !== e.from && s.id !== e.to && !edges.some((q) => q.from === e.from && q.to === s.id),
              );
            if (!e || !third) throw new Error("the sim has no edge to re-aim at a third state");
            e.to = third.id;
            delete m.equations;
          }
          site.saveSim();
          site.saveLog();
        }),
    },
    {
      defect: "a recompute log worked from another input sequence",
      plant: (good, scratch) =>
        plantInMachine(good, scratch, (site) => {
          const model = (site.log.inputs as { model: Model }).model;
          const [name] = Object.keys(model.stimulus);
          const bits = name === undefined ? undefined : model.stimulus[name];
          if (name === undefined || !bits) throw new Error("the sim has no input sequence to change");
          model.stimulus[name] = (bits[0] === "1" ? "0" : "1") + bits.slice(1);
          site.saveLog();
        }),
    },
    {
      defect: "a live state machine with no recompute log",
      plant: (good, scratch) => plantInMachine(good, scratch, (site) => rmSync(site.logPath)),
    },
  ],
};

interface Model {
  states: { id: string; kind: string; label: string }[];
  edges: { from: string; to: string; label: string }[];
  equations?: unknown;
  stimulus: Record<string, string>;
}

interface Site {
  contentDir: string;
  simPath: string;
  logPath: string;
  /** The sim file as written, and the recompute log; a plant changes them, then saves what it changed. */
  raw: Record<string, unknown>;
  log: StateMachineLog;
  saveSim(): void;
  saveLog(): void;
}

const writeSim = (path: string, sim: Record<string, unknown>) =>
  writeFileSync(path, extname(path) === ".json" ? JSON.stringify(sim) : stringify(sim));

/**
 * A scratch copy of the Course with `plant` run on its first live state machine. Throws when there is
 * none, so a control can't silently check nothing. A plant that changes the model changes its log's
 * `inputs` the same way, so only the table can catch it, not the inputs comparison.
 */
function plantInMachine(good: GateInput, scratch: string, plant: (site: Site) => void): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "sims")) {
    const { sim } = readSim(file);
    if (!sim || !isStateDiagram(sim) || !isLive(sim)) continue;
    const simPath = join(copy.contentDir, file.entry);
    const logPath = join(copy.contentDir, recomputeLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry)));
    const raw = readStructured(readFileSync(simPath, "utf8"), file.entry, () => {});
    const log = JSON.parse(readFileSync(logPath, "utf8")) as StateMachineLog;
    plant({
      contentDir: copy.contentDir,
      simPath,
      logPath,
      raw,
      log,
      saveSim: () => writeSim(simPath, raw),
      saveLog: () => writeFileSync(logPath, JSON.stringify(log)),
    });
    return copy;
  }
  throw new Error(`no live state machine in ${good.contentDir} to plant a negative control in`);
}
