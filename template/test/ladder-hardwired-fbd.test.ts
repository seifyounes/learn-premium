// A hard-wired rung and FBD's N-input boxes with negated inputs, on the Fixture Course's fan starter
// and tank alarm (Module 10): the model's rules, the engine's power flow past a coil, the STL they
// compile to, the drawing (right rail, the coil's `out`, negation circles) and the figure check
// against the Blind reader's readings, with the negation mutant caught.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { sim } from "../src/content/contract.ts";
import { compileLadder } from "../src/sims/ladder/compile.ts";
import { LadderRun } from "../src/sims/ladder/engine.ts";
import { ladderProblems, schematicOf, type LadderModel } from "../src/sims/ladder/model.ts";
import { checkDrawing, figureReading, RIGHT_RAIL, type FigureReading } from "../src/sims/layout/check.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { mutantsOf } from "../src/sims/layout/mutants.ts";
import { pinsOf, strokesOf } from "../src/sims/layout/symbols.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "10-two-conveyors";
const ladder = (name: string) => {
  const s = sim.parse(parse(readFileSync(join(FIXTURE_COURSE, "modules", MODULE, "sims", `${name}.yaml`), "utf8")));
  if (s.kind !== "ladder") throw new Error("not a ladder sim");
  return s;
};
const readingOf = (name: string) =>
  figureReading.parse(
    JSON.parse(readFileSync(join(FIXTURE_COURSE, "build-records/figure", MODULE, `${name}.json`), "utf8")),
  );
const starter = ladder("fan-starter");
const alarm = ladder("tank-alarm");

/** The model's parts and nets rewritten. */
const edited = (
  model: LadderModel,
  parts: (p: LadderModel["parts"]) => LadderModel["parts"],
  nets: (n: LadderModel["nets"]) => LadderModel["nets"] = (n) => n,
): LadderModel => ({ ...model, parts: parts(model.parts), nets: nets(model.nets) });

const failing = (s: { model: LadderModel; layout: typeof starter.layout }, reading?: FigureReading) => {
  const model = schematicOf(s.model);
  return Object.fromEntries(
    checkDrawing(layOut(model, s.layout), model, reading)
      .checks.filter((c) => c.problems.length > 0)
      .map((c) => [c.id, c.problems]),
  );
};

