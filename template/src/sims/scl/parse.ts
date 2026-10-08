// The SCL interpreter's reader: a Professor's listing in S7-SCL (STEP 7 V5.x, the S7-300/400
// dialect) read into a tree the engine walks. A listing is a run of units: TYPE (a UDT), DATA_BLOCK,
// FUNCTION and FUNCTION_BLOCK, in any order. Every statement keeps the lines it spans, so the trace
// can shade the line being read. Pure: no DOM, the same code in Node at build and in the page.

import { S7_TYPES, type S7Type } from "../s7/core.ts";

/** A listing that doesn't read as SCL, with the line (0-based) it stops on. */
export class ListingError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line + 1}: ${message}`);
    this.line = line;
  }
}

// ---- tokens ------------------------------------------------------------------------------------

type Token =
  | { t: "num"; value: number; type: S7Type | "ANYINT"; line: number }
  | { t: "id"; value: string; quoted: boolean; line: number }
  | { t: "kw"; value: string; line: number }
  | { t: "op"; value: string; line: number }
  | { t: "eof"; value: ""; line: number };

const KEYWORDS = new Set(
  (
    "FUNCTION FUNCTION_BLOCK END_FUNCTION END_FUNCTION_BLOCK TYPE END_TYPE STRUCT END_STRUCT DATA_BLOCK " +
    "END_DATA_BLOCK VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR END_VAR CONST END_CONST BEGIN IF THEN ELSIF ELSE " +
    "END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT CONTINUE RETURN AND " +
    "OR XOR NOT MOD DIV ARRAY TRUE FALSE TITLE VERSION AUTHOR NAME FAMILY KNOW_HOW_PROTECT VOID"
  ).split(" "),
);

/** A typed constant's prefix: `W#16#00FF`, `L#70000`, `INT#5`. */
const TYPED_PREFIX: Record<string, S7Type> = {
  B: "BYTE",
  BYTE: "BYTE",
  W: "WORD",
  WORD: "WORD",
  DW: "DWORD",
  DWORD: "DWORD",
  L: "DINT",
  DINT: "DINT",
  INT: "INT",
  REAL: "REAL",
};

