// The Nernst and series-limit gates on the Fixture Course's copper concentration cell (Module 13):
// the sheet three ways, the whole slider grid (729 states) against the independent recompute, the
// cell's polarity against the recompute's own anode, and the four-line rule of chemistry plots.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareSweep, nernstGate } from "../gates/nernst.ts";
import { runControls, type Gate } from "../gates/runner.ts";
import { seriesLimitGate } from "../gates/series.ts";
import { cellState } from "../src/sims/nernst/apparatus.ts";
import { sweepGrid, type NernstLog } from "../src/sims/nernst/log.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "13-cell-potential";
const SIM = `modules/${MODULE}/sims/cell.json`;
const LOG = `build-records/recompute/${MODULE}/cell.json`;
const SHEET = `modules/${MODULE}/worked/1.json`;
const input = { contentDir: FIXTURE_COURSE, module: MODULE };

const json = <T>(file: string, from = FIXTURE_COURSE) => JSON.parse(readFileSync(join(from, file), "utf8")) as T;
const sim = () => json<{ model: Parameters<typeof cellState>[0]; tune: Parameters<typeof sweepGrid>[0] }>(SIM);
const log = () => json<NernstLog>(LOG);
/** A copy of the Course whose recompute log, or sim, is changed by `edit`. */
const editJson = (file: string, edit: (data: Record<string, unknown>) => void) =>
  fixtureWith(file, (source) => {
    const data = JSON.parse(source) as Record<string, unknown>;
    edit(data);
    return JSON.stringify(data);
  });
const run = (gate: Gate, contentDir = FIXTURE_COURSE) => gate.run({ contentDir, module: MODULE });
const messages = async (gate: Gate, contentDir: string) =>
  (await run(gate, contentDir)).findings.map((f) => `${f.outcome}: ${f.message}`);

