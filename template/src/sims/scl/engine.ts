// The SCL sim's engine: a Professor's S7-SCL listing run on the S7 core, one scan at a time. A scan
// is one call of the listing's FUNCTION_BLOCK: the inputs are copied in, its VAR_TEMP starts at 0,
// its body runs, and its statics and every DATA_BLOCK keep their values for the next scan. Every
// statement leaves a trace entry: the line it ran on, what it decided (an IF's condition, a CASE's
// arm) and every variable it wrote. INT and DINT wrap through the core, every REAL result is
// rounded to float32 by it, and REAL_TO_INT rounds a tie to even, the core's way.
//
// A pure function of the listing and the inputs, the same code in Node for the build gate (which
// holds it to the blind interpreter, `oracle/scl-blind.ts`) and in the page for the student. Where
// the SCL manual leaves a result open, the engine does what the CPU's own instructions do (the STL
// engine's, held to awlsim), and `test/scl-engine.test.ts` names each such point.

import {
  bitsToReal,
  divide,
  fits,
  int16,
  int32,
  realToBits,
  realToDint,
  toReal,
  wrap,
  type Rounding,
  type S7Type,
} from "../s7/core.ts";
import {
  key,
  ListingError,
  parseScl,
  statementsIn,
  type Block,
  type BinaryOp,
  type Declaration,
  type Expr,
  type Init,
  type Reference,
  type SectionKind,
  type Statement,
  type TypeNode,
  type Unit,
} from "./parse.ts";

/** What an SCL sim's model holds: the listing, the FUNCTION_BLOCK a scan calls, and the watch table. */
export interface SclModel {
  /** The listing as the Professor wrote it: TYPE, DATA_BLOCK, FUNCTION and FUNCTION_BLOCK units. */
  source: string;
  /** The FUNCTION_BLOCK each scan calls once. */
  block: string;
  /** The watch table: variables by path (`fill_pct`, `Rack.slot[1,2].occupied`), shown after each statement. */
  watch: readonly string[];
}

/** Input values by VAR_INPUT name, as a student or a gate case sets them (a BOOL as 0 or 1). */
export type Inputs = Readonly<Record<string, number>>;

/** An elementary variable's value: a BOOL 0/1, BYTE/WORD/DWORD unsigned, INT/DINT signed, REAL a float32. */
export interface Leaf {
  type: S7Type;
  value: number;
}

/** One variable a statement wrote, by its path. */
export interface SclWrite {
  path: string;
  type: S7Type;
  before: number;
  after: number;
}

/** One statement as it ran. */
export interface TraceEntry {
  /** Its lines in the listing (0-based). */
  line: number;
  lastLine: number;
  kind: Statement["kind"] | "else" | "next" | "until";
  /** The line as written, without its comment. */
  text: string;
  /** What it decided: an IF's or WHILE's condition, a CASE's arm, whether a FOR goes round again. */
  outcome?: string;
  writes: SclWrite[];
}

/** A listing that runs into something the CPU can't go on from (an index past its array's end). */
export class RunError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line + 1}: ${message}`);
    this.line = line;
  }
}

/**
 * How the interpreter computes: the real rules, or a negative control's broken one
 * (`mutants.ts`), so the gate can prove it sees the defect it plants.
 */
export interface Interpreter {
  /** A REAL result as stored: rounded to float32. */
  real(x: number): number;
  /** An INT (16) or DINT (32) result from its exact value: wrapped. */
  integer(exact: bigint, bits: 16 | 32): number;
  /** REAL_TO_INT and ROUND's rounding of a tie. */
  nearest: Rounding;
  /** EXIT leaves its loop. */
  exits: boolean;
  /** A FOR runs while its variable is at most the end value (at least, counting down). */
  forReachesEnd: boolean;
  /** An FB's statics keep their values from scan to scan. */
  staticsKept: boolean;
  /** `<` and `>` compare strictly. */
  strictCompare: boolean;
}

export const INTERPRETER: Interpreter = {
  real: toReal,
  integer: (exact, bits) => wrap(exact, bits).value,
  nearest: "nearest",
  exits: true,
  forReachesEnd: true,
  staticsKept: true,
  strictCompare: true,
};

// ---- types and values --------------------------------------------------------------------------

type Resolved =
  | { kind: "elementary"; name: S7Type }
  | { kind: "array"; dims: [number, number][]; of: Resolved }
  | { kind: "struct"; fields: { name: string; type: Resolved; init?: Init }[] };

/** A value in an expression: an untyped integer constant is ANYINT until an operation types it. */
interface Value {
  type: S7Type | "ANYINT";
  value: number;
}

const INTEGER_RANK: Partial<Record<S7Type | "ANYINT", number>> = { INT: 1, DINT: 2, REAL: 3 };
const BIT_WIDTH: Partial<Record<S7Type, number>> = { BOOL: 1, BYTE: 8, WORD: 16, DWORD: 32 };
const MASK: Partial<Record<S7Type, number>> = { BOOL: 1, BYTE: 0xff, WORD: 0xffff, DWORD: 0xffffffff };

/** An untyped integer constant takes the smallest type that holds it (the manual: INT, then DINT). */
function typed(v: Value, line: number): Value {
  if (v.type !== "ANYINT") return v;
  if (fits("INT", v.value)) return { type: "INT", value: v.value };
  if (fits("DINT", v.value)) return { type: "DINT", value: v.value };
  throw new ListingError(line, `the constant ${v.value} doesn't fit a DINT`);
}

interface Variable {
  name: string;
  type: Resolved;
  section: SectionKind | "DB" | "RETURN";
}

/** A block's or a DB's variables, and their elementary values by path. */
interface Frame {
  variables: Map<string, Variable>;
  store: Map<string, number>;
  /** How its paths are written outside it: "" for the FB, `Rack.` for a DB. */
  prefix: string;
  constants: Map<string, Value>;
  /** Its writes show in the trace (an FB's and a DB's; a FUNCTION's own are its business). */
  traced: boolean;
}

/** A resolved place: the frame, its path there, and its type. */
interface Place {
  frame: Frame;
  path: string;
  type: Resolved;
}

type Flow = "next" | "exit" | "continue" | "return";

