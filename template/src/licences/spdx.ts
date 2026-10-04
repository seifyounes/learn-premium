// The licence allow-list the licence gate holds every shipped npm package to, and a reader for
// the SPDX expressions packages declare their licences in. Anything else is the Owner's to decide.

/** The licences a shipped package may carry without asking the Owner. */
export const ALLOWED_LICENCES: ReadonlySet<string> = new Set([
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Apache-2.0",
  "0BSD",
  "CC0-1.0",
  "Zlib",
  "BSL-1.0",
  "PSF-2.0",
  "OFL-1.1",
  "MPL-2.0",
  "EPL-2.0",
]);

export type LicenceVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether a package's declared licence (an SPDX expression) is on the allow-list. A choice (`OR`)
 * is allowed when any side is; a conjunction (`AND`) only when every side is. A `WITH` exception,
 * a missing licence or one the gate can't read goes to the Owner.
 */
export function licenceVerdict(expression: string | undefined): LicenceVerdict {
  if (expression === undefined || expression.trim() === "")
    return { allowed: false, reason: "the package declares no licence" };
  let parsed: Expression;
  try {
    parsed = parse(expression);
  } catch {
    return {
      allowed: false,
      reason: `the licence "${expression}" is not an SPDX expression the gate can read`,
    };
  }
  return allowed(parsed)
    ? { allowed: true }
    : { allowed: false, reason: `${expression.trim()} is not on the allow-list` };
}

type Expression = { id: string } | { op: "AND" | "OR"; terms: Expression[] };

function allowed(expression: Expression): boolean {
  if ("id" in expression) return ALLOWED_LICENCES.has(expression.id);
  return expression.op === "OR" ? expression.terms.some(allowed) : expression.terms.every(allowed);
}

/** SPDX licence ids: letters, digits, `.`, `-` and `+`. `WITH` makes an id the gate won't allow. */
const ID = /^[A-Za-z0-9.+-]+$/;

/** Parses `a OR b AND (c OR d)`: AND binds tighter than OR, as SPDX says. */
function parse(text: string): Expression {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];

  const primary = (): Expression => {
    const token = take();
    if (token === "(") {
      const inner = or();
      if (take() !== ")") throw new Error("unclosed (");
      return inner;
    }
    if (token === undefined || !ID.test(token) || ["AND", "OR", "WITH"].includes(token))
      throw new Error(`unexpected ${token ?? "end"}`);
    if (peek() === "WITH") {
      take();
      const exception = take();
      if (exception === undefined || !ID.test(exception)) throw new Error("WITH needs an exception");
      return { id: `${token} WITH ${exception}` };
    }
    return { id: token };
  };
  /** `term (op term)*`, one term alone as itself. */
  const joined = (op: "AND" | "OR", term: () => Expression) => (): Expression => {
    const terms = [term()];
    while (peek() === op) {
      take();
      terms.push(term());
    }
    return terms.length === 1 && terms[0] !== undefined ? terms[0] : { op, terms };
  };
  const and = joined("AND", () => primary());
  const or = joined("OR", and);

  const expression = or();
  if (at !== tokens.length) throw new Error(`unexpected ${peek()}`);
  return expression;
}
