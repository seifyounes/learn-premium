// Provenance tags: every number a Course's content shows carries its origin, stated (in the
// Materials), derived (worked out, no official key), scaled (measured off a drawing) or assumed
// (supplied by the agent). An entry tags its values in a `provenance` block, writing each one as it
// likes (`0.25`, `$L = 0.250\ \text{m}$`); a value counts as tagged when a list names the same
// number. This module finds every value an entry shows and every one no list tags. Pure: the
// provenance gate and the page both read it.
import { splitProse } from "../math/katex.ts";

export const PROVENANCE_TAGS = ["stated", "derived", "scaled", "assumed"] as const;
export type ProvenanceTag = (typeof PROVENANCE_TAGS)[number];

export interface NumberFound {
  /** As written (without its sign): how a finding names it. */
  written: string;
  /** Its magnitude: the sign belongs to the quantity's direction, not to its origin. */
  value: number;
}

/**
 * A number not glued to a word or another number: "W01.1", "CO2" and "T1" are names. A comma
 * groups thousands only before three digits.
 */
const NUMBER = /(?<![\p{L}\d.])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/gu;

function numbersInText(text: string): NumberFound[] {
  return [...text.matchAll(NUMBER)].map((m) => ({ written: m[0], value: Number(m[0].replace(/,/g, "")) }));
}

/** TeX commands whose argument is notation or layout, never a value: chemistry, tags, spacing. */
const DROPS_ARGUMENT = new Set([
  "ce",
  "tag",
  "label",
  "hspace",
  "vspace",
  "rule",
  "raisebox",
  "phantom",
  "hphantom",
  "vphantom",
]);
/** TeX commands followed by a bare dimension (`\kern3pt`). */
const DROPS_DIMENSION = new Set(["kern", "mkern", "hskip", "mskip"]);
/** Commands whose group belongs to them when they are a sub/superscript's one token (`R_\text{total}`). */
const TAKES_GROUP = /^(?:text\w*|math\w*|operatorname|bold\w*|bm)$/;

/** The index after the balanced `{…}` group starting at `i` (or `i` itself if none starts there). */
function afterGroup(tex: string, i: number): number {
  if (tex[i] !== "{") return i;
  let depth = 0;
  for (let j = i; j < tex.length; j++) {
    if (tex[j] === "\\") j++;
    else if (tex[j] === "{") depth++;
    else if (tex[j] === "}" && --depth === 0) return j + 1;
  }
  return tex.length;
}

const skipSpaces = (tex: string, i: number) => {
  while (tex[i] === " ") i++;
  return i;
};

/** The command at `i` (a backslash): its name and where it ends. */
function command(tex: string, i: number): { name: string; end: number } {
  const name = /^\\([A-Za-z]+|.?)/.exec(tex.slice(i))?.[1] ?? "";
  return { name, end: i + 1 + name.length };
}

/** Where the one token after `_` or `^` ends: a group, a command (with its group), or a character. */
function afterToken(tex: string, i: number): number {
  const start = skipSpaces(tex, i);
  if (tex[start] === "{") return afterGroup(tex, start);
  if (tex[start] === "\\") {
    const { name, end } = command(tex, start);
    return TAKES_GROUP.test(name) ? afterGroup(tex, skipSpaces(tex, end)) : end;
  }
  return start + 1;
}

/**
 * TeX with its notation taken out, so only values keep their digits: subscripts go (`T_1`), and so
 * do powers of a symbol or a unit (`x^2`, `\text{m}^2`); a power of a number (`10^{-3}`) stays,
 * being part of the value. Commands become spaces, so a digit after one isn't read as a name.
 */
