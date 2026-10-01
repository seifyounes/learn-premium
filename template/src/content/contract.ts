// Content contract v0: the shape of everything a Course's writers produce. A change here is a
// major Template release, because every Course's content is checked against it.
import { z } from "astro/zod";
import { isPadKey, PAD_COLOUR, PAD_KEYS } from "../pads/catalogue.ts";
import { CELL_REF, parseCell } from "../worked/cells.ts";

/** A Module's folder name is its route: a two-digit number and a slug, e.g. `01-thermal-resistance`. */
export const MODULE_ID = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The Course's pad: a catalogue key, or a colour to build a custom pad from. */
const pad = z.string().refine((value) => isPadKey(value) || PAD_COLOUR.test(value), {
  message: `a catalogue pad (${PAD_KEYS.join(", ")}) or a colour written #RRGGBB`,
});

/**
 * One exam the Course is assessed in (CONTEXT.md, Exam sitting). Its Revision (and, from #74, its
 * Exam room) exists only once the Owner has said it is complete.
 */
const sitting = z.strictObject({
  /** Its routes: `/revision/<id>/`. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "a sitting id is lower-case letters, digits and dashes"),
  name: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, "a date is written YYYY-MM-DD")
    .optional(),
  /** The Modules it covers, by folder name. */
  modules: z.array(z.string().regex(MODULE_ID, "a Module is named by its folder, e.g. 01-thermal-resistance")).min(1),
  /** Sitting complete: only the Owner says so. */
  complete: z.boolean().default(false),
});

export const course = z
  .strictObject({
    name: z.string().min(1),
    code: z.string().min(1),
    pad,
    /** A synthetic Course (the Fixture Course) says so in the title block of every page. */
    synthetic: z.boolean().default(false),
    credit: z.strictObject({
      professor: z.string().min(1),
      course: z.string().min(1),
      university: z.string().min(1),
    }),
    /** Who built the Study site, for the About page. */
    owner: z.string().min(1),
    sittings: z.array(sitting).default([]),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.sittings.forEach((s, i) => {
      if (ids.has(s.id))
        ctx.addIssue({ code: "custom", path: ["sittings", i, "id"], message: `"${s.id}" is used twice` });
      ids.add(s.id);
    });
  });

export type Sitting = z.infer<typeof course>["sittings"][number];

/** What a sitting covers that the Course has no Module for: each one with what to say about it. */
export const uncoveredModules = (sittings: readonly Sitting[], modules: ReadonlySet<string>) =>
  sittings.flatMap((sitting, index) =>
    sitting.modules
      .filter((m) => !modules.has(m))
      .map((m) => ({ index, message: `sitting "${sitting.id}" covers ${m}, which the Course has no Module for` })),
  );

export const module = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Ringed in red pen on the contents sheet: where limited time is best spent. */
  highYield: z.boolean().default(false),
});

/**
 * Where an entry's values come from (CONTEXT.md, Provenance tag). Each list names values the way
 * the writer likes (`0.25`, `$L = 0.25\ \text{m}$`); a number counts as tagged when a list holds
 * the same number. The provenance gate blocks a value no list tags. Scaled and assumed values are
 * shown with the question, derived ones with the answer.
 */
export const provenance = z.strictObject({
  /** In the Materials. */
  stated: z.array(z.string().min(1)).default([]),
  /** Worked out here: no official key gives it. */
  derived: z.array(z.string().min(1)).default([]),
  /** Measured off a drawing. */
  scaled: z.array(z.string().min(1)).default([]),
  /** Supplied here: the Materials don't give it. */
  assumed: z.array(z.string().min(1)).default([]),
  /** The Owner ruled the Professor's result a mistake: the site ships `value`, and shows `sheet` too. */
  slips: z
    .array(z.strictObject({ value: z.string().min(1), sheet: z.string().min(1), note: z.string().min(1).optional() }))
    .default([]),
  /** The Owner ruled the Professor's result the exam's truth: `value` ships, `note` says what the recompute or the real system gives. */
  divergences: z.array(z.strictObject({ value: z.string().min(1), note: z.string().min(1) })).default([]),
});
const tagged = { provenance: provenance.prefault({}) };

const column = z.strictObject({
  label: z.string().min(1),
  unit: z.string().min(1).optional(),
  /** Printed with the question: its values are on the sheet before the first step. */
  given: z.boolean().default(false),
});

const cellRef = z.string().regex(CELL_REF, "a cell is named by its column letter and row number, e.g. D2");

