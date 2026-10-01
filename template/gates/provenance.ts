// The provenance gate, per job: every number a Worked example, Practice item, Summary beat or rule
// shows carries a Provenance tag (stated, derived, scaled or assumed), so nothing on the page is of
// unknown origin. A value no list in the entry's `provenance` block names blocks.
import { readFileSync } from "node:fs";
import { COLLECTIONS } from "../src/content/layout.ts";
import { readStructured, splitFrontmatter } from "../src/content/loaders.ts";
import { untagged, valuesOf, type ValueCollection } from "../src/provenance/values.ts";
import { courseFiles, courseWith } from "./course-files.ts";
import type { Finding, Gate } from "./runner.ts";

const ignoreMath = () => {};
const TAGGED: readonly ValueCollection[] = ["worked", "practice", "beats", "rules"];
const isTagged = (collection: string): collection is ValueCollection =>
  (TAGGED as readonly string[]).includes(collection);

export const provenanceGate: Gate = {
  id: "provenance",
  checks: "every number a Worked example, Practice item, Summary beat or rule shows carries a Provenance tag",
  points: ["job", "deploy"],
  async run(input) {
    const coverage = { entries: 0, values: 0 };
    const findings: Finding[] = [];
    for (const file of courseFiles(input)) {
      const { collection } = file;
      if (!isTagged(collection)) continue;
      coverage.entries += 1;
      const source = readFileSync(file.path, "utf8");
      let raw: unknown;
      let body: string | undefined;
      try {
        if (COLLECTIONS[collection].format === "markdown") {
          const split = splitFrontmatter(source);
          raw = split.frontmatter === undefined ? {} : readStructured(split.frontmatter, file.entry, ignoreMath);
          body = split.body;
        } else raw = readStructured(source, file.entry, ignoreMath);
      } catch (error) {
        findings.push({
          outcome: "block",
          at: file.entry,
          message: `can't read the entry, so its values can't be checked: ${(error as Error).message}`,
        });
        continue;
      }
      coverage.values += valuesOf(collection, raw, body).length;
      for (const { written, at } of untagged(collection, raw, body)) {
        findings.push({
          outcome: "block",
          at: file.entry,
          message: `${written} (in ${at.join(", ")}) carries no Provenance tag: list it under provenance as stated, derived, scaled or assumed`,
        });
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a Practice item whose answer no provenance list tags",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "practice/900.yaml": [
            "kind: numeric",
            "question: 'Planted: a $2\\ \\text{m}$ bar at $3\\ \\text{K}$ per metre. Find the drop.'",
            "answer: { value: 6, unit: K, tolerance: 0 }",
            "model: 'The drop is the product.'",
            "provenance: { stated: ['2', '3'] }",
            "",
          ].join("\n"),
        }),
    },
    {
      defect: "a Summary beat with an untagged number inside a formula",
      plant: (good, scratch) =>
        courseWith(good, scratch, {
          "summary/900.md": "---\ntitle: Planted defect\n---\n\nA wall of $R = 0.5\\ \\text{K/W}$ resists.\n",
        }),
    },
  ],
};
