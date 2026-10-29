// The state-machine engine family: the expression parser, the token engine, its table, its captions,
// the contract's problems, the four broken engines and the recompute log's comparison. No browser.
import { describe, expect, it } from "vitest";
import { clockCaption, openingCaption } from "../src/sims/state-machine/captions.ts";
import {
  combos,
  fire,
  levelsOf,
  machineOf,
  machineTable,
  outputsOf,
  quantities,
  run,
  stateBits,
  timingRows,
  type Machine,
  type MachineModel,
} from "../src/sims/state-machine/engine.ts";
import { evaluate, ExpressionError, namesIn, parseExpression, termsOf } from "../src/sims/state-machine/expressions.ts";
import { compareTable, stateMachineLog, type StateMachineLog } from "../src/sims/state-machine/log.ts";
import { MUTANTS, runControls } from "../src/sims/state-machine/mutants.ts";
import { machineProblems } from "../src/sims/state-machine/problems.ts";
import { detector, drill } from "./state-machine-models.ts";

const fsm = () => machineOf("fsm", detector);
const grafcet = () => machineOf("grafcet", drill);

describe("the detector's run", () => {
  it("runs the example period by period", () => {
    const periods = run(fsm());
    const x = [0, 1, 1, 0, 1, 0, 1, 0, 0];
    const state = ["S0", "S0", "S1", "S1", "S2", "S3", "S2", "S3", "S2"];
    const bits = ["00", "00", "01", "01", "10", "11", "10", "11", "10"];
    const z = [0, 0, 0, 0, 0, 1, 0, 1, 0];
    const taken = ["S0→S0", "S0→S1", "S1→S1", "S1→S2", "S2→S3", "S3→S2", "S2→S3", "S3→S2", "S2→S0"];
    expect(periods).toHaveLength(9);
    periods.forEach((p, i) => {
      expect(p.k).toBe(i + 1);
      expect(p.inputs).toEqual({ x: x[i] });
      expect(p.active).toEqual([state[i]]);
      const q = stateBits(fsm(), p.active);
      expect(`${q.Q1}${q.Q0}`).toBe(bits[i]);
      expect(p.outputs).toEqual({ z: z[i] });
      expect(p.taken.map((e) => `${fsm().edges[e]?.from}→${fsm().edges[e]?.to}`)).toEqual([
        taken[i]?.replace(/→/g, "→"),
      ]);
    });
  });

  it("gives the 36 bits of the strip, in the rows x, Q1, Q0, z", () => {
    const machine = fsm();
    expect(timingRows(machine).map((r) => r.id)).toEqual(["x", "Q1", "Q0", "z"]);
    const q = quantities("fsm", detector);
    expect(Object.keys(q)).toHaveLength(36);
    expect(q["x[2]"]).toBe(1);
    expect(q["Q1[5]"]).toBe(1);
    expect(q["Q0[5]"]).toBe(0);
    expect(q["z[6]"]).toBe(1);
    expect(q["z[7]"]).toBe(0);
  });
});

describe("the drill's GRAFCET", () => {
  it("runs the example period by period", () => {
    const machine = grafcet();
    const periods = run(machine);
    const active = ["100", "100", "010", "010", "010", "001", "001", "001", "100"];
    const actions = ["00", "00", "10", "10", "10", "01", "01", "01", "00"];
    const fires = [-1, 0, -1, -1, 1, -1, -1, 2, -1];
    periods.forEach((p, i) => {
      const bits = stateBits(machine, p.active);
      expect(`${bits.X0}${bits.X1}${bits.X2}`).toBe(active[i]);
      expect(`${p.outputs.KM1}${p.outputs.KM2}`).toBe(actions[i]);
      expect(p.taken).toEqual(fires[i] === -1 ? [] : [fires[i]]);
    });
    expect(Object.keys(quantities("grafcet", drill))).toHaveLength(72);
    expect(timingRows(machine).map((r) => r.id)).toEqual(["m", "a", "b", "X0", "X1", "X2", "KM1", "KM2"]);
  });

  it("a state both left and entered stays active, and every firable edge fires at once", () => {
    const two: MachineModel = {
      states: [
        { id: "X0", kind: "step-initial", label: "0" },
        { id: "X1", kind: "step-initial", label: "1" },
        { id: "X2", kind: "step", label: "2", out: ["Y"] },
      ],
      edges: [
        { from: "X0", to: "X2", label: "go" },
        { from: "X1", to: "X1", label: "go" },
        { from: "X2", to: "X0", label: "back" },
      ],
      inputs: ["go", "back"],
      outputs: ["Y"],
      stimulus: { go: "11", back: "00" },
    };
    const machine = machineOf("grafcet", two);
    expect(machine.initial).toEqual(["X0", "X1"]);
    // Both edges fire at once; X1 is left and entered, so it stays.
    const { next, taken } = fire(machine, machine.initial, { go: 1, back: 0 });
    expect(taken).toEqual([0, 1]);
    expect(next).toEqual(["X1", "X2"]);
    expect(outputsOf(machine, next)).toEqual({ Y: 1 });
  });
});

