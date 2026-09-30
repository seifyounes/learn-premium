// The content gates, per job: the content contract (Zod) and KaTeX with throwOnError. Both read a
// Course's files the way the build does, but collect every finding instead of stopping at the first.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { MODULE_ID } from "../src/content/contract.ts";
import { COLLECTIONS } from "../src/content/layout.ts";
import { readStructured, splitFrontmatter } from "../src/content/loaders.ts";
import { where, type MathError } from "../src/math/katex.ts";
import { paperMathProcessor } from "../src/math/markdown.ts";
import { courseFiles, courseWith, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateRun } from "./runner.ts";

const ignoreMath = () => {};

/** A file's data, or the finding that says why it can't be read. */
function readData(file: CourseFile): { data: unknown } | { finding: Finding } {
  const source = readFileSync(file.path, "utf8");
  try {
    if (COLLECTIONS[file.collection].format === "structured")
      return { data: readStructured(source, file.entry, ignoreMath) };
    const { frontmatter } = splitFrontmatter(source);
    return { data: frontmatter === undefined ? {} : readStructured(frontmatter, file.entry, ignoreMath) };
  } catch (error) {
    return { finding: { outcome: "block", at: file.entry, message: (error as Error).message } };
  }
}

export const contentContract: Gate = {
  id: "content-contract",
  checks: "every content file keeps the content contract (the Zod schemas)",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage: GateRun["coverage"] = {};
    const findings: Finding[] = [];
    if (input.module === undefined && !existsSync(join(input.contentDir, "course.yaml"))) {
      findings.push({ outcome: "block", at: "course.yaml", message: "the Course has no course.yaml" });
    }
    for (const file of files) {
      coverage[file.collection] = (coverage[file.collection] ?? 0) + 1;
      const folder = /^modules\/([^/]+)\//.exec(file.entry)?.[1];
      if (folder !== undefined && !MODULE_ID.test(folder)) {
        findings.push({
          outcome: "block",
          at: file.entry,
          message: `Module folder "${folder}" must be named NN-slug, e.g. 01-thermal-resistance`,
        });
      }
      const read = readData(file);
      if ("finding" in read) {
        findings.push(read.finding);
        continue;
      }
      const parsed = COLLECTIONS[file.collection].schema.safeParse(read.data);
      for (const issue of parsed.error?.issues ?? []) {
        findings.push({
          outcome: "block",
          at: file.entry,
          message: `${issue.path.join(".") || "(file)"}: ${issue.message}`,
        });
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a Worked example whose solving-table row is missing a cell",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "worked/900.json": JSON.stringify({
            code: "W00.1",
            title: "Planted defect",
            statement: "A two-column table.",
            table: { caption: "Two columns", columns: [{ label: "a" }, { label: "b" }], rows: [["1"]] },
            answer: "one",
          }),
        }),
    },
    {
      defect: "a Practice item with no answer",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "practice/900.yaml": "question: What is planted here?\nmodel: Nothing.\n",
        }),
    },
  ],
};

export const katexGate: Gate = {
  id: "katex",
  checks: "every formula renders through KaTeX with throwOnError (mhchem included)",
  points: ["job", "deploy"],
  async run(input) {
    const findings: Finding[] = [];
    let formulas = 0;
    const onFormula = (error: MathError | undefined) => {
      formulas += 1;
      if (error) {
        const at = { ...error.at, file: relative(input.contentDir, error.at.file).replace(/\\/g, "/") };
        findings.push({ outcome: "block", at: where(at), message: `bad LaTeX: ${error.reason}; in: ${error.tex}` });
      }
    };
    const markdown = await paperMathProcessor({ onFormula }).createRenderer({ syntaxHighlight: false });
    const files = courseFiles(input);
    for (const file of files) {
      const source = readFileSync(file.path, "utf8");
      // Paths in errors are absolute here and made content-relative in `onFormula`.
      try {
        if (COLLECTIONS[file.collection].format === "structured") {
          readStructured(source, file.path, onFormula);
          continue;
        }
        const { frontmatter, body } = splitFrontmatter(source);
        if (frontmatter !== undefined) readStructured(frontmatter, file.path, onFormula);
        await markdown.render(body, { fileURL: pathToFileURL(file.path) });
      } catch (error) {
        findings.push({
          outcome: "block",
          at: file.entry,
          message: `can't read the file: ${(error as Error).message}`,
        });
      }
    }
    return { coverage: { files: files.length, formulas }, findings };
  },
  controls: [
    {
      defect: "an undefined control sequence in a YAML field",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "practice/900.yaml": [
            "question: 'Planted: a wall at $600\\ \\txet{K}$.'",
            "answer: { value: 1, unit: K, tolerance: 0 }",
            "model: One.",
            "",
          ].join("\n"),
        }),
    },
    {
      defect: "an unclosed brace in a Summary beat (Markdown)",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "summary/900.md": "---\ntitle: Planted defect\n---\n\nA thicker wall (larger $\\frac{L$) resists more.\n",
        }),
    },
  ],
};
