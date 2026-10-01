// The Master Rules gate, per job: Master Rules is reference only, set as paper math. A rule whose
// formula divides with a bare `/` (outside a `\text{…}` unit) blocks, since every fraction on the
// sheet is stacked; so does an emoji anywhere in a rule.
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { splitProse } from "../src/math/katex.ts";
import { courseFiles, courseWith } from "./course-files.ts";
import type { Finding, Gate } from "./runner.ts";

const ignoreMath = () => {};

/** TeX groups that hold words or units, where a `/` reads as "per" (`\text{K/W}`). */
const WORDS = /\\(?:text\w*|mathrm|operatorname)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g;

/** Where a formula divides with a bare `/`: in its math outside words and units, or in its text. */
export function bareSlashes(formula: string): string[] {
  const segments = splitProse(formula);
  // Unclosed math is the KaTeX gate's to report; the whole formula is checked as text.
  if (!Array.isArray(segments)) return formula.includes("/") ? [formula] : [];
  return segments.flatMap((s) => {
    const text = s.kind === "text" ? s.text : s.tex.replace(WORDS, "");
    return text.includes("/") ? [s.kind === "text" ? s.text.trim() : `$${s.tex}$`] : [];
  });
}

const EMOJI = /\p{Extended_Pictographic}/u;

type Raw = Record<string, unknown>;
const asObject = (value: unknown): Raw => (value && typeof value === "object" ? (value as Raw) : {});

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
        if (typeof rule.formula === "string") {
          for (const slash of bareSlashes(rule.formula))
            block(`rules.${i}.formula divides with a bare / in ${slash}: write the fraction stacked, \\frac{…}{…}`);
        }
        for (const field of ["name", "formula", "use"] as const) {
          const text = rule[field];
          if (typeof text === "string" && EMOJI.test(text))
            block(`rules.${i}.${field} has an emoji: Master Rules is plain reference`);
        }
      });
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a rule that divides with a bare /",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "rules.yaml": "rules:\n  - name: Planted defect\n    formula: '$\\dot{Q} = \\Delta T / R$'\n",
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