/** A type with its article: "an INT", "a DINT". */
const an = (type: string) => (/^[AEIOU]/.test(type) ? `an ${type}` : `a ${type}`);

const textOf = (line: string | undefined) =>
  (line ?? "")
    .replace(/\/\/.*$/, "")
    .replace(/\(\*.*?\*\)/g, "")
    .trim();

// ---- the run -----------------------------------------------------------------------------------

/** A listing's FUNCTION_BLOCK, called once per scan: its statics and the DBs persist between scans. */
export class SclRun {
  readonly model: SclModel;
  readonly unit: Unit;
  readonly block: Block;
  readonly interpreter: Interpreter;
  /** Each VAR_INPUT, with its type, in declaration order. */
  readonly inputs: Readonly<Record<string, S7Type>>;
  /** Scans run so far. */
  scans = 0;
  /** Every listing line a statement ran on, in any scan (a FUNCTION's statements too). */
  readonly ran = new Set<number>();
  /** Every construct a statement ran (`FOR`, `MOD`, `REAL_TO_INT`, `FUNCTION ToKg`): see `constructsIn`. */
  readonly constructs = new Set<string>();
  /** A scan stops here: a listing that loops longer than this never ends its scan. */
  static readonly STEP_LIMIT = 100_000;

  private readonly fb: Frame;
  private readonly dbs = new Map<string, Frame>();
  private trace: TraceEntry[] | undefined;
  private current: TraceEntry | undefined;
  private steps = 0;
  /** The line of the statement running, for an error an expression raises. */
  private at = 0;

  constructor(model: SclModel, unit: Unit = parseScl(model.source), interpreter: Interpreter = INTERPRETER) {
    this.model = model;
    this.unit = unit;
    this.interpreter = interpreter;
    const block = unit.blocks.find((b) => key(b.name) === key(model.block));
    if (!block) throw new ListingError(0, `the listing has no FUNCTION_BLOCK "${model.block}"`);
    if (block.kind !== "FUNCTION_BLOCK")
      throw new ListingError(block.line, `"${model.block}" is a FUNCTION: a scan calls a FUNCTION_BLOCK`);
    this.block = block;
    for (const db of unit.dataBlocks) {
      const frame = this.frame(`${db.name}.`, new Map());
      for (const d of db.declarations) this.define(frame, d, "DB");
      this.dbs.set(key(db.name), frame);
    }
    // A DB's BEGIN section sets its actual values, once.
    for (const db of unit.dataBlocks) {
      const frame = this.dbs.get(key(db.name)) as Frame;
      this.exec(db.begin, frame);
    }
    this.fb = this.frame("", this.constantsOf(block));
    const inputs: Record<string, S7Type> = {};
    for (const section of block.sections) {
      if (section.kind === "VAR_IN_OUT")
        throw new ListingError(
          section.declarations[0]?.line ?? block.line,
          "the FUNCTION_BLOCK a scan calls has no actual parameter for a VAR_IN_OUT: declare it VAR_INPUT or VAR_OUTPUT",
        );
      for (const d of section.declarations) {
        const v = this.define(this.fb, d, section.kind);
        if (section.kind === "VAR_INPUT") {
          if (v.type.kind !== "elementary")
            throw new ListingError(
              d.line,
              `the input ${d.name} is an ARRAY or STRUCT: a student sets elementary inputs`,
            );
          inputs[d.name] = v.type.name;
        }
      }
    }
    this.inputs = inputs;
  }

  /** Runs one scan with these inputs: every statement's trace, and why it stopped if it did. */
  scan(inputs: Inputs): { trace: TraceEntry[]; error?: string } {
    if (!this.interpreter.staticsKept && this.scans > 0)
      for (const section of this.block.sections)
        if (section.kind === "VAR" || section.kind === "VAR_OUTPUT")
          for (const d of section.declarations)
            this.initialise(this.fb, d.name, this.variable(this.fb, d.name).type, d.init);
    for (const [name, value] of Object.entries(inputs)) {
      const type = this.inputs[name];
      if (type === undefined) throw new Error(`${name} isn't one of the FUNCTION_BLOCK's inputs`);
      if (!fits(type, value)) throw new Error(`${name} can't hold ${value}: it is ${an(type)}`);
      this.fb.store.set(name, type === "REAL" ? toReal(value) : value);
    }
    // VAR_TEMP holds nothing from the last call: the engine starts it at 0 (on a CPU it is whatever
    // the local stack held, which the manual leaves open).
    for (const section of this.block.sections)
      if (section.kind === "VAR_TEMP")
        for (const d of section.declarations)
          this.initialise(this.fb, d.name, this.variable(this.fb, d.name).type, undefined);
    this.scans += 1;
    this.steps = 0;
    const trace: TraceEntry[] = [];
    this.trace = trace;
    try {
      this.exec(this.block.body, this.fb);
      return { trace };
    } catch (error) {
      if (!(error instanceof RunError) && !(error instanceof ListingError)) throw error;
      return { trace, error: error.message };
    } finally {
      this.trace = undefined;
      this.current = undefined;
    }
  }

  /** Every elementary variable after the scan: the FB's outputs and statics, and every DB's. */
  values(): Record<string, Leaf> {
    const out: Record<string, Leaf> = {};
    const add = (frame: Frame, sections: readonly string[]) => {
      for (const v of frame.variables.values())
        if (sections.includes(v.section)) this.leaves(frame, v.name, v.type, out);
    };
    add(this.fb, ["VAR_OUTPUT", "VAR"]);
    for (const frame of this.dbs.values()) add(frame, ["DB"]);
    return out;
  }

  /** What a student can watch: `values()` and the inputs. */
  watchable(): Record<string, Leaf> {
    const out = this.values();
    for (const [name, type] of Object.entries(this.inputs)) out[name] = { type, value: this.fb.store.get(name) ?? 0 };
    return out;
  }

  /** Every line a statement can run on: the FB's and every FUNCTION's statements. */
  statementLines(): Set<number> {
    const lines = new Set<number>();
    for (const b of this.unit.blocks) for (const s of statementsIn(b.body)) lines.add(s.line);
    return lines;
  }

  // ---- declarations ----

  private frame(prefix: string, constants: Map<string, Value>): Frame {
    return { variables: new Map(), store: new Map(), prefix, constants, traced: true };
  }

