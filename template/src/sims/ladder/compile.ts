// A ladder or FBD model compiled to STL, the way STEP 7 shows a network as statements: each acting
// element's input logic as a chain of A/O (with brackets for branches), then its instruction. This is
// what awlsim, the build oracle, runs: its logic, timers, counters and SFB 4 are awlsim's own, and
// the compiler is a separate path from the engine's power flow, so either one's slip shows as a
// disagreement. Only the gate's oracle uses it; nothing of it ships to the page.

import { splitPin } from "../layout/drawing.ts";
import { formatAddress } from "../s7/core.ts";
import { TIMER_KIND } from "./engine.ts";
import { driversOf, ELEMENTS, netOf, networksOf, parseOperand, type LadderModel, type LadderPart } from "./model.ts";

/** A network's logic as a boolean expression. */
type Expr =
  | { kind: "const"; value: 0 | 1 }
  | { kind: "lit"; operand: string; negated: boolean }
  | { kind: "and" | "or"; items: Expr[] }
  | { kind: "not"; item: Expr };

const TRUE: Expr = { kind: "const", value: 1 };
const FALSE: Expr = { kind: "const", value: 0 };

/** An operand as awlsim's parser takes it: `I 0.0`, `MW 10`, `T 1`, `C 1`. */
export function stlOperand(text: string): string {
  const o = parseOperand(text);
  if (!o) throw new Error(`"${text}" isn't an operand`);
  switch (o.kind) {
    case "timer":
      return `T ${o.number}`;
    case "counter":
      return `C ${o.number}`;
    case "db":
      return `DB ${o.number}`;
    default:
      return formatAddress(o.address);
  }
}

// A constant that decides a chain (a FALSE in an AND, a TRUE in an OR) still leaves its other items
// in it: STL reads every operand, and reading a timer settles it, as the engine's power flow does.

function and(items: Expr[]): Expr {
  const flat = items.flatMap((e) => (e.kind === "and" ? e.items : [e])).filter((e) => !(e.kind === "const" && e.value));
  const rest = flat.filter((e) => e.kind !== "const");
  if (rest.length < flat.length) return rest.length === 0 ? FALSE : { kind: "and", items: [...rest, FALSE] };
  return flat.length === 0 ? TRUE : flat.length === 1 ? (flat[0] as Expr) : { kind: "and", items: flat };
}

function or(items: Expr[]): Expr {
  const flat = items.flatMap((e) => (e.kind === "or" ? e.items : [e])).filter((e) => !(e.kind === "const" && !e.value));
  const rest = flat.filter((e) => e.kind !== "const");
  if (rest.length < flat.length) return rest.length === 0 ? TRUE : { kind: "or", items: [...rest, TRUE] };
  return flat.length === 0 ? FALSE : flat.length === 1 ? (flat[0] as Expr) : { kind: "or", items: flat };
}

function not(item: Expr): Expr {
  if (item.kind === "const") return item.value ? FALSE : TRUE;
  if (item.kind === "lit") return { ...item, negated: !item.negated };
  return { kind: "not", item };
}

/** S7 nests at most seven brackets. */
const MOST_BRACKETS = 7;

/** The statements that leave `e` as the RLO, starting a new logic string. */
function chain(e: Expr, depth = 0): string[] {
  if (depth > MOST_BRACKETS) throw new Error(`a network's logic nests more than ${MOST_BRACKETS} branches deep`);
  switch (e.kind) {
    case "const":
      return [e.value ? "SET" : "CLR"];
    case "lit":
      return [`${e.negated ? "AN" : "A"} ${e.operand}`];
    case "not":
      return ["AN(", ...chain(e.item, depth + 1), ")"];
    case "and":
    case "or": {
      const op = e.kind === "and" ? "A" : "O";
      return e.items.flatMap((item) => {
        if (item.kind === "lit") return [`${op}${item.negated ? "N" : ""} ${item.operand}`];
        if (item.kind === "not") return [`${op}N(`, ...chain(item.item, depth + 1), ")"];
        return [`${op}(`, ...chain(item, depth + 1), ")"];
      });
    }
  }
}

/** The temporary bits a TON's IN and Q pass through, by its DB number. */
const tonIn = (db: number) => `#tin${db}`;
const tonQ = (db: number) => `#tq${db}`;

