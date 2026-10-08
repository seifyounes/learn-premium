// The SCL manual's ambiguous points (#37: short-circuit AND/OR, REAL_TO_INT ties, -2**2, …), each run
// on both interpreters: the engine and the blind one written from the S7-SCL V5.3 manual. Where the
// manual decides, both follow it. Where it is silent or calls the result undefined, the blind
// interpreter stops rather than invent a value, and the engine does what the CPU's own instruction
// does (the STL engine's, held to awlsim): those points are the Owner's, and a listing that reaches
// one raises a Checkpoint item at build (`gates/scl.ts`).
import { describe, expect, it } from "vitest";
import { runBlind, type BlindScan } from "../oracle/scl-blind.ts";
import { MAX_REAL } from "../src/sims/s7/core.ts";
import { runCase } from "../src/sims/scl/engine.ts";

const OUTPUTS = "VAR_OUTPUT r : REAL; i : INT; d : DINT; b : BOOL; w : WORD; n : INT; END_VAR";
const LOG =
  'DATA_BLOCK "Log" STRUCT n : INT; END_STRUCT BEGIN END_DATA_BLOCK\n' +
  'FUNCTION "Bump" : BOOL\nVAR_INPUT x : INT; END_VAR\nBEGIN "Log".n := "Log".n + x; "Bump" := TRUE; END_FUNCTION\n' +
  'FUNCTION "Next" : INT\nBEGIN "Log".n := "Log".n + 1; "Next" := "Log".n; END_FUNCTION\n';

const listing = (body: string, declarations = OUTPUTS, before = "") =>
  `${before}FUNCTION_BLOCK T\n${declarations}\nBEGIN\n${body}\nEND_FUNCTION_BLOCK\n`;

