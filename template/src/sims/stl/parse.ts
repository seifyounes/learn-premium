// Reads a Professor's STL listing, as STEP 7 writes its source: one ORGANIZATION_BLOCK OB 1, its
// networks between BEGIN and END_ORGANIZATION_BLOCK, a statement a line, `//` comments, labels of up
// to four characters, and a CALL's parameters one `NAME :=actual` per line below it, as the editor
// prints them. Every statement keeps the line it sits on, so the trace marks the listing itself.
//
// Parsing never decides what runs: an instruction the interpreter lacks is still a statement, and
// `unsupported` (in `instructions.ts`) names it, so the listing ships as a step-through instead.

import { parseAddress, type Address, type Width } from "../s7/memory.ts";
import { realToBits } from "../s7/numbers.ts";

/** A status-word condition read as a bit: `A OV`, `O ==0`, `AN UO`. */
export const CONDITIONS = ["OV", "OS", "BR", "==0", "<>0", ">0", "<0", ">=0", "<=0", "UO"] as const;
export type Condition = (typeof CONDITIONS)[number];

export type ConstantType = "INT" | "DINT" | "WORD" | "DWORD" | "BYTE" | "REAL" | "POINTER";

export type Operand =
  | { kind: "none" }
  | { kind: "address"; address: Address }
  /** Area-internal register-indirect: `MW [AR1,P#2.0]`, the address AR 1 + the offset, in bits. */
  | { kind: "indirect"; area: Address["area"]; width: Width; offset: number }
  | { kind: "condition"; condition: Condition }
  | { kind: "constant"; type: ConstantType; pattern: number }
  | { kind: "label"; name: string }
  | { kind: "block"; number: number }
  | { kind: "unknown"; text: string };

export interface Statement {
  /** Its place among the statements, 0 first. */
  index: number;
  /** The line it starts on, 0 first, and the line it ends on (a CALL's last parameter). */
  line: number;
  lastLine: number;
  label?: string;
  /** The mnemonic, upper case: `A`, `A(`, `)`, `+I`, `==R`, `CALL`. */
  op: string;
  /** The operand as written, comment stripped; empty when there is none. */
  text: string;
  operand: Operand;
  /** A CALL's parameters, by name, each with its actual operand as written. */
  params?: Record<string, string>;
  /** The block end the CPU runs at END_ORGANIZATION_BLOCK, which the listing doesn't write. */
  implicit?: true;
}

export interface Program {
  lines: string[];
  statements: Statement[];
  /** Each label's statement index. */
  labels: Record<string, number>;
}

export class ListingError extends Error {
  /** The line, 0 first. */
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${line + 1}: ${message}`);
    this.line = line;
  }
}

const code = (line: string) => line.replace(/\/\/.*$/, "").trim();

export function parseStl(source: string): Program {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const statements: Statement[] = [];
  const labels: Record<string, number> = {};
  let state: "before" | "head" | "body" | "after" = "before";
  for (let i = 0; i < lines.length; i++) {
    const text = code(lines[i] ?? "");
    if (!text) continue;
    if (state === "before") {
      if (!/^ORGANIZATION_BLOCK\s+(OB\s*1|"[^"]*")$/i.test(text))
        throw new ListingError(`a listing is one ORGANIZATION_BLOCK OB 1 in STEP 7 source form, not "${text}"`, i);
      state = "head";
      continue;
    }
    if (state === "head") {
      if (/^BEGIN$/i.test(text)) state = "body";
      else if (!/^(TITLE\s*=|VERSION\s*:|AUTHOR\s*:|FAMILY\s*:|NAME\s*:|\{)/i.test(text))
        throw new ListingError(`OB 1 has no declarations here (VAR_TEMP isn't read): "${text}"`, i);
      continue;
    }
    if (state === "after") throw new ListingError(`nothing follows END_ORGANIZATION_BLOCK: "${text}"`, i);
    if (/^END_ORGANIZATION_BLOCK$/i.test(text)) {
      statements.push({
        index: statements.length,
        line: i,
        lastLine: i,
        op: "BE",
        text: "",
        operand: { kind: "none" },
        implicit: true,
      });
      state = "after";
      continue;
    }
    if (/^NETWORK$/i.test(text) || /^TITLE\s*=/i.test(text)) continue;