describe("the expressions", () => {
  const bits = { Q1: 1, Q0: 0, x: 1, m: 1, a: 0, b: 1 };

  it("parses and evaluates the Materials' notations", () => {
    expect(evaluate(parseExpression("Q0·x' + Q1·Q0'·x"), bits)).toBe(1);
    expect(evaluate(parseExpression("m·a"), bits)).toBe(0);
    expect(evaluate(parseExpression("/m + (a·¬b)"), bits)).toBe(0);
    expect(evaluate(parseExpression("!x'"), bits)).toBe(1);
    expect(evaluate(parseExpression("m.b * 1"), bits)).toBe(1);
    expect(namesIn(parseExpression("Q0·x' + Q1·Q0'·x"))).toEqual(["Q0", "x", "Q1"]);
  });

  it("keeps the printed text of each top-level term", () => {
    expect(termsOf("Q0·x' + Q1·Q0'·x").map((t) => t.text)).toEqual(["Q0·x'", "Q1·Q0'·x"]);
    expect(termsOf("(a + b)·c").map((t) => t.text)).toEqual(["(a + b)·c"]);
    expect(termsOf("x").map((t) => t.text)).toEqual(["x"]);
  });

  it("names what is wrong with an expression it can't read", () => {
    expect(() => parseExpression("m·")).toThrow(new ExpressionError('"m·" ends where a name, 0, 1 or ( should follow'));
    expect(() => parseExpression("m·a)")).toThrow('unexpected ")" at character 4');
    expect(() => parseExpression("m a")).toThrow('"m a" has two names side by side: join them with · or +');
    expect(() => evaluate(parseExpression("q"), bits)).toThrow("q has no value");
  });
});

describe("the whole table", () => {
  it("the detector reaches 4 situations and 8 rows, the drill 3 and 24", () => {
    const detectorRows = machineTable(fsm());
    expect(detectorRows).toHaveLength(8);
    expect(new Set(detectorRows.map((r) => r.from.join())).size).toBe(4);
    const drillRows = machineTable(grafcet());
    expect(drillRows).toHaveLength(24);
    expect(new Set(drillRows.map((r) => r.from.join())).size).toBe(3);
    expect(combos(["m", "a"]).map((c) => `${c.m}${c.a}`)).toEqual(["00", "01", "10", "11"]);
  });

  it("each row sends the situation where the Materials' table does", () => {
    const rows = machineTable(fsm());
    const to = (from: string, x: number) => rows.find((r) => r.from.join() === from && r.inputs.x === x)?.to.join();
    expect(to("S2", 1)).toBe("S3");
    expect(to("S3", 1)).toBe("S1");
    expect(to("S2", 0)).toBe("S0");
    expect(rows.find((r) => r.from.join() === "S3")?.outputs).toEqual({ z: 1 });
  });
});