/** The engine's values after the scans (the last scan's), or why it stopped. */
function engine(source: string, scans: Record<string, number>[] = [{}]): Record<string, number> | { error: string } {
  try {
    const { scans: done } = runCase({ source, block: "T", watch: [] }, scans);
    const last = done.at(-1);
    if (!last) return { error: "no scan" };
    if (last.error) return { error: last.error };
    return Object.fromEntries(Object.entries(last.values).map(([k, v]) => [k, v.value]));
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** The blind interpreter's last scan, or why it couldn't run the listing. */
function blind(source: string, scans: Record<string, number>[] = [{}]): BlindScan | { error: string } {
  try {
    const done = runBlind({ source, block: "T", scans });
    return done.at(-1) ?? { error: "no scan" };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
const blindValues = (source: string, scans?: Record<string, number>[]) => {
  const scan = blind(source, scans);
  if (!("values" in scan)) throw new Error(`the blind interpreter didn't give values: ${JSON.stringify(scan)}`);
  return Object.fromEntries(Object.entries(scan.values).map(([k, v]) => [k, v.value]));
};
const stopped = (source: string, scans?: Record<string, number>[]) => {
  const scan = blind(source, scans);
  return "stopped" in scan ? scan.stopped.point : `not stopped: ${JSON.stringify(scan)}`;
};

describe("where the manual decides, both interpreters follow it", () => {
  it("ROUND and REAL_TO_INT round a tie to the even number (TIA S7-300/400 help, ROUND), TRUNC toward zero", () => {
    const src = listing(
      "d := ROUND(x); i := REAL_TO_INT(x); n := DINT_TO_INT(TRUNC(x));",
      "VAR_INPUT x : REAL; END_VAR VAR_OUTPUT d : DINT; i : INT; n : INT; END_VAR",
    );
    for (const [x, rounded, truncated] of [
      [2.5, 2, 2],
      [-2.5, -2, -2],
      [3.5, 4, 3],
      [-2.7, -3, -2],
    ] as const) {
      expect(engine(src, [{ x }])).toEqual({ d: rounded, i: rounded, n: truncated });
      expect(blindValues(src, [{ x }])).toEqual({ d: rounded, i: rounded, n: truncated });
    }
  });

  it("reads -2 ** 2 as -(2 ** 2), ** gives a REAL, and equal priorities run left to right", () => {
    const src = listing("r := -2 ** 2; w := 16#0; d := 0; r := r + 2 ** 3 ** 2;");
    expect(engine(src)).toMatchObject({ r: 60 });
    expect(blindValues(src)).toMatchObject({ r: 60 });
    for (const run of [engine, blind]) expect(run(listing("i := 2 ** 3;"))).toMatchObject({ error: /REAL/ });
  });

  it("types an untyped constant by its size, and converts DINT to INT only explicitly", () => {
    const src = listing("i := 100; d := i * 40000;");
    expect(engine(src)).toMatchObject({ d: 4000000 });
    expect(blindValues(src)).toMatchObject({ d: 4000000 });
    for (const run of [engine, blind])
      expect(run(listing("i := 7; d := 1; i := i + d;"))).toMatchObject({ error: /DINT.*INT/ });
  });

  it("runs FOR to one step past its end, keeps its variable on EXIT, counts down by a negative BY", () => {
    const sources = [
      listing("FOR i := 1 TO 5 DO n := n + 1; END_FOR;"),
      listing("FOR i := 1 TO 5 DO IF i = 3 THEN EXIT; END_IF; n := n + 1; END_FOR;"),
      listing("FOR i := 5 TO 1 BY -2 DO n := n + 1; END_FOR;"),
    ];
    const expected = [
      { i: 6, n: 5 },
      { i: 3, n: 2 },
      { i: -1, n: 3 },
    ];
    sources.forEach((src, k) => {
      expect(engine(src)).toMatchObject(expected[k] ?? {});
      expect(blindValues(src)).toMatchObject(expected[k] ?? {});
    });
  });

  it("runs nothing for a CASE value no label names when there is no ELSE, and refuses a value in two labels", () => {
    const decl = "VAR_OUTPUT n : INT := 7; END_VAR";
    const src = listing("CASE n OF 1: n := 1; 2..5: n := 2; END_CASE;", decl);
    expect(engine(src)).toEqual({ n: 7 });
    expect(blindValues(src)).toEqual({ n: 7 });
    const twice = listing("CASE n OF 7: n := 1; 5..8: n := 2; END_CASE;", decl);
    for (const run of [engine, blind]) expect(run(twice)).toMatchObject({ error: expect.any(String) });
  });

  it("takes WORD_TO_INT and INT_TO_WORD's bit string over as it is, and rounds DINT to REAL to the nearest float32", () => {
    const src = listing(
      "i := WORD_TO_INT(W#16#FFFF); n := -1; w := INT_TO_WORD(n); d := 16777217; r := DINT_TO_REAL(d);",
    );
    const expected = { i: -1, w: 65535, r: 16777216 };
    expect(engine(src)).toMatchObject(expected);
    expect(blindValues(src)).toMatchObject(expected);
  });

  it("keeps -0.0, which compares equal to 0.0", () => {
    const src = listing("r := -0.0; b := r = 0.0;");
    expect(Object.is((engine(src) as Record<string, number>).r, -0)).toBe(true);
    expect(Object.is(blindValues(src).r, -0)).toBe(true);
    expect(engine(src)).toMatchObject({ b: 1 });
  });

  it("shifts every bit out at a count of the width or more", () => {
    const src = listing("w := SHL(IN := W#16#FFFF, N := 16);");
    expect(engine(src)).toMatchObject({ w: 0 });
    expect(blindValues(src)).toMatchObject({ w: 0 });
  });

  it("stops on an index past its array's end (the manual gives no value without the array-limit check)", () => {
    const src = listing("a[k] := 1;", "VAR_INPUT k : INT; END_VAR VAR_OUTPUT a : ARRAY[1..3] OF INT; END_VAR");
    expect(engine(src, [{ k: 4 }])).toMatchObject({ error: /a\[4\] is outside its bounds 1..3/ });
    expect(stopped(src, [{ k: 4 }])).toMatch(/index 4/);
  });

  it("refuses two arithmetic operators in a row: a * -b is written a * (-b), a * -1 reads", () => {
    for (const run of [engine, blind])
      expect(run(listing("i := 3; i := i * -i;"))).toMatchObject({ error: /operators/ });
    const src = listing("i := 3; n := i * (-i); d := i * -1;");
    expect(engine(src)).toMatchObject({ n: -9, d: -3 });
    expect(blindValues(src)).toMatchObject({ n: -9, d: -3 });
  });

  it("ends a (* comment at the first *): comments don't nest by default", () => {
    for (const run of [engine, blind])
      expect(run(listing("(* a (* b *) c *) i := 1;"))).toMatchObject({ error: expect.any(String) });
  });
});

/**
 * Where the manual is silent or calls the result undefined: the blind interpreter stops, the engine
 * does what the CPU's instruction does. Each is for the Owner to confirm; a listing that reaches one
 * raises a Checkpoint item.
 */
describe("where the manual is silent, the engine does what the CPU does and the blind interpreter stops", () => {
  const cases: {
    point: string;
    source: string;
    scans?: Record<string, number>[];
    engine: Record<string, number>;
    blind: RegExp;
  }[] = [
    {
      point: "AND and OR evaluate both operands (no short-circuit), so a FUNCTION on the right still runs",
      source: listing('b := FALSE AND "Bump"(x := 1); b := TRUE OR "Bump"(x := 1);', OUTPUTS, LOG),
      engine: { "Log.n": 2, b: 1 },
      blind: /short-circuit/,
    },
    {
      point: "operands are worked out left to right",
      source: listing('i := "Next"() - "Next"();', OUTPUTS, LOG),
      engine: { i: -1, "Log.n": 2 },
      blind: /evaluation order/,
    },
    {
      point: "integer / and DIV truncate toward zero, MOD takes the dividend's sign (the CPU's /I and MOD)",
      source: listing("i := -7 / 2; n := -7 MOD 2; d := INT_TO_DINT(-7) / 2;"),
      engine: { i: -3, n: -1, d: -3 },
      blind: /negative operand/,
    },
    {
      point: "an integer divided by 0 gives 0 (the CPU's /I leaves the divisor, 0, and sets OV)",
      source: listing("i := 0; i := 7 / i;"),
      engine: { i: 0 },
      blind: /by 0/,
    },
    {
      point: "INT and DINT wrap past their range (and OK goes FALSE)",
      source: listing("i := 32767; i := i + 1; n := 300; n := n * 300; d := 2147483647; d := d + 1;"),
      engine: { i: -32768, n: 24464, d: -2147483648 },
      blind: /overflow/,
    },
    {
      point: "-(-32768) and ABS(-32768) wrap back to -32768",
      source: listing("i := -32768; i := -i; n := -32768; n := ABS(n);"),
      engine: { i: -32768, n: -32768 },
      blind: /overflow/,
    },
    {
      point: "INT * an INT constant stays INT and wraps, even assigned to a DINT",
      source: listing("i := 100; d := i * 1000;"),
      engine: { d: -31072 },
      blind: /overflow/,
    },
    {
      point: "a REAL result past the largest REAL is stored as the largest REAL (awlsim's choice, accepted on #54)",
      source: listing("r := 3.0E38; r := r * 10.0;"),
      engine: { r: MAX_REAL },
      blind: /overflow/,
    },
    {
      point: "SQRT of a negative gives NaN",
      source: listing("r := SQRT(-1.0);"),
      engine: { r: NaN },
      blind: /NaN/,
    },
    {
      point: "a NaN compares unequal to everything, itself too",
      source: listing("r := DWORD_TO_REAL(DW#16#7FC00000); b := r = r;"),
      engine: { b: 0 },
      blind: /NaN/,
    },
    {
      point: "a FOR whose end is its type's limit wraps and never ends (the scan stops at the step limit)",
      source: listing("FOR i := 32766 TO 32767 DO n := n + 1; END_FOR;"),
      engine: {},
      blind: /overflows/,
    },
    {
      point: "a FOR body may write its control variable; the loop goes on from the value written",
      source: listing("FOR i := 1 TO 5 DO i := i + 1; END_FOR;"),
      engine: { i: 7 },
      blind: /control variable is written/,
    },
    {
      point: "VAR_TEMP starts each scan at 0 (on a CPU, whatever the local stack held)",
      source: listing("i := t;", `${OUTPUTS} VAR_TEMP t : INT; END_VAR`),
      engine: { i: 0 },
      blind: /read before it is written/,
    },
    {
      point: "a FUNCTION that never assigns its value returns 0",
      source: listing(
        "i := F(x := 0);",
        OUTPUTS,
        "FUNCTION F : INT\nVAR_INPUT x : INT; END_VAR\nBEGIN IF x > 0 THEN F := x; END_IF; END_FUNCTION\n",
      ),
      engine: { i: 0 },
      blind: /without assigning/,
    },
    {
      point: "REAL_TO_INT and DINT_TO_INT out of INT's range keep the low word",
      source: listing("i := REAL_TO_INT(40000.0); d := 40000; n := DINT_TO_INT(d);"),
      engine: { i: -25536, n: -25536 },
      blind: /outside the INT range/,
    },
    {
      point: "a shift by a negative count shifts nothing",
      source: listing("i := -1; w := SHL(IN := W#16#1, N := i);"),
      engine: { w: 1 },
      blind: /negative N/,
    },
  ];
  for (const c of cases)
    it(c.point, () => {
      const ours = engine(c.source, c.scans);
      if (Object.keys(c.engine).length === 0) expect(ours).toMatchObject({ error: /without ending/ });
      else expect(ours).toMatchObject(c.engine);
      expect(stopped(c.source, c.scans)).toMatch(c.blind);
    });

  it("adds two constants as INTs, wrapping (the blind interpreter folds them exactly: the Owner's point)", () => {
    const src = listing("d := 30000 + 30000;");
    expect(engine(src)).toMatchObject({ d: -5536 });
    expect(blindValues(src)).toMatchObject({ d: 60000 });
  });
});
