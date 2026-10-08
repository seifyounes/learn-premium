// The blind SCL interpreter (the build oracle, ticket #55) on self-written listings, one rule a case,
// each named with the section of "S7-SCL V5.3 for S7-300/400" (A5E00324650-01) it comes from, or with
// the point where the manual is silent and the scan must stop instead of inventing a value.
import { describe, expect, it } from "vitest";
import { runBlind, type BlindScan, type BlindValue } from "../oracle/scl-blind.ts";

const f = Math.fround;
type Inputs = Record<string, number>;

/** An FB "T" with the given declarations and body. */
const fb = (decls: string, body: string) => `FUNCTION_BLOCK T\n${decls}\nBEGIN\n${body}\nEND_FUNCTION_BLOCK\n`;
const run = (source: string, scans: Inputs[] = [{}], block = "T") => runBlind({ source, block, scans });

function values(scan: BlindScan | undefined): Record<string, BlindValue> {
  if (!scan || !("values" in scan)) throw new Error(`scan stopped: ${JSON.stringify(scan)}`);
  return scan.values;
}
/** The value of one output after the first scan. */
function out(source: string, name: string, scans: Inputs[] = [{}]): number {
  const v = values(run(source, scans)[0])[name];
  if (!v) throw new Error(`no value ${name}`);
  return v.value;
}
function stopped(scan: BlindScan | undefined) {
  if (!scan || !("stopped" in scan)) throw new Error(`scan not stopped: ${JSON.stringify(scan)}`);
  return scan.stopped;
}
/** A one-statement FB with a REAL output r, an INT output i, a DINT output d, a BOOL output b and more. */
const OUTS = `VAR_OUTPUT r : REAL; i : INT; d : DINT; b : BOOL; w : WORD; dw : DWORD; bt : BYTE; END_VAR`;
const expr = (body: string, temps = "") => fb(`${OUTS}\n${temps}`, body);

describe("program structure and lexical rules (§5, §6, §9)", () => {
  it("runs a state machine over scans; statics and outputs persist, unnamed inputs keep their value (§6, §8)", () => {
    const SORTER = `
FUNCTION_BLOCK "Sorter"
TITLE = Sorter state machine, it's TITLE text to the end of the line
{ S7_m_c := 'true' }
VERSION : '1.0'
AUTHOR : Seif
// a line comment
VAR_INPUT
  start : BOOL;
  part  : INT;     (* weight in grams *)
  reset : BOOL;
END_VAR
VAR_OUTPUT
  state : INT := 0;
  bin   : INT;
  busy  : BOOL;
END_VAR
VAR
  ticks  : INT;
  sorted : ARRAY[1..3] OF INT;
END_VAR
CONST
  IDLE := 0; WEIGH := 1; MOVE := 2; DONE := 3;
END_CONST
BEGIN
IF #reset THEN #state := IDLE; #busy := FALSE; RETURN; END_IF;
CASE #state OF
  IDLE: IF #start THEN #state := WEIGH; #busy := TRUE; END_IF;
  WEIGH:
    CASE #part OF
      0..99: #bin := 1;
      100..499, 600: #bin := 2;
    ELSE
      #bin := 3;
    END_CASE;
    #ticks := 0; #state := MOVE;
  MOVE:
    #ticks := #ticks + 1;
    IF #ticks >= #bin THEN #state := DONE; END_IF;
  DONE:
    #sorted[#bin] := #sorted[#bin] + 1; #busy := FALSE; #state := IDLE;
ELSE:
  #state := IDLE;
END_CASE;
END_FUNCTION_BLOCK`;
    const scans = [
      { start: 1, part: 250 },
      {},
      {},
      {},
      {},
      { start: 0 },
      { start: 1, part: 700 },
      {},
      {},
      {},
      {},
      {},
      { reset: 1 },
    ];
    const r = run(SORTER, scans, "Sorter").map(values);
    expect(r.map((x) => x["state"]?.value)).toEqual([1, 2, 2, 3, 0, 0, 1, 2, 2, 2, 3, 0, 0]);
    expect(r[0]?.["busy"]).toEqual({ type: "BOOL", value: 1 });
    expect(r[4]?.["sorted[2]"]).toEqual({ type: "INT", value: 1 });
    expect(r[11]?.["sorted[3]"]?.value).toBe(1);
    // Outputs and statics only, in declaration order; not inputs, temps or constants.
    expect(Object.keys(r[0] ?? {})).toEqual(["state", "bin", "busy", "ticks", "sorted[1]", "sorted[2]", "sorted[3]"]);
  });

  it("reads literals in every notation the manual gives (§9 Literals, typed constants)", () => {
    const src = expr(
      `i := 16#7F + 2#1010 + 8#17; dw := DW#16#DEAD_BEEF; w := W#16#F0F0; bt := B#16#FF; d := L#100000;
       r := 1.5E2 + REAL#0.25; b := BOOL#TRUE;`,
    );
    const v = values(run(src)[0]);
    expect(v["i"]?.value).toBe(127 + 10 + 15);
    expect(v["dw"]).toEqual({ type: "DWORD", value: 0xdeadbeef });
    expect(v["w"]?.value).toBe(0xf0f0);
    expect(v["bt"]?.value).toBe(255);
    expect(v["d"]).toEqual({ type: "DINT", value: 100000 });
    expect(v["r"]).toEqual({ type: "REAL", value: 150.25 });
    expect(v["b"]?.value).toBe(1);
    expect(out(expr("i := INT#-5;"), "i")).toBe(-5);
  });

  it("skips // and (* *) comments; (* *) does not nest by default (§4 'Permit nested comments' option)", () => {
    expect(out(expr("i := 1; (* i := 2; *) // i := 3;\n"), "i")).toBe(1);
    expect(() => run(expr("(* outer (* inner *) still comment *) i := 1;"))).toThrow(/line 5/);
  });

  it('takes #local and "Symbol" names, case-insensitively, keeping declared spelling in results (§5 Identifiers)', () => {
    const src = `DATA_BLOCK "Rack" STRUCT Stored : INT; END_STRUCT BEGIN END_DATA_BLOCK
${fb("VAR_OUTPUT FillPct : INT; END_VAR", '#fillpct := 5; "Rack".stored := FILLPCT + 1; Rack.STORED := rack.Stored + 1;')}`;
    expect(values(run(src)[0])).toEqual({
      FillPct: { type: "INT", value: 5 },
      "Rack.Stored": { type: "INT", value: 7 },
    });
  });

  it("throws with the 1-based line on a syntax error, an unknown name or block, an unsupported construct", () => {
    expect(() => run(expr("i := 1;\ni := ;"))).toThrow(/^line 6: /);
    expect(() => run(expr("i := nope;"))).toThrow(/line 5: unknown identifier nope/);
    expect(() => run(expr("i := 1;"), [{}], "Other")).toThrow(/FUNCTION_BLOCK Other/);
    expect(() => run(expr("GOTO m1;"))).toThrow(/GOTO/);
    expect(() => run(fb("VAR s : STRING; END_VAR", ""))).toThrow(/data type STRING|unknown data type STRING/);
  });

  it("throws on an endless loop (more than 1,000,000 statements in a scan)", () => {
    expect(() => run(expr("WHILE TRUE DO END_WHILE;"))).toThrow(/endless loop/);
  });
});

