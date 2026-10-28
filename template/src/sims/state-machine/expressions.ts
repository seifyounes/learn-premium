// The receptivity and equation parser of the state-machine sims: the Boolean expressions the
// Materials print, `Q0·x' + Q1·Q0'·x`, `m·a`, `/m + (a·¬b)`. AND is `·`, `.` or `*`; OR is `+`; NOT is
// a leading `¬`, `!` or `/`, or a trailing `'`; `0`, `1` and parentheses. Whitespace is ignored.
export type Bit = 0 | 1;

export type Expr =
  | { op: "name"; name: string }
  | { op: "const"; value: Bit }
  | { op: "not"; arg: Expr }
  | { op: "and"; args: Expr[] }
  | { op: "or"; args: Expr[] };

export class ExpressionError extends Error {}

interface Token {
  kind: "name" | "const" | "or" | "and" | "not" | "quote" | "open" | "close";
  text: string;
  /** Its place in the text, 1-based. */
  at: number;
}

const AND = new Set(["·", ".", "*"]);
const NOT = new Set(["¬", "!", "/"]);

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const at = i + 1;
    if (/\s/.test(c)) continue;
    if (/[A-Za-z]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j] as string)) j++;
      out.push({ kind: "name", text: text.slice(i, j), at });
      i = j - 1;
    } else if (c === "0" || c === "1") out.push({ kind: "const", text: c, at });
    else if (c === "+") out.push({ kind: "or", text: c, at });
    else if (AND.has(c)) out.push({ kind: "and", text: c, at });
    else if (NOT.has(c)) out.push({ kind: "not", text: c, at });
    else if (c === "'") out.push({ kind: "quote", text: c, at });
    else if (c === "(") out.push({ kind: "open", text: c, at });
    else if (c === ")") out.push({ kind: "close", text: c, at });
    else throw new ExpressionError(`unexpected "${c}" at character ${at}`);
  }
  return out;
}

const STARTS_PRIMARY = new Set<Token["kind"]>(["name", "const", "open"]);

export function parseExpression(text: string): Expr {
  const all = tokens(text);
  let i = 0;
  const peek = () => all[i];
  const expectMore = () => {
    const t = peek();
    if (!t) throw new ExpressionError(`"${text}" ends where a name, 0, 1 or ( should follow`);
    return t;
  };
  const expr = (): Expr => {
    const terms = [term()];
    while (peek()?.kind === "or") {
      i++;
      terms.push(term());
    }
    return terms.length === 1 ? (terms[0] as Expr) : { op: "or", args: terms };
  };
  const term = (): Expr => {
    const factors = [factor()];
    while (peek()?.kind === "and") {
      i++;
      factors.push(factor());
    }
    return factors.length === 1 ? (factors[0] as Expr) : { op: "and", args: factors };
  };
  const factor = (): Expr => {
    if (expectMore().kind === "not") {
      i++;
      return { op: "not", arg: factor() };
    }
    let e = primary();
    while (peek()?.kind === "quote") {
      i++;
      e = { op: "not", arg: e };
    }
    return e;
  };
  const primary = (): Expr => {
    const t = expectMore();
    i++;
    switch (t.kind) {
      case "name":
        return { op: "name", name: t.text };
      case "const":
        return { op: "const", value: t.text === "1" ? 1 : 0 };
      case "open": {
        const inner = expr();
        const close = peek();
        if (!close) throw new ExpressionError(`"${text}" ends where ) should follow`);
        if (close.kind !== "close") throw new ExpressionError(`unexpected "${close.text}" at character ${close.at}`);
        i++;
        return inner;
      }
      default:
        throw new ExpressionError(`unexpected "${t.text}" at character ${t.at}`);
    }
  };
  const parsed = expr();
  const rest = peek();
  if (rest) {
    if (STARTS_PRIMARY.has(rest.kind))
      throw new ExpressionError(`"${text}" has two names side by side: join them with · or +`);
    throw new ExpressionError(`unexpected "${rest.text}" at character ${rest.at}`);
  }
  return parsed;
}

/** The expression's value for `bits`; throws on a name `bits` doesn't give. */
export function evaluate(expr: Expr, bits: Readonly<Record<string, number>>): Bit {
  switch (expr.op) {
    case "name": {
      const v = bits[expr.name];
      if (v === undefined) throw new ExpressionError(`${expr.name} has no value`);
      return v === 0 ? 0 : 1;
    }
    case "const":
      return expr.value;
    case "not":
      return evaluate(expr.arg, bits) === 1 ? 0 : 1;
    case "and":
      return expr.args.every((a) => evaluate(a, bits) === 1) ? 1 : 0;
    case "or":
      return expr.args.some((a) => evaluate(a, bits) === 1) ? 1 : 0;
  }
}

/** The names an expression reads, once each, in order of appearance. */
export function namesIn(expr: Expr): string[] {
  switch (expr.op) {
    case "name":
      return [expr.name];
    case "const":
      return [];
    case "not":
      return namesIn(expr.arg);
    case "and":
    case "or":
      return [...new Set(expr.args.flatMap(namesIn))];
  }
}

/** The printed text's outermost terms (split at each `+` outside parentheses), each trimmed as printed, and parsed. */
export function termsOf(text: string): { text: string; expr: Expr }[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "+" && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => ({ text: part.trim(), expr: parseExpression(part) }));
}
