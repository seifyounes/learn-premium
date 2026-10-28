// The state-diagram gate, per job: the Drawing gate's half for state diagrams. Every FSM and GRAFCET
// sim's diagram, made by the layout core and its curve drawer from the sim's model and Layout hints
// exactly as the page makes it, passes every check against its model and against the Blind reader's
// figure reading (`src/sims/layout/diagram-check.ts`): edges are read from the drawn curves alone. On
// every build it also runs its negative control: each drawing broken nine known ways
// (`src/sims/layout/diagram-mutants.ts`) must fail, or the gate can't see what it claims to and
// blocks. Every check blocks.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { stringify } from "yaml";
import { moduleOf } from "../src/content/layout.ts";
import { diagramModelOf, isStateDiagram, type Sim } from "../src/sims/kinds.ts";
import { checkDiagram, diagramReading, type DiagramReading } from "../src/sims/layout/diagram-check.ts";
import { diagramMutantsOf } from "../src/sims/layout/diagram-mutants.ts";
import { layOutDiagram } from "../src/sims/layout/diagram.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import { figureReadingEntry } from "./drawing.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems, readSim } from "./sims.ts";

type StateDiagramSim = Extract<Sim, { kind: "fsm" | "grafcet" }>;

function readReading(contentDir: string, entry: string): DiagramReading | string {
  const path = join(contentDir, entry);
  if (!existsSync(path))
    return `no figure reading at ${entry}: a Blind reader reads the Professor's figure for every state diagram, so the model can be checked against it`;
  try {
    const parsed = diagramReading.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : `the figure reading ${entry} isn't one: ${problems(parsed.error)}`;
  } catch (error) {
    return `can't read the figure reading ${entry}: ${(error as Error).message}`;
  }
}

