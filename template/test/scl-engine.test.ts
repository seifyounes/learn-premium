// The SCL interpreter at its interface: a listing's FUNCTION_BLOCK called once a scan, its statics
// and DBs kept, every statement traced with what it decided and wrote. Expected values come from the
// S7-SCL V5.3 manual's rules, worked by hand, or (float32 patterns) from the #37 prototype's gate.
import { describe, expect, it } from "vitest";
import { realToBits } from "../src/sims/s7/core.ts";
import { quantities, runCase, SclRun, type SclModel } from "../src/sims/scl/engine.ts";
import { ListingError } from "../src/sims/scl/parse.ts";

/** An FB named T around a body, with its declarations. */
const fb = (declarations: string, body: string, before = ""): SclModel => ({
  source: `${before}\nFUNCTION_BLOCK T\n${declarations}\nBEGIN\n${body}\nEND_FUNCTION_BLOCK\n`,
  block: "T",
  watch: [],
});
const after = (model: SclModel, inputs: Record<string, number> = {}) => {
  const run = new SclRun(model);
  const { error } = run.scan(inputs);
  if (error) throw new Error(error);
  return Object.fromEntries(Object.entries(run.values()).map(([k, v]) => [k, v.value]));
};

describe("a scan calls the FUNCTION_BLOCK once, and its statics and DBs persist", () => {
  const counter = fb(
    "VAR_INPUT step : INT; END_VAR VAR_OUTPUT total : INT; END_VAR VAR calls : INT := 10; END_VAR",
    'calls := calls + 1;\n"Log".last := step;\ntotal := total + step;',
    'DATA_BLOCK "Log"\nVAR last : INT; seen : INT; END_VAR\nBEGIN\nseen := 7;\nEND_DATA_BLOCK',
  );

  it("starts statics at their declared values, runs the DB's BEGIN once, and keeps both from scan to scan", () => {
    const { scans } = runCase(counter, [{ step: 5 }, { step: -2 }]);
    expect(scans.map((s) => s.values.calls?.value)).toEqual([11, 12]);
    expect(scans.map((s) => s.values.total?.value)).toEqual([5, 3]);
    expect(scans[1]?.values["Log.last"]).toEqual({ type: "INT", value: -2 });
    expect(scans[1]?.values["Log.seen"]).toEqual({ type: "INT", value: 7 });
  });

  it("reports its outputs, statics and DB variables by path, not its inputs or temps", () => {
    expect(Object.keys(runCase(counter, [{ step: 1 }]).scans[0]?.values ?? {}).sort()).toEqual([
      "Log.last",
      "Log.seen",
      "calls",
      "total",
    ]);
  });

  it("starts VAR_TEMP at 0 every scan", () => {
    const m = fb("VAR_OUTPUT o : INT; END_VAR VAR_TEMP t : INT; END_VAR", "t := t + 1;\no := t;");
    expect(runCase(m, [{}, {}]).scans.map((s) => s.values.o?.value)).toEqual([1, 1]);
  });

  it("names arrays of structs element by element, a UDT's members by their declared spelling", () => {
    const m = fb(
      'VAR slot : ARRAY[1..2, 0..1] OF "Slot"; END_VAR',
      "slot[2, 1].Full := TRUE;",
      'TYPE "Slot"\nSTRUCT\n  Full : BOOL;\n  id : INT := 3;\nEND_STRUCT\nEND_TYPE',
    );
    const v = after(m);
    expect(v["slot[2,1].Full"]).toBe(1);
    expect(v["slot[1,0].id"]).toBe(3);
    expect(Object.keys(v)).toHaveLength(8);
  });
});

