// The ladder engine at its interface, on the Fixture Course's two conveyors (W10.1): the example's
// timeline in, the key's values out, each rung's power as the page inks it, and the delay the timing
// chart measures. Expected values are the Worked example's key, worked by hand from the Professor's
// screenshot, never by this engine.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { sim } from "../src/content/contract.ts";
import { LadderRun, quantities, scansOf } from "../src/sims/ladder/engine.ts";
import { compileLadder } from "../src/sims/ladder/compile.ts";
import { ladderProblems, screenshotKeys, type LadderModel } from "../src/sims/ladder/model.ts";
import { measures, momentOf, seconds } from "../src/sims/ladder/view.ts";
import { FIXTURE_COURSE } from "./build-course";

const conveyors = sim.parse(
  parse(readFileSync(join(FIXTURE_COURSE, "modules/10-two-conveyors/sims/conveyors.yaml"), "utf8")),
);
if (conveyors.kind !== "ladder") throw new Error("not a ladder sim");
const { model, start, scenario, cycle } = conveyors;

describe("the two conveyors", () => {
  it("give the key's values on the example's timeline", () => {
    const q = quantities(model, start, scenario, cycle);
    const at = (ms: number) => [q[`Q 4.0@${ms}`], q[`MD 20@${ms}`], q[`Q 4.1@${ms}`]];
    expect(at(500)).toEqual([0, 0, 0]);
    expect(at(1000)).toEqual([1, 0, 0]);
    expect(at(3000)).toEqual([1, 2000, 0]);
    expect(at(5900)).toEqual([1, 4900, 0]);
    expect(at(6000)).toEqual([1, 5000, 1]);
    expect(at(8000)).toEqual([0, 0, 0]);
  });

  it("inks the rungs carrying power, and measures the TON's delay as 5.0 s", () => {
    const run = new LadderRun(model);
    const history = scansOf(start, scenario, cycle).map(({ ms, inputs }) =>
      momentOf(run, run.scan(inputs, ms), inputs),
    );
    const six = history.find((m) => m.ms === 6000);
    expect(six?.levels).toMatchObject({ latch: 1, run1: 1, timing: 1, run2: 1 });
    expect(six?.gauges).toEqual({ Delay: 1 });
    expect(history.find((m) => m.ms === 3000)?.gauges).toEqual({ Delay: 0.4 });
    expect(history.find((m) => m.ms === 500)?.levels).toMatchObject({ latch: 0, run1: 0, timing: 0, run2: 0 });
    expect(measures(model, history).map((m) => [m.part, seconds(m.to - m.from)])).toEqual([["Delay", "5.0 s"]]);
  });

  it("measures no delay from a history whose older scans were dropped while the input was already up", () => {
    const run = new LadderRun(model);
    const history = scansOf(start, scenario, cycle).map(({ ms, inputs }) =>
      momentOf(run, run.scan(inputs, ms), inputs),
    );
    expect(
      measures(
        model,
        history.filter((m) => m.ms >= 2000),
      ),
    ).toEqual([]);
  });

  it("take only a scan cycle that divides a second, so +1 s is one second of scans", () => {
    for (const [ms, ok] of [
      [100, true],
      [700, false],
      [5, false],
    ] as const)
      expect(sim.safeParse({ ...conveyors, cycle: ms }).success, `${ms} ms`).toBe(ok);
  });

  it("keys each part as a Blind reader keys an editor screenshot", () => {
    expect([...screenshotKeys(model).values()]).toEqual([
      "N1 no I 0.0",
      "N1 no Q 4.0",
      "N1 no I 0.1",
      "N1 coil Q 4.0",
      "N2 no Q 4.0",
      "N2 ton DB 1",
      "N2 coil Q 4.1",
    ]);
  });

  it("compile to STL as STEP 7 shows the networks", () => {
    expect(compileLadder(model)).toContain(
      ["\tA(", "\tO I 0.0", "\tO Q 4.0", "\t)", "\tA I 0.1", "\t= Q 4.0"].join("\n"),
    );
    expect(compileLadder(model)).toContain(
      "\tCALL SFB 4 , DB 1 ( IN := #tin1 , PT := T#5S , Q := #tq1 , ET := MD 20 )",
    );
  });
});

