// What the page says about where values come from. Stated values need no word; derived, scaled
// and assumed values say so, a Slip shows both values and a Divergence its note (CONTEXT.md).
// Scaled and assumed values are inputs, shown with the question; derived values, Slips and
// Divergences are results, shown with the answer, so they never give it away early.
import type { z } from "astro/zod";
import type { provenance } from "../content/contract.ts";

export type Provenance = z.output<typeof provenance>;

export interface ProvenanceNotes {
  /** Scaled and assumed values: shown with the question. "" when there are none. */
  inputsHtml: string;
  /** Derived values, Slips and Divergences: shown with the answer. "" when there are none. */
  outputsHtml: string;
}

const row = (label: string, body: string, kind?: string) =>
  `<div class="provenance-row"${kind ? ` data-kind="${kind}"` : ""}><dt class="field-label">${label}</dt><dd>${body}</dd></div>`;

const listed = (gloss: string, values: string[], html: (prose: string) => string) =>
  `<span class="provenance-gloss">${gloss}:</span> ${values.map(html).join('<span class="provenance-sep"> · </span>')}`;

const notesBox = (rows: string[]) => (rows.length === 0 ? "" : `<dl class="provenance-notes">${rows.join("")}</dl>`);

/** The entry's provenance as printed notes, every prose field rendered by `html` (paper math). */
export function provenanceNotes(p: Provenance, html: (prose: string) => string): ProvenanceNotes {
  const inputs: string[] = [];
  if (p.scaled.length > 0) inputs.push(row("Scaled", listed("measured off a drawing", p.scaled, html)));
  if (p.assumed.length > 0) inputs.push(row("Assumed", listed("supplied here, not in the Materials", p.assumed, html)));

  const outputs: string[] = [];
  if (p.derived.length > 0) outputs.push(row("Derived", listed("worked out here, no official key", p.derived, html)));
  for (const slip of p.slips) {
    const note = slip.note === undefined ? "" : ` ${html(slip.note)}`;
    outputs.push(
      row(
        "Slip",
        `<span class="correction-lead">Correction.</span> The sheet gives <s class="pen-strike">${html(slip.sheet)}</s>; the right value is ${html(slip.value)}.${note}`,
        "slip",
      ),
    );
  }
  for (const divergence of p.divergences) {
    outputs.push(
      row(
        "Divergence",
        `The exam answer is ${html(divergence.value)}, the Professor's. ${html(divergence.note)}`,
        "divergence",
      ),
    );
  }
  return { inputsHtml: notesBox(inputs), outputsHtml: notesBox(outputs) };
}