    let body = text;
    let label: string | undefined;
    const labelled = /^([A-Za-z_][A-Za-z0-9_]{0,3})\s*:(?!=)\s*(.*)$/.exec(body);
    if (labelled) {
      label = labelled[1]?.toUpperCase();
      body = labelled[2] ?? "";
      if (label && label in labels) throw new ListingError(`the label ${label} is used twice`, i);
      if (label) labels[label] = statements.length;
      if (!body) throw new ListingError(`the label ${label} marks no statement`, i);
    }
    const [opText = "", ...rest] = body.split(/\s+/);
    const op = opText.toUpperCase();
    const operandText = rest.join(" ");
    const statement: Statement = {
      index: statements.length,
      line: i,
      lastLine: i,
      op,
      text: operandText,
      operand: decodeOperand(op, operandText),
      ...(label ? { label } : {}),
    };
    if (op === "CALL") {
      const params: Record<string, string> = {};
      while (i + 1 < lines.length) {
        const param = /^([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+)$/.exec(code(lines[i + 1] ?? ""));
        if (!param) break;
        params[(param[1] ?? "").toUpperCase()] = (param[2] ?? "").trim();
        i++;
        statement.lastLine = i;
      }
      statement.params = params;
    }
    statements.push(statement);
  }
  if (state !== "after") throw new ListingError("the listing never reaches END_ORGANIZATION_BLOCK", lines.length - 1);
  for (const s of statements) {
    if (s.operand.kind === "label" && !(s.operand.name in labels))
      throw new ListingError(`${s.op} jumps to ${s.operand.name}, which no statement is labelled`, s.line);
  }
  return { lines, statements, labels };
}

/** The mnemonics whose operand is a jump label. */
export const JUMPS = new Set([
  "JU",
  "JC",
  "JCN",
  "JCB",
  "JNB",
  "JBI",
  "JNBI",
  "JO",
  "JOS",
  "JZ",
  "JN",
  "JP",
  "JM",
  "JPZ",
  "JMZ",
  "JUO",
  "LOOP",
]);

export function decodeOperand(op: string, text: string): Operand {
  const t = text.trim();
  if (!t) return { kind: "none" };
  if (JUMPS.has(op))
    return /^[A-Za-z_][A-Za-z0-9_]{0,3}$/.test(t)
      ? { kind: "label", name: t.toUpperCase() }
      : { kind: "unknown", text: t };
  if (op === "CALL") {
    const block = /^FC\s*(\d+)$/i.exec(t);
    return block ? { kind: "block", number: Number(block[1]) } : { kind: "unknown", text: t };
  }
  const upper = t.toUpperCase();
  if ((CONDITIONS as readonly string[]).includes(upper)) return { kind: "condition", condition: upper as Condition };
  const address = parseAddress(t);
  if (address) return { kind: "address", address };
  const indirect = /^(I|Q|M)(B|W|D)?\s*\[\s*AR1\s*,\s*P#(\d+)\.([0-7])\s*\]$/i.exec(t);
  if (indirect) {
    const [, area = "", size, byte = "0", bit = "0"] = indirect;
    const width: Width = size
      ? ({ B: "byte", W: "word", D: "dword" } as const)[size.toUpperCase() as "B" | "W" | "D"]
      : "bit";
    return {
      kind: "indirect",
      area: area.toUpperCase() as Address["area"],
      width,
      offset: Number(byte) * 8 + Number(bit),
    };
  }
  const constant = decodeConstant(t);
  return constant ? { kind: "constant", ...constant } : { kind: "unknown", text: t };
}

/** A constant as STEP 7 writes one, with the pattern it loads. */
export function decodeConstant(text: string): { type: ConstantType; pattern: number } | undefined {
  const t = text.replace(/\s+/g, "");
  let m: RegExpExecArray | null;
  if ((m = /^[+-]?\d+$/.exec(t))) {
    const v = Number(m[0]);
    return v >= -32768 && v <= 32767 ? { type: "INT", pattern: v & 0xffff } : undefined;
  }
  if ((m = /^L#([+-]?\d+)$/i.exec(t))) {
    const v = Number(m[1]);
    return v >= -2147483648 && v <= 2147483647 ? { type: "DINT", pattern: v >>> 0 } : undefined;
  }
  if ((m = /^B#16#([0-9A-F]{1,2})$/i.exec(t))) return { type: "BYTE", pattern: parseInt(m[1] ?? "", 16) };
  if ((m = /^W#16#([0-9A-F]{1,4})$/i.exec(t))) return { type: "WORD", pattern: parseInt(m[1] ?? "", 16) };
  if ((m = /^DW#16#([0-9A-F]{1,8})$/i.exec(t))) return { type: "DWORD", pattern: parseInt(m[1] ?? "", 16) >>> 0 };
  if ((m = /^2#([01_]{1,19})$/.exec(t)) && (m[1] ?? "").replace(/_/g, "").length <= 16)
    return { type: "WORD", pattern: parseInt((m[1] ?? "").replace(/_/g, ""), 2) };
  if ((m = /^P#(\d+)\.([0-7])$/i.exec(t))) return { type: "POINTER", pattern: Number(m[1]) * 8 + Number(m[2]) };
  if (/^[+-]?(\d+\.\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) || /^[+-]?\d+e[+-]?\d+$/i.test(t))
    return { type: "REAL", pattern: realToBits(Number(t)) };
  return undefined;
}