  private constantsOf(block: Block): Map<string, Value> {
    const constants = new Map<string, Value>();
    const frame: Frame = { variables: new Map(), store: new Map(), prefix: "", constants, traced: false };
    for (const c of block.constants) constants.set(key(c.name), this.ev(c.value, frame));
    return constants;
  }

  private define(frame: Frame, d: Declaration, section: Variable["section"]): Variable {
    if (frame.variables.has(key(d.name))) throw new ListingError(d.line, `${d.name} is declared twice`);
    const type = this.resolve(d.type, frame, d.line);
    const v: Variable = { name: d.name, type, section };
    frame.variables.set(key(d.name), v);
    this.initialise(frame, d.name, type, d.init);
    return v;
  }

  private resolve(t: TypeNode, frame: Frame, line: number, seen: string[] = []): Resolved {
    switch (t.kind) {
      case "elementary":
        return t;
      case "named": {
        const udt = this.unit.types.get(key(t.name));
        if (!udt) throw new ListingError(t.line, `the type "${t.name}" isn't declared (or isn't one SCL has)`);
        if (seen.includes(key(t.name))) throw new ListingError(t.line, `the type "${t.name}" contains itself`);
        return this.resolve(udt, frame, line, [...seen, key(t.name)]);
      }
      case "array":
        return {
          kind: "array",
          dims: t.dims.map(([lo, hi]) => {
            const [a, b] = [this.constant(lo, frame, line), this.constant(hi, frame, line)];
            if (a > b) throw new ListingError(line, `an ARRAY's bounds run low to high, not ${a}..${b}`);
            return [a, b];
          }),
          of: this.resolve(t.of, frame, line, seen),
        };
      case "struct":
        return {
          kind: "struct",
          fields: t.fields.map((f) => ({
            name: f.name,
            type: this.resolve(f.type, frame, f.line, seen),
            ...(f.init ? { init: f.init } : {}),
          })),
        };
    }
  }

  private constant(e: Expr, frame: Frame, line: number): number {
    const v = this.ev(e, frame);
    if (v.type !== "ANYINT" && v.type !== "INT" && v.type !== "DINT")
      throw new ListingError(line, "an ARRAY bound is an integer constant");
    return v.value;
  }

  /** Sets a variable's elementary values from its initial value, its type's, or 0. */
  private initialise(frame: Frame, path: string, type: Resolved, init: Init | undefined): void {
    switch (type.kind) {
      case "elementary": {
        const value = init?.kind === "value" ? this.convert(this.ev(init.value, frame), type.name, 0) : 0;
        frame.store.set(path, value);
        return;
      }
      case "struct":
        for (const f of type.fields) this.initialise(frame, `${path}.${f.name}`, f.type, f.init);
        return;
      case "array": {
        const items = init ? flatten(init) : [];
        elements(type.dims).forEach((index, i) => {
          const item = items[i];
          this.initialise(frame, `${path}[${index.join(",")}]`, type.of, item);
        });
        if (items.length > elements(type.dims).length)
          throw new ListingError(0, `${path}'s initial values outnumber its elements`);
      }
    }
  }

  private leaves(frame: Frame, path: string, type: Resolved, out: Record<string, Leaf>): void {
    switch (type.kind) {
      case "elementary":
        out[frame.prefix + path] = { type: type.name, value: frame.store.get(path) ?? 0 };
        return;
      case "struct":
        for (const f of type.fields) this.leaves(frame, `${path}.${f.name}`, f.type, out);
        return;
      case "array":
        for (const index of elements(type.dims)) this.leaves(frame, `${path}[${index.join(",")}]`, type.of, out);
    }
  }

  private variable(frame: Frame, name: string): Variable {
    return frame.variables.get(key(name)) as Variable;
  }

  // ---- references ----

  private place(ref: Reference, frame: Frame): Place {
    // A quoted name is a block's or a DB's: inside a FUNCTION, its own name is its value.
    const named = frame.variables.get(key(ref.name));
    const local = ref.quoted && named?.section !== "RETURN" ? undefined : named;
    if (local) return this.select({ frame, path: local.name, type: local.type }, ref.selectors, frame, ref);
    const db = this.dbs.get(key(ref.name));
    if (!db) throw new ListingError(ref.line, `"${ref.name}" isn't a variable, a constant or a DB here`);
    const first = ref.selectors[0];
    if (!first || !("member" in first))
      throw new ListingError(ref.line, `a DB is read by its variables: "${ref.name}".name`);
    const v = db.variables.get(key(first.member));
    if (!v) throw new ListingError(ref.line, `the DB "${ref.name}" has no variable ${first.member}`);
    return this.select({ frame: db, path: v.name, type: v.type }, ref.selectors.slice(1), frame, ref);
  }

  private select(start: Place, selectors: Reference["selectors"], scope: Frame, ref: Reference): Place {
    let at = start;
    for (const s of selectors) {
      if ("member" in s) {
        if (at.type.kind !== "struct") throw new ListingError(ref.line, `${at.frame.prefix}${at.path} has no members`);
        const field = at.type.fields.find((f) => key(f.name) === key(s.member));
        if (!field) throw new ListingError(ref.line, `${at.frame.prefix}${at.path} has no member ${s.member}`);
        at = { frame: at.frame, path: `${at.path}.${field.name}`, type: field.type };
      } else {
        if (at.type.kind !== "array") throw new ListingError(ref.line, `${at.frame.prefix}${at.path} isn't an ARRAY`);
        const { dims, of } = at.type;
        if (s.index.length !== dims.length)
          throw new ListingError(ref.line, `${at.frame.prefix}${at.path} takes ${dims.length} indices`);
        const index = s.index.map((e, i) => {
          const v = this.ev(e, scope);
          if (v.type !== "ANYINT" && v.type !== "INT" && v.type !== "DINT")
            throw new ListingError(ref.line, "an ARRAY index is an INT or DINT");
          const [lo, hi] = dims[i] as [number, number];
          if (v.value < lo || v.value > hi)
            throw new RunError(ref.line, `${at.frame.prefix}${at.path}[${v.value}] is outside its bounds ${lo}..${hi}`);
          return v.value;
        });
        at = { frame: at.frame, path: `${at.path}[${index.join(",")}]`, type: of };
      }
    }
    return at;
  }