describe("what the engine refuses to run", () => {
  const base: LadderModel = {
    language: "LAD",
    parts: [
      { id: "R", kind: "power-rail", network: 1 },
      { id: "A", kind: "no", network: 1, operand: "I 0.0" },
      { id: "K", kind: "coil", network: 1, operand: "Q 4.0" },
    ],
    nets: [
      { id: "r", pins: ["R.t", "A.in"] },
      { id: "a", pins: ["A.out", "K.in"] },
    ],
    inputs: ["I 0.0"],
    watch: { "Q 4.0": "BOOL" },
  };
  const parts = (change: Partial<LadderModel["parts"][number]>, id = "K") =>
    base.parts.map((p) => (p.id === id ? { ...p, ...change } : p));

  it("passes a plain rung", () => expect(ladderProblems(base)).toEqual([]));

  it("takes timer and counter 0, as S7 numbers them, but no DB 0", () => {
    expect(
      ladderProblems({ ...base, parts: parts({ kind: "coil-sd", operand: "T 0", params: { preset: "S5T#1S" } }) }),
    ).toEqual([]);
    expect(ladderProblems({ ...base, parts: parts({ kind: "coil-cu", operand: "C 0" }) })).toEqual([]);
    expect(
      ladderProblems({ ...base, parts: parts({ kind: "ton", operand: "DB 0", params: { PT: "T#1S" } }) }).join(),
    ).toMatch(/isn't an operand/);
  });

  it("inks a line two timer boxes drive, unread, as the OR of both", () => {
    const parallel: LadderModel = {
      ...base,
      parts: [
        ...base.parts.filter((p) => p.id !== "K"),
        { id: "B1", kind: "s-odt", network: 1, operand: "T 1", params: { TV: "S5T#100MS" } },
        { id: "B2", kind: "s-odt", network: 1, operand: "T 2", params: { TV: "S5T#1S" } },
      ],
      nets: [
        { id: "r", pins: ["R.t", "A.in"] },
        { id: "a", pins: ["A.out", "B1.S", "B2.S"] },
        { id: "r1", pins: ["B1.R"] },
        { id: "r2", pins: ["B2.R"] },
        { id: "parallel", pins: ["B1.Q", "B2.Q"] },
      ],
    };
    const run = new LadderRun(parallel);
    run.scan({ "I 0.0": 1 }, 0);
    expect(run.scan({ "I 0.0": 1 }, 100).levels.parallel).toBe(1);
  });

  it("compiles two calls on one TON instance with its temporaries and DB declared once", () => {
    const twice: LadderModel = {
      ...base,
      parts: [
        ...base.parts.filter((p) => p.id !== "K"),
        { id: "T1", kind: "ton", network: 1, operand: "DB 1", params: { PT: "T#1S" } },
        { id: "R2", kind: "power-rail", network: 2 },
        { id: "T2", kind: "ton", network: 2, operand: "DB 1", params: { PT: "T#1S" } },
      ],
      nets: [
        { id: "r", pins: ["R.t", "A.in"] },
        { id: "a", pins: ["A.out", "T1.IN"] },
        { id: "q1", pins: ["T1.Q"] },
        { id: "r2", pins: ["R2.t", "T2.IN"] },
        { id: "q2", pins: ["T2.Q"] },
      ],
    };
    const awl = compileLadder(twice);
    expect(awl.match(/tin1 : BOOL;/g)).toHaveLength(1);
    expect(awl.match(/DATA_BLOCK DB 1/g)).toHaveLength(1);
    expect(awl.match(/CALL SFB 4 , DB 1/g)).toHaveLength(2);
  });

  it("a coil writing an input, a contact on a word, a timer without its preset", () => {
    expect(ladderProblems({ ...base, parts: parts({ operand: "I 1.0" }) })).toEqual([
      "K (coil, network 1): I 1.0 can't be its operand (it writes an output or memory bit)",
    ]);
    expect(ladderProblems({ ...base, parts: parts({ operand: "MW 10" }, "A") })[0]).toMatch(/can't be its operand/);
    expect(ladderProblems({ ...base, parts: parts({ kind: "coil-sd", operand: "T 1" }) })).toEqual([
      "K (coil-sd, network 1) needs its preset",
    ]);
  });

  it("an FBD element in a LAD sim, and a rung looped back on itself", () => {
    expect(ladderProblems({ ...base, parts: parts({ kind: "fbd-assign" }) })).toEqual([
      "K (fbd-assign, network 1) is an FBD element in a LAD sim",
    ]);
    const looped: LadderModel = {
      ...base,
      parts: [...base.parts, { id: "B", kind: "no", network: 1, operand: "I 0.1" }],
      nets: [
        { id: "r", pins: ["R.t", "A.in", "B.out"] },
        { id: "a", pins: ["A.out", "B.in", "K.in"] },
      ],
    };
    expect(ladderProblems(looped).join()).toMatch(/feeds itself round a loop/);
  });
});
