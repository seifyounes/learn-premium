// The maths and heat-transfer sims held to the sim gates: each live sim's numbers three ways, the
// engine against an independent check (direct evaluation in exact fractions for the tangent, the
// Fourier series for the plane wall's Crank–Nicolson march) and the Worked example's sheet, and
// each one through the tools gate's five eligibility checks.
import { describe, expect, it } from "vitest";
import { runControls } from "../gates/runner.ts";
import { simNumbers, toolsGate } from "../gates/sims.ts";
import { sim } from "../src/content/contract.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MATHS = "05-derivatives";
const HEAT = "01-thermal-resistance";
const log = (module: string, name: string) => `build-records/recompute/${module}/${name}.json`;
const numbers = (contentDir: string, module: string) => simNumbers.run({ contentDir, module });

describe("the tangent sim through the gates", () => {
  it("agrees three ways with direct evaluation and the sheet, h and the limit row included", async () => {
    const result = await numbers(FIXTURE_COURSE, MATHS);
    expect(result.findings).toEqual([]);
    // Eleven sheet cells three ways; the tangent's intercept off the sheet, two ways to 1e-9.
    expect(result.coverage).toEqual({ modules: 1, sims: 1, sheetValues: 11, recomputedValues: 12, stepThroughs: 0 });
  });

  it("blocks an engine the direct evaluation disagrees with", async () => {
    const course = fixtureWith(log(MATHS, "tangent"), (s) => s.replace('"secant[1]": 2.31', '"secant[1]": 2.33'));
    expect((await numbers(course, MATHS)).findings).toEqual([
      {
        outcome: "block",
        at: `modules/${MATHS}/sims/tangent.json`,
        message:
          "secant[1] (sheet cell C2): the engine gives 2.31 but the independent recompute gives 2.33, at the sheet's 2 decimals; fix whichever is wrong",
      },
    ]);
  });

  it("passes the five eligibility checks, its engine run at both sliders' min, mid and max", async () => {
    const result = await toolsGate.run({ contentDir: FIXTURE_COURSE, module: MATHS });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, sims: 1, kinds: 1, checks: 5, engineSamples: 7 });
  });
});

describe("the plane-wall sim through the gates", () => {
  it("agrees three ways with the Fourier series and the sheet, at the sheet's one decimal", async () => {
    const result = await numbers(FIXTURE_COURSE, HEAT);
    expect(result.findings).toEqual([]);
    // Five probes three ways; the Fourier number off the sheet, two ways to 1e-9.
    expect(result.coverage).toEqual({ modules: 1, sims: 1, sheetValues: 5, recomputedValues: 6, stepThroughs: 0 });
  });

  it("blocks a march the Fourier series disagrees with past the sheet's last digit", async () => {
    const course = fixtureWith(log(HEAT, "plate"), (s) => s.replace(/"T\(L\/2\)": [\d.]+/, '"T(L/2)": 45.1'));
    expect((await numbers(course, HEAT)).findings).toEqual([
      {
        outcome: "block",
        at: `modules/${HEAT}/sims/plate.json`,
        message:
          "T(L/2) (sheet cell B3): the engine gives 44.9 but the independent recompute gives 45.1, at the sheet's 1 decimals; fix whichever is wrong",
      },
    ]);
  });

  it("passes the five eligibility checks, Plotly's heatmap view included", async () => {
    const result = await toolsGate.run({ contentDir: FIXTURE_COURSE, module: HEAT });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, sims: 1, kinds: 1, checks: 5, engineSamples: 7 });
  });

  it("catches every planted defect on the plane-wall sim, the first live sim of the Course", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE }, gates: [simNumbers] });
    const [gate] = result.gates;
    expect(gate?.positive).toBe("pass");
    for (const control of gate?.controls ?? [])
      expect(control.caught, `${control.defect}: ${control.error ?? ""}`).toBe(true);
    expect(gate?.controls).toHaveLength(4);
  });
});

describe("the content contract for the new kinds", () => {
  const base = {
    title: "A sim",
    caption: "Planted",
    recompute: "independent",
  };
  it("keeps a secant's run above 0, and a wall whose faces change temperature", () => {
    const tangent = {
      ...base,
      kind: "tangent",
      model: { coefficients: [1, 2] },
      start: { a: 1, h: 0.5 },
      tune: { a: { min: 0, max: 2, step: 0.1 }, h: { min: 0, max: 1, step: 0.1 } },
    };
    expect(sim.safeParse(tangent).error?.issues.map((i) => i.message)).toEqual([
      "a secant's run is never 0: start h's range above 0",
    ]);
    const wall = {
      ...base,
      kind: "plane-wall",
      model: { thickness: 1, initial: 20, surface: 20 },
      units: { length: "m", temperature: "K" },
      start: { time: 1, diffusivity: 1 },
      tune: { time: { min: 0, max: 2, step: 1 }, diffusivity: { min: 1, max: 2, step: 1 } },
    };
    expect(sim.safeParse(wall).error?.issues.map((i) => i.message)).toEqual([
      "the faces change temperature: initial and surface differ",
    ]);
  });
});
