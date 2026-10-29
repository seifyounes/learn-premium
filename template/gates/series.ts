// The series-limit gate, per job: a chemistry plot draws at most four lines in ink at once (past
// four, students toggle them), each line has its own dash and marker and its own label, and no
// order of toggling ever draws a fifth in ink. The rule is `src/chemistry/series.ts`'s, not the
// contract's, so these controls exercise the gate.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_SHOWN, seriesOfSim, seriesProblems, startSeries, toggleSeries } from "../src/chemistry/series.ts";
import { readStructured } from "../src/content/loaders.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { readSim } from "./sims.ts";

const ignoreMath = () => {};

/** A scratch copy of the Course with `edit` run on the raw JSON of its first multi-series plot's sim. */
function plantInPlot(good: GateInput, scratch: string, edit: (raw: { plot: Record<string, unknown> }) => void) {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "sims")) {
    const { sim } = readSim(file);
    if (!sim || !seriesOfSim(sim)) continue;
    const raw = readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath) as {
      plot: Record<string, unknown>;
    };
    edit(raw);
    writeFileSync(join(copy.contentDir, file.entry), JSON.stringify(raw));
    return copy;
  }
  throw new Error(`no sim with a multi-series plot in ${good.contentDir} to plant a negative control in`);
}

export const seriesLimitGate: Gate = {
  id: "series-limit",
  checks:
    "every chemistry plot draws at most 4 lines in ink at once (past 4, students toggle them), each line with its own dash and marker and its own label",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      plots: 0,
      series: 0,
      shown: 0,
    };
    const findings: Finding[] = [];
    for (const file of files.filter((f) => f.collection === "sims")) {
      const { sim } = readSim(file);
      const found = sim && seriesOfSim(sim);
      if (!found) continue;
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      coverage.plots += 1;
      coverage.series += found.defs.length;
      for (const message of seriesProblems(found.defs, found.plot)) block(message);
      // However the student toggles, never more than MAX_SHOWN lines are drawn in ink.
      let state = startSeries(found.defs, found.plot.shown);
      coverage.shown += state.shown.length;
      for (const hidden of found.defs.filter((d) => !state.shown.includes(d.id))) {
        state = toggleSeries(found.defs, state, hidden.id);
        if (state.shown.length > MAX_SHOWN)
          block(`showing ${hidden.label} draws ${state.shown.length} lines in ink: at most ${MAX_SHOWN} at once`);
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "five isotherms with no toggle",
      plant: (good, scratch) => plantInPlot(good, scratch, (raw) => void delete raw.plot["many"]),
    },
    {
      defect: "a toggle plot that opens with five lines in ink",
      plant: (good, scratch) =>
        plantInPlot(good, scratch, (raw) => {
          raw.plot["shown"] = [...(raw.plot["isotherms"] as number[])];
        }),
    },
    {
      defect: "two lines that share a label",
      plant: (good, scratch) =>
        plantInPlot(good, scratch, (raw) => {
          raw.plot["isotherms"] = [273.15, 298.15, 298.15, 348.15];
          delete raw.plot["shown"];
        }),
    },
    {
      defect: "more lines than distinct line styles",
      plant: (good, scratch) =>
        plantInPlot(good, scratch, (raw) => {
          raw.plot["isotherms"] = [263.15, 273.15, 283.15, 293.15, 303.15, 313.15, 323.15];
          raw.plot["many"] = "toggle";
          delete raw.plot["shown"];
        }),
    },
  ],
};
