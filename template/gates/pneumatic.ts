// The pneumatic-cycle gate, per job: every pneumatic sim's circuit stays as drawn at rest, runs exactly
// the sequence the Materials state once its buttons are pressed, comes back to rest and stops
// there, with every valve, line, roller and cylinder at every step agreeing with the independent
// recompute's trace (`fixture-course/tools/recompute-*.py` walk each line back to the supply or an
// exhaust, apart from the engine). The five broken engines (`src/sims/pneumatic/mutants.ts`) are
// each caught wherever the cycle reaches their defect. The displacement-step diagram's own bits are
// the `timing-key` gate's, checked against the key.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { isLive } from "../src/sims/kinds.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { CycleError, runCycle } from "../src/sims/pneumatic/engine.ts";
import { compareTrace, pneumaticLog, type PneumaticLog } from "../src/sims/pneumatic/log.ts";
import { runControls } from "../src/sims/pneumatic/mutants.ts";
import { differences } from "../src/sims/three-way.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems, readSim, recomputeLogEntry } from "./sims.ts";

/** How many disagreements a finding lists before it counts the rest. */
const SHOWN = 3;

export const pneumaticCycleGate: Gate = {
  id: "pneumatic-cycle",
  checks:
    "every pneumatic sim's circuit stays as drawn at rest, runs exactly the sequence the Materials state when its buttons are pressed, comes back to rest and stops there, every valve, line, roller and cylinder at every step agreeing with the independent recompute; five broken engines, each caught where the cycle reaches its defect",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      sims: 0,
      stepThroughs: 0,
      steps: 0,
      values: 0,
      movements: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
    };
    const findings: Finding[] = [];
    for (const file of files.filter((f) => f.collection === "sims")) {
      const read = readSim(file);
      if (read.raw?.kind !== "pneumatic") continue;
      coverage.sims += 1;
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      const { sim: s, problem } = read;
      if (!s) {
        block(problem);
        continue;
      }
      if (s.kind !== "pneumatic") continue;
      if (!isLive(s)) {
        coverage.stepThroughs += 1;
        continue;
      }
      const logEntry = recomputeLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry));
      const logPath = join(input.contentDir, logEntry);
      if (!existsSync(logPath)) {
        block(
          `no recompute log at ${logEntry}: a pneumatic sim ships live only when an independent recompute runs its circuit; if it can't be recomputed, mark it recompute: none`,
        );
        continue;
      }
      let log;
      try {
        log = pneumaticLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
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
      let cycle;
      try {
        cycle = runCycle(s.model, s.start);
      } catch (error) {
        if (!(error instanceof CycleError)) throw error;
        block(`can't run the circuit: ${error.message}`);
        continue;
      }
      if (cycle.end === "unstable") {
        block(
          `the circuit doesn't stay as drawn at rest: ${cycle.why}; draw each valve on the side its pilots hold it at rest`,
        );
        continue;
      }
      if (cycle.end === "stall") {
        block(`the cycle stalls at step ${cycle.steps.length} after ${cycle.movements.join(" ")}: ${cycle.why}`);
        continue;
      }
      if (cycle.end === "runaway") {
        block("the circuit doesn't come back to rest within 32 steps");
        continue;
      }
      coverage.movements += cycle.movements.length;
      if (cycle.movements.join(" ") !== s.model.sequence.join(" "))
        block(`the circuit runs ${cycle.movements.join(" ")}, but the Materials state ${s.model.sequence.join(" ")}`);
      if (!cycle.still) {
        const again = cycle.events.at(-1)?.find((e) => e.kind === "start");
        block(
          `the cycle doesn't stop at rest: ${again && "part" in again ? `${again.part} starts again by itself` : "it starts again by itself"}`,
        );
      }
      const agreement = compareTrace(cycle, log.data.trace);
      coverage.steps += agreement.states;
      coverage.values += agreement.values;
      if (agreement.mismatches.length > 0) {
        const more = agreement.mismatches.length - SHOWN;
        block(
          `the engine disagrees with the independent recompute: ${agreement.mismatches.slice(0, SHOWN).join("; ")}${more > 0 ? `; and ${more} more` : ""}`,
        );
        continue;
      }
      for (const control of runControls(s.model, s.start, log.data.trace)) {
        if (control.outcome === "caught") coverage.controlsCaught += 1;
        else if (control.outcome === "not-reached") coverage.controlsNotReached += 1;
        else
          block(
            `the gate is blind to a broken engine: ${control.defect}; its cycle differs from the engine's, yet the recompute's trace agrees with it`,
          );
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect:
        "the cascade bypassed: a roller valve fed straight from the supply, so a valve's pilots overlap when the cylinder must retract",
      plant: (good, scratch) =>
        plantInPneumatic(good, scratch, (site) => {
          const model = site.raw.model as Model;
          const roller = rollerAtExtendedEnd(model);
          const supply = model.nets.find((n) =>
            n.pins.some((p) => model.parts.some((q) => q.kind === "air-source" && p.startsWith(`${q.id}.`))),
          );
          if (!roller || !supply)
            throw new Error("the cascade has no roller at a stroke's far end, or no supply, to bypass");
          for (const m of [model, (site.log.inputs as { model: Model }).model]) {
            for (const n of m.nets) n.pins = n.pins.filter((p) => p !== `${roller}.1`);
            m.nets.find((n) => n.id === supply.id)?.pins.push(`${roller}.1`);
          }
          site.saveSim();
          site.saveLog();
        }),
    },
    {
      defect: "a recompute trace with one valve's spool off at one step",
      plant: (good, scratch) =>
        plantInPneumatic(good, scratch, (site) => {
          const { steps } = site.log.trace;
          const at = Math.min(2, steps.length - 1);
          const [before, here] = [steps[Math.max(0, at - 1)], steps[at]];
          if (!before || !here) throw new Error("the trace has no step to change");
          // The valve that shifts at that step, or the first one.
          const valve =
            Object.keys(here.spools).find((v) => here.spools[v] !== before.spools[v]) ?? Object.keys(here.spools)[0];
          if (valve === undefined) throw new Error("the circuit has no 5/2 valve");
          here.spools[valve] = here.spools[valve] === "12" ? "14" : "12";
          site.saveLog();
        }),
    },
    {
      defect: "a stated sequence the circuit doesn't run",
      plant: (good, scratch) =>
        plantInPneumatic(good, scratch, (site) => {
          for (const m of [site.raw.model as Model, (site.log.inputs as { model: Model }).model]) {
            const last = m.sequence.length - 1;
            [m.sequence[last - 1], m.sequence[last]] = [m.sequence[last] as string, m.sequence[last - 1] as string];
          }
          site.saveSim();
          site.saveLog();
        }),
    },
    {
      defect: "a cascade valve drawn on its 14 side, which the circuit doesn't hold at rest",
      plant: (good, scratch) =>
        plantInPneumatic(good, scratch, (site) => {
          for (const m of [site.raw.model as Model, (site.log.inputs as { model: Model }).model]) {
            const valve = m.parts.filter((p) => p.kind === "valve-52").at(-1);
            if (!valve) throw new Error("the circuit has no 5/2 valve");
            valve.rest = valve.rest === "14" ? "12" : "14";
          }
          site.saveSim();
          site.saveLog();
        }),
    },
    {
      defect: "a live pneumatic sim with no recompute log",
      plant: (good, scratch) => plantInPneumatic(good, scratch, (site) => rmSync(site.logPath)),
    },
    {
      defect: "a recompute trace that stops a step short",
      plant: (good, scratch) =>
        plantInPneumatic(good, scratch, (site) => {
          site.log.trace.steps.pop();
          site.saveLog();
        }),
    },
  ],
};