  private read(ref: Reference, frame: Frame): Value {
    if (!ref.quoted && ref.selectors.length === 0 && !frame.variables.has(key(ref.name))) {
      const c = frame.constants.get(key(ref.name));
      if (c) return c;
    }
    const at = this.place(ref, frame);
    if (at.type.kind !== "elementary")
      throw new ListingError(ref.line, `${at.frame.prefix}${at.path} is an ARRAY or STRUCT: read one of its elements`);
    return { type: at.type.name, value: at.frame.store.get(at.path) ?? 0 };
  }

  private write(at: Place, value: Value, line: number): void {
    if (at.type.kind !== "elementary")
      throw new ListingError(
        line,
        `assigning a whole ARRAY or STRUCT (${at.frame.prefix}${at.path}) isn't supported yet`,
      );
    const after = this.convert(value, at.type.name, line);
    const before = at.frame.store.get(at.path) ?? 0;
    at.frame.store.set(at.path, after);
    if (at.frame.traced && this.current)
      this.current.writes.push({ path: at.frame.prefix + at.path, type: at.type.name, before, after });
  }

  /** A value converted for a variable of `type`: the implicit conversions SCL allows, and no others. */
  private convert(v: Value, type: S7Type, line: number): number {
    if (v.type === type) return v.value;
    if (v.type === "ANYINT") {
      if (type === "REAL") return this.interpreter.real(v.value);
      if (type !== "BOOL" && fits(type, v.value)) return v.value;
      throw new ListingError(line, `the constant ${v.value} doesn't fit ${an(type)}`);
    }
    const widening: Partial<Record<S7Type, S7Type[]>> = {
      INT: ["DINT", "REAL"],
      DINT: ["REAL"],
      BOOL: ["BYTE", "WORD", "DWORD"],
      BYTE: ["WORD", "DWORD"],
      WORD: ["DWORD"],
    };
    if (widening[v.type]?.includes(type)) return type === "REAL" ? this.interpreter.real(v.value) : v.value;
    throw new ListingError(
      line,
      `${an(v.type)} can't be assigned to ${an(type)} without a conversion (${v.type}_TO_${type})`,
    );
  }

  // ---- statements ----

  /** The line an expression sits on, for an error: its own, or the statement's. */
  private lineOf(e: Expr): number {
    return lineIn(e) ?? this.at;
  }

  private entry(s: { line: number; lastLine: number }, kind: TraceEntry["kind"], outcome?: string): TraceEntry {
    this.ran.add(s.line);
    this.at = s.line;
    if (++this.steps > SclRun.STEP_LIMIT)
      throw new RunError(s.line, `the scan ran ${SclRun.STEP_LIMIT} statements without ending`);
    const e: TraceEntry = {
      line: s.line,
      lastLine: s.lastLine,
      kind,
      text: textOf(this.unit.lines[s.line]),
      ...(outcome === undefined ? {} : { outcome }),
      writes: [],
    };
    if (this.trace) {
      this.trace.push(e);
      this.current = e;
    }
    return e;
  }

  private exec(list: readonly Statement[], frame: Frame): Flow {
    for (const s of list) {
      const flow = this.statement(s, frame);
      if (flow !== "next") return flow;
    }
    return "next";
  }

  private statement(s: Statement, frame: Frame): Flow {
    this.constructs.add(STATEMENT_CONSTRUCT[s.kind]);
    switch (s.kind) {
      case "assign": {
        this.entry(s, "assign");
        const value = this.ev(s.value, frame);
        this.write(this.place(s.target, frame), value, s.line);
        return "next";
      }
      case "call": {
        this.entry(s, "call");
        this.call(s.call, frame, true);
        return "next";
      }
      case "if": {
        for (const arm of s.arms) {
          const e = this.entry(arm, "if");
          const c = this.bool(this.ev(arm.condition, frame), arm.line);
          e.outcome = c ? "TRUE" : "FALSE";
          if (c) return this.exec(arm.body, frame);
        }
        if (s.otherwise) {
          this.entry(s.otherwise, "else");
          return this.exec(s.otherwise.body, frame);
        }
        return "next";
      }
      case "case": {
        const e = this.entry({ line: s.line, lastLine: s.line }, "case");
        const sel = typed(this.ev(s.selector, frame), s.line);
        if (sel.type !== "INT" && sel.type !== "DINT")
          throw new ListingError(s.line, "a CASE selector is an INT or DINT");
        const matching = s.arms.filter((a) =>
          a.labels.some((l) => sel.value >= this.ev(l.from, frame).value && sel.value <= this.ev(l.to, frame).value),
        );
        // Each value labels one arm at most (the manual, CASE Statement).
        if (matching.length > 1) throw new ListingError(s.line, `the CASE value ${sel.value} labels two arms`);
        const arm = matching[0];
        e.outcome = arm
          ? `${sel.value}: line ${arm.line + 1}`
          : s.otherwise
            ? `${sel.value}: ELSE`
            : `${sel.value}: no arm`;
        if (arm) return this.exec(arm.body, frame);
        if (s.otherwise) return this.exec(s.otherwise.body, frame);
        return "next";
      }
      case "for": {
        const at = this.place(s.variable, frame);
        if (at.type.kind !== "elementary" || (at.type.name !== "INT" && at.type.name !== "DINT"))
          throw new ListingError(s.line, "a FOR's control variable is an INT or DINT");
        const bits = at.type.name === "INT" ? 16 : 32;
        const first = this.entry({ line: s.line, lastLine: s.line }, "for");
        const from = this.ev(s.from, frame);
        // The end value and the increment are worked out once, as the loop starts.
        const to = this.convert(this.ev(s.to, frame), at.type.name, s.line);
        const by = s.by ? this.convert(this.ev(s.by, frame), at.type.name, s.line) : 1;
        this.write(at, from, s.line);
        const goesOn = () => {
          const v = at.frame.store.get(at.path) ?? 0;
          if (this.interpreter.forReachesEnd) return by >= 0 ? v <= to : v >= to;
          return by >= 0 ? v < to : v > to;
        };
        let more = goesOn();
        first.outcome = more ? "into the loop" : "skipped";
        while (more) {
          const flow = this.exec(s.body, frame);
          if (flow === "return") return flow;
          if (flow === "exit") break;
          const next = this.entry({ line: s.lastLine, lastLine: s.lastLine }, "next");
          const v = at.frame.store.get(at.path) ?? 0;
          this.write(
            at,
            { type: at.type.name, value: this.interpreter.integer(BigInt(v) + BigInt(by), bits) },
            s.lastLine,
          );
          more = goesOn();
          next.outcome = more ? "again" : "done";
        }
        return "next";
      }
      case "while": {
        for (;;) {
          const e = this.entry({ line: s.line, lastLine: s.line }, "while");
          const c = this.bool(this.ev(s.condition, frame), s.line);
          e.outcome = c ? "TRUE" : "FALSE";
          if (!c) return "next";
          const flow = this.exec(s.body, frame);
          if (flow === "return") return flow;
          if (flow === "exit") return "next";
        }
      }
      case "repeat": {
        for (;;) {
          const flow = this.exec(s.body, frame);
          if (flow === "return") return flow;
          if (flow === "exit") return "next";
          const e = this.entry({ line: s.untilLine, lastLine: s.untilLine }, "until");
          const c = this.bool(this.ev(s.condition, frame), s.untilLine);
          e.outcome = c ? "TRUE" : "FALSE";
          if (c) return "next";
        }
      }
      case "exit":
        this.entry(s, "exit");
        return this.interpreter.exits ? "exit" : "next";
      case "continue":
        this.entry(s, "continue");
        return "continue";
      case "return":
        this.entry(s, "return");
        return "return";
    }
  }

