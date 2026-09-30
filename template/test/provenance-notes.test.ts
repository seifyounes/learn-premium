import { describe, expect, it } from "vitest";
import { provenance } from "../src/content/contract.ts";
import { provenanceNotes } from "../src/provenance/notes.ts";

/** Stands in for the paper-math step: marks what it rendered. */
const html = (prose: string) => `<m>${prose}</m>`;
const notes = (block: unknown) => provenanceNotes(provenance.parse(block), html);

describe("the provenance notes an entry shows", () => {
  it("shows nothing for values the Materials state", () => {
    expect(notes({ stated: ["0.25", "600"] })).toEqual({ inputsHtml: "", outputsHtml: "" });
  });

  it("shows scaled and assumed values with the question, each saying so", () => {
    const { inputsHtml, outputsHtml } = notes({ scaled: ["$L = 0.05$"], assumed: ["$h = 10$", "$T = 20$"] });
    expect(outputsHtml).toBe("");
    expect(inputsHtml).toContain('<dt class="field-label">Scaled</dt>');
    expect(inputsHtml).toContain("measured off a drawing");
    expect(inputsHtml).toContain("<m>$L = 0.05$</m>");
    expect(inputsHtml).toContain('<dt class="field-label">Assumed</dt>');
    expect(inputsHtml).toMatch(/<m>\$h = 10\$<\/m>.*<m>\$T = 20\$<\/m>/);
  });

  it("shows derived values with the answer", () => {
    const { inputsHtml, outputsHtml } = notes({ derived: ["$R = 0.04$"] });
    expect(inputsHtml).toBe("");
    expect(outputsHtml).toContain('<dt class="field-label">Derived</dt>');
    expect(outputsHtml).toContain("no official key");
    expect(outputsHtml).toContain("<m>$R = 0.04$</m>");
  });

  it("shows a Slip with both values, the sheet's struck through in red pen", () => {
    const { outputsHtml } = notes({ slips: [{ value: "$1.54$", sheet: "$1.45$", note: "Two digits swapped." }] });
    expect(outputsHtml).toContain('<dt class="field-label">Slip</dt>');
    expect(outputsHtml).toContain('<span class="correction-lead">Correction.</span>');
    expect(outputsHtml).toContain('<s class="pen-strike"><m>$1.45$</m></s>');
    expect(outputsHtml).toContain("<m>$1.54$</m>");
    expect(outputsHtml).toContain("<m>Two digits swapped.</m>");
  });

  it("shows a Divergence with the Professor's value as the exam answer, and its note", () => {
    const { outputsHtml } = notes({ divergences: [{ value: "$9.6$", note: "A real wall loses more." }] });
    expect(outputsHtml).toContain('<dt class="field-label">Divergence</dt>');
    expect(outputsHtml).toMatch(/exam answer is <m>\$9\.6\$<\/m>, the Professor's/);
    expect(outputsHtml).toContain("<m>A real wall loses more.</m>");
  });
});
