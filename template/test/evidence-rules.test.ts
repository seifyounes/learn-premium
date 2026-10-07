import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceShape } from "../gates/evidence.ts";

const TEMPLATE_COPY = resolve(import.meta.dirname, "../gates/evidence.ts");
// In learn-premium's own repo; a Course project carries the template without the skill.
const SKILL_COPY = resolve(import.meta.dirname, "../../skill/scripts/go-public/evidence.ts");

describe("the evidence-shaped path rules", () => {
  it.runIf(existsSync(SKILL_COPY))("are the same file in the deploy gates and the Go-public check", () => {
    expect(readFileSync(TEMPLATE_COPY, "utf8")).toBe(readFileSync(SKILL_COPY, "utf8"));
  });

  it("match the Materials reader's renders and transcriptions, never the site's own files", () => {
    expect(evidenceShape("transcripts/lecture-01.txt")?.rule).toBe("transcription");
    expect(evidenceShape("_astro/page-001.png")?.rule).toBe("page-render");
    expect(evidenceShape("01-thermal-resistance/media/explainer.mp4")).toBeNull();
    expect(evidenceShape("_astro/TranscriptPanel.abc123.js")).toBeNull();
  });

  it("match a Module wave's readings and rulings, wherever they were copied, and nothing else in a waves/ folder", () => {
    for (const file of [
      "reading-a.json",
      "reading-b.json",
      "reading.json",
      "resolutions.json",
      "checkpoint-items.json",
    ])
      expect(evidenceShape(`waves/01/${file}`)?.rule, file).toBe("wave-reading");
    expect(evidenceShape("content/notes/waves/03/reading.json")?.rule).toBe("wave-reading");
    expect(evidenceShape("waves/01/summary.json")).toBeNull();
    expect(evidenceShape("content/modules/01-waves/worked/reading.json")).toBeNull();
  });
});