describe("the nernst gate", () => {
  it("nernst passes the Fixture cell", async () => {
    const result = await run(nernstGate);
    expect(result.findings).toEqual([]);
    // 9 points on each of c1, c2 and T; c1 > c2 at 36 of the 81 pairs, so the cell reverses at 36 × 9; the diagonal's 81 have no current.
    expect(result.coverage).toEqual({
      modules: 1,
      nernstSims: 1,
      stepThroughs: 0,
      states: 729,
      reversed: 324,
      sheetValues: 3,
      recomputedValues: 6,
    });
  });

  it("catches a recompute that disagrees with the engine on a sheet value", async () => {
    const course = editJson(LOG, (data) => {
      const values = data["values"] as Record<string, number>;
      values["E"] = (values["E"] as number) + 5;
    });
    expect((await messages(nernstGate, course)).join("\n")).toMatch(/block: .*E/);
  });

  it("raises a Checkpoint item for a sheet value the engine and the recompute agree against", async () => {
    const course = fixtureWith(SHEET, (source) => source.replace('"0.0592"', '"0.0597"'));
    const found = await messages(nernstGate, course);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^checkpoint: /);
  });

  it("catches a sweep 1 mV off the engine at one state, naming it", async () => {
    const course = editJson(LOG, (data) => {
      const sweep = data["sweep"] as { E: number }[];
      (sweep[400] as { E: number }).E += 0.001;
    });
    const found = await messages(nernstGate, course);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^block: the recompute's E is off the engine's at 1 of 729 states, worst at sweep state 400 \(c1 = 1\.0005, c2 = 2, T = 323\.15\): 0\.010644 V against 0\.009644\d* V$/,
    );
  });

  it("names a sweep that leaves out the temperature slider", async () => {
    const course = editJson(LOG, (data) => {
      data["sweep"] = (data["sweep"] as { inputs: { T: number } }[]).filter((s) => s.inputs.T === 298.15);
    });
    expect(await messages(nernstGate, course)).toEqual([
      "block: the sweep has 81 states; the 9-point grid over c1, c2 and T has 729",
    ]);
  });

  it("catches an anode that never leaves the first electrode: the 3D cell would draw the wrong polarity", async () => {
    const course = editJson(LOG, (data) => {
      for (const state of data["sweep"] as { E: number; anode: string | null }[])
        if (state.E < 0) state.anode = "first";
    });
    expect(await messages(nernstGate, course)).toEqual([
      "block: the recompute's anode is the first electrode at 324 states where the cell reverses (E < 0): the 3D cell would draw the wrong polarity",
    ]);
  });

  it("a cell state that never reverses is caught", () => {
    const { model, tune } = sim();
    const stuck = (m: typeof model, i: Parameters<typeof cellState>[1]) => ({
      ...cellState(m, i),
      anode: "first" as const,
      flow: "first-to-second" as const,
    });
    const found = compareSweep(model, tune, log().sweep, { state: stuck });
    // The recompute reasons the anode is the second electrode wherever E < 0; the mutant cell says the first everywhere.
    expect(found).toContain(
      "the recompute's anode is the second electrode at 324 states where the cell runs as written (E > 0): the 3D cell would draw the wrong polarity",
    );
    expect(found).toHaveLength(2);
  });

  it("a sweep state 0.5e-9 V off passes: the tolerance is not zero", () => {
    const { model, tune } = sim();
    const sweep = log().sweep;
    (sweep[400] as { E: number }).E += 0.5e-9;
    expect(compareSweep(model, tune, sweep)).toEqual([]);
    (sweep[400] as { E: number }).E += 1e-9;
    expect(compareSweep(model, tune, sweep)).toHaveLength(1);
  });

  it("a state off the grid is named", () => {
    const { model, tune } = sim();
    const sweep = log().sweep;
    (sweep[10] as { inputs: Record<string, number> }).inputs["c2"] = 0.5;
    expect(compareSweep(model, tune, sweep)[0]).toMatch(
      /^sweep state 10 isn't on the grid: c2 = 0\.5 where the grid has 0\.25/,
    );
  });

  it("catches its six controls", async () => {
    const result = await runControls({ input, gates: [nernstGate] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(result.gates[0]?.controls.map((c) => `${c.caught ? "caught" : "MISSED"}: ${c.defect}`)).toEqual([
      "caught: a recompute that disagrees with the engine on a sheet value",
      "caught: a sheet value the engine and the recompute agree against, which only the Owner can rule",
      "caught: a recompute sweep 1 mV off the engine at one state",
      "caught: a recompute whose anode never leaves the first electrode",
      "caught: a sweep that leaves out the temperature slider",
      "caught: a live Nernst sim with no recompute log",
    ]);
  });
});

describe("the series-limit gate", () => {
  it("series-limit passes the Fixture plot", async () => {
    const result = await run(seriesLimitGate);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, plots: 1, series: 5, shown: 4 });
  });

  it("names each of its defects", async () => {
    const plot = (edit: (p: Record<string, unknown>) => void) =>
      editJson(SIM, (data) => edit(data["plot"] as Record<string, unknown>));
    expect(
      await messages(
        seriesLimitGate,
        plot((p) => void delete p["many"]),
      ),
    ).toEqual(["block: 5 lines on one plot: past 4, let students toggle them (plot.many: toggle)"]);
    expect(
      await messages(
        seriesLimitGate,
        plot((p) => void (p["shown"] = p["isotherms"])),
      ),
    ).toEqual(["block: it opens with 5 lines in ink: at most 4 are drawn at once"]);
    expect(
      await messages(
        seriesLimitGate,
        plot((p) => {
          p["isotherms"] = [273.15, 298.15, 298.15, 348.15];
          delete p["shown"];
        }),
      ),
    ).toEqual(['block: two lines are labelled "298.15 K": each label names one line']);
  });

  it("series-limit catches its four controls", async () => {
    const result = await runControls({ input, gates: [seriesLimitGate] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(result.gates[0]?.controls.map((c) => `${c.caught ? "caught" : "MISSED"}: ${c.defect}`)).toEqual([
      "caught: five isotherms with no toggle",
      "caught: a toggle plot that opens with five lines in ink",
      "caught: two lines that share a label",
      "caught: more lines than distinct line styles",
    ]);
  });
});