describe("machineProblems", () => {
  const say = (family: "fsm" | "grafcet", model: MachineModel) => machineProblems(family, model);
  const edit = (model: MachineModel, change: Partial<MachineModel>): MachineModel => ({ ...model, ...change });

  it("passes both", () => {
    expect(say("fsm", detector)).toEqual([]);
    expect(say("grafcet", drill)).toEqual([]);
  });

  it("names a name used twice", () => {
    expect(say("fsm", edit(detector, { outputs: ["x"] }))).toContain("x names both an input and an output");
  });

  it("counts a GRAFCET's step ids among its state variables: an output can't be called X0", () => {
    expect(say("grafcet", edit(drill, { outputs: ["X0", "KM2"] }))).toContain(
      "X0 names both an output and a state variable",
    );
    expect(say("grafcet", edit(drill, { inputs: ["m", "X1", "b"], stimulus: drill.stimulus }))).toContain(
      "X1 names both an input and a state variable",
    );
  });

  it("names two states with the same name", () => {
    const states = detector.states.map((s) => (s.id === "S2" ? { ...s, label: "S1" } : s));
    expect(say("fsm", edit(detector, { states }))).toContain(
      'two states are both named "S1": the figure gives each state its own name',
    );
  });

  it("names a step id that isn't X and its number", () => {
    const states = drill.states.map((s) => (s.id === "X1" ? { ...s, id: "Y1" } : s));
    expect(say("grafcet", edit(drill, { states, edges: [] }))).toContain(
      "step Y1's id isn't X followed by its number (1)",
    );
  });

  it("names a label it can't read", () => {
    const labelled = (label: string) =>
      edit(detector, { edges: detector.edges.map((e, i) => (i === 1 ? { ...e, label } : e)) });
    expect(say("fsm", labelled("10"))).toContain(
      'S0 → S1\'s label "10" has 2 bits, but the machine has 1 input (x): one 0, 1 or - per input',
    );
    expect(say("fsm", labelled("2"))).toContain(
      "S0 → S1's label \"2\" isn't an input pattern: one 0, 1 or - per input, several joined by commas",
    );
    const receptivity = (label: string) =>
      edit(drill, { edges: drill.edges.map((e, i) => (i === 0 ? { ...e, label } : e)) });
    expect(say("grafcet", receptivity("m·"))).toContain(
      'X0 → X1\'s receptivity "m·" can\'t be read: "m·" ends where a name, 0, 1 or ( should follow',
    );
    expect(say("grafcet", receptivity("q"))).toContain("X0 → X1's receptivity names q, which isn't an input");
  });

  it("names a missing initial state, an encoding that doesn't fit, and a GRAFCET with no initial step", () => {
    expect(say("fsm", edit(detector, { initial: "S9" }))).toContain("the initial state S9 isn't a state of the model");
    const codes = (change: Record<string, string>) =>
      edit(detector, {
        encoding: { variables: ["Q1", "Q0"], codes: { ...(detector.encoding?.codes ?? {}), ...change } },
      });
    expect(say("fsm", codes({ S2: "01" }))).toContain("S1 and S2 share the code 01");
    expect(say("fsm", codes({ S2: "1" }))).toContain("S2's code 1 has 1 bit, but the encoding has 2 variables");
    expect(say("fsm", codes({ S9: "11" }))).toContain("the encoding names S9, which the model doesn't have");
    const without = Object.fromEntries(Object.entries(detector.encoding?.codes ?? {}).filter(([id]) => id !== "S2"));
    expect(say("fsm", edit(detector, { encoding: { variables: ["Q1", "Q0"], codes: without } }))).toContain(
      "the encoding gives no code for S2",
    );
    const plain = drill.states.map((s) => (s.kind === "step-initial" ? { ...s, kind: "step" as const } : s));
    expect(say("grafcet", edit(drill, { states: plain }))).toContain(
      "the GRAFCET has no initial step: the figure draws one as a double square (step-initial)",
    );
  });

  it("names outputs nobody sets or states set wrongly", () => {
    const states = detector.states.map((s) => (s.id === "S3" ? { ...s, out: ["z", "y"] } : s));
    expect(say("fsm", edit(detector, { states }))).toContain("S3 sets y, which isn't an output");
    expect(say("fsm", edit(detector, { outputs: ["z", "w"] }))).toContain("output w is set by no state");
  });

  it("names a stimulus that doesn't fit", () => {
    expect(say("grafcet", edit(drill, { stimulus: { m: "01", a: "11" } }))).toContain(
      "the stimulus gives m, a, but the inputs are m, a, b, in that order",
    );
    expect(say("grafcet", edit(drill, { stimulus: { m: "010000000", a: "11100001", b: "000011000" } }))).toContain(
      "the stimulus's inputs run 9, 8 and 9 periods: give every input for every period",
    );
    expect(say("fsm", edit(detector, { stimulus: { x: "1" } }))).toContain("the stimulus runs 1 period: give 2 to 16");
  });

  it("names a state whose input goes nowhere, or two ways", () => {
    const missing = edit(detector, { edges: detector.edges.filter((e) => !(e.from === "S2" && e.to === "S0")) });
    expect(say("fsm", missing)).toContain(
      "S2 has no edge for x = 0: a state machine's every state says where each input takes it",
    );
    const twice = edit(detector, { edges: detector.edges.map((e, i) => (i === 3 ? { ...e, label: "-" } : e)) });
    expect(say("fsm", twice)).toContain('S1 → S1 ("1") and S1 → S2 ("-") both take x = 1: one input takes one edge');
    const branch = edit(drill, { edges: [...drill.edges, { from: "X0", to: "X2", label: "a" }] });
    expect(say("grafcet", branch)).toContain(
      "step 0's receptivities m·a and a can both hold (m = 1, a = 1, b = 0): an alternative branch takes exclusive receptivities",
    );
  });

  it("names an equation that doesn't read, names a stranger, or disagrees with the diagram", () => {
    const eq = (equations: NonNullable<MachineModel["equations"]>) => edit(detector, { equations });
    expect(say("fsm", eq([{ name: "D1", gives: "Q1", expr: "Q0·" }]))[0]).toMatch(/^equation D1 can't be read: /);
    expect(say("fsm", eq([{ name: "D1", gives: "Q1", expr: "q" }]))).toContain(
      "equation D1 names q, which is no input or state variable",
    );
    expect(say("fsm", eq([{ name: "D1", gives: "Q9", expr: "x" }]))).toContain(
      "equation D1 gives Q9, which is no state variable or output",
    );
    expect(
      say(
        "fsm",
        eq([
          { name: "D1", gives: "Q1", expr: "x" },
          { name: "D2", gives: "Q1", expr: "x" },
        ]),
      ),
    ).toContain("the equations give Q1 twice");
    expect(say("fsm", eq([{ name: "D1", gives: "Q1", expr: "Q0·x'" }]))).toContain(
      "D1 = Q0·x' gives 0 with S2 active and x = 1, but the diagram gives Q1 = 1 next",
    );
    expect(say("fsm", eq([{ name: "z", gives: "z", expr: "Q1" }]))).toContain(
      "z = Q1 gives 1 with S2 active and x = 0, but the diagram gives z = 0",
    );
  });
});

describe("captions", () => {
  const strings = (machine: Machine) => {
    const periods = run(machine);
    return [openingCaption(machine), ...periods.map((p) => clockCaption(machine, p, periods.length))];
  };

  it("say the eighteen Fixture strings and both openings", () => {
    expect(strings(fsm())).toEqual([
      "S0 at reset, z = 0. Set x and press Clock.",
      "Clock 1: x = 0 takes S0 to S0.",
      "Clock 2: x = 1 takes S0 to S1.",
      "Clock 3: x = 1 takes S1 to S1.",
      "Clock 4: x = 0 takes S1 to S2.",
      "Clock 5: x = 1 takes S2 to S3; z = 1.",
      "Clock 6: x = 0 takes S3 to S2; z = 0.",
      "Clock 7: x = 1 takes S2 to S3; z = 1.",
      "Clock 8: x = 0 takes S3 to S2; z = 0.",
      "Clock 9: x = 0 takes S2 to S0. The example's 9 clocks are done.",
    ]);
    expect(strings(grafcet())).toEqual([
      "Step 0 active at the start. Set m, a and b and press Clock.",
      "Clock 1: no receptivity holds; step 0 stays active.",
      "Clock 2: m·a holds, so step 0 → step 1 fires; KM1 = 1.",
      "Clock 3: no receptivity holds; step 1 stays active.",
      "Clock 4: no receptivity holds; step 1 stays active.",
      "Clock 5: b holds, so step 1 → step 2 fires; KM1 = 0, KM2 = 1.",
      "Clock 6: no receptivity holds; step 2 stays active.",
      "Clock 7: no receptivity holds; step 2 stays active.",
      "Clock 8: a holds, so step 2 → step 0 fires; KM2 = 0.",
      "Clock 9: no receptivity holds; step 0 stays active. The example's 9 clocks are done.",
    ]);
  });

  it("say two active steps and two inputs in the Materials' words", () => {
    const two: MachineModel = {
      states: [
        { id: "X0", kind: "step-initial", label: "0" },
        { id: "X3", kind: "step-initial", label: "3" },
      ],
      edges: [{ from: "X0", to: "X3", label: "go" }],
      inputs: ["go", "stop"],
      outputs: ["Y"],
      stimulus: { go: "00", stop: "00" },
    };
    const machine = machineOf("grafcet", {
      ...two,
      states: two.states.map((s, i) => (i === 0 ? { ...s, out: ["Y"] } : s)),
    });
    expect(openingCaption(machine)).toBe("Steps 0 and 3 active at the start. Set go and stop and press Clock.");
    expect(clockCaption(machine, run(machine)[0] as never, 9)).toBe(
      "Clock 1: no receptivity holds; steps 0 and 3 stay active.",
    );
  });
});

describe("the broken engines", () => {
  const logOf = (family: "fsm" | "grafcet", model: MachineModel) => {
    const machine = machineOf(family, model);
    return { values: levelsOf(machine, run(machine)), table: machineTable(machine) };
  };

  it("are each reached and caught on both", () => {
    for (const [family, model] of [
      ["fsm", detector],
      ["grafcet", drill],
    ] as const) {
      const controls = runControls(family, model, logOf(family, model));
      expect(controls).toHaveLength(4);
      expect(controls.map((c) => c.outcome)).toEqual(["caught", "caught", "caught", "caught"]);
    }
  });

  it("a broken engine whose own run the recompute repeats is missed (the control's own negative control)", () => {
    const machine = fsm();
    const first = MUTANTS[0]?.semantics;
    const repeated = {
      values: levelsOf(machine, run(machine, first)),
      table: machineTable(machine, first),
    };
    const outcomes = runControls("fsm", detector, repeated);
    expect(outcomes[0]?.outcome).toBe("missed");
  });
});

describe("the recompute log", () => {
  const log = (): StateMachineLog => {
    const machine = fsm();
    return {
      recompute: "learn-premium recompute log v1",
      by: "test",
      inputs: { model: detector, start: { x: 0 } },
      values: levelsOf(machine, run(machine)),
      table: machineTable(machine),
    };
  };

  it("refuses an unknown key", () => {
    expect(stateMachineLog.safeParse(log()).success).toBe(true);
    expect(stateMachineLog.safeParse({ ...log(), extra: 1 }).success).toBe(false);
    expect(stateMachineLog.safeParse({ ...log(), table: [] }).success).toBe(false);
  });

  it("names a contradictory duplicate row, even one a correct row follows", () => {
    const machine = fsm();
    const table = structuredClone(machineTable(machine));
    const first = structuredClone(table[0] as (typeof table)[number]);
    first.to = ["S3"];
    const { mismatches } = compareTable(machine, machineTable(machine), [first, ...table]);
    expect(mismatches).toEqual(["the recompute's table has two rows for S0 active and x = 0"]);
  });

  it("names a wrong target, a wrong output, a missing row and an extra one", () => {
    const machine = fsm();
    const table = structuredClone(machineTable(machine));
    const agree = compareTable(machine, machineTable(machine), table);
    expect(agree).toEqual({ mismatches: [], situations: 4, rows: 8 });

    const row = (from: string, x: 0 | 1) => table.find((r) => r.from.join() === from && r.inputs.x === x);
    (row("S2", 1) as { to: string[] }).to = ["S1"];
    (row("S3", 0) as { outputs: Record<string, number> }).outputs = { z: 0 };
    table.splice(table.indexOf(row("S1", 0) as never), 1);
    table.push({ from: ["S0", "S3"], inputs: { x: 1 }, to: ["S1"], outputs: { z: 0 } });
    const { mismatches } = compareTable(machine, machineTable(machine), table);
    expect(mismatches).toContain("with S2 active and x = 1, the engine goes to S3 and the recompute to S1");
    expect(mismatches).toContain("with S3 active and x = 0, the engine gives z = 1 and the recompute z = 0");
    expect(mismatches).toContain("the recompute's table has no row for S1 active and x = 0");
    expect(mismatches).toContain(
      "the recompute's table has a row for S0 and S3 active and x = 1, which the engine never reaches",
    );
  });
});