  private bool(v: Value, line: number): boolean {
    if (v.type !== "BOOL") throw new ListingError(line, `a condition is a BOOL, not ${an(v.type)}`);
    return v.value === 1;
  }

  // ---- expressions ----

  private ev(e: Expr, frame: Frame): Value {
    const construct = expressionConstruct(e);
    if (construct) this.constructs.add(construct);
    switch (e.kind) {
      case "literal":
        return { type: e.type, value: e.type === "REAL" ? this.interpreter.real(e.value) : e.value };
      case "ref":
        return this.read(e.ref, frame);
      case "unary":
        return this.unary(e.op, this.ev(e.operand, frame), this.lineOf(e));
      case "binary":
        return this.binary(e.op, this.ev(e.lhs, frame), this.ev(e.rhs, frame), this.lineOf(e));
      case "call":
        return this.call(e, frame, false);
    }
  }

  private unary(op: "-" | "+" | "NOT", v: Value, line: number): Value {
    if (op === "+") return v;
    if (op === "NOT") {
      if (v.type === "BOOL") return { type: "BOOL", value: v.value ? 0 : 1 };
      const mask = MASK[v.type as S7Type];
      if (mask === undefined || v.type === "ANYINT")
        throw new ListingError(line, `NOT takes a BOOL or a bit string, not ${an(v.type)}`);
      return { type: v.type, value: (~v.value & mask) >>> 0 };
    }
    if (v.type === "ANYINT") return { type: "ANYINT", value: -v.value + 0 };
    if (v.type === "REAL") return { type: "REAL", value: this.interpreter.real(-v.value) };
    if (v.type === "INT" || v.type === "DINT")
      return { type: v.type, value: this.interpreter.integer(-BigInt(v.value), v.type === "INT" ? 16 : 32) };
    throw new ListingError(line, `${an(v.type)} has no sign`);
  }

  private asReal(v: Value): number {
    return this.interpreter.real(v.value);
  }

  private binary(op: BinaryOp, a: Value, b: Value, line: number): Value {
    switch (op) {
      case "AND":
      case "OR":
      case "XOR":
        return this.logic(op, a, b, line);
      case "<":
      case ">":
      case "<=":
      case ">=":
      case "=":
      case "<>":
        return { type: "BOOL", value: this.compare(op, a, b, line) ? 1 : 0 };
      default:
        return this.arithmetic(op, a, b, line);
    }
  }

  private logic(op: "AND" | "OR" | "XOR", a: Value, b: Value, line: number): Value {
    // Both operands are worked out: S7-SCL V5.x has no short-circuit evaluation.
    const f = (x: number, y: number) => (op === "AND" ? x & y : op === "OR" ? x | y : x ^ y);
    if (a.type === "BOOL" && b.type === "BOOL") return { type: "BOOL", value: f(a.value, b.value) };
    const width = (v: Value) => (v.type === "ANYINT" ? 0 : (BIT_WIDTH[v.type] ?? -1));
    if (a.type === "BOOL" || b.type === "BOOL" || width(a) < 0 || width(b) < 0 || (width(a) === 0 && width(b) === 0))
      throw new ListingError(line, `${op} takes two BOOLs or two bit strings, not ${an(a.type)} and ${an(b.type)}`);
    const type = (width(a) >= width(b) ? a.type : b.type) as S7Type;
    return { type, value: (f(a.value, b.value) & (MASK[type] ?? 0)) >>> 0 };
  }

  private compare(op: "<" | ">" | "<=" | ">=" | "=" | "<>", a: Value, b: Value, line: number): boolean {
    let x: number;
    let y: number;
    const numeric = (v: Value) => v.type === "ANYINT" || INTEGER_RANK[v.type] !== undefined;
    const bits = (v: Value) => v.type === "ANYINT" || BIT_WIDTH[v.type] !== undefined;
    if (numeric(a) && numeric(b)) {
      const real = a.type === "REAL" || b.type === "REAL";
      x = real ? this.asReal(a) : a.value;
      y = real ? this.asReal(b) : b.value;
    } else if (bits(a) && bits(b) && (op === "=" || op === "<>" || (a.type !== "BOOL" && b.type !== "BOOL"))) {
      if ((a.type === "BOOL") !== (b.type === "BOOL"))
        throw new ListingError(line, `a BOOL compares with a BOOL, not ${an(a.type === "BOOL" ? b.type : a.type)}`);
      x = a.value >>> 0;
      y = b.value >>> 0;
    } else throw new ListingError(line, `${op} can't compare ${an(a.type)} with ${an(b.type)}`);
    const strict = this.interpreter.strictCompare;
    switch (op) {
      case "<":
        return strict ? x < y : x <= y;
      case ">":
        return strict ? x > y : x >= y;
      case "<=":
        return x <= y;
      case ">=":
        return x >= y;
      case "=":
        return x === y;
      case "<>":
        return x !== y;
    }
  }