describe("operators and their priority (§11 Operations)", () => {
  it("'**' has priority 2 over unary minus (3): -2**2 = -(2**2) = -4.0", () => {
    expect(Object.is(out(expr("r := -2**2;"), "r"), -4)).toBe(true);
  });
  it("'**' gives a REAL even for integer operands (§11 Arithmetic Expressions): 2**3 = 8.0", () => {
    expect(values(run(expr("r := 2**3;"))[0])["r"]).toEqual({ type: "REAL", value: 8 });
    expect(() => run(expr("i := 2**3;"))).toThrow(/no implicit conversion from REAL to INT/);
  });
  it("operators of equal priority associate left to right: 2**3**2 = 64.0, 20 - 4 - 6 = 10", () => {
    expect(out(expr("r := 2**3**2;"), "r")).toBe(64);
    expect(out(expr("i := 20 - 4 - 6;"), "i")).toBe(10);
  });
  it("* binds tighter than +, comparison tighter than AND, AND than XOR, XOR than OR", () => {
    expect(out(expr("i := 2 + 3 * 4;"), "i")).toBe(14);
    expect(out(expr("b := 1 < 2 AND 3 > 4 OR TRUE XOR TRUE;"), "b")).toBe(0);
    expect(out(expr("b := NOT FALSE AND FALSE;"), "b")).toBe(0);
  });
  it("two arithmetic operators must not follow each other: a * -b is invalid, a * (-b) and a * -1 are fine", () => {
    expect(() => run(expr("i := 3; i := i * -i;"))).toThrow(/must not follow each other/);
    expect(out(expr("i := 3; i := i * (-i);"), "i")).toBe(-9);
    expect(out(expr("i := 3; i := i * -1;"), "i")).toBe(-3);
  });
  it("logical operators work bitwise on WORDs and keep the wider type; = and <> only for bit strings (§11)", () => {
    expect(values(run(expr("w := W#16#FF00 AND 16#0FF0;"))[0])["w"]).toEqual({ type: "WORD", value: 0x0f00 });
    expect(out(expr("dw := W#16#00FF OR DW#16#FF000000;"), "dw")).toBe(0xff0000ff);
    expect(out(expr("w := NOT W#16#00FF;"), "w")).toBe(0xff00);
    expect(out(expr("b := W#16#1 <> W#16#2;"), "b")).toBe(1);
    expect(() => run(expr("b := W#16#1 < W#16#2;"))).toThrow(/only = and <>/);
    expect(() => run(expr("i := W#16#1 + 1;"))).toThrow(/needs INT, DINT or REAL/);
  });
  it("a condition may be arithmetic, TRUE when not 0 (§12 Conditions)", () => {
    expect(out(expr("i := 2; IF i THEN b := TRUE; END_IF;"), "b")).toBe(1);
  });
});