describe("a hard-wired rung", () => {
  it("holds together: right rails, a coil passing its current on through the overload contact", () => {
    expect(ladderProblems(starter.model)).toEqual([]);
  });

  it("energises the coil only while the contacts after it carry the current to the right rail", () => {
    const run = new LadderRun(starter.model);
    const scan = (inputs: Record<string, number>, ms: number) => {
      run.scan({ "I 0.0": 0, "I 0.1": 0, "I 0.2": 0, "I 0.3": 0, ...inputs }, ms);
      return run.watch();
    };
    expect(scan({ "I 0.2": 1 }, 0)).toEqual({ "Q 4.0": 1, "Q 4.1": 1 });
    // Held in through K1 once Start is let go.
    expect(scan({}, 100)).toEqual({ "Q 4.0": 1, "Q 4.1": 1 });
    // The overload F2 trips: the contact after the coil opens, K1 drops out and stays out.
    expect(scan({ "I 0.3": 1 }, 200)).toEqual({ "Q 4.0": 0, "Q 4.1": 0 });
    expect(scan({}, 300)).toEqual({ "Q 4.0": 0, "Q 4.1": 0 });
    // Start held into a tripped overload pulls nothing in.
    expect(scan({ "I 0.2": 1, "I 0.3": 1 }, 400)).toEqual({ "Q 4.0": 0, "Q 4.1": 0 });
    // The current past the coil is inked only while it flows.
    expect(run.last?.levels).toMatchObject({ latch: 1, coil: 0, l2: 0 });
    scan({ "I 0.2": 1 }, 500);
    expect(run.last?.levels).toMatchObject({ latch: 1, coil: 1, l2: 1 });
  });

  it("compiles the contacts after the coil into its condition, as awlsim runs it", () => {
    const stl = compileLadder(starter.model);
    expect(stl).toContain(["\t)", "\tAN I 0.3", "\t= Q 4.0"].join("\n"));
    expect(stl).toContain(["\tA Q 4.0", "\t= Q 4.1"].join("\n"));
  });

  it("refuses a rung that reaches the right rail without a coil, which would short L1 to L2", () => {
    const model = edited(
      starter.model,
      (p) => p,
      (n) => [
        ...n.filter((x) => x.id !== "lamp" && x.id !== "l2b"),
        { id: "short", pins: ["Run.out", "L2b.t"] },
        { id: "lamp", pins: ["H1.in"] },
        { id: "l2b", pins: ["H1.out"] },
      ],
    );
    expect(ladderProblems(model)).toContain(
      "net short reaches the right rail without passing a coil: it would short L1 to L2",
    );
  });

  it("refuses an element past a coil that isn't a contact, and a coil left open in a network with a right rail", () => {
    const model = edited(
      starter.model,
      (p) => p,
      (n) =>
        n.map((x) =>
          x.id === "coil"
            ? { ...x, pins: ["K1.out", "F2.in", "H1.in"] }
            : x.id === "lamp"
              ? { ...x, pins: ["Run.out"] }
              : x.id === "l2b"
                ? { ...x, pins: ["H1.out"] }
                : x,
        ),
    );
    expect(ladderProblems(model)).toEqual(
      expect.arrayContaining([
        "H1.in takes the current after K1: past a coil, a hard-wired rung runs only through contacts to the right rail",
        "H1 (network 2) passes no current on to the right rail: wire its out",
      ]),
    );
  });

  it("draws the right rail, the coil's out lead and the rails' names, and leaves a PLC coil's out off", () => {
    const model = schematicOf(starter.model);
    const d = layOut(model, starter.layout);
    const k1 = d.parts.find((p) => p.id === "K1");
    expect(k1?.open).toBeUndefined();
    expect(strokesOf(k1 ?? { kind: "coil" }).leads).toBe("M14 0H40M-40 0H-14");
    expect(d.parts.find((p) => p.id === "L2")?.label?.text).toBe("L2");
    // A PLC ladder's coil ends its rung: no out pin, no lead, exactly as before.
    const conveyors = ladder("conveyors");
    const plc = layOut(schematicOf(conveyors.model), conveyors.layout).parts.find((p) => p.id === "Conveyor1");
    expect(plc?.open).toEqual(["out"]);
    expect(Object.keys(pinsOf(plc ?? { kind: "coil", x: 0, y: 0, turn: 0, flip: false }))).toEqual(["in"]);
    expect(strokesOf(plc ?? { kind: "coil" }).leads).toBe("M-40 0H-14");
  });

  it("matches the Blind reader's reading, its rails named by label or as POWER_RIGHT.t", () => {
    const reading = readingOf("fan-starter");
    expect(failing(starter, reading)).toEqual({});
    const byLabel = {
      ...reading,
      nets: reading.nets.map((n) => ({ ...n, pins: n.pins.map((p) => (p === RIGHT_RAIL ? "L2.t" : p)) })),
    };
    expect(failing(starter, byLabel)).toEqual({});
  });

  it("blocks a model whose overload contact the figure draws after the coil, but the model before it", () => {
    const before = {
      ...starter,
      model: edited(
        starter.model,
        (p) => p,
        (n) => [
          ...n.filter((x) => !["latch", "coil", "l2"].includes(x.id)),
          { id: "latch", pins: ["Start.out", "Hold.out", "F2.in"] },
          { id: "coil", pins: ["F2.out", "K1.in"] },
          { id: "l2", pins: ["K1.out", "L2.t"] },
        ],
      ),
    };
    expect(failing(before, readingOf("fan-starter")).netlist).toEqual(
      expect.arrayContaining(["N1 coil K1.in and N1 nc F2.out connect in the model but not in the figure"]),
    );
  });
});