/** The Professor's solving table: the artefact most Worked examples are solved on. */
export const solvingTable = z
  .strictObject({
    kind: z.literal("table"),
    caption: z.string().min(1),
    columns: z.array(column).min(2).max(26),
    rows: z.array(z.array(z.string())).min(1),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, i) => {
      if (row.length !== table.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: `row has ${row.length} cells; the table has ${table.columns.length} columns`,
        });
      }
    });
  });

/**
 * The solving artefacts this template ships, by kind. A Worked example declares the one the
 * Professor solves on; trees and redrawn circuits join as their components land.
 */
export const artefact = z.discriminatedUnion("kind", [solvingTable]);
export const ARTEFACT_KINDS = ["table"] as const satisfies readonly z.infer<typeof artefact>["kind"][];

/**
 * The order the Professor writes values in, within a step: `columns` is column by column, top to
 * bottom (the usual hand order); `rows` is row by row.
 */
export const FILL_ORDERS = ["columns", "rows"] as const;

const axis = z
  .strictObject({
    label: z.string().min(1),
    unit: z.string().min(1).optional(),
    min: z.number(),
    max: z.number(),
    /** Distance between labelled ticks. */
    step: z.number().positive(),
  })
  .refine((a) => a.max > a.min, "max must be greater than min")
  .refine((a) => (a.max - a.min) / a.step <= 20, "more than 20 ticks: take a larger step");

const coordinate = z.tuple([z.number(), z.number()]);
const elementId = z.string().regex(/^[a-z][a-z0-9-]*$/, "an element id is lower-case letters, digits and dashes");
/** Which side of its mark a label sits on: `start` and `end` run along the x axis. */
const labelSide = z.enum(["above", "below", "start", "end"]);

const plotElement = z.discriminatedUnion("kind", [
  z.strictObject({
    id: elementId,
    kind: z.literal("point"),
    at: coordinate,
    label: z.string().min(1).optional(),
    side: labelSide.default("end"),
  }),
  z.strictObject({
    id: elementId,
    kind: z.literal("line"),
    through: z.array(coordinate).min(2),
    label: z.string().min(1).optional(),
  }),
  /** A vertical pencil guide, e.g. the face between two layers. */
  z.strictObject({ id: elementId, kind: z.literal("guide"), x: z.number(), label: z.string().min(1).optional() }),
]);

/** A figure plotted on the sheet: axes, and the elements the steps draw onto it. */
export const plotFigure = z.strictObject({
  kind: z.literal("plot"),
  caption: z.string().min(1),
  x: axis,
  y: axis,
  elements: z.array(plotElement).min(1),
  /** The elements the question itself shows: the figure the student reads first. */
  question: z.array(elementId),
});

const step = z.strictObject({
  /** Short: it names the step in the steps margin. */
  title: z.string().min(1),
  note: z.string().min(1),
  /** The cells this step writes (the order within the step comes from `fillOrder`). */
  fill: z.array(cellRef).default([]),
  /** Cells the red pen rings at this step, after the values land. */
  marks: z.array(cellRef).default([]),
  figure: z
    .strictObject({
      /** Elements first drawn at this step. */
      add: z.array(elementId).default([]),
      /** Elements the red pen rings at this step. */
      ring: z.array(elementId).default([]),
      caption: z.string().min(1).optional(),
    })
    .optional(),
});

export const worked = z
  .strictObject({
    code: z.string().min(1),
    title: z.string().min(1),
    statement: z.string().min(1),
    /** The given data, one quantity each, for the Given box. */
    given: z.array(z.string().min(1)).default([]),
    artefact,
    fillOrder: z.enum(FILL_ORDERS),
    /** The question figure; absent when the question has none. */
    figure: plotFigure.optional(),
    steps: z.array(step).min(1),
    answer: z.string().min(1),
    ...tagged,
  })
  .superRefine((example, ctx) => {
    const { columns, rows } = example.artefact;
    const cellExists = (ref: string) => {
      if (!CELL_REF.test(ref)) return true; // a malformed name is reported by `cellRef` itself
      const { row, col } = parseCell(ref);
      return col < columns.length && row < rows.length;
    };
    const ids = new Set<string>();
    example.figure?.elements.forEach((e, i) => {
      if (ids.has(e.id))
        ctx.addIssue({ code: "custom", path: ["figure", "elements", i, "id"], message: `"${e.id}" is used twice` });
      ids.add(e.id);
    });
    const unknown = (path: (string | number)[]) => (id: string, i: number) => {
      if (!ids.has(id))
        ctx.addIssue({ code: "custom", path: [...path, i], message: `the figure has no element "${id}"` });
    };
    example.figure?.question.forEach(unknown(["figure", "question"]));
    example.steps.forEach((s, i) => {
      for (const key of ["fill", "marks"] as const) {
        s[key].forEach((ref, j) => {
          if (!cellExists(ref))
            ctx.addIssue({ code: "custom", path: ["steps", i, key, j], message: `the table has no cell ${ref}` });
        });
      }
      if (s.figure && !example.figure) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "figure"], message: "the example has no figure" });
        return;
      }
      s.figure?.add.forEach(unknown(["steps", i, "figure", "add"]));
      s.figure?.ring.forEach(unknown(["steps", i, "figure", "ring"]));
    });
  });