describe("integer arithmetic (§11 Arithmetic Expressions, §7 ranges)", () => {
  it("INT / INT drops the decimals (manual: 10/3 = 3); DIV and MOD alike", () => {
    expect(out(expr("i := 10 / 3;"), "i")).toBe(3);
    expect(out(expr("i := 17 DIV 5; d := 17 MOD 5;"), "d")).toBe(2);
    expect(out(expr("i := -6 / 3;"), "i")).toBe(-2);
    expect(out(expr("i := -6 MOD 3;"), "i")).toBe(0);
  });
  it("STOPS on / DIV MOD with a negative operand and a remainder: the manual gives neither rounding nor MOD's sign", () => {
    for (const body of ["i := -7 / 2;", "i := -7; i := i DIV 2;", "i := 7 MOD -2;"])
      expect(stopped(run(expr(body))[0]).point).toMatch(/negative operand/);
  });
  it("STOPS on integer division by 0 (§8 OK flag: no result value)", () => {
    const s = stopped(run(expr("i := 0;\ni := 5 / i;"))[0]);
    expect(s).toMatchObject({ line: 6, point: "integer / by 0" });
    expect(stopped(run(expr("i := 0; i := 5 MOD i;"))[0]).point).toMatch(/MOD by 0/);
  });
  it("STOPS on INT/DINT overflow in + - * and on -(-32768): OK := FALSE, no value given (§7, §8 OK flag)", () => {
    expect(stopped(run(expr("i := 32767; i := i + 1;"))[0]).point).toMatch(/INT overflow/);
    expect(stopped(run(expr("i := -32768; i := i - 1;"))[0]).point).toMatch(/INT overflow/);
    expect(stopped(run(expr("i := 300; i := i * 300;"))[0]).point).toMatch(/INT overflow/);
    expect(stopped(run(expr("i := -32768; i := -i;"))[0]).point).toMatch(/INT overflow: -\(-32768\)/);
    expect(stopped(run(expr("d := 2147483647; d := d + 1;"))[0]).point).toMatch(/DINT overflow/);
    expect(stopped(run(expr("i := -32768; i := ABS(i);"))[0]).point).toMatch(/ABS/);
  });
  it("an untyped integer constant is INT if it fits, else DINT (§9 Data types of constants)", () => {
    // i * 1000 is INT * INT: it overflows INT though the target is a DINT.
    expect(stopped(run(expr("i := 100; d := i * 1000;"))[0]).point).toMatch(/INT overflow/);
    // 40000 is a DINT constant, so i * 40000 is a DINT operation.
    expect(values(run(expr("i := 100; d := i * 40000;"))[0])["d"]).toEqual({ type: "DINT", value: 4000000 });
    expect(out(expr("i := -32768;"), "i")).toBe(-32768);
  });
  it("mixed INT and DINT gives a DINT, which isn't assigned to an INT implicitly (§11, §14 class A)", () => {
    expect(out(expr("i := 7; d := 100000; d := i + d;"), "d")).toBe(100007);
    expect(() => run(expr("i := 7; d := 1; i := i + d;"))).toThrow(/no implicit conversion from DINT to INT/);
    expect(out(expr("i := 7; r := i + 0.5;"), "r")).toBe(7.5);
  });
  it("two constants fold to a constant typed by its value: 30000 + 30000 is the DINT 60000", () => {
    expect(out(expr("d := 30000 + 30000;"), "d")).toBe(60000);
    expect(() => run(expr("i := 32767 + 1;"))).toThrow(/constant 32768 does not fit INT/);
  });
});

describe("REAL arithmetic (§7 REAL, 32-bit IEEE)", () => {
  it("rounds every operation to float32", () => {
    expect(out(expr("r := 0.1; r := r + 0.2;"), "r")).toBe(f(f(0.1) + f(0.2)));
    expect(out(expr("r := 1.0 / 3.0;"), "r")).toBe(f(1 / 3));
    expect(out(expr("d := 16777217; r := DINT_TO_REAL(d);"), "r")).toBe(16777216);
  });
  it("STOPS when a result leaves the REAL range: overflow, /0, underflow (§7 REAL range)", () => {
    expect(stopped(run(expr("r := 3.0E38; r := r * 10.0;"))[0]).point).toMatch(/overflow/);
    expect(stopped(run(expr("r := 0.0; r := 1.0 / r;"))[0]).point).toBe("REAL division by 0");
    expect(stopped(run(expr("r := EXP(-100.0);"))[0]).point).toMatch(/underflow/);
  });
  it("STOPS on SQRT of a negative, LN(0), ASIN(2): the manual gives no value outside the domain (§14)", () => {
    expect(stopped(run(expr("r := SQRT(-1.0);"))[0]).point).toMatch(/SQRT gives no REAL number/);
    expect(stopped(run(expr("r := LN(0.0);"))[0]).point).toMatch(/LN leaves the REAL range/);
    expect(stopped(run(expr("r := ASIN(2.0);"))[0]).point).toMatch(/ASIN/);
  });
  it("keeps a NaN that a bit-string conversion makes, but STOPS when it is compared or computed with", () => {
    const keep = values(run(expr("r := DWORD_TO_REAL(DW#16#7FC00000);"))[0])["r"];
    expect(Number.isNaN(keep?.value)).toBe(true);
    expect(stopped(run(expr("r := DWORD_TO_REAL(DW#16#7FC00000); b := r = r;"))[0]).point).toMatch(/comparison/);
    expect(stopped(run(expr("r := DWORD_TO_REAL(DW#16#7FC00000); r := r + 1.0;"))[0]).point).toMatch(/REAL \+/);
  });
  it("keeps -0.0, which compares equal to 0.0", () => {
    const v = values(run(expr("r := -0.0; b := r = 0.0;"))[0]);
    expect(Object.is(v["r"]?.value, -0)).toBe(true);
    expect(v["b"]?.value).toBe(1);
  });
  it("'**' of a negative base: an integer exponent has its value, a fractional one STOPS; 0**0 STOPS", () => {
    expect(out(expr("r := -2.0; r := r ** 3;"), "r")).toBe(-8);
    expect(stopped(run(expr("r := -2.0; r := r ** 0.5;"))[0]).point).toMatch(/fractional power/);
    expect(stopped(run(expr("r := 0.0; r := r ** 0;"))[0]).point).toMatch(/0 \*\* 0/);
  });
  it("numeric standard functions take ANY_NUM and give a REAL (§14 Numeric Standard Functions)", () => {
    const v = values(run(expr("r := SQRT(2); i := ABS(-5); d := TRUNC(SIN(1.0) * 1000.0);"))[0]);
    expect(v["r"]?.value).toBe(f(Math.SQRT2));
    expect(v["i"]?.value).toBe(5);
    expect(v["d"]?.value).toBe(Math.trunc(f(f(Math.sin(1)) * 1000)));
    expect(out(expr("r := SQR(3.0) + EXPD(2.0) + LOG(1000.0);"), "r")).toBe(f(f(9 + 100) + 3));
  });
});

