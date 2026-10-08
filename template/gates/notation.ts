// The notation lint, per job: every content file is held to the Course style sheet's
// machine-readable part. A symbol written in a variant the style sheet says not to use (in a
// formula), or a unit spelled the way it says not to (in text or a formula), blocks: the writer
// that wrote it fixes it. A Course without a style sheet blocks too, since Module 1's wave writes
// it before any other Module is written.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLLECTIONS, moduleOf } from "../src/content/layout.ts";
import { readStructured, splitFrontmatter } from "../src/content/loaders.ts";
import { STYLE_SHEET_FILE, styleSheet, type StyleSheet } from "../src/content/style-sheet.ts";
import { splitProse } from "../src/math/katex.ts";
import { courseCopy, courseFiles, courseWith, type CourseFile } from "./course-files.ts";
import { problems } from "./sims.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

const ignoreMath = () => {};

/** The Course style sheet, or the finding that says why the lint can't run against it. */
function readStyleSheet(contentDir: string): { sheet: StyleSheet } | { finding: Finding } {
  const path = join(contentDir, STYLE_SHEET_FILE);
  const block = (message: string) => ({ finding: { outcome: "block" as const, at: STYLE_SHEET_FILE, message } });
  if (!existsSync(path)) {
    return block(
      `no Course style sheet: Module 1's wave writes ${STYLE_SHEET_FILE} (the Professor's notation, units, table forms and voice) before any other Module is written`,
    );
  }
  let raw: unknown;
  try {
    raw = readStructured(readFileSync(path, "utf8"), STYLE_SHEET_FILE, ignoreMath);
  } catch (error) {
    return block(`can't read the Course style sheet: ${(error as Error).message}`);
  }
  const parsed = styleSheet.safeParse(raw);
  return parsed.success
    ? { sheet: parsed.data }
    : block(`the Course style sheet breaks its contract: ${problems(parsed.error)}`);
}

/** Every string an entry holds, with the field it sits in (`steps.2.note`). */
function stringsIn(value: unknown, at: string[] = []): { at: string; text: string }[] {
  if (typeof value === "string") return [{ at: at.join(".") || "(file)", text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringsIn(v, [...at, String(i)]));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, v]) => stringsIn(v, [...at, key]));
  return [];
}

/** A content file's strings: its fields, and a Markdown file's body. */
function entryStrings(file: CourseFile): { at: string; text: string }[] {
  const source = readFileSync(file.path, "utf8");
  if (COLLECTIONS[file.collection].format === "structured")
    return stringsIn(readStructured(source, file.entry, ignoreMath));
  const { frontmatter, body } = splitFrontmatter(source);
  const fields = frontmatter === undefined ? [] : stringsIn(readStructured(frontmatter, file.entry, ignoreMath));
  return [...fields, { at: "body", text: body }];
}

const LETTER = /\p{L}/u;
const isLetter = (c: string | undefined) => c !== undefined && LETTER.test(c);

/**
 * Whether `variant` occurs in `text` as a whole token: not glued to a letter on either side, and,
 * when it starts with a letter, not the tail of a TeX command (`\quad` holds no `q`).
 */
function occurs(text: string, variant: string): boolean {
  for (let at = text.indexOf(variant); at !== -1; at = text.indexOf(variant, at + 1)) {
    const before = text[at - 1];
    const after = text[at + variant.length];
    if (isLetter(variant[0]) && (isLetter(before) || before === "\\")) continue;
    if (isLetter(variant.at(-1)) && isLetter(after)) continue;
    return true;
  }
  return false;
}

/** The formulas in a prose string; none when its math is unclosed (the KaTeX gate reports that). */
function formulasIn(text: string): string[] {
  const segments = splitProse(text);
  return Array.isArray(segments) ? segments.flatMap((s) => (s.kind === "math" ? [s.tex] : [])) : [];
}

/** Every place `strings` break the style sheet's notation or units, one finding per field and variant. */
function lint(entry: string, strings: { at: string; text: string }[], sheet: StyleSheet): Finding[] {
  const found = new Map<string, Finding>();
  const block = (at: string, message: string) => {
    const where = `${entry} (${at})`;
    found.set(`${where}\n${message}`, { outcome: "block", at: where, message });
  };
  for (const { at, text } of strings) {
    const formulas = formulasIn(text);
    for (const symbol of sheet.notation) {
      for (const variant of symbol.not) {
        if (formulas.some((tex) => occurs(tex, variant)))
          block(at, `writes ${variant} for ${symbol.means}; the Course style sheet writes ${symbol.write}`);
      }
    }
    for (const unit of sheet.units) {
      for (const variant of unit.not) {
        if (occurs(text, variant)) block(at, `writes the unit ${variant}; the Course style sheet writes ${unit.write}`);
      }
    }
  }
  return [...found.values()];
}

/** The first `not` variant of a style sheet list, for a negative control to plant. */
function firstVariant(input: GateInput, list: "notation" | "units"): string {
  const read = readStyleSheet(input.contentDir);
  if ("finding" in read) throw new Error(read.finding.message);
  const variant = read.sheet[list].flatMap((rule) => rule.not)[0];
  if (variant === undefined) throw new Error(`the style sheet's ${list} names no variant to plant`);
  return variant;
}

export const notationGate: Gate = {
  id: "notation",
  checks:
    "every content file writes the Course style sheet's notation and units (its machine-readable part), and the Course has a style sheet",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    // No Module in scope (a Module that doesn't exist, or a Course with none yet, whose style sheet
    // Module 1's wave hasn't written): the gate covered nothing.
    if (!files.some((f) => moduleOf(f.entry) !== undefined))
      return { coverage: { entries: 0, styleSheetRules: 0 }, findings: [] };
    const read = readStyleSheet(input.contentDir);
    if ("finding" in read) return { coverage: { entries: files.length, styleSheetRules: 0 }, findings: [read.finding] };
    const { sheet } = read;
    const findings: Finding[] = [];
    for (const file of files) {
      let strings;
      try {
        strings = entryStrings(file);
      } catch (error) {
        findings.push({
          outcome: "block",
          at: file.entry,
          message: `can't read the file, so its notation can't be checked: ${(error as Error).message}`,
        });
        continue;
      }
      findings.push(...lint(file.entry, strings, sheet));
    }
    const styleSheetRules = sheet.notation.length + sheet.units.length;
    return { coverage: { entries: files.length, styleSheetRules }, findings };
  },
  controls: [
    {
      defect: "a Summary beat writing a symbol the way the style sheet says not to",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "summary/900.md": `---\ntitle: Planted defect\n---\n\nThe planted symbol $${firstVariant(good, "notation")}$ here.\n`,
        }),
    },
    {
      defect: "a Practice item spelling a unit the way the style sheet says not to",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "practice/900.json": JSON.stringify({
            kind: "numeric",
            question: `Planted: a value of 1 ${firstVariant(good, "units")}.`,
            answer: { value: 1, unit: "K", tolerance: 0 },
            model: "One.",
          }),
        }),
    },
    {
      defect: "a Course with no style sheet",
      plant: (good, scratch) => {
        const copy = courseCopy(good, scratch);
        rmSync(join(copy.contentDir, STYLE_SHEET_FILE), { force: true });
        return copy;
      },
    },
    {
      defect: "a style sheet whose machine-readable part pins no symbol",
      plant: (good, scratch) => {
        const copy = courseCopy(good, scratch);
        writeFileSync(
          join(copy.contentDir, STYLE_SHEET_FILE),
          "writtenFrom: 01-planted\nvoice: Planted.\nnotation: []\n",
        );
        return copy;
      },
    },
  ],
};