/** One of the main rules the Module's problems use. */
const rule = z.strictObject({
  name: z.string().min(1),
  /** The rule as written on the sheet: paper math, every fraction stacked. */
  formula: z.string().min(1),
  /** When the problems reach for it, in one line. */
  use: z.string().min(1).optional(),
});

/**
 * A Module's rules for Master Rules (CONTEXT.md), in `rules.yaml`, in the order a solution uses
 * them. Master Rules and Revision are assembled from them; they are reference only.
 */
export const rules = z.strictObject({
  rules: z.array(rule).min(1),
  ...tagged,
});

/** A Summary beat's frontmatter; its body is plain Markdown of at most 90 words. */
export const beat = z.strictObject({
  title: z.string().min(1),
  /** The one figure the beat is written around, plotted on the sheet. */
  figure: plotFigure.omit({ question: true }).optional(),
  ...tagged,
});

/** A Practice item the site checks: the student's number, within `tolerance` of `value`. */
const numericPractice = z.strictObject({
  kind: z.literal("numeric"),
  question: z.string().min(1),
  answer: z.strictObject({
    value: z.number(),
    /** Absent for a dimensionless answer. */
    unit: z.string().min(1).optional(),
    /** Either side of `value`, in its unit. */
    tolerance: z.number().nonnegative(),
  }),
  model: z.string().min(1),
  ...tagged,
});

/** A prose or derivation item the student marks themselves against the model answer. */
const prosePractice = z.strictObject({
  kind: z.literal("prose"),
  question: z.string().min(1),
  model: z.string().min(1),
  /** What earns the mark: one point per mark. */
  earns: z.array(z.string().min(1)).min(1),
  ...tagged,
});

export const practice = z.discriminatedUnion("kind", [numericPractice, prosePractice]);

const duration = z.string().regex(/^(?:\d+:[0-5]\d|\d{1,2}):[0-5]\d$/, "a duration is written m:ss or h:mm:ss");
/** A file in the Module's `media/` folder, named with no folder. */
const mediaFile = (...extensions: string[]) =>
  z
    .string()
    .regex(
      new RegExp(String.raw`^[\w-][\w.-]*\.(?:${extensions.join("|")})$`),
      `a file in the Module's media/ folder: ${extensions.map((e) => `.${e}`).join(", ")}`,
    );

/** A YouTube video that follows the Professor's method closely enough to ship: 9/10 or better. */
const youtubeCard = z.strictObject({
  id: z.string().regex(/^[\w-]{11}$/, "a YouTube video id is 11 letters, digits, - or _"),
  title: z.string().min(1),
  channel: z.string().min(1),
  duration,
  /** How closely it follows the Professor's method, out of 10. Below 9 there is no card. */
  match: z.number().int().min(9).max(10),
  /** One line: what it explains the Professor's way. */
  why: z.string().min(1),
  /** The moments it cites, each a jump into the video. */
  moments: z.array(z.strictObject({ at: duration, label: z.string().min(1) })).default([]),
});

/**
 * A Module's media (CONTEXT.md, Module media), in `media.yaml` beside `module.yaml`; the files sit
 * in the Module's `media/` folder. Every slot is optional, and an empty one renders nothing.
 */
export const media = z.strictObject({
  /** The NotebookLM Explainer video, first in Watch. */
  video: z.strictObject({ file: mediaFile("mp4"), duration, captions: mediaFile("vtt").optional() }).optional(),
  /** The NotebookLM Deep Dive audio, after the video. */
  audio: z.strictObject({ file: mediaFile("mp3", "m4a"), duration }).optional(),
  /** The NotebookLM infographic, at the top of Summary. */
  infographic: z.strictObject({ file: mediaFile("png"), alt: z.string().min(1) }).optional(),
  /** YouTube cards, after the NotebookLM media. */
  youtube: z.array(youtubeCard).default([]),
});