describe("conversion functions (§14 Data Type Conversion Functions)", () => {
  it("ROUND and REAL_TO_INT round a tie to the even neighbour (TIA S7-300/400 help, ROUND): 2.5, -2.5, 3.5", () => {
    const src = fb(
      "VAR_INPUT x : REAL; END_VAR VAR_OUTPUT d : DINT; i : INT; END_VAR",
      "d := ROUND(x); i := REAL_TO_INT(x);",
    );
    const r = run(src, [{ x: 2.5 }, { x: -2.5 }, { x: 3.5 }, { x: 2.6 }, { x: -0.5 }]).map(values);
    expect(r.map((v) => v["d"]?.value)).toEqual([2, -2, 4, 3, 0]);
    expect(r.map((v) => v["i"]?.value)).toEqual([2, -2, 4, 3, 0]);
  });
  it("TRUNC keeps the integer part, toward 0: TRUNC(-2.7) = -2 (TIA S7-300/400 help, TRUNC: -1.5 gives -1)", () => {
    expect(out(expr("d := TRUNC(-2.7);"), "d")).toBe(-2);
    expect(out(expr("d := TRUNC(2.7);"), "d")).toBe(2);
  });
  it("STOPS when REAL_TO_INT or DINT_TO_INT is out of range: OK := FALSE, no value (§14 class B)", () => {
    expect(stopped(run(expr("i := REAL_TO_INT(40000.0);"))[0]).point).toMatch(/REAL_TO_INT: 40000/);
    expect(stopped(run(expr("d := 40000; i := DINT_TO_INT(d);"))[0]).point).toMatch(/DINT_TO_INT/);
    expect(stopped(run(expr("d := ROUND(3.0E10);"))[0]).point).toMatch(/ROUND/);
  });
  it("WORD_TO_INT and INT_TO_WORD take over the bit string: 16#FFFF <-> -1", () => {
    expect(out(expr("i := WORD_TO_INT(W#16#FFFF);"), "i")).toBe(-1);
    expect(out(expr("i := -1; w := INT_TO_WORD(i);"), "w")).toBe(0xffff);
    expect(out(expr("i := -32768; w := INT_TO_WORD(i);"), "w")).toBe(0x8000);
    expect(out(expr("dw := DW#16#FFFFFFFE; d := DWORD_TO_DINT(dw);"), "d")).toBe(-2);
    expect(out(expr("d := -2; dw := DINT_TO_DWORD(d);"), "dw")).toBe(0xfffffffe);
  });
  it("narrowing bit-string conversions copy the low bits; widening ones fill with zeros", () => {
    expect(out(expr("bt := WORD_TO_BYTE(W#16#1234);"), "bt")).toBe(0x34);
    expect(out(expr("w := DWORD_TO_WORD(DW#16#12345678);"), "w")).toBe(0x5678);
    expect(out(expr("b := BYTE_TO_BOOL(B#16#03);"), "b")).toBe(1);
    expect(out(expr("w := BYTE_TO_WORD(B#16#AB);"), "w")).toBe(0xab);
    expect(out(expr("dw := REAL_TO_DWORD(1.0);"), "dw")).toBe(0x3f800000);
  });
  it("class A conversions are implicit on assignment; class B ones are not (§14)", () => {
    expect(out(expr("i := 5; r := i;"), "r")).toBe(5);
    expect(out(expr("bt := B#16#7; dw := bt;"), "dw")).toBe(7);
    expect(() => run(expr("r := 1.5; i := r;"))).toThrow(/no implicit conversion from REAL to INT/);
    expect(() => run(expr("w := W#16#1; i := w;"))).toThrow(/no implicit conversion from WORD to INT/);
  });
  it("SHL, SHR, ROL, ROR shift a BYTE/WORD/DWORD by N bits (§14 Bit String Standard Functions)", () => {
    expect(values(run(expr("w := SHL(IN := W#16#00FF, N := 4);"))[0])["w"]).toEqual({ type: "WORD", value: 0x0ff0 });
    expect(out(expr("w := SHR(IN := W#16#8000, N := 15);"), "w")).toBe(1);
    expect(out(expr("bt := ROL(IN := B#16#81, N := 1);"), "bt")).toBe(0x03);
    expect(out(expr("dw := ROR(IN := DW#16#00000001, N := 1);"), "dw")).toBe(0x80000000);
    expect(out(expr("w := SHL(IN := W#16#FFFF, N := 16);"), "w")).toBe(0);
    expect(stopped(run(expr("i := -1; w := SHL(IN := W#16#1, N := i);"))[0]).point).toMatch(/negative N/);
  });
});