describe("FBD boxes with N inputs and negated inputs", () => {
  it("holds together, and refuses a negation on a pin a box doesn't have", () => {
    expect(ladderProblems(alarm.model)).toEqual([]);
    const bad = edited(alarm.model, (p) => p.map((x) => (x.id === "Shut" ? { ...x, negated: ["in3"] } : x)));
    expect(ladderProblems(bad)).toContain("Shut (fbd-and, network 1) can't negate in3: its inputs are in1, in2");
    const contact = edited(starter.model, (p) => p.map((x) => (x.id === "Start" ? { ...x, negated: ["in"] } : x)));
    expect(ladderProblems(contact)).toContain(
      "Start (no, network 1) can't negate in: only an FBD box's inputs carry a negation circle",
    );
  });

  it("compiles each negated input to AN or ON", () => {
    expect(compileLadder(alarm.model)).toContain(
      [
        "\tON I 0.0",
        "\tO(",
        "\tA I 0.1",
        "\tAN I 0.2",
        "\t)",
        "\tO(",
        "\tAN I 0.1",
        "\tA I 0.3",
        "\t)",
        "\t= Q 4.0",
      ].join("\n"),
    );
  });

  it("runs Alarm = ¬Flow + Pump·¬Valve + ¬Pump·Heat over every combination", () => {
    const run = new LadderRun(alarm.model);
    for (let n = 0; n < 16; n++) {
      const [flow, pump, valve, heat] = [n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1];
      run.scan({ "I 0.0": flow, "I 0.1": pump, "I 0.2": valve, "I 0.3": heat }, n * 100);
      const want = !flow || (pump && !valve) || (!pump && heat) ? 1 : 0;
      expect(run.watch()["Q 4.0"], `Flow ${flow}, Pump ${pump}, Valve ${valve}, Heat ${heat}`).toBe(want);
    }
  });

  it("draws each negation as a circle on the box's edge, its lead stopping short of it", () => {
    const d = layOut(schematicOf(alarm.model), alarm.layout);
    const any = d.parts.find((p) => p.id === "Any");
    expect(any?.negated).toEqual(["in1"]);
    expect(strokesOf(any ?? { kind: "fbd-or3" })).toEqual({
      leads: "M-40 -40H-30M-40 0H-20M-40 40H-20M20 0H40",
      circles: [[-25, -40, 5]],
    });
  });

  it("matches the Blind reader's reading, and blocks a negation the model and the figure disagree on", () => {
    const reading = readingOf("tank-alarm");
    expect(failing(alarm, reading)).toEqual({});
    const unnegated = {
      ...alarm,
      model: edited(alarm.model, (p) => p.map((x) => (x.id === "Dry" ? { ...x, negated: ["in2"] } : x))),
    };
    expect(failing(unnegated, reading).netlist).toEqual(["the figure negates N1 fbd-and #2's in1, the model in2"]);
  });

  it("lets a box's inputs swap where the figure reads them in another order, each circle going with its wire", () => {
    const reading = readingOf("tank-alarm");
    // The reader takes the OR's inputs bottom to top: in1 and in3 change places, the circle with them.
    const swap = (p: string) =>
      p === "N1 fbd-or3.in1" ? "N1 fbd-or3.in3" : p === "N1 fbd-or3.in3" ? "N1 fbd-or3.in1" : p;
    const reversed: FigureReading = {
      ...reading,
      parts: {
        ...reading.parts,
        "N1 fbd-or3": { ...(reading.parts["N1 fbd-or3"] as FigureReading["parts"][string]), negated: ["in3"] },
      },
      nets: reading.nets.map((n) => ({ ...n, pins: n.pins.map(swap) })),
    };
    expect(failing(alarm, reversed)).toEqual({});
    // A circle on another wire than the model's is still caught.
    const moved: FigureReading = {
      ...reading,
      parts: {
        ...reading.parts,
        "N1 fbd-or3": { ...(reading.parts["N1 fbd-or3"] as FigureReading["parts"][string]), negated: ["in2"] },
      },
    };
    expect(Object.keys(failing(alarm, moved))).toEqual(["netlist"]);
  });

  it("catches the negation mutant: a circle dropped from a box's input", () => {
    const model = schematicOf(alarm.model);
    const d = layOut(model, alarm.layout);
    const mutant = mutantsOf(d, model.nets).mutants.find((m) => m.id === "negation");
    expect(mutant?.what).toBe("the negation circle on Shut.in2 dropped");
    const failed = checkDrawing(mutant?.drawing ?? d, model, readingOf("tank-alarm")).checks.find(
      (c) => c.id === "parts",
    );
    expect(failed?.problems).toEqual(["Shut is drawn negating none, the model negates in2"]);
  });
});
