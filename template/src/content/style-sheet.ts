// The Course style sheet: the Professor's notation, symbols, units, table forms and voice for one
// Course, written from Module 1 before any other Module is written. Every writer follows it. Its
// machine-readable part (`notation`, `units`) is what the notation lint checks every content file
// against; the rest is read by the writers and the recompute. It describes the Professor's way of
// writing in our words and never quotes the Materials, so it lives in the Course's content.
import { z } from "astro/zod";
import { MODULE_ID } from "./contract.ts";

/** At the content folder's root, beside `course.yaml`. */
export const STYLE_SHEET_FILE = "style-sheet.yaml";

const text = z.string().min(1);

export const styleSheet = z.strictObject({
  /** The Module it was written from: Module 1 of the Course. */
  writtenFrom: z.string().regex(MODULE_ID, "a Module folder name, e.g. 01-linear-regression"),
  /** How the Professor explains: register, person, what they stress. In our words, never a quote. */
  voice: text,
  /** The table and artefact forms the Professor solves on, one line each. */
  tableForms: z.array(text).default([]),
  /** Definitions the Professor pins (e.g. settling time to 2 %): the recompute uses these. */
  definitions: z.array(z.strictObject({ term: text, definition: text })).default([]),
  /** Device and system models the Professor idealises (an ideal diode, a frictionless pulley). */
  idealisedModels: z.array(z.strictObject({ device: text, model: text })).default([]),
  /**
   * Machine-readable: each symbol as the Professor writes it (TeX), what it means, and the variants
   * a writer must not use for it. The notation lint blocks any `not` variant in a formula.
   */
  notation: z
    .array(z.strictObject({ write: text, means: text, not: z.array(text).default([]) }))
    .min(1, "the style sheet pins at least one symbol"),
  /** Machine-readable: each unit as the Professor writes it, and the spellings not to use, in text or math. */
  units: z.array(z.strictObject({ write: text, not: z.array(text).default([]) })).default([]),
});
export type StyleSheet = z.output<typeof styleSheet>;