describe("control statements (§12)", () => {
  const FOR_SRC = (loop: string) => fb("VAR_OUTPUT i : INT; n : INT; END_VAR", loop);
  it("FOR leaves the control variable at the first value past the end; after EXIT, where it left (§12 FOR, EXIT)", () => {
    expect(values(run(FOR_SRC("FOR i := 1 TO 5 DO n := n + 1; END_FOR;"))[0])).toMatchObject({
      i: { value: 6 },
      n: { value: 5 },
    });
    expect(
      values(run(FOR_SRC("FOR i := 1 TO 5 DO IF i = 3 THEN EXIT; END_IF; n := n + 1; END_FOR;"))[0]),
    ).toMatchObject({
      i: { value: 3 },
      n: { value: 2 },
    });
  });
  it("FOR with a negative BY counts down while the variable is >= the end (§12 FOR)", () => {
    expect(values(run(FOR_SRC("FOR i := 10 TO 1 BY -3 DO n := n * 10 + i; END_FOR;"))[0])).toMatchObject({
      i: { value: -2 },
      n: { value: ((10 * 10 + 7) * 10 + 4) * 10 + 1 },
    });
    expect(out(FOR_SRC("FOR i := 1 TO 0 DO n := 99; END_FOR;"), "n")).toBe(0);
  });
  it("FOR with BY 0 never passes its end: an endless loop unless it EXITs", () => {
    expect(() => run(FOR_SRC("FOR i := 1 TO 5 BY 0 DO n := 1; END_FOR;"))).toThrow(/endless loop/);
    expect(out(FOR_SRC("FOR i := 1 TO 5 BY 0 DO n := n + 1; IF n = 4 THEN EXIT; END_IF; END_FOR;"), "n")).toBe(4);
  });
  it("FOR evaluates end and BY once; CONTINUE goes on to the increment (§12 FOR, CONTINUE)", () => {
    const src = fb(
      "VAR_OUTPUT i : INT; n : INT; e : INT := 3; END_VAR",
      "FOR i := 1 TO e DO e := 10; IF i = 2 THEN CONTINUE; END_IF; n := n + i; END_FOR;",
    );
    expect(values(run(src)[0])).toMatchObject({ i: { value: 4 }, n: { value: 4 } });
  });
  it("STOPS when the body writes the control variable (TIA S7-300/400 help, FOR: result undefined)", () => {
    expect(stopped(run(FOR_SRC("FOR i := 1 TO 5 DO\n  i := i + 1;\nEND_FOR;"))[0])).toMatchObject({
      line: 5,
      point: "the FOR control variable is written inside its loop",
    });
  });
  it("STOPS when the increment overflows: a FOR up to 32767 can't pass its end", () => {
    expect(stopped(run(FOR_SRC("FOR i := 32766 TO 32767 DO n := n + 1; END_FOR;"))[0]).point).toMatch(/overflows INT/);
  });
  it("WHILE tests first, REPEAT runs at least once; EXIT leaves the innermost loop (§12)", () => {
    expect(out(FOR_SRC("WHILE i < 0 DO n := 1; END_WHILE;"), "n")).toBe(0);
    expect(out(FOR_SRC("REPEAT n := n + 1; UNTIL TRUE END_REPEAT;"), "n")).toBe(1);
    expect(
      values(
        run(
          FOR_SRC(
            "WHILE TRUE DO i := i + 1; REPEAT n := n + 1; EXIT; UNTIL FALSE END_REPEAT; IF i = 3 THEN EXIT; END_IF; END_WHILE;",
          ),
        )[0],
      ),
    ).toMatchObject({ i: { value: 3 }, n: { value: 3 } });
  });
  it("CASE takes values, lists, ranges and named constants; ELSE; no match and no ELSE runs nothing (§12 CASE)", () => {
    const src = fb(
      "VAR_INPUT s : INT; END_VAR VAR_OUTPUT n : INT; END_VAR CONST TEN := 10; END_CONST",
      "n := 0; CASE s OF 1: n := 1; 2, 4: n := 24; 5..7: n := 57; TEN: n := 10; -3..-1: n := -1; END_CASE;",
    );
    expect(
      run(src, [{ s: 1 }, { s: 4 }, { s: 6 }, { s: 10 }, { s: -2 }, { s: 99 }]).map((x) => values(x)["n"]?.value),
    ).toEqual([1, 24, 57, 10, -1, 0]);
    expect(out(fb("VAR_OUTPUT n : INT; END_VAR", "CASE 9 OF 1: n := 1; ELSE n := 2; END_CASE;"), "n")).toBe(2);
    expect(() => run(fb("VAR_OUTPUT n : INT; END_VAR", "CASE n OF 1..3: n := 1; 3: n := 2; END_CASE;"))).toThrow(
      /more than once/,
    );
  });
  it("RETURN ends the block; EXIT outside a loop is an error (§12 RETURN, EXIT)", () => {
    expect(out(FOR_SRC("n := 1; RETURN; n := 2;"), "n")).toBe(1);
    expect(() => run(FOR_SRC("EXIT;"))).toThrow(/EXIT outside a loop/);
  });
});