  private arithmetic(
    op: Exclude<BinaryOp, "AND" | "OR" | "XOR" | "<" | ">" | "<=" | ">=" | "=" | "<>">,
    a: Value,
    b: Value,
    line: number,
  ): Value {
    const numeric = (v: Value) => v.type === "ANYINT" || INTEGER_RANK[v.type] !== undefined;
    if (!numeric(a) || !numeric(b))
      throw new ListingError(line, `${op} works on INT, DINT and REAL, not ${an(numeric(a) ? b.type : a.type)}`);
    if (op === "**") return { type: "REAL", value: this.interpreter.real(Math.pow(this.asReal(a), this.asReal(b))) };
    const [x, y] = [typed(a, line), typed(b, line)];
    const type = (INTEGER_RANK[x.type] ?? 0) >= (INTEGER_RANK[y.type] ?? 0) ? x.type : y.type;
    if (type === "REAL") {
      if (op === "MOD" || op === "DIV") throw new ListingError(line, `${op} works on INT and DINT, not REAL`);
      const [p, q] = [this.asReal(x), this.asReal(y)];
      const exact = op === "+" ? p + q : op === "-" ? p - q : op === "*" ? p * q : p / q;
      return { type: "REAL", value: this.interpreter.real(exact) };
    }
    const bits = type === "INT" ? 16 : 32;
    const [p, q] = [BigInt(x.value), BigInt(y.value)];
    switch (op) {
      case "+":
        return { type, value: this.interpreter.integer(p + q, bits) };
      case "-":
        return { type, value: this.interpreter.integer(p - q, bits) };
      case "*":
        return { type, value: this.interpreter.integer(p * q, bits) };
      default: {
        // Divided by 0, the CPU's /I and MOD leave the divisor, 0, where the result goes (and OV set).
        const d = divide(x.value, y.value, bits);
        if (d.byZero) return { type, value: 0 };
        if (op === "MOD") return { type, value: d.remainder };
        return { type, value: this.interpreter.integer(BigInt(x.value) / BigInt(y.value), bits) };
      }
    }
  }

  // ---- calls ----

  private call(e: Extract<Expr, { kind: "call" }>, frame: Frame, statement: boolean): Value {
    const standard = STANDARD[e.name.toUpperCase()];
    if (standard) {
      if (statement) throw new ListingError(e.line, `${e.name} returns a value: assign it`);
      const args = e.args.map((a) => this.ev(a.value, frame));
      return standard(args, e.line, this.interpreter);
    }
    const fc = this.unit.blocks.find((b) => key(b.name) === key(e.name));
    if (!fc) throw new ListingError(e.line, `"${e.name}" isn't a function SCL has or a FUNCTION in the listing`);
    if (fc.kind !== "FUNCTION")
      throw new ListingError(e.line, `calling a FUNCTION_BLOCK (${fc.name}) from the scan's FB isn't supported yet`);
    if (!statement && !fc.returns)
      throw new ListingError(e.line, `${fc.name} returns nothing (VOID): call it as a statement`);
    const local: Frame = {
      variables: new Map(),
      store: new Map(),
      prefix: "",
      constants: this.constantsOf(fc),
      traced: false,
    };
    const params: { d: Declaration; section: SectionKind }[] = [];
    for (const section of fc.sections)
      for (const d of section.declarations) {
        this.define(local, d, section.kind);
        if (section.kind !== "VAR_TEMP" && section.kind !== "VAR") params.push({ d, section: section.kind });
      }
    if (fc.returns) this.define(local, { name: fc.name, type: fc.returns, line: fc.line }, "RETURN");
    const outs: { param: Place; actual: Place }[] = [];
    const given = new Set<string>();
    e.args.forEach((a, i) => {
      const p = a.name === undefined ? params[i] : params.find((x) => key(x.d.name) === key(a.name ?? ""));
      if (!p) throw new ListingError(e.line, `${fc.name} has no parameter ${a.name ?? `number ${i + 1}`}`);
      given.add(key(p.d.name));
      const param: Place = { frame: local, path: p.d.name, type: this.variable(local, p.d.name).type };
      if (p.section === "VAR_INPUT") {
        if (param.type.kind !== "elementary") throw new ListingError(e.line, `${p.d.name} takes an elementary value`);
        local.store.set(p.d.name, this.convert(this.ev(a.value, frame), param.type.name, e.line));
        return;
      }
      if (a.value.kind !== "ref") throw new ListingError(e.line, `${p.d.name} is an output: give it a variable`);
      const actual = this.place(a.value.ref, frame);
      if (p.section === "VAR_IN_OUT") {
        if (param.type.kind !== "elementary" || actual.type.kind !== "elementary")
          throw new ListingError(e.line, `${p.d.name} takes an elementary variable`);
        local.store.set(
          p.d.name,
          this.convert(
            { type: actual.type.name, value: actual.frame.store.get(actual.path) ?? 0 },
            param.type.name,
            e.line,
          ),
        );
      }
      outs.push({ param, actual });
    });
    for (const p of params)
      if (!given.has(key(p.d.name)))
        throw new ListingError(e.line, `${fc.name} is called without its parameter ${p.d.name}`);
    const saved = this.trace;
    this.trace = undefined;
    try {
      this.execQuiet(fc.body, local);
    } finally {
      this.trace = saved;
    }
    for (const { param, actual } of outs) {
      if (param.type.kind !== "elementary") continue;
      this.write(actual, { type: param.type.name, value: local.store.get(param.path) ?? 0 }, e.line);
    }
    if (!fc.returns) return { type: "BOOL", value: 0 };
    const ret = this.variable(local, fc.name).type;
    if (ret.kind !== "elementary")
      throw new ListingError(fc.line, `${fc.name} returns an ARRAY or STRUCT, which isn't supported yet`);
    return { type: ret.name, value: local.store.get(fc.name) ?? 0 };
  }

