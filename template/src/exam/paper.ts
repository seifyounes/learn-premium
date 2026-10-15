// The Exam room's content types, read off the content contract (`paper`, `mock` and
// `announcedFormat` in `src/content/contract.ts`, where their schemas sit beside the Practice
// item's). Types only, so the pure exam logic and the island share them without a build step.
import type { z } from "astro/zod";
import type { announcedFormat, mock, paper } from "../content/contract.ts";

/** A past paper, as the contract reads it (defaults applied). */
export type Paper = z.infer<typeof paper>;
/** A mock, as the contract reads it. */
export type Mock = z.infer<typeof mock>;
/** The format the Professor announced for a sitting. */
export type AnnouncedFormat = z.infer<typeof announcedFormat>;
/** One question of a paper or a mock. */
export type Question = Paper["questions"][number];

/** What the DNA, marks and format checks read of a paper or a mock. */
export interface Sheet {
  marks: number;
  minutes: number;
  questions: readonly {
    module: string;
    type: string;
    reverse: boolean;
    marks: number;
    answer: { kind: "numeric" } | { kind: "prose"; earns: readonly string[] };
  }[];
}