describe("variables, arrays, structures, data blocks (§7, §8)", () => {
  it("STOPS when a VAR_TEMP is read before it is written; temps are fresh in every scan (§8 temporary variables)", () => {
    expect(stopped(run(expr("i := t;", "VAR_TEMP t : INT; END_VAR"))[0])).toMatchObject({
      line: 5,
      point: "VAR_TEMP t is read before it is written",
    });
    const src = fb(
      "VAR_INPUT first : BOOL; END_VAR VAR_OUTPUT i : INT; END_VAR VAR_TEMP t : INT; END_VAR",
      "IF first THEN t := 4; END_IF; i := t;",
    );
    const r = run(src, [{ first: 1 }, { first: 0 }, { first: 1 }]);
    expect(r).toHaveLength(2);
    expect(values(r[0])["i"]?.value).toBe(4);
    expect(stopped(r[1]).point).toMatch(/VAR_TEMP t/);
  });
  it("STOPS on an array index out of range ('Monitor array limits' off: no value, §4)", () => {
    const src = fb("VAR_INPUT k : INT; END_VAR VAR_OUTPUT a : ARRAY[1..3] OF INT; END_VAR", "a[k] := 7;");
    const r = run(src, [{ k: 3 }, { k: 4 }]);
    expect(values(r[0])["a[3]"]?.value).toBe(7);
    expect(stopped(r[1]).point).toBe("index 4 is outside a[1..3]");
  });
  it("names array elements by their declared indices: a[-1], m[1,2], aa[1][2] (§7 ARRAY)", () => {
    const src = fb(
      `VAR a : ARRAY[-1..0] OF INT := 5, 6; m : ARRAY[1..2, 1..3] OF INT := 1, 2(7), 3(0); aa : ARRAY[1..2] OF ARRAY[1..2] OF BOOL; END_VAR`,
      "aa[2][1] := TRUE; m[2] := m[1]; a[0] := m[2,3];",
    );
    const v = values(run(src)[0]);
    expect(Object.keys(v)).toEqual([
      "a[-1]",
      "a[0]",
      "m[1,1]",
      "m[1,2]",
      "m[1,3]",
      "m[2,1]",
      "m[2,2]",
      "m[2,3]",
      "aa[1][1]",
      "aa[1][2]",
      "aa[2][1]",
      "aa[2][2]",
    ]);
    // Initial values fill row by row, the last index fastest; 2(7) repeats (§8 Initialization).
    expect([1, 2, 3].map((j) => v[`m[2,${j}]`]?.value)).toEqual([1, 7, 7]);
    expect(v["a[0]"]?.value).toBe(7);
    expect(v["aa[2][1]"]).toEqual({ type: "BOOL", value: 1 });
  });
  it("STRUCT, UDT and DATA_BLOCK: initial values, BEGIN section once before the first scan, persistent (§6, §7)", () => {
    const src = `
TYPE "Slot"
  STRUCT occupied : BOOL; weight : REAL := 1.5; END_STRUCT
END_TYPE
DATA_BLOCK Rack
  STRUCT
    stored : INT := 2;
    slot : ARRAY[1..2, 1..2] OF "Slot";
  END_STRUCT
BEGIN
  stored := 10;
  slot[1,2].occupied := TRUE;
END_DATA_BLOCK
FUNCTION_BLOCK T
VAR_OUTPUT p : STRUCT x : INT; y : "Slot"; END_STRUCT; END_VAR
BEGIN
  "Rack".stored := "Rack".stored + 1;
  p.y := Rack.slot[1,2];
  p.x := Rack.stored;
END_FUNCTION_BLOCK`;
    const r = run(src, [{}, {}]).map(values);
    expect(r[0]?.["Rack.stored"]?.value).toBe(11);
    expect(r[1]?.["Rack.stored"]?.value).toBe(12);
    expect(r[1]?.["p.x"]?.value).toBe(12);
    expect(r[0]?.["p.y.occupied"]?.value).toBe(1);
    expect(r[0]?.["p.y.weight"]).toEqual({ type: "REAL", value: 1.5 });
    expect(r[0]?.["Rack.slot[1,2].occupied"]?.value).toBe(1);
    expect(r[0]?.["Rack.slot[2,2].weight"]?.value).toBe(1.5);
  });
  it("inputs start at their declared initial value, else 0, and keep the last value given (§8)", () => {
    const src = fb("VAR_INPUT a : INT := 5; x : REAL; END_VAR VAR_OUTPUT s : REAL; END_VAR", "s := a + x;");
    expect(run(src, [{}, { x: 0.5 }, { a: 1 }]).map((x) => values(x)["s"]?.value)).toEqual([5, 5.5, 1.5]);
    expect(() => run(src, [{ a: 1.5 }])).toThrow(/not a valid INT/);
    expect(() => run(src, [{ s: 1 }])).toThrow(/not a VAR_INPUT/);
  });
  it("temporary variables and FC parameters cannot be initialised (§8 Initialization)", () => {
    expect(() => run(fb("VAR_TEMP t : INT := 1; END_VAR", ""))).toThrow(/cannot be initialised/);
  });
});