describe("numbers on the S7 core", () => {
  it("wraps an INT past 32767 (the CPU sets OV, the scan goes on)", () => {
    expect(after(fb("VAR i : INT := 32767; END_VAR", "i := i + 1;")).i).toBe(-32768);
  });

  it("types an untyped constant by its size: INT * 1000 is INT and wraps, INT * 100000 is DINT", () => {
    const m = fb("VAR i : INT := 100; d : DINT; END_VAR", "i := i * 1000;\nd := INT_TO_DINT(100) * 100000;");
    expect(after(m)).toMatchObject({ i: -31072, d: 10000000 });
    expect(() => after(fb("VAR i : INT; END_VAR", "i := i * 100000;"))).toThrow(
      /a DINT can't be assigned to an INT without a conversion \(DINT_TO_INT\)/,
    );
  });

  it("rounds every REAL result to float32: one in six as a percentage is 16#41855556", () => {
    const m = fb("VAR p : REAL; n : INT := 1; END_VAR", "p := INT_TO_REAL(n) / 6.0 * 100.0;");
    expect(realToBits(after(m).p ?? 0)).toBe(0x41855556);
  });

  it("divides integers toward zero, the remainder taking the dividend's sign", () => {
    const m = fb("VAR q : INT; r : INT; d : INT; END_VAR", "q := -7 / 2;\nr := -7 MOD 2;\nd := 7 DIV -2;");
    expect(after(m)).toMatchObject({ q: -3, r: -1, d: -3 });
  });

  it("reads -2 ** 2 as -(2 ** 2), and ** gives a REAL", () => {
    expect(after(fb("VAR r : REAL; END_VAR", "r := -2 ** 2;")).r).toBe(-4);
  });

  it("rounds REAL_TO_INT and ROUND to the nearest, a tie to the even neighbour; TRUNC toward zero", () => {
    const m = fb(
      "VAR a : INT; b : INT; c : INT; d : DINT; e : DINT; END_VAR",
      "a := REAL_TO_INT(2.5);\nb := REAL_TO_INT(3.5);\nc := REAL_TO_INT(-2.5);\nd := ROUND(-3.5);\ne := TRUNC(-3.9);",
    );
    expect(after(m)).toMatchObject({ a: 2, b: 4, c: -2, d: -4, e: -3 });
  });

  it("evaluates both operands of AND and OR: no short-circuit in S7-SCL V5.x", () => {
    const m = fb(
      "VAR hit : BOOL; END_VAR",
      "hit := FALSE AND Bump();\nhit := TRUE OR Bump();",
      'DATA_BLOCK "G"\nVAR n : INT; END_VAR\nBEGIN\nEND_DATA_BLOCK\nFUNCTION Bump : BOOL\nBEGIN\n"G".n := "G".n + 1;\nBump := TRUE;\nEND_FUNCTION',
    );
    expect(after(m)["G.n"]).toBe(2);
  });
});

describe("control statements", () => {
  it("runs FOR to its end value inclusive, then holds one step past it", () => {
    const m = fb("VAR i : INT; n : INT; END_VAR", "FOR i := 1 TO 3 DO\n  n := n + i;\nEND_FOR;");
    expect(after(m)).toMatchObject({ i: 4, n: 6 });
  });

  it("leaves only the innermost loop on EXIT", () => {
    const m = fb(
      "VAR i : INT; j : INT; n : INT; END_VAR",
      "FOR i := 1 TO 3 DO\n  FOR j := 1 TO 3 DO\n    IF j = 2 THEN EXIT; END_IF;\n    n := n + 1;\n  END_FOR;\nEND_FOR;",
    );
    expect(after(m)).toMatchObject({ i: 4, j: 2, n: 3 });
  });

  it("picks a CASE arm by value, list or range, else its ELSE, else nothing", () => {
    const m = fb(
      "VAR_INPUT s : INT; END_VAR VAR_OUTPUT o : INT; END_VAR",
      "o := 0;\nCASE s OF\n  1: o := 10;\n  2, 4: o := 20;\n  5..7: o := 30;\nELSE\n  o := 99;\nEND_CASE;",
    );
    const { scans } = runCase(m, [{ s: 1 }, { s: 4 }, { s: 6 }, { s: 3 }]);
    expect(scans.map((s) => s.values.o?.value)).toEqual([10, 20, 30, 99]);
  });

  it("runs WHILE and REPEAT, CONTINUE skipping the rest of the pass", () => {
    const m = fb(
      "VAR i : INT; n : INT; k : INT; END_VAR",
      "WHILE i < 5 DO\n  i := i + 1;\n  IF i = 3 THEN CONTINUE; END_IF;\n  n := n + 1;\nEND_WHILE;\nREPEAT\n  k := k + 2;\nUNTIL k >= 5\nEND_REPEAT;",
    );
    expect(after(m)).toMatchObject({ i: 5, n: 4, k: 6 });
  });

  it("takes an arithmetic expression as a condition, TRUE when it isn't 0 (Codex review)", () => {
    const m = fb("VAR_INPUT k : INT; END_VAR VAR_OUTPUT o : INT; END_VAR", "o := 0;\nIF k THEN o := 1; END_IF;");
    expect(runCase(m, [{ k: 0 }, { k: -3 }]).scans.map((s) => s.values.o?.value)).toEqual([0, 1]);
  });

  it("stops the scan on an index past its array's end, naming the line", () => {
    const m = fb("VAR a : ARRAY[1..3] OF INT; i : INT := 4; END_VAR", "a[1] := 1;\na[i] := 2;");
    const { trace, error } = new SclRun(m).scan({});
    expect(error).toBe("line 6: a[4] is outside its bounds 1..3");
    expect(trace).toHaveLength(2);
  });

  it("stops an endless loop at the step limit", () => {
    const { error } = new SclRun(fb("VAR i : INT; END_VAR", "WHILE TRUE DO\n  i := 1;\nEND_WHILE;")).scan({});
    expect(error).toMatch(/ran 100000 statements without ending/);
  });
});