  /** A FUNCTION's body runs inside its caller's statement: it marks the lines it ran, and isn't traced itself. */
  private execQuiet(list: readonly Statement[], frame: Frame): void {
    const current = this.current;
    try {
      this.exec(list, frame);
    } finally {
      this.current = current;
    }
  }
}

// ---- constructs: what a gate case must run ------------------------------------------------------

/**
 * A construct is what must run in some gate case before the listing counts as checked: each kind of
 * statement, operator and function the listing uses (the `*I` lesson of #37: an instruction no case
 * runs is never compared).
 */
const STATEMENT_CONSTRUCT: Record<Statement["kind"], string> = {
  assign: ":=",
  call: "a call",
  if: "IF",
  case: "CASE",
  for: "FOR",
  while: "WHILE",
  repeat: "REPEAT",
  exit: "EXIT",
  continue: "CONTINUE",
  return: "RETURN",
};

function expressionConstruct(e: Expr): string | undefined {
  switch (e.kind) {
    case "binary":
      return e.op;
    case "unary":
      return e.op === "+" ? undefined : e.op === "-" ? "unary -" : e.op;
    case "call":
      return STANDARD[e.name.toUpperCase()] ? e.name.toUpperCase() : `FUNCTION ${e.name}`;
    default:
      return undefined;
  }
}

/** Every construct the listing's blocks use, with the line (0-based) each is first used on. */
export function constructsIn(unit: Unit): Map<string, number> {
  const found = new Map<string, number>();
  const add = (construct: string | undefined, line: number) => {
    if (construct && !found.has(construct)) found.set(construct, line);
  };
  const expression = (e: Expr | undefined, line: number): void => {
    if (!e) return;
    add(expressionConstruct(e), line);
    switch (e.kind) {
      case "unary":
        expression(e.operand, line);
        break;
      case "binary":
        expression(e.lhs, line);
        expression(e.rhs, line);
        break;
      case "call":
        for (const a of e.args) expression(a.value, line);
        break;
      case "ref":
        for (const s of e.ref.selectors) if ("index" in s) for (const i of s.index) expression(i, line);
        break;
    }
  };
  const reference = (r: Reference, line: number) => expression({ kind: "ref", ref: r }, line);
  for (const block of unit.blocks)
    for (const s of statementsIn(block.body)) {
      add(STATEMENT_CONSTRUCT[s.kind], s.line);
      switch (s.kind) {
        case "assign":
          reference(s.target, s.line);
          expression(s.value, s.line);
          break;
        case "call":
          expression(s.call, s.line);
          break;
        case "if":
          for (const arm of s.arms) expression(arm.condition, arm.line);
          break;
        case "case":
          expression(s.selector, s.line);
          break;
        case "for":
          reference(s.variable, s.line);
          expression(s.from, s.line);
          expression(s.to, s.line);
          expression(s.by, s.line);
          break;
        case "while":
          expression(s.condition, s.line);
          break;
        case "repeat":
          expression(s.condition, s.untilLine);
          break;
      }
    }
  return found;
}

/** The line an expression starts on, if it names one (a constant alone doesn't). */
const lineIn = (e: Expr): number | undefined => {
  switch (e.kind) {
    case "ref":
      return e.ref.line;
    case "call":
      return e.line;
    case "unary":
      return lineIn(e.operand);
    case "binary":
      return lineIn(e.lhs) ?? lineIn(e.rhs);
    case "literal":
      return undefined;
  }
};

function flatten(init: Init): (Init | undefined)[] {
  switch (init.kind) {
    case "value":
      return [init];
    case "list":
      return init.items.flatMap(flatten);
    case "repeat":
      return Array.from({ length: init.times }, () => flatten(init.item)).flat();
  }
}

/** Every index of an array, the last dimension running fastest. */
function elements(dims: readonly [number, number][]): number[][] {
  let all: number[][] = [[]];
  for (const [lo, hi] of dims) {
    const next: number[][] = [];
    for (const prefix of all) for (let i = lo; i <= hi; i++) next.push([...prefix, i]);
    all = next;
  }
  return all;
}

// ---- the standard functions ------------------------------------------------------------------

type Standard = (args: Value[], line: number, interpreter: Interpreter) => Value;

const one = (name: string, args: Value[], line: number): Value => {
  if (args.length !== 1) throw new ListingError(line, `${name} takes one value`);
  return args[0] as Value;
};
const numericArg = (name: string, args: Value[], line: number): Value => {
  const v = typed(one(name, args, line), line);
  if (INTEGER_RANK[v.type] === undefined)
    throw new ListingError(line, `${name} takes an INT, DINT or REAL, not ${an(v.type)}`);
  return v;
};
const realFunction =
  (name: string, f: (x: number) => number): Standard =>
  (args, line, interpreter) => {
    const v = numericArg(name, args, line);
    return { type: "REAL", value: interpreter.real(f(interpreter.real(v.value))) };
  };
/** A conversion from one type to another: the argument must be the `from` type (an INT constant too). */
const conversion =
  (from: S7Type, to: S7Type, f: (x: number, interpreter: Interpreter) => number): Standard =>
  (args, line, interpreter) => {
    let v = one(`${from}_TO_${to}`, args, line);
    if (v.type === "ANYINT" && from !== "REAL" && from !== "BOOL" && fits(from, v.value))
      v = { type: from, value: v.value };
    if (v.type !== from) throw new ListingError(line, `${from}_TO_${to} takes ${an(from)}, not ${an(v.type)}`);
    return { type: to, value: f(v.value, interpreter) };
  };

/**
 * REAL to DINT by `rounding`. Outside DINT the CPU's RND/TRN leave their operand where the result
 * goes, so the result is the REAL's own bit pattern read as a DINT (the manual calls it undefined).
 */
const realToDintBy = (x: number, rounding: Rounding) => {
  const r = realToDint(x, rounding);
  return r.ov ? int32(realToBits(x)) : r.value;
};