describe("functions (§12 Calling Functions, Function value)", () => {
  const LIB = `
DATA_BLOCK "Log" STRUCT n : INT; END_STRUCT BEGIN END_DATA_BLOCK
FUNCTION "Bump" : BOOL
VAR_INPUT x : INT; END_VAR
BEGIN
  "Log".n := "Log".n + x;
  "Bump" := TRUE;
END_FUNCTION
FUNCTION "Pure" : BOOL
VAR_INPUT x : INT; END_VAR
BEGIN
  Pure := x > 0;
END_FUNCTION
FUNCTION "Next" : INT
BEGIN
  "Log".n := "Log".n + 1;
  "Next" := "Log".n;
END_FUNCTION
FUNCTION "Split" : VOID
VAR_INPUT v : INT; END_VAR
VAR_OUTPUT hi, lo : INT; END_VAR
VAR_TEMP q : INT; END_VAR
BEGIN
  q := v / 10;
  hi := q; lo := v - q * 10;
END_FUNCTION
`;
  const prog = (body: string, decls = "VAR_OUTPUT b : BOOL; i : INT; h : INT; l : INT; END_VAR") =>
    LIB + fb(decls, body);

  it("returns the function value; named parameters; outputs write the actual variables; a FUNCTION may write a DB", () => {
    const v = values(run(prog('b := "Bump"(x := 3); "Split"(v := 47, hi := h, lo := l); i := "Next"();'))[0]);
    expect(v).toEqual({
      b: { type: "BOOL", value: 1 },
      i: { type: "INT", value: 4 },
      h: { type: "INT", value: 4 },
      l: { type: "INT", value: 7 },
      "Log.n": { type: "INT", value: 4 },
    });
  });
  it("needs every FC parameter, by name (§12 Calling Functions)", () => {
    expect(() => run(prog('"Split"(v := 47, hi := h);'))).toThrow(/parameter lo is missing/);
    expect(() => run(prog('"Split"(47, h, l);'))).toThrow(/by name/);
    expect(out(prog('b := "Pure"(5);'), "b")).toBe(1);
  });
  it("STOPS when an FC returns without assigning its value (§12 Function value)", () => {
    const src = `FUNCTION F : INT\nVAR_INPUT x : INT; END_VAR\nBEGIN\n  IF x > 0 THEN F := x; END_IF;\nEND_FUNCTION\n${expr("i := F(x := 1); i := F(x := 0);")}`;
    expect(stopped(run(src)[0])).toMatchObject({ point: "FUNCTION F returns without assigning its value" });
  });
  it("STOPS when an FC reads its own VAR_TEMP before writing it (§8)", () => {
    const src = `FUNCTION F : INT\nVAR_TEMP t : INT; END_VAR\nBEGIN\n  F := t;\nEND_FUNCTION\n${expr("i := F();")}`;
    expect(stopped(run(src)[0])).toMatchObject({ line: 4, point: "VAR_TEMP t is read before it is written" });
  });
  it("STOPS on AND/OR when the left operand decides and the right one calls a FUNCTION that writes (short-circuit, §11 silent)", () => {
    expect(stopped(run(prog('b := FALSE AND "Bump"(x := 1);'))[0]).point).toMatch(/short-circuit/);
    expect(stopped(run(prog('b := TRUE OR "Bump"(x := 1);'))[0]).point).toMatch(/short-circuit/);
    expect(stopped(run(prog('IF i > 0 AND "Bump"(x := 1) THEN b := TRUE; END_IF;'))[0]).point).toMatch(/short-circuit/);
  });
  it("evaluates AND/OR in full when it doesn't matter: a side-effect-free FC, or a left operand that doesn't decide", () => {
    expect(out(prog('b := FALSE AND "Pure"(x := 1);'), "b")).toBe(0);
    const v = values(run(prog('b := TRUE AND "Bump"(x := 2);'))[0]);
    expect(v["b"]?.value).toBe(1);
    expect(v["Log.n"]?.value).toBe(2);
  });
  it("STOPS when the result depends on the order operands, parameters or assignment sides are evaluated in (§11 silent)", () => {
    expect(stopped(run(prog('i := "Next"() - "Next"();'))[0]).point).toMatch(/evaluation order of the operands of -/);
    expect(stopped(run(prog('i := "Log".n + "Next"();'))[0]).point).toMatch(/evaluation order/);
    // Same value either way: no stop.
    expect(out(prog('i := "Next"() * 0 + 5;'), "i")).toBe(5);
    expect(out(prog('b := "Bump"(x := 1) AND "Bump"(x := 2); i := "Log".n;'), "i")).toBe(3);
  });
});