export const stateDiagramGate: Gate = {
  id: "state-diagram",
  checks:
    "every state diagram's drawing (an FSM, a GRAFCET) matches its model (states, edges read from the drawn curves alone, labels, conventions, legibility, tidiness), its model matches the Blind reader's figure reading, and the drawing matches the figure (arrangement, self-loop and bow sides, symbols, start arrow); a negative control of broken drawings is caught on every build",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      drawings: 0,
      checks: 0,
      mutantsCaught: 0,
      /** Mutants a drawing had nothing to plant in (no self-loop to move): reported, never a block. */
      mutantsSkipped: 0,
    };
    const findings: Finding[] = [];
    for (const file of files.filter((f) => f.collection === "sims")) {
      const read = readSim(file);
      // Only a sim that means to be a state diagram is this gate's.
      if (read.raw?.kind !== "fsm" && read.raw?.kind !== "grafcet") continue;
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      const { sim, problem } = read;
      if (!sim) {
        block(problem);
        continue;
      }
      if (!isStateDiagram(sim)) continue;
      const module = moduleOf(file.entry) ?? "";
      const reading = readReading(input.contentDir, figureReadingEntry(module, nameOf(file.entry)));
      if (typeof reading === "string") {
        block(reading);
        continue;
      }
      coverage.drawings += 1;
      const model = diagramModelOf(sim);
      const drawing = layOutDiagram(model, sim.layout);
      const verdict = checkDiagram(drawing, model, reading);
      coverage.checks += verdict.checks.length;
      for (const c of verdict.checks) for (const p of c.problems) block(`${c.group}, ${c.id}: ${p}`);
      // The negative control, on this drawing: every mutant must fail the check it breaks.
      const { mutants, skipped } = diagramMutantsOf(drawing);
      for (const mutant of mutants) {
        const failed = checkDiagram(mutant.drawing, model, reading).checks.filter((c) => c.problems.length > 0);
        if (failed.some((c) => mutant.expect.includes(c.id))) coverage.mutantsCaught += 1;
        else
          block(
            `the negative control missed a mutant (${mutant.what}): it passed the ${mutant.expect.join(" and ")} check, so the gate can't see what it claims to`,
          );
      }
      coverage.mutantsSkipped += skipped.length;
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "Layout hints that mirror the figure left to right",
      plant: (good, scratch) =>
        plantInStateDiagram(good, scratch, ({ sim }) => {
          const xs = Object.values(sim.layout.states).map((h) => h.at[0]);
          const span = Math.min(...xs) + Math.max(...xs);
          const states = Object.fromEntries(
            Object.entries(sim.layout.states).map(([id, h]) => [
              id,
              { ...h, at: [Math.round((span - h.at[0]) * 10) / 10, h.at[1]] },
            ]),
          );
          return { ...sim, layout: { ...sim.layout, states } };
        }),
    },
    {
      defect: "a model edge redirected to a state the figure doesn't point it at",
      plant: (good, scratch) =>
        plantInStateDiagram(good, scratch, ({ sim }) => {
          // The first edge whose source has no edge to some third state is re-aimed there; the hint
          // keyed by the old pair goes, and so do the equations (they no longer fit the diagram, and the
          // contract would refuse the sim before the figure check could see the edge).
          const edges = sim.model.edges;
          for (const [i, e] of edges.entries()) {
            const third = sim.model.states.find(
              (s) => s.id !== e.from && s.id !== e.to && !edges.some((q) => q.from === e.from && q.to === s.id),
            );
            if (e.from === e.to || !third) continue;
            const redirected = edges.map((q, j) => (j === i ? { ...q, to: third.id } : q));
            const hints = Object.fromEntries(
              Object.entries(sim.layout.edges).filter(([key]) => key !== `${e.from}>${e.to}`),
            );
            const model = { ...sim.model, edges: redirected };
            delete model.equations;
            return { ...sim, model, layout: { ...sim.layout, edges: hints } };
          }
          throw new Error("the sim has no edge to re-aim at a third state");
        }),
    },
    {
      defect: "two edges' labels swapped in the model, unlike the figure",
      plant: (good, scratch) =>
        plantInStateDiagram(good, scratch, ({ sim }) => {
          // The first state with two outgoing edges of different labels has them swapped.
          const edges = sim.model.edges;
          for (const s of sim.model.states) {
            const out = edges.flatMap((e, i) => (e.from === s.id ? [i] : []));
            const [a, b] = out.flatMap((i) =>
              out.filter((j) => j > i && edges[j]?.label !== edges[i]?.label).map((j) => [i, j] as const),
            )[0] ?? [-1, -1];
            if (a === -1 || b === -1) continue;
            const swapped = edges.map((e, i) =>
              i === a
                ? { ...e, label: edges[b]?.label ?? e.label }
                : i === b
                  ? { ...e, label: edges[a]?.label ?? e.label }
                  : e,
            );
            const model = { ...sim.model, edges: swapped };
            delete model.equations;
            return { ...sim, model };
          }
          throw new Error("the sim has no state with two differently labelled edges");
        }),
    },
    {
      defect: "a model that drops a state the figure draws",
      plant: (good, scratch) =>
        plantInStateDiagram(good, scratch, ({ readingPath, reading, sim }) => {
          // The figure gains a state and an edge into the first state; the model has neither.
          const first = sim.model.states[0];
          const firstEdge = reading.edges[0];
          if (!first || !firstEdge) throw new Error("the sim has no state to draw an extra edge into");
          const extra = {
            ...reading,
            states: { ...reading.states, S9: { kind: "state", at: [0.5, 0.5], output: "0" } },
            edges: [...reading.edges, { from: "S9", to: first.label, label: firstEdge.label }],
          };
          writeFileSync(readingPath, JSON.stringify(extra));
          return sim;
        }),
    },
    {
      defect: "Layout hints that move a self-loop to the other side",
      plant: (good, scratch) =>
        plantInStateDiagram(good, scratch, ({ sim }) => {
          const opposite = { left: "right", right: "left", above: "below", below: "above" } as const;
          const entry = Object.entries(sim.layout.states).find(([, h]) => h.loop !== undefined);
          if (!entry || !entry[1].loop) throw new Error("the sim has no self-loop hint to move");
          const [id, hint] = entry;
          return {
            ...sim,
            layout: {
              ...sim.layout,
              states: { ...sim.layout.states, [id]: { ...hint, loop: opposite[hint.loop as keyof typeof opposite] } },
            },
          };
        }),
    },
    {
      defect: "a state diagram with no figure reading",
      plant: (good, scratch) =>
        plantInStateDiagram(good, scratch, ({ contentDir, readingEntry, sim }) => {
          rmSync(join(contentDir, readingEntry));
          return sim;
        }),
    },
  ],
};

interface PlantSite {
  contentDir: string;
  readingEntry: string;
  readingPath: string;
  sim: StateDiagramSim;
  reading: DiagramReading;
}

/**
 * A scratch copy of the Course with its first FSM rewritten by `plant`. Throws when there is none, so
 * a control can't silently check nothing.
 */
function plantInStateDiagram(good: GateInput, scratch: string, plant: (site: PlantSite) => unknown): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f: CourseFile) => f.collection === "sims")) {
    const { sim } = readSim(file);
    if (sim?.kind !== "fsm") continue;
    const module = moduleOf(file.entry) ?? "";
    const readingEntry = figureReadingEntry(module, nameOf(file.entry));
    const readingPath = join(copy.contentDir, readingEntry);
    const reading = JSON.parse(readFileSync(readingPath, "utf8")) as DiagramReading;
    const written = plant({ contentDir: copy.contentDir, readingEntry, readingPath, sim, reading });
    writeFileSync(file.path, extname(file.path) === ".json" ? JSON.stringify(written) : stringify(written));
    return copy;
  }
  throw new Error(`no FSM in ${good.contentDir} to plant a negative control in`);
}
