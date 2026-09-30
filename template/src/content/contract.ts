// Content contract v0: the shape of everything a Course's writers produce. A change here is a
// major Template release, because every Course's content is checked against it.
import { z } from "astro/zod";
import { isPadKey, PAD_COLOUR, PAD_KEYS } from "../pads/catalogue.ts";
import { CELL_REF, parseCell } from "../worked/cells.ts";

/** The Course's pad: a catalogue key, or a colour to build a custom pad from. */
const pad = z.string().refine((value) => isPadKey(value) || PAD_COLOUR.test(value), {
  message: `a catalogue pad (${PAD_KEYS.join(", ")}) or a colour written #RRGGBB`,
});

export const course = z.strictObject({
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
});

export const module = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
});

export const beat = z.strictObject({
  title: z.string().min(1),
});

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

export const practice = z.strictObject({
  question: z.string().min(1),
  answer: z.strictObject({
    value: z.number(),
    unit: z.string().min(1),
    tolerance: z.number().nonnegative(),
  }),
  model: z.string().min(1),
});

/** A Module's folder name is its route: a two-digit number and a slug, e.g. `01-thermal-resistance`. */
export const MODULE_ID = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