function valuesOnly(tex: string): string {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    const ch = tex[i] ?? "";
    if (ch === "\\") {
      const { name, end } = command(tex, i);
      if (DROPS_ARGUMENT.has(name)) {
        i = afterGroup(tex, skipSpaces(tex, end));
        if (name === "raisebox") i = afterGroup(tex, skipSpaces(tex, i));
      } else if (DROPS_DIMENSION.has(name)) {
        i = end + (/^\s*-?[\d.]+\s*[a-z]{2}/.exec(tex.slice(end))?.[0].length ?? 0);
      } else i = end;
      out += " ";
    } else if (ch === "_") {
      i = afterToken(tex, i + 1);
      out += " ";
    } else if (ch === "^") {
      const end = afterToken(tex, i + 1);
      if (/\d\s*$/.test(out)) out += ` ${tex.slice(i + 1, end)} `;
      else out += " ";
      i = end;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Every value in a prose field: its text and its math (`$…$`, `$$…$$`). */
export function numbersIn(prose: string): NumberFound[] {
  const segments = splitProse(prose);
  // Unclosed math is the KaTeX gate's to report; its values still count here.
  if (!Array.isArray(segments)) return numbersInText(prose);
  return segments.flatMap((s) => numbersInText(s.kind === "text" ? s.text : valuesOnly(s.tex)));
}

/** Every value in a Markdown body, leaving out its list numbers and link targets. */
export function numbersInMarkdown(body: string): NumberFound[] {
  const prose = body
    .replace(/^[ \t]*\d+[.)][ \t]/gm, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<!--[\s\S]*?-->/g, "");
  return numbersIn(prose);
}

export interface ValueFound extends NumberFound {
  /** Where it sits in the entry: a field path, e.g. `steps.4.note`. */
  at: string;
}

/** The kinds of entry that show values. */
export type ValueCollection = "worked" | "practice" | "beats" | "rules";

type Raw = Record<string, unknown>;
export const asObject = (value: unknown): Raw => (value && typeof value === "object" ? (value as Raw) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Every value an entry shows, in reading order. It reads the raw entry defensively, so an entry
 * that breaks the content contract still has its values checked. A Summary beat's body is passed
 * apart from its frontmatter.
 */
export function valuesOf(collection: ValueCollection, raw: unknown, body?: string): ValueFound[] {
  const found: ValueFound[] = [];
  const prose = (value: unknown, at: string) => {
    if (typeof value === "string") for (const n of numbersIn(value)) found.push({ ...n, at });
  };
  const quantity = (value: unknown, at: string) => {
    if (typeof value === "number" && Number.isFinite(value))
      found.push({ written: String(Math.abs(value)), value: Math.abs(value), at });
  };
  const labelled = (value: unknown, at: string) => {
    const o = asObject(value);
    prose(o.label, `${at}.label`);
    prose(o.unit, `${at}.unit`);
  };
  const figure = (value: unknown, at: string) => {
    if (value === undefined) return;
    const f = asObject(value);
    prose(f.caption, `${at}.caption`);
    labelled(f.x, `${at}.x`);
    labelled(f.y, `${at}.y`);
    asArray(f.elements).forEach((e, i) => {
      const element = asObject(e);
      const path = `${at}.elements.${i}`;
      prose(element.label, `${path}.label`);
      asArray(element.at).forEach((n) => quantity(n, `${path}.at`));
      quantity(element.x, `${path}.x`);
      asArray(element.through).forEach((point) => asArray(point).forEach((n) => quantity(n, `${path}.through`)));
    });
  };
  const entry = asObject(raw);
  switch (collection) {
    case "worked": {
      prose(entry.title, "title");
      prose(entry.statement, "statement");
      asArray(entry.given).forEach((g, i) => prose(g, `given.${i}`));
      const artefact = asObject(entry.artefact);
      prose(artefact.caption, "artefact.caption");
      asArray(artefact.columns).forEach((c, i) => labelled(c, `artefact.columns.${i}`));
      asArray(artefact.rows).forEach((row, r) =>
        asArray(row).forEach((cell, c) => prose(cell, `artefact.rows.${r}.${c}`)),
      );
      figure(entry.figure, "figure");
      asArray(entry.steps).forEach((s, i) => {
        const step = asObject(s);
        prose(step.title, `steps.${i}.title`);
        prose(step.note, `steps.${i}.note`);
        prose(asObject(step.figure).caption, `steps.${i}.figure.caption`);
      });
      prose(entry.answer, "answer");
      break;
    }
    case "practice": {
      prose(entry.question, "question");
      prose(entry.model, "model");
      asArray(entry.earns).forEach((e, i) => prose(e, `earns.${i}`));
      const answer = asObject(entry.answer);
      quantity(answer.value, "answer.value");
      prose(answer.unit, "answer.unit");
      break;
    }
    case "rules": {
      asArray(entry.rules).forEach((r, i) => {
        const rule = asObject(r);
        prose(rule.name, `rules.${i}.name`);
        prose(rule.formula, `rules.${i}.formula`);
        prose(rule.use, `rules.${i}.use`);
      });
      break;
    }
    case "beats": {
      prose(entry.title, "title");
      figure(entry.figure, "figure");
      if (body !== undefined) for (const n of numbersInMarkdown(body)) found.push({ ...n, at: "body" });
      break;
    }
  }
  return found;
}

/** A value compared by its number: `0.20`, `0.2` and `$L = 0.200$` tag the same value. */
const key = (value: number) => String(value);

/** Every number an entry's `provenance` block declares, whatever it tags it as. */
export function taggedValues(provenance: unknown): Set<string> {
  const p = asObject(provenance);
  const declared = [
    ...PROVENANCE_TAGS.flatMap((tag) => asArray(p[tag])),
    ...asArray(p.slips).flatMap((s) => [asObject(s).value, asObject(s).sheet]),
    ...asArray(p.divergences).flatMap((d) => [asObject(d).value, asObject(d).note]),
  ];
  return new Set(declared.flatMap((d) => (typeof d === "string" ? numbersIn(d).map((n) => key(n.value)) : [])));
}

export interface Untagged {
  written: string;
  /** Every field it sits in, in reading order. */
  at: string[];
}

/** The values an entry shows that no Provenance tag covers, each once. */
export function untagged(collection: ValueCollection, raw: unknown, body?: string): Untagged[] {
  const tagged = taggedValues(asObject(raw).provenance);
  const missing = new Map<string, Untagged>();
  for (const v of valuesOf(collection, raw, body)) {
    if (tagged.has(key(v.value))) continue;
    const entry = missing.get(key(v.value)) ?? { written: v.written, at: [] };
    if (!entry.at.includes(v.at)) entry.at.push(v.at);
    missing.set(key(v.value), entry);
  }
  return [...missing.values()];
}
