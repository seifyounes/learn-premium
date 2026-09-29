// Content contract v0: the shape of everything a Course's writers produce. A change here is a
// major Template release, because every Course's content is checked against it.
import { z } from "astro/zod";

export const PADS = ["green"] as const;

export const course = z.strictObject({
  name: z.string().min(1),
  code: z.string().min(1),
  pad: z.enum(PADS),
  /** A synthetic Course (the Fixture Course) says so on every page. */
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

const column = z.strictObject({ label: z.string().min(1), unit: z.string().min(1).optional() });

export const solvingTable = z
  .strictObject({
    caption: z.string().min(1),
    columns: z.array(column).min(2),
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

export const worked = z.strictObject({
  code: z.string().min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  table: solvingTable,
  answer: z.string().min(1),
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