interface Model {
  parts: { id: string; kind: string; rest?: string; label?: string; notes?: Record<string, string> }[];
  nets: { id: string; pins: string[] }[];
  sequence: string[];
}

/** The roller valve a cylinder's far stroke end carries (the figure's `a1`): the first cylinder's `extended` mark. */
function rollerAtExtendedEnd(model: Model) {
  const cylinder = model.parts.find((p) => p.kind === "cylinder");
  const label = cylinder?.notes?.extended;
  return model.parts.find((p) => p.kind === "valve-32-roller" && p.label === label)?.id;
}

interface Site {
  contentDir: string;
  simPath: string;
  logPath: string;
  /** The sim file as written, and the recompute log; a plant changes them, then saves what it changed. */
  raw: Record<string, unknown>;
  log: PneumaticLog;
  saveSim(): void;
  saveLog(): void;
}

const writeSim = (path: string, sim: Record<string, unknown>) =>
  writeFileSync(path, path.endsWith(".json") ? JSON.stringify(sim) : stringify(sim));

/**
 * A scratch copy of the Course with `plant` run on its first live pneumatic sim. Throws when there is
 * none, so a control can't silently check nothing. A plant that changes the circuit changes its log's
 * `inputs` the same way, so only the run's checks can catch it, not the inputs comparison.
 */
function plantInPneumatic(good: GateInput, scratch: string, plant: (site: Site) => void): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "sims")) {
    const { sim } = readSim(file);
    if (sim?.kind !== "pneumatic" || !isLive(sim)) continue;
    const simPath = join(copy.contentDir, file.entry);
    const logPath = join(copy.contentDir, recomputeLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry)));
    const raw = readStructured(readFileSync(simPath, "utf8"), file.entry, () => {});
    const log = JSON.parse(readFileSync(logPath, "utf8")) as PneumaticLog;
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
  throw new Error(`no live pneumatic sim in ${good.contentDir} to plant a negative control in`);
}