const shift =
  (name: string, f: (value: number, n: number, width: number) => number): Standard =>
  (args, line) => {
    if (args.length !== 2) throw new ListingError(line, `${name} takes IN and N`);
    const [v, n] = args as [Value, Value];
    const width = v.type === "ANYINT" ? undefined : BIT_WIDTH[v.type];
    if (width === undefined || v.type === "BOOL") throw new ListingError(line, `${name} shifts a BYTE, WORD or DWORD`);
    const count = typed(n, line);
    if (count.type !== "INT" && count.type !== "DINT") throw new ListingError(line, `${name}'s N is an INT`);
    const mask = MASK[v.type as S7Type] ?? 0;
    return { type: v.type, value: (f(v.value, Math.max(0, count.value), width) & mask) >>> 0 };
  };

const STANDARD: Readonly<Record<string, Standard>> = {
  ABS: (args, line, interpreter) => {
    const v = numericArg("ABS", args, line);
    if (v.type === "REAL") return { type: "REAL", value: Math.abs(v.value) };
    return { type: v.type, value: interpreter.integer(BigInt(Math.abs(v.value)), v.type === "INT" ? 16 : 32) };
  },
  SQR: realFunction("SQR", (x) => x * x),
  SQRT: realFunction("SQRT", Math.sqrt),
  EXP: realFunction("EXP", Math.exp),
  EXPD: realFunction("EXPD", (x) => Math.pow(10, x)),
  LN: realFunction("LN", Math.log),
  LOG: realFunction("LOG", Math.log10),
  SIN: realFunction("SIN", Math.sin),
  COS: realFunction("COS", Math.cos),
  TAN: realFunction("TAN", Math.tan),
  ASIN: realFunction("ASIN", Math.asin),
  ACOS: realFunction("ACOS", Math.acos),
  ATAN: realFunction("ATAN", Math.atan),
  INT_TO_DINT: conversion("INT", "DINT", (x) => x),
  INT_TO_REAL: conversion("INT", "REAL", (x, i) => i.real(x)),
  DINT_TO_REAL: conversion("DINT", "REAL", (x, i) => i.real(x)),
  // Out of INT's range the CPU stores the low word (and clears OK).
  DINT_TO_INT: conversion("DINT", "INT", (x) => int16(x)),
  REAL_TO_INT: conversion("REAL", "INT", (x, i) => int16(realToDintBy(x, i.nearest))),
  REAL_TO_DINT: conversion("REAL", "DINT", (x, i) => realToDintBy(x, i.nearest)),
  ROUND: conversion("REAL", "DINT", (x, i) => realToDintBy(x, i.nearest)),
  TRUNC: conversion("REAL", "DINT", (x) => realToDintBy(x, "toward-zero")),
  INT_TO_WORD: conversion("INT", "WORD", (x) => x & 0xffff),
  WORD_TO_INT: conversion("WORD", "INT", (x) => int16(x)),
  DINT_TO_DWORD: conversion("DINT", "DWORD", (x) => x >>> 0),
  DWORD_TO_DINT: conversion("DWORD", "DINT", (x) => int32(x)),
  BYTE_TO_WORD: conversion("BYTE", "WORD", (x) => x),
  BYTE_TO_DWORD: conversion("BYTE", "DWORD", (x) => x),
  WORD_TO_DWORD: conversion("WORD", "DWORD", (x) => x),
  WORD_TO_BYTE: conversion("WORD", "BYTE", (x) => x & 0xff),
  DWORD_TO_WORD: conversion("DWORD", "WORD", (x) => x & 0xffff),
  DWORD_TO_BYTE: conversion("DWORD", "BYTE", (x) => x & 0xff),
  BOOL_TO_BYTE: conversion("BOOL", "BYTE", (x) => x),
  BOOL_TO_WORD: conversion("BOOL", "WORD", (x) => x),
  BOOL_TO_DWORD: conversion("BOOL", "DWORD", (x) => x),
  BYTE_TO_BOOL: conversion("BYTE", "BOOL", (x) => x & 1),
  DWORD_TO_REAL: conversion("DWORD", "REAL", (x) => bitsToReal(x)),
  REAL_TO_DWORD: conversion("REAL", "DWORD", (x) => realToBits(x)),
  SHL: shift("SHL", (v, n, w) => (n >= w ? 0 : Number((BigInt(v) << BigInt(n)) & 0xffffffffn))),
  SHR: shift("SHR", (v, n, w) => (n >= w ? 0 : v >>> n)),
  ROL: shift("ROL", (v, n, w) => {
    const k = n % w;
    return k === 0 ? v : Number(((BigInt(v) << BigInt(k)) | (BigInt(v) >> BigInt(w - k))) & ((1n << BigInt(w)) - 1n));
  }),
  ROR: shift("ROR", (v, n, w) => {
    const k = n % w;
    return k === 0 ? v : Number(((BigInt(v) >> BigInt(k)) | (BigInt(v) << BigInt(w - k))) & ((1n << BigInt(w)) - 1n));
  }),
};

// ---- the gate's and the page's view of a run ---------------------------------------------------

/** One scan as the engine ran it: its trace, why it stopped if it did, and every value after it. */
export interface ScanResult {
  trace: TraceEntry[];
  error?: string;
  values: Record<string, Leaf>;
}

/** A gate case: the inputs before each scan, from a cold start. */
export interface GateCase {
  name: string;
  scans: Inputs[];
}

/** Runs a case from a cold start (the DBs and statics at their initial values). */
export function runCase(
  model: SclModel,
  scans: readonly Inputs[],
  interpreter: Interpreter = INTERPRETER,
  unit: Unit = parseScl(model.source),
): { scans: ScanResult[]; ran: Set<number>; constructs: Set<string> } {
  const run = new SclRun(model, unit, interpreter);
  const results: ScanResult[] = [];
  for (const inputs of scans) {
    const { trace, error } = run.scan(inputs);
    results.push({ trace, values: run.values(), ...(error === undefined ? {} : { error }) });
    if (error !== undefined) break;
  }
  return { scans: results, ran: run.ran, constructs: run.constructs };
}

/** Every value the engine gives for a model at these inputs: every variable after one scan from a cold start, by path. */
export function quantities(model: SclModel, inputs: Inputs): Record<string, number> {
  const run = new SclRun(model);
  const { error } = run.scan(inputs);
  if (error !== undefined) throw new Error(error);
  return Object.fromEntries(Object.entries(run.watchable()).map(([path, leaf]) => [path, leaf.value]));
}

export { ListingError, parseScl };