const TOKEN =
  /(\r?\n)|([ \t\f\v]+)|(\/\/[^\n]*|\(\*[\s\S]*?\*\)|\{[^}]*\})|((?:[A-Za-z]+#)?(?:16#[0-9A-Fa-f_]+|2#[01_]+|8#[0-7_]+|[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?))|("[^"\n]*")|(#?[A-Za-z_]\w*)|(:=|<>|<=|>=|\*\*|\.\.|[-+*/=<>()[\],;:.&])/y;

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 0;
  let i = 0;
  while (i < source.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(source);
    if (!m) throw new ListingError(line, `can't read "${source.slice(i, i + 12).split("\n")[0]}"`);
    const at = line;
    line += (m[0].match(/\n/g) ?? []).length;
    i = TOKEN.lastIndex;
    const [, newline, space, comment, number, quoted, word, op] = m;
    if (newline || space || comment) continue;
    if (number !== undefined) {
      // A sign is part of a number only as a typed constant's (`L#-5`); elsewhere it is an operator.
      if (/^[+-]/.test(number)) {
        tokens.push({ t: "op", value: number[0] ?? "", line: at });
        TOKEN.lastIndex = i = i - number.length + 1;
        continue;
      }
      tokens.push({ t: "num", ...readNumber(number, at), line: at });
    } else if (quoted !== undefined) tokens.push({ t: "id", value: quoted.slice(1, -1), quoted: true, line: at });
    else if (word !== undefined) {
      const upper = word.toUpperCase();
      tokens.push(
        !word.startsWith("#") && KEYWORDS.has(upper)
          ? { t: "kw", value: upper, line: at }
          : { t: "id", value: word.replace(/^#/, ""), quoted: false, line: at },
      );
    } else tokens.push({ t: "op", value: op ?? "", line: at });
  }
  tokens.push({ t: "eof", value: "", line });
  return tokens;
}

function readNumber(text: string, line: number): { value: number; type: S7Type | "ANYINT" } {
  const typed = /^([A-Za-z]+)#(.*)$/.exec(text);
  let type: S7Type | "ANYINT" = "ANYINT";
  let rest = text;
  if (typed && !/^(16|2|8)$/.test(typed[1] ?? "")) {
    const named = TYPED_PREFIX[(typed[1] ?? "").toUpperCase()];
    if (!named) throw new ListingError(line, `"${text}" isn't a constant SCL knows`);
    type = named;
    rest = typed[2] ?? "";
  }
  rest = rest.replace(/_/g, "");
  const based = /^(16|2|8)#(.+)$/.exec(rest);
  if (based) return { value: parseInt(based[2] ?? "", Number(based[1])), type };
  // A decimal point or an exponent makes a REAL (an exponent alone too: `1E3`).
  if (/[.eE]/.test(rest)) return { value: Number(rest), type: type === "ANYINT" ? "REAL" : type };
  return { value: Number(rest), type };
}

// ---- the tree ----------------------------------------------------------------------------------

export type TypeNode =
  | { kind: "elementary"; name: S7Type }
  | { kind: "named"; name: string; line: number }
  | { kind: "array"; dims: [Expr, Expr][]; of: TypeNode }
  | { kind: "struct"; fields: Declaration[] };

/** An initial value: an expression, or a list for an array (`[1, 2, 3(0)]`: a repetition factor). */
export type Init =
  { kind: "value"; value: Expr } | { kind: "list"; items: Init[] } | { kind: "repeat"; times: number; item: Init };

export interface Declaration {
  name: string;
  type: TypeNode;
  init?: Init;
  line: number;
}

export type SectionKind = "VAR_INPUT" | "VAR_OUTPUT" | "VAR_IN_OUT" | "VAR" | "VAR_TEMP";

export interface Section {
  kind: SectionKind;
  declarations: Declaration[];
}

/** A variable by name, then its members and indices: `"Rack".slot[#lvl, 2].occupied`. */
export interface Reference {
  name: string;
  /** Written in quotes: a block, DB or UDT name, never a local. */
  quoted: boolean;
  selectors: ({ member: string } | { index: Expr[] })[];
  line: number;
}

export type Expr =
  | { kind: "literal"; type: S7Type | "ANYINT" | "BOOL"; value: number }
  | { kind: "ref"; ref: Reference }
  | { kind: "unary"; op: "-" | "+" | "NOT"; operand: Expr }
  | { kind: "binary"; op: BinaryOp; lhs: Expr; rhs: Expr }
  | { kind: "call"; name: string; args: { name?: string; value: Expr }[]; line: number };

export type BinaryOp =
  "**" | "*" | "/" | "MOD" | "DIV" | "+" | "-" | "<" | ">" | "<=" | ">=" | "=" | "<>" | "AND" | "XOR" | "OR";

interface At {
  /** The first line of the statement (0-based). */
  line: number;
  /** Its last line. */
  lastLine: number;
}

export interface Arm extends At {
  body: Statement[];
}

export type Statement = At &
  (
    | { kind: "assign"; target: Reference; value: Expr }
    | { kind: "call"; call: Extract<Expr, { kind: "call" }> }
    | { kind: "if"; arms: (Arm & { condition: Expr })[]; otherwise?: Arm }
    | {
        kind: "case";
        selector: Expr;
        arms: (Arm & { labels: { from: Expr; to: Expr }[] })[];
        otherwise?: Arm;
      }
    | { kind: "for"; variable: Reference; from: Expr; to: Expr; by?: Expr; body: Statement[] }
    | { kind: "while"; condition: Expr; body: Statement[] }
    | { kind: "repeat"; body: Statement[]; condition: Expr; untilLine: number }
    | { kind: "exit" | "continue" | "return" }
  );

export interface Block {
  kind: "FUNCTION" | "FUNCTION_BLOCK";
  name: string;
  /** A FUNCTION's return type; VOID has none. */
  returns?: TypeNode;
  sections: Section[];
  constants: { name: string; value: Expr; line: number }[];
  body: Statement[];
  line: number;
}

export interface DataBlock {
  name: string;
  declarations: Declaration[];
  /** The assignments after BEGIN: its actual values, set once before the first scan. */
  begin: Statement[];
  line: number;
}

export interface Unit {
  types: Map<string, TypeNode>;
  dataBlocks: DataBlock[];
  blocks: Block[];
  /** The listing's lines, as written. */
  lines: string[];
}

/** A unit's name compared as SCL does: case-insensitive. */
export const key = (name: string) => name.toUpperCase();

// ---- the parser --------------------------------------------------------------------------------

const ELEMENTARY = new Set<string>(S7_TYPES);
const PRECEDENCE: BinaryOp[][] = [
  ["OR"],
  ["XOR"],
  ["AND"],
  ["=", "<>"],
  ["<", ">", "<=", ">="],
  ["+", "-"],
  ["*", "/", "MOD", "DIV"],
];

export function parseScl(source: string): Unit {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const tokens = lex(lines.join("\n"));
  let p = 0;
  const here = (): Token => tokens[p] as Token;
  const is = (value: string) => (here().t === "kw" || here().t === "op") && here().value === value;
  const next = () => tokens[p++] as Token;
  const fail = (message: string): never => {
    throw new ListingError(here().line, message);
  };
  const expect = (value: string) => {
    if (!is(value)) fail(`expected ${value}, found "${here().value || "the end"}"`);
    return next();
  };
  const optional = (value: string) => (is(value) ? next() : undefined);
  const name = (): string => {
    const t = next();
    if (t.t !== "id" && t.t !== "kw") throw new ListingError(t.line, `expected a name, found "${t.value}"`);
    return t.value;
  };
  const lastLine = () => (tokens[p - 1] as Token).line;

  function type(): TypeNode {
    if (optional("ARRAY")) {
      expect("[");
      const dims: [Expr, Expr][] = [];
      do {
        const lo = expr();
        expect("..");
        dims.push([lo, expr()]);
      } while (optional(","));
      expect("]");
      expect("OF");
      return { kind: "array", dims, of: type() };
    }
    if (optional("STRUCT")) {
      const fields = declarations(["END_STRUCT"]);
      expect("END_STRUCT");
      return { kind: "struct", fields };
    }
    const t = next();
    if (t.t !== "id") throw new ListingError(t.line, `expected a type, found "${t.value}"`);
    const upper = t.value.toUpperCase();
    if (!t.quoted && ELEMENTARY.has(upper)) return { kind: "elementary", name: upper as S7Type };
    return { kind: "named", name: t.value, line: t.line };
  }

  function init(): Init {
    if (optional("[")) {
      const items: Init[] = [];
      if (!is("]"))
        do items.push(initItem());
        while (optional(","));
      expect("]");
      return { kind: "list", items };
    }
    return initItem();
  }
  function initItem(): Init {
    // A repetition factor: `3(0)` is three zeros.
    const t = here();
    const after = tokens[p + 1];
    if (t.t === "num" && t.type === "ANYINT" && after?.t === "op" && after.value === "(") {
      next();
      next();
      const item = init();
      expect(")");
      return { kind: "repeat", times: t.value, item };
    }
    if (is("[")) return init();
    return { kind: "value", value: expr() };
  }

  function declarations(ends: string[]): Declaration[] {
    const out: Declaration[] = [];
    while (!ends.some(is)) {
      if (here().t === "eof") fail(`expected ${ends.join(" or ")}`);
      const line = here().line;
      const names = [name()];
      while (optional(",")) names.push(name());
      expect(":");
      const t = type();
      const value = optional(":=") ? init() : undefined;
      expect(";");
      for (const n of names) out.push({ name: n, type: t, ...(value ? { init: value } : {}), line });
    }
    return out;
  }

  // ---- expressions ----
  function expr(level = 0): Expr {
    const ops = PRECEDENCE[level];
    if (!ops) return unary();
    let lhs = expr(level + 1);
    for (;;) {
      const op = ops.find((o) => is(o) || (o === "AND" && is("&")));
      if (!op) return lhs;
      next();
      signAfter(op);
      lhs = { kind: "binary", op, lhs, rhs: expr(level + 1) };
    }
  }
  /**
   * Two arithmetic operators never follow each other (the manual, Arithmetic Expressions): `a * -b`
   * is written `a * (-b)`. A signed constant is one operand, so `a * -1` reads.
   */
  function signAfter(op: BinaryOp) {
    if (!["+", "-", "*", "/", "MOD", "DIV", "**"].includes(op)) return;
    if ((is("-") || is("+")) && tokens[p + 1]?.t !== "num")
      fail(`two arithmetic operators can't follow each other: write ${op} (${here().value}…) in brackets`);
  }
  /** Unary + − and NOT bind looser than **: −2 ** 2 is −(2 ** 2) (the manual's operator table). */
  function unary(): Expr {
    if (is("-") || is("+")) {
      const op = next().value as "-" | "+";
      const operand = unary();
      // A signed number is one constant: `-32768` is an INT.
      if (operand.kind === "literal" && operand.type !== "BOOL" && op === "-")
        return { ...operand, value: operand.type === "REAL" ? -operand.value : -operand.value + 0 };
      return op === "+" ? operand : { kind: "unary", op, operand };
    }
    if (optional("NOT")) return { kind: "unary", op: "NOT", operand: unary() };
    return power();
  }
  /** ** between operands of equal priority runs in reading order, so 2 ** 3 ** 2 is (2 ** 3) ** 2. */
  function power(): Expr {
    let base = primary();
    while (optional("**")) {
      signAfter("**");
      // 2 ** −1 takes a signed constant as its exponent.
      const exponent = is("-") || is("+") ? unary() : primary();
      base = { kind: "binary", op: "**", lhs: base, rhs: exponent };
    }
    return base;
  }
  function primary(): Expr {
    const t = next();
    if (t.t === "num") return { kind: "literal", type: t.type, value: t.value };
    if (t.t === "kw" && (t.value === "TRUE" || t.value === "FALSE"))
      return { kind: "literal", type: "BOOL", value: t.value === "TRUE" ? 1 : 0 };
    if (t.t === "op" && t.value === "(") {
      const e = expr();
      expect(")");
      return e;
    }
    if (t.t !== "id") throw new ListingError(t.line, `unexpected "${t.value || "end of listing"}"`);
    if (is("(")) {
      next();
      const args: { name?: string; value: Expr }[] = [];
      if (!is(")"))
        do {
          const a = here();
          const b = tokens[p + 1];
          if (a.t === "id" && b?.t === "op" && b.value === ":=") {
            next();
            next();
            args.push({ name: a.value, value: expr() });
          } else args.push({ value: expr() });
        } while (optional(","));
      expect(")");
      return { kind: "call", name: t.value, args, line: t.line };
    }
    return { kind: "ref", ref: reference(t) };
  }
  function reference(t: Extract<Token, { t: "id" }>): Reference {
    const ref: Reference = { name: t.value, quoted: t.quoted, selectors: [], line: t.line };
    for (;;) {
      if (optional("[")) {
        const index: Expr[] = [];
        do index.push(expr());
        while (optional(","));
        expect("]");
        ref.selectors.push({ index });
      } else if (is(".")) {
        next();
        ref.selectors.push({ member: name() });
      } else return ref;
    }
  }

  // ---- statements ----
  function statements(ends: string[]): Statement[] {
    const out: Statement[] = [];
    while (!ends.some(is)) {
      if (here().t === "eof") fail(`expected ${ends.join(" or ")}`);
      if (optional(";")) continue;
      out.push(statement());
    }
    return out;
  }
  const end = (keyword: string) => {
    expect(keyword);
    const last = lastLine();
    optional(";");
    return last;
  };
  /** A CASE arm's labels start here: constants (signed), lists and ranges, then a colon. */
  function atCaseLabel(): boolean {
    let q = p;
    for (;;) {
      const t = tokens[q];
      if (t?.t === "op" && (t.value === "-" || t.value === "+")) q++;
      const v = tokens[q];
      if (v?.t !== "num" && v?.t !== "id") return false;
      const after = tokens[q + 1];
      if (after?.t !== "op") return false;
      if (after.value === ":") return true;
      if (after.value !== ".." && after.value !== ",") return false;
      q += 2;
    }
  }
  function statement(): Statement {
    const line = here().line;
    if (optional("IF")) {
      const arms: (Arm & { condition: Expr })[] = [];
      let condition = expr();
      expect("THEN");
      let armLine = line;
      let body = statements(["ELSIF", "ELSE", "END_IF"]);
      arms.push({ line: armLine, lastLine: armLine, condition, body });
      while (is("ELSIF")) {
        armLine = next().line;
        condition = expr();
        expect("THEN");
        body = statements(["ELSIF", "ELSE", "END_IF"]);
        arms.push({ line: armLine, lastLine: armLine, condition, body });
      }
      let otherwise: Arm | undefined;
      if (is("ELSE")) {
        const elseLine = next().line;
        otherwise = { line: elseLine, lastLine: elseLine, body: statements(["END_IF"]) };
      }
      const last = end("END_IF");
      return { kind: "if", line, lastLine: last, arms, ...(otherwise ? { otherwise } : {}) };
    }
    if (optional("CASE")) {
      const selector = expr();
      expect("OF");
      const arms: (Arm & { labels: { from: Expr; to: Expr }[] })[] = [];
      while (!is("ELSE") && !is("END_CASE")) {
        const armLine = here().line;
        if (!atCaseLabel()) fail("expected a CASE label (a constant, a list or a range) and a colon");
        const labels: { from: Expr; to: Expr }[] = [];
        do {
          const from = unary();
          labels.push({ from, to: optional("..") ? unary() : from });
        } while (optional(","));
        expect(":");
        const body: Statement[] = [];
        while (!is("ELSE") && !is("END_CASE") && !atCaseLabel()) {
          if (here().t === "eof") fail("expected END_CASE");
          if (optional(";")) continue;
          body.push(statement());
        }
        arms.push({ line: armLine, lastLine: armLine, labels, body });
      }
      let otherwise: Arm | undefined;
      if (is("ELSE")) {
        const elseLine = next().line;
        optional(":");
        otherwise = { line: elseLine, lastLine: elseLine, body: statements(["END_CASE"]) };
      }
      const last = end("END_CASE");
      return { kind: "case", line, lastLine: last, selector, arms, ...(otherwise ? { otherwise } : {}) };
    }
    if (optional("FOR")) {
      const t = next();
      if (t.t !== "id") throw new ListingError(t.line, "FOR needs a control variable");
      const variable = reference(t);
      expect(":=");
      const from = expr();
      expect("TO");
      const to = expr();
      const by = optional("BY") ? expr() : undefined;
      expect("DO");
      const body = statements(["END_FOR"]);
      const last = end("END_FOR");
      return { kind: "for", line, lastLine: last, variable, from, to, ...(by ? { by } : {}), body };
    }
    if (optional("WHILE")) {
      const condition = expr();
      expect("DO");
      const body = statements(["END_WHILE"]);
      return { kind: "while", line, lastLine: end("END_WHILE"), condition, body };
    }
    if (optional("REPEAT")) {
      const body = statements(["UNTIL"]);
      const untilLine = expect("UNTIL").line;
      const condition = expr();
      optional(";");
      return { kind: "repeat", line, lastLine: end("END_REPEAT"), body, condition, untilLine };
    }
    for (const word of ["EXIT", "CONTINUE", "RETURN"] as const) {
      if (optional(word)) {
        expect(";");
        return { kind: word.toLowerCase() as "exit" | "continue" | "return", line, lastLine: line };
      }
    }
    const t = next();
    if (t.t !== "id") throw new ListingError(t.line, `unexpected "${t.value || "end of listing"}"`);
    if (is("(")) {
      p--;
      const call = primary();
      if (call.kind !== "call") fail("expected a call");
      expect(";");
      return { kind: "call", line, lastLine: lastLine(), call: call as Extract<Expr, { kind: "call" }> };
    }
    const target = reference(t);
    expect(":=");
    const value = expr();
    expect(";");
    return { kind: "assign", line, lastLine: lastLine(), target, value };
  }

  /** Block attributes the interpreter has no use for: TITLE = …, VERSION : '1.0', `{ … }` (lexed away). */
  function attributes() {
    for (;;) {
      if (["TITLE", "VERSION", "AUTHOR", "NAME", "FAMILY"].some(is)) {
        const line = here().line;
        next();
        // The attribute's value runs to the end of its line.
        while (here().t !== "eof" && here().line === line) next();
        continue;
      }
      if (optional("KNOW_HOW_PROTECT")) continue;
      return;
    }
  }

  const unit: Unit = { types: new Map(), dataBlocks: [], blocks: [], lines };
  while (here().t !== "eof") {
    const line = here().line;
    if (optional("TYPE")) {
      const n = name();
      attributes();
      optional(":");
      unit.types.set(key(n), type());
      optional(";");
      end("END_TYPE");
      continue;
    }
    if (optional("DATA_BLOCK")) {
      const n = name();
      attributes();
      const declared: Declaration[] = [];
      if (optional("STRUCT")) {
        declared.push(...declarations(["END_STRUCT"]));
        expect("END_STRUCT");
        optional(";");
      }
      while (optional("VAR")) {
        declared.push(...declarations(["END_VAR"]));
        expect("END_VAR");
      }
      // A DB of a UDT or an FB's instance DB is not part of what the interpreter runs.
      if (here().t === "id") fail("a DATA_BLOCK of a UDT or an instance DB isn't supported yet: declare its variables");
      expect("BEGIN");
      const begin = statements(["END_DATA_BLOCK"]);
      end("END_DATA_BLOCK");
      unit.dataBlocks.push({ name: n, declarations: declared, begin, line });
      continue;
    }
    const kind = next();
    if (kind.value !== "FUNCTION" && kind.value !== "FUNCTION_BLOCK")
      throw new ListingError(kind.line, `expected TYPE, DATA_BLOCK, FUNCTION or FUNCTION_BLOCK, found "${kind.value}"`);
    const n = name();
    let returns: TypeNode | undefined;
    if (kind.value === "FUNCTION" && optional(":")) {
      if (!optional("VOID")) returns = type();
    }
    const sections: Section[] = [];
    const constants: Block["constants"] = [];
    for (;;) {
      attributes();
      if (optional("CONST")) {
        while (!is("END_CONST")) {
          const cl = here().line;
          const cn = name();
          expect(":=");
          constants.push({ name: cn, value: expr(), line: cl });
          expect(";");
        }
        expect("END_CONST");
        continue;
      }
      const section = ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR"].find(is) as SectionKind | undefined;
      if (!section) break;
      next();
      sections.push({ kind: section, declarations: declarations(["END_VAR"]) });
      expect("END_VAR");
    }
    expect("BEGIN");
    const ending = kind.value === "FUNCTION" ? "END_FUNCTION" : "END_FUNCTION_BLOCK";
    const body = statements([ending]);
    end(ending);
    unit.blocks.push({
      kind: kind.value,
      name: n,
      ...(returns ? { returns } : {}),
      sections,
      constants,
      body,
      line,
    });
  }
  return unit;
}

/** Every statement in a body, nested ones too, in listing order. */
export function* statementsIn(body: readonly Statement[]): Generator<Statement> {
  for (const s of body) {
    yield s;
    switch (s.kind) {
      case "if":
        for (const arm of s.arms) yield* statementsIn(arm.body);
        if (s.otherwise) yield* statementsIn(s.otherwise.body);
        break;
      case "case":
        for (const arm of s.arms) yield* statementsIn(arm.body);
        if (s.otherwise) yield* statementsIn(s.otherwise.body);
        break;
      case "for":
      case "while":
      case "repeat":
        yield* statementsIn(s.body);
        break;
    }
  }
}