describe("whole listings", () => {
  it("computes a small network bit-exactly in float32 (REAL after every operation, §7)", () => {
    const NET = `
FUNCTION "Sigmoid" : REAL
VAR_INPUT x : REAL; END_VAR
BEGIN
  "Sigmoid" := 1.0 / (1.0 + EXP(-x));
END_FUNCTION

FUNCTION_BLOCK "Net"
VAR_INPUT in : ARRAY[1..3] OF REAL; END_VAR
VAR_OUTPUT y : REAL; END_VAR
VAR
  w1 : ARRAY[1..2, 1..3] OF REAL := 0.5, -0.25, 0.1, 2(0.3), -0.7;
  b1 : ARRAY[1..2] OF REAL := [2(0.1)];
  w2 : ARRAY[1..2] OF REAL := 1.5, -2.0;
  b2 : REAL := 0.05;
  h  : ARRAY[1..2] OF REAL;
END_VAR
VAR_TEMP i, j : INT; s : REAL; END_VAR
BEGIN
FOR i := 1 TO 2 DO
  s := b1[i];
  FOR j := 1 TO 3 DO s := s + w1[i, j] * in[j]; END_FOR;
  h[i] := "Sigmoid"(x := s);
END_FOR;
s := b2;
FOR i := 2 TO 1 BY -1 DO s := s + w2[i] * h[i]; END_FOR;
y := "Sigmoid"(x := s);
END_FUNCTION_BLOCK`;
    const inputs = [
      [1, 0.5, -1],
      [0.2, 0.9, 3.25],
    ];
    const r = run(
      NET,
      inputs.map((v) => ({ "in[1]": v[0] ?? 0, "in[2]": v[1] ?? 0, "in[3]": v[2] ?? 0 })),
      "Net",
    ).map(values);
    const W1 = [
      [0.5, -0.25, 0.1],
      [0.3, 0.3, -0.7],
    ];
    const W2 = [1.5, -2.0];
    const sig = (x: number) => f(f(1) / f(f(1) + f(Math.exp(f(-x)))));
    inputs.forEach((inp, n) => {
      const h = [0, 1].map((i) => {
        let s = f(0.1);
        for (let j = 0; j < 3; j++) s = f(s + f(f(W1[i]?.[j] ?? 0) * f(inp[j] ?? 0)));
        return sig(s);
      });
      let s = f(0.05);
      for (let i = 1; i >= 0; i--) s = f(s + f(f(W2[i] ?? 0) * (h[i] ?? 0)));
      expect(r[n]?.["y"]?.value).toBe(sig(s));
      expect(r[n]?.["h[1]"]?.value).toBe(h[0]);
    });
    expect(r[0]?.["w1[2,2]"]?.value).toBe(f(0.3));
    expect(r[0]?.["w1[2,3]"]?.value).toBe(f(-0.7));
  });

  it("sorts an array in place through an FC's VAR_IN_OUT (§12 Calling Functions, in/out parameters)", () => {
    const SORT = `
FUNCTION "SortArr" : VOID
VAR_IN_OUT data : ARRAY[1..8] OF INT; END_VAR
VAR_OUTPUT swaps : INT; END_VAR
VAR_TEMP i, t, last : INT; swapped : BOOL; END_VAR
BEGIN
swaps := 0; last := 8;
REPEAT
  swapped := FALSE;
  FOR i := 1 TO last - 1 DO
    IF data[i] > data[i + 1] THEN
      t := data[i]; data[i] := data[i + 1]; data[i + 1] := t;
      swapped := TRUE; swaps := swaps + 1;
    END_IF;
  END_FOR;
  last := last - 1;
UNTIL NOT swapped
END_REPEAT;
END_FUNCTION

FUNCTION_BLOCK "SortTest"
VAR_OUTPUT a : ARRAY[1..8] OF INT := 5, -3, 9, 0, 2(7), -32768, 32767; n : INT; END_VAR
BEGIN
"SortArr"(data := a, swaps := n);
END_FUNCTION_BLOCK`;
    const v = values(run(SORT, [{}], "SortTest")[0]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((i) => v[`a[${i}]`]?.value)).toEqual([-32768, -3, 0, 5, 7, 7, 9, 32767]);
    expect(v["n"]?.value).toBe(11);
  });

  it("types a DATA_BLOCK by a UDT and copies whole structures between DB and FB (§6, §7 UDT)", () => {
    const src = `
TYPE "Pt" STRUCT x : INT := 1; y : INT := 2; END_STRUCT END_TYPE
DATA_BLOCK "Store" "Pt" BEGIN y := 20; END_DATA_BLOCK
${fb('VAR p : "Pt"; END_VAR', 'p := "Store"; "Store".x := p.x + p.y;')}`;
    expect(values(run(src)[0])).toEqual({
      "p.x": { type: "INT", value: 1 },
      "p.y": { type: "INT", value: 20 },
      "Store.x": { type: "INT", value: 21 },
      "Store.y": { type: "INT", value: 20 },
    });
  });
});
