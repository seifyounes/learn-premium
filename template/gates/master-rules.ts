// The Master Rules gate, per job: Master Rules is reference only, set as paper math. A rule that
// divides with a bare `/` (outside a `\text{…}` unit) blocks, since every fraction on the sheet is
// stacked: anywhere in its formula, and in the math of its name and use line and of the
// provenance notes printed under the rules. So does an emoji anywhere in any of them.
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { splitProse } from "../src/math/katex.ts";
import { asObject } from "../src/provenance/values.ts";
import { courseFiles, courseWith } from "./course-files.ts";
import type { Finding, Gate } from "./runner.ts";

const ignoreMath = () => {};

/** TeX groups that hold words or units, where a `/` reads as "per" (`\text{K/W}`). */
const WORDS = /\\(?:text\w*|mathrm|operatorname)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g;

/**
 * Where prose divides with a bare `/`: in its math outside words and units, and, unless `mathOnly`
 * (a name or use line, where a `/` in words reads as "or"), in its text.
 */
export function bareSlashes(prose: string, mathOnly = false): string[] {
  const segments = splitProse(prose);
  // Unclosed math is the KaTeX gate's to report; the whole field is checked as text.
  if (!Array.isArray(segments)) return !mathOnly && prose.includes("/") ? [prose] : [];
  return segments.flatMap((s) => {
    if (s.kind === "text") return !mathOnly && s.text.includes("/") ? [s.text.trim()] : [];
    return s.tex.replace(WORDS, "").includes("/") ? [`$${s.tex}$`] : [];
  });
}

/**
 * Emoji: pictographs drawn as emoji by default or by the emoji selector (U+FE0F, so a plain
 * copyright sign or arrow isn't one), flags (regional indicators) and keycaps (U+20E3).
 */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}|\u20E3/u;

export const hasEmoji = (text: string) => EMOJI.test(text);

/**
 * The provenance prose Master Rules prints under a Module's rules (`provenanceNotes`): scaled,
 * assumed and derived values, Slips and Divergences. Stated values are never printed.
 */
export function renderedNotes(provenance: unknown): { at: string; text: string }[] {
  const p = asObject(provenance);
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const notes: { at: string; text: unknown }[] = [
    ...(["scaled", "assumed", "derived"] as const).flatMap((tag) =>
      list(p[tag]).map((text, i) => ({ at: `provenance.${tag}.${i}`, text })),
    ),
    ...list(p.slips).flatMap((slip, i) =>
      (["value", "sheet", "note"] as const).map((key) => ({
        at: `provenance.slips.${i}.${key}`,
        text: asObject(slip)[key],
      })),
    ),
    ...list(p.divergences).flatMap((divergence, i) =>
      (["value", "note"] as const).map((key) => ({
        at: `provenance.divergences.${i}.${key}`,
        text: asObject(divergence)[key],
      })),
    ),
  ];
  return notes.flatMap((n) => (typeof n.text === "string" ? [{ at: n.at, text: n.text }] : []));
}

export const masterRules: Gate = {
  id: "master-rules",
  checks: "every rule is set with stacked fractions (no bare /) and carries no emoji",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const rules = files.filter((f) => f.collection === "rules");
    const modules = new Set(files.map((f) => moduleOf(f.entry)).filter((m) => m !== undefined && MODULE_ID.test(m)));
    const coverage = { modules: modules.size, files: rules.length, rules: 0 };
    const findings: Finding[] = [];
    for (const file of rules) {
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      let raw: unknown;
      try {
        raw = readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
      } catch (error) {
        block(`can't read the rules, so they can't be checked: ${(error as Error).message}`);
        continue;
      }
      const list = asObject(raw).rules;
      (Array.isArray(list) ? list : []).forEach((value, i) => {
        coverage.rules += 1;
        const rule = asObject(value);
        for (const field of ["name", "formula", "use"] as const) {
          const text = rule[field];
          if (typeof text !== "string") continue;
          for (const slash of bareSlashes(text, field !== "formula"))
            block(`rules.${i}.${field} divides with a bare / in ${slash}: write the fraction stacked, \\frac{…}{…}`);
          if (hasEmoji(text)) block(`rules.${i}.${field} has an emoji: Master Rules is plain reference`);
        }
      });
      // The notes print as prose beside the rules: a / in their words reads as "per" or "or".
      for (const { at, text } of renderedNotes(asObject(raw).provenance)) {
        for (const slash of bareSlashes(text, true))
          block(`${at} divides with a bare / in ${slash}: write the fraction stacked, \\frac{…}{…}`);
        if (hasEmoji(text)) block(`${at} has an emoji: Master Rules is plain reference`);
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a derived value under the rules that divides with a bare /",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "rules.yaml": [
            "rules:",
            "  - name: Planted defect",
            "    formula: '$q = \\frac{\\dot{Q}}{A}$'",
            "provenance:",
            "  derived: ['$q = \\dot{Q}/A$']",
            "",
          ].join("\n"),
        }),
    },
    {
      defect: "a rule that divides with a bare /",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "rules.yaml": "rules:\n  - name: Planted defect\n    formula: '$\\dot{Q} = \\Delta T / R$'\n",
        }),
    },
    {
      defect: "a rule with a flag emoji",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "rules.yaml": "rules:\n  - name: Planted defect 🇪🇬\n    formula: '$R = \\frac{L}{k A}$'\n",
        }),
    },
    {
      defect: "a rule with an emoji",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "rules.yaml": "rules:\n  - name: Planted defect 🔥\n    formula: '$R = \\frac{L}{k A}$'\n",
        }),
    },
  ],
};