describe("the trace", () => {
  const m = fb(
    "VAR_INPUT go : BOOL; END_VAR VAR state : INT; END_VAR",
    "IF go THEN // start\n  state := 1;\nELSIF state = 1 THEN\n  state := 2;\nELSE\n  state := 0;\nEND_IF;",
  );

  it("has an entry for each statement and each decision, with what it decided and wrote", () => {
    const run = new SclRun(m);
    const { trace } = run.scan({ go: 1 });
    expect(trace.map((t) => [t.line + 1, t.kind, t.text, t.outcome])).toEqual([
      [5, "if", "IF go THEN", "TRUE"],
      [6, "assign", "state := 1;", undefined],
    ]);
    expect(trace[1]?.writes).toEqual([{ path: "state", type: "INT", before: 0, after: 1 }]);
    const second = run.scan({ go: 0 }).trace;
    expect(second.map((t) => [t.line + 1, t.outcome])).toEqual([
      [5, "FALSE"],
      [7, "TRUE"],
      [8, undefined],
    ]);
  });

  it("marks every line a statement ran on", () => {
    const run = new SclRun(m);
    run.scan({ go: 0 });
    expect([...run.ran].sort((a, b) => a - b).map((l) => l + 1)).toEqual([5, 7, 9, 10]);
  });

  it("shows a FUNCTION's DB writes on the statement that called it", () => {
    const withFc = fb(
      "VAR x : INT; END_VAR",
      "x := Twice(v := 4);",
      'DATA_BLOCK "G"\nVAR n : INT; END_VAR\nBEGIN\nEND_DATA_BLOCK\nFUNCTION Twice : INT\nVAR_INPUT v : INT; END_VAR\nBEGIN\n"G".n := v;\nTwice := v * 2;\nEND_FUNCTION',
    );
    const { trace } = new SclRun(withFc).scan({});
    expect(trace).toHaveLength(1);
    expect(trace[0]?.writes).toEqual([
      { path: "G.n", type: "INT", before: 0, after: 4 },
      { path: "x", type: "INT", before: 0, after: 8 },
    ]);
  });
});

describe("FUNCTION parameters", () => {
  it("binds a VAR_IN_OUT to its actual variable: two naming the same one both write it (Codex review)", () => {
    const m = fb(
      "VAR n : INT; END_VAR",
      "Both(a := n, b := n);",
      "FUNCTION Both : VOID\nVAR_IN_OUT a : INT; b : INT; END_VAR\nBEGIN\na := a + 1;\nb := b + 1;\nEND_FUNCTION",
    );
    expect(after(m).n).toBe(2);
    // Called as a statement, the FUNCTION still counts as run (Codex review).
    expect(runCase(m, [{}]).constructs.has("FUNCTION Both")).toBe(true);
  });

  it("binds a VAR_OUTPUT to its actual variable too: writes land in the order the FUNCTION makes them (Codex review)", () => {
    const m = fb(
      "VAR n : INT; END_VAR",
      "Outs(a := n, b := n);",
      "FUNCTION Outs : VOID\nVAR_OUTPUT a : INT; b : INT; END_VAR\nBEGIN\na := 1;\nb := a + 1;\na := 3;\nEND_FUNCTION",
    );
    expect(after(m).n).toBe(3);
  });
});

describe("what the listing may carry", () => {
  it("skips a block attribute with a quoted value (Codex review)", () => {
    const m = fb("VAR i : INT; END_VAR", "i := 1;");
    const withVersion = { ...m, source: m.source.replace("FUNCTION_BLOCK T\n", "FUNCTION_BLOCK T\nVERSION : '1.0'\n") };
    expect(after(withVersion).i).toBe(1);
  });

  it("marks a REPEAT's own line as run (Codex review)", () => {
    const run = new SclRun(fb("VAR k : INT; END_VAR", "REPEAT\n  k := k + 1;\nUNTIL k >= 2\nEND_REPEAT;"));
    run.scan({});
    expect(run.ran.has(4)).toBe(true);
  });
});

describe("what isn't SCL, or isn't supported", () => {
  it("names the line a listing stops reading on", () => {
    expect(() => new SclRun(fb("VAR i : INT; END_VAR", "i := ;"))).toThrow(ListingError);
    expect(() => new SclRun(fb("VAR i : INT; END_VAR", "i := ;"))).toThrow(/^line 5: unexpected ";"/);
  });

  it("refuses a model whose block isn't a FUNCTION_BLOCK in the listing", () => {
    expect(() => new SclRun({ ...fb("", ""), block: "Missing" })).toThrow(/no FUNCTION_BLOCK "Missing"/);
  });
});

describe("quantities", () => {
  it("gives every variable after one scan from a cold start, inputs too", () => {
    const m = fb("VAR_INPUT a : INT; END_VAR VAR_OUTPUT b : REAL; END_VAR", "b := INT_TO_REAL(a) / 4.0;");
    expect(quantities(m, { a: 3 })).toEqual({ a: 3, b: 0.75 });
  });
});
