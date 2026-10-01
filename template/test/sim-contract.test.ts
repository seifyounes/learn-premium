import { describe, expect, it } from "vitest";
import { plantedSim } from "../gates/sims.ts";
import { sim } from "../src/content/contract.ts";

const issues = (raw: unknown) => sim.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("the Agent-built sim contract", () => {
  it("takes a model, the example's values to open on, and the ranges students tune them over", () => {
    expect(issues(plantedSim())).toBeUndefined();
  });

  it("lets students tune the inputs, never rewire the model", () => {
    const rewired = plantedSim();
    (rewired.tune as Record<string, unknown>).data = { min: 0, max: 1, step: 1 };
    expect(issues(rewired)).toEqual(['tune: Unrecognized key: "data"']);
  });

  it("opens on values inside the ranges students can tune them over", () => {
    const outside = plantedSim();
    (outside.start as Record<string, number>).alpha = 2;
    expect(issues(outside)).toEqual(["start.alpha: 2 is outside the range students tune it over (0.01 to 1)"]);
  });

  it("ships live only with the example's values to open on and the ranges students tune over", () => {
    const bare = plantedSim();
    delete bare.start;
    delete bare.tune;
    expect(issues(bare)).toEqual([
      "start: a live sim opens on the example's values (start) and says what students tune over (tune)",
      "tune: a live sim opens on the example's values (start) and says what students tune over (tune)",
    ]);
    // A step-through has nothing to tune.
    expect(issues({ ...bare, recompute: "none", stepThrough: plantedStepThrough() })).toBeUndefined();
  });

  it("maps sheet cells only when it names the Worked example they are on", () => {
    const loose = plantedSim();
    delete loose.worked;
    expect(issues(loose)).toEqual(["sheet: the sim checks sheet cells but names no Worked example (worked)"]);
  });

  it("falls back to a step-through when its model can't be recomputed, and must say how it steps", () => {
    const unchecked = plantedSim();
    unchecked.recompute = "none";
    expect(issues(unchecked)).toEqual([
      "stepThrough: a sim that can't be recomputed ships as a step-through: give its figure and steps",
    ]);
  });

  it("steps only through elements its step-through figure has", () => {
    const stepped = { ...plantedSim(), recompute: "none", stepThrough: plantedStepThrough() };
    expect(issues(stepped)).toBeUndefined();
    (stepped.stepThrough.steps[1] as { add: string[] }).add = ["nowhere"];
    expect(issues(stepped)).toEqual(['stepThrough.steps.1.add.0: the figure has no element "nowhere"']);
  });
});

function plantedStepThrough() {
  return {
    figure: {
      kind: "plot",
      caption: "Planted path",
      x: { label: "$\\theta_0$", min: 0, max: 1, step: 1 },
      y: { label: "$\\theta_1$", min: 0, max: 1, step: 1 },
      elements: [
        { id: "start", kind: "point", at: [0, 0] },
        { id: "next", kind: "point", at: [1, 1] },
      ],
      question: ["start"],
    },
    steps: [
      { caption: "The start", add: [] as string[] },
      { caption: "One step", add: ["next"], ring: ["next"] },
    ],
  };
}