/** The model as one OB 1 in awlsim's form, with an instance DB for each TON. */
export function compileLadder(model: LadderModel): string {
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const numberOf = (p: LadderPart) => {
    const o = parseOperand(p.operand ?? "");
    return o && "number" in o ? o.number : 0;
  };

  /** The logic reaching a pin: the OR of the net's drivers. */
  const exprAt = (part: LadderPart, pin: string): Expr => {
    const net = netOf(model, `${part.id}.${pin}`);
    if (!net) return FALSE;
    return or(driversOf(model, net).map((d) => exprOut(byId.get(splitPin(d)[0]) as LadderPart)));
  };
  const exprOut = (part: LadderPart): Expr => {
    const lit = (negated = false): Expr => ({ kind: "lit", operand: stlOperand(part.operand ?? ""), negated });
    switch (part.kind) {
      case "power-rail":
        return TRUE;
      case "no":
        return and([exprAt(part, "in"), lit()]);
      case "nc":
        return and([exprAt(part, "in"), lit(true)]);
      case "fbd-in":
        return lit();
      case "fbd-and":
        return and([exprAt(part, "in1"), exprAt(part, "in2")]);
      case "fbd-or":
        return or([exprAt(part, "in1"), exprAt(part, "in2")]);
      case "fbd-not":
        return not(exprAt(part, "in"));
      case "ton":
        return { kind: "lit", operand: tonQ(numberOf(part)), negated: false };
      default:
        // A timer's or counter's box: its Q is the timer's or counter's bit.
        return lit();
    }
  };
  const wired = (part: LadderPart, pin: string) => {
    const net = netOf(model, `${part.id}.${pin}`);
    return net !== undefined && driversOf(model, net).length > 0;
  };

  // One instance DB may serve several calls: declare its temporaries and its DB once.
  const tons = [...new Set(model.parts.filter((p) => p.kind === "ton").map(numberOf))];
  const body: string[] = [];
  for (const { network, parts } of networksOf(model)) {
    body.push("NETWORK", `TITLE = ${network}`);
    for (const part of parts) {
      if (!ELEMENTS[part.kind].acts) continue;
      const operand = part.operand === undefined ? "" : stlOperand(part.operand);
      const params = part.params ?? {};
      const logic = (pin: string) => chain(exprAt(part, pin));
      const timer = TIMER_KIND[part.kind];
      switch (part.kind) {
        case "coil":
        case "fbd-assign":
          body.push(...logic("in"), `= ${operand}`);
          break;
        case "coil-s":
        case "fbd-s":
          body.push(...logic("in"), `S ${operand}`);
          break;
        case "coil-r":
        case "fbd-r":
          body.push(...logic("in"), `R ${operand}`);
          break;
        case "coil-cu":
          body.push(...logic("in"), `CU ${operand}`);
          break;
        case "coil-cd":
          body.push(...logic("in"), `CD ${operand}`);
          break;
        case "coil-sc":
          body.push(...logic("in"), `L ${params.preset ?? ""}`, `S ${operand}`);
          break;
        case "ton": {
          const db = numberOf(part);
          const actuals = [`IN := ${tonIn(db)}`, `PT := ${params.PT ?? ""}`, `Q := ${tonQ(db)}`];
          if (params.ET !== undefined) actuals.push(`ET := ${stlOperand(params.ET)}`);
          body.push(...logic("IN"), `= ${tonIn(db)}`, `CALL SFB 4 , DB ${db} ( ${actuals.join(" , ")} )`);
          break;
        }
        default:
          if (timer && part.kind.startsWith("coil")) {
            body.push(...logic("in"), `L ${params.preset ?? ""}`, `${timer} ${operand}`);
          } else if (timer) {
            body.push(...logic("S"), `L ${params.TV ?? ""}`, `${timer} ${operand}`);
            if (wired(part, "R")) body.push(...logic("R"), `R ${operand}`);
            if (params.BI !== undefined) body.push(`L ${operand}`, `T ${stlOperand(params.BI)}`);
            if (params.BCD !== undefined) body.push(`LC ${operand}`, `T ${stlOperand(params.BCD)}`);
          } else {
            // A counter box: CU, CD, S, R, then the count out, in STEP 7's order.
            if (wired(part, "CU")) body.push(...logic("CU"), `CU ${operand}`);
            if (wired(part, "CD")) body.push(...logic("CD"), `CD ${operand}`);
            if (params.PV !== undefined && wired(part, "S")) body.push(...logic("S"), `L ${params.PV}`, `S ${operand}`);
            if (wired(part, "R")) body.push(...logic("R"), `R ${operand}`);
            if (params.CV !== undefined) body.push(`L ${operand}`, `T ${stlOperand(params.CV)}`);
            if (params.CV_BCD !== undefined) body.push(`LC ${operand}`, `T ${stlOperand(params.CV_BCD)}`);
          }
      }
    }
  }
  const temps = tons.flatMap((db) => [`\t${tonIn(db).slice(1)} : BOOL;`, `\t${tonQ(db).slice(1)} : BOOL;`]);
  return [
    "ORGANIZATION_BLOCK OB 1",
    ...(temps.length > 0 ? ["VAR_TEMP", ...temps, "END_VAR"] : []),
    "BEGIN",
    ...body.map((line) => (line.startsWith("NETWORK") || line.startsWith("TITLE") ? line : `\t${line}`)),
    "END_ORGANIZATION_BLOCK",
    ...tons.flatMap((db) => ["", `DATA_BLOCK DB ${db}`, "\tSFB 4", "BEGIN", "END_DATA_BLOCK"]),
    "",
  ].join("\n");
}
