// The Owner's rulings a Course's content carries: each Slip (the sheet's value, which the site
// corrects) and each Divergence (the Professor's value, which the site ships) in an entry's
// `provenance` block. The Module wave's merge gate (`skill/scripts/wave`) holds every one to a stored
// Owner answer, so no writer can rule on the Professor's numbers alone. Read here because the
// content is YAML or JSON and the skill's scripts carry no parser.
import { readFileSync } from "node:fs";
import { COLLECTIONS } from "../src/content/layout.ts";
import { readStructured, splitFrontmatter } from "../src/content/loaders.ts";
import { asObject } from "../src/provenance/values.ts";
import { rulingValues } from "../src/sims/precision.ts";
import { courseFiles } from "./course-files.ts";
import type { GateInput } from "./runner.ts";

export interface ContentRuling {
  /** The content file, relative to the content folder. */
  entry: string;
  kind: "slip" | "divergence";
  /** The magnitudes of the sheet's value it rules on: a Slip's `sheet`, a Divergence's `value`. */
  printed: number[];
  /** A Worked example's Slip: the sheet cell it corrects. */
  cell?: string;
}

export function rulingsIn(input: GateInput): ContentRuling[] {
  const found: ContentRuling[] = [];
  for (const file of courseFiles(input)) {
    const source = readFileSync(file.path, "utf8");
    const structured =
      COLLECTIONS[file.collection].format === "structured" ? source : (splitFrontmatter(source).frontmatter ?? "");
    const provenance = asObject(asObject(readStructured(structured, file.entry, () => {})).provenance);
    const list = (key: string) => (Array.isArray(provenance[key]) ? (provenance[key] as unknown[]) : []);
    const numbers = (text: unknown) => (typeof text === "string" ? rulingValues(text) : []);
    for (const slip of list("slips")) {
      const { sheet, cell } = asObject(slip);
      found.push({
        entry: file.entry,
        kind: "slip",
        printed: numbers(sheet),
        ...(typeof cell === "string" ? { cell } : {}),
      });
    }
    for (const divergence of list("divergences"))
      found.push({ entry: file.entry, kind: "divergence", printed: numbers(asObject(divergence).value) });
  }
  return found;
}
