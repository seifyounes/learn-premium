// Content contract v0: the shape of everything a Course's writers produce. A change here is a
// major Template release, because every Course's content is checked against it.
import { z } from "astro/zod";
import { isPadKey, PAD_COLOUR, PAD_KEYS } from "../pads/catalogue.ts";
import { turnSchema } from "../sims/layout/check.ts";
import { SIDES } from "../sims/layout/symbols.ts";
import { schematicProblems } from "../sims/layout/validate.ts";
import { LOGIC_KINDS, logicProblems } from "../sims/logic/engine.ts";
import { PROVENANCE_TAGS } from "../provenance/values.ts";
import { S7_TYPES } from "../sims/s7/memory.ts";
import { sclProblems } from "../sims/scl/validate.ts";
import { stlProblems } from "../sims/stl/validate.ts";
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
    /**
     * The Arabic-notes toggle, set at intake: on, every Arabic note in the content is shown beside
     * the English; off, none is. Media stays English either way.
     */
    arabicNotes: z.boolean().default(false),
    sittings: z.array(sitting).default([]),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.sittings.forEach((s, i) => {
      if (ids.has(s.id))
        ctx.addIssue({ code: "custom", path: ["sittings", i, "id"], message: `"${s.id}" is used twice` });
      ids.add(s.id);
      const covered = new Set<string>();
      s.modules.forEach((m, j) => {
        if (covered.has(m))
          ctx.addIssue({ code: "custom", path: ["sittings", i, "modules", j], message: `"${m}" is listed twice` });
        covered.add(m);
      });
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

/**
 * An Arabic note (CONTEXT.md): a difficult point explained in Arabic, with paper math, shown right
 * to left beside the English only when the course's Arabic-notes toggle is on. Its numbers use the
 * digits 0–9, as the English content and the exam do, so the provenance gate reads them.
 */
const arabicNote = z
  .string()
  .min(1)
  .refine((text) => /\p{Script=Arabic}/u.test(text), "an Arabic note is written in Arabic")
  .refine(
    (text) => !/[\u0660-\u0669\u06F0-\u06F9]/.test(text),
    "write numbers in an Arabic note with the digits 0–9, as the English content does",
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
    .array(
      z.strictObject({
        /** In a Worked example, the sheet cell it corrects (`D4`): its corrected value is checked against that cell's recompute. */
        cell: z.string().regex(CELL_REF, "a cell is named by its column letter and row number, e.g. D2").optional(),
        value: z.string().min(1),
        sheet: z.string().min(1),
        note: z.string().min(1).optional(),
      }),
    )
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
  /** The step's Arabic note, shown below its note. */
  arabic: arabicNote.optional(),
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

/** A range a student tunes one input over. */
const tuneRange = z
  .strictObject({ min: z.number(), max: z.number(), step: z.number().positive() })
  .refine((r) => r.max > r.min, "max must be greater than min");

/**
 * What an Agent-built sim falls back to when its model can't be recomputed independently: its
 * figure as the Materials draw it, stepped through with motion. Nothing on it is computed.
 */
const stepThrough = z.strictObject({
  figure: plotFigure,
  steps: z
    .array(
      z.strictObject({
        caption: z.string().min(1),
        /** Elements first drawn at this step. */
        add: z.array(elementId).default([]),
        /** Elements the red pen rings at this step. */
        ring: z.array(elementId).default([]),
      }),
    )
    .min(2),
});

/** What every Agent-built sim declares, whatever its kind. */
const simCommon = {
  title: z.string().min(1),
  caption: z.string().min(1),
  /**
   * `independent`: an independent recompute checks the engine at build, and the sim ships live.
   * `none`: its model can't be recomputed, so the page shows `stepThrough` instead.
   */
  recompute: z.enum(["independent", "none"]),
  /** The Worked example it sits in, by its file number in the Module's `worked/` folder. */
  worked: z.string().regex(/^\d+$/, "a Worked example's file number, e.g. 1").optional(),
  /** The cells of that example's table the engine must reproduce, each with the quantity it prints. */
  sheet: z.record(cellRef, z.string().min(1)).default({}),
  stepThrough: stepThrough.optional(),
  ...tagged,
};

/**
 * Gradient descent fitting a line to the Professor's data by the half mean squared error
 * (`src/sims/gradient-descent/engine.ts`). The model is fixed; students tune where descent starts,
 * the learning rate and the number of steps.
 */
const gradientDescentSim = z.strictObject({
  kind: z.literal("gradient-descent"),
  ...simCommon,
  model: z.strictObject({ data: z.array(coordinate).min(2) }),
  /** The example's values: a live sim opens on them. A step-through has none. */
  start: z
    .strictObject({
      theta0: z.number(),
      theta1: z.number(),
      alpha: z.number().positive(),
      iterations: z.number().int().nonnegative(),
    })
    .optional(),
  /** The only inputs students change, each by slider. Anything else in the model is the Professor's. */
  tune: z.strictObject({ theta0: tuneRange, theta1: tuneRange, alpha: tuneRange, iterations: tuneRange }).optional(),
});

/** A part as the figure names it: its printed label (R1, G4, Cin), or a kind prefix and a number. */
const partId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "a part is named as the figure labels it, e.g. G4 or Cin");
const pinRef = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z0-9+-]+$/, "a pin is written part.pin, e.g. G1.in2");
/** A tenth of a coarse step at most: a cell on the figure's grid, never a drawing coordinate. */
const cell = z
  .number()
  .refine(
    (n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9,
    "a cell on the figure's coarse grid, to a tenth of a step",
  );

/**
 * Layout hints (CONTEXT.md): what the builder reads off the figure for each part. There is no
 * field for a drawing coordinate and no hand-placed override: the layout core places, straightens
 * and routes from these alone.
 */
const layoutHints = z.strictObject({
  parts: z.record(
    partId,
    z.strictObject({
      /** Its cell on the figure's coarse grid, [column, row], rows growing down; one step is about one two-terminal part. */
      at: z.tuple([cell, cell]),
      turn: turnSchema.optional(),
      flip: z.boolean().optional(),
      /** The side the figure prints its label on. */
      label: z.enum(SIDES).optional(),
    }),
  ),
  /** The nets whose joints the figure dots; every other net's joints are drawn undotted, as the figure has them. */
  dots: z.array(z.string().min(1)).default([]),
});

const bit = z.union([z.literal(0), z.literal(1)]);

/**
 * A logic circuit (`src/sims/logic/engine.ts`): the figure's gates as a netlist, drawn by the
 * layout core from its hints. Students set the inputs, by tapping a truth-table row or an input;
 * each net carrying a 1 is inked.
 */
const logicSim = z.strictObject({
  kind: z.literal("logic"),
  ...simCommon,
  model: z.strictObject({
    parts: z
      .array(z.strictObject({ id: partId, kind: z.enum(LOGIC_KINDS), label: z.string().min(1).optional() }))
      .min(1),
    nets: z.array(z.strictObject({ id: z.string().min(1), pins: z.array(pinRef).min(1) })).min(1),
    /** The input terminals, in the truth table's column order. */
    inputs: z.array(partId).min(1).max(6),
    /** The output terminals, in the truth table's column order. */
    outputs: z.array(partId).min(1),
  }),
  layout: layoutHints,
  /** The example's input bits: the sim opens on them. */
  start: z.record(partId, bit).optional(),
  /** Each input, 0 or 1. */
  tune: z.record(partId, z.strictObject({ min: z.literal(0), max: z.literal(1), step: z.literal(1) })).optional(),
});

/**
 * The derivative as the tangent's slope (`src/sims/tangent/engine.ts`): the Professor's polynomial,
 * the tangent at a point, and secants over runs shrinking by tenths closing on it. The polynomial
 * is fixed; students tune the point and the first secant's run.
 */
const tangentSim = z.strictObject({
  kind: z.literal("tangent"),
  ...simCommon,
  /** f(x) = c0 + c1·x + c2·x² + …, lowest power first. */
  model: z.strictObject({ coefficients: z.array(z.number()).min(2).max(8) }),
  start: z.strictObject({ a: z.number(), h: z.number().positive() }).optional(),
  tune: z
    .strictObject({
      a: tuneRange,
      h: tuneRange.refine((r) => r.min > 0, "a secant's run is never 0: start h's range above 0"),
    })
    .optional(),
});

/**
 * Transient conduction through a plane wall whose faces are suddenly held at another temperature,
 * marched by Crank–Nicolson (`src/sims/plane-wall/engine.ts`). The wall is fixed; students tune
 * the time and the material's diffusivity. Lengths are in the model's one unit, the diffusivity in
 * that unit squared per second.
 */
const planeWallSim = z.strictObject({
  kind: z.literal("plane-wall"),
  ...simCommon,
  model: z
    .strictObject({ thickness: z.number().positive(), initial: z.number(), surface: z.number() })
    .refine((m) => m.initial !== m.surface, "the faces change temperature: initial and surface differ"),
  /** The units the Materials write the wall in: time is in seconds, the diffusivity in length² per second. */
  units: z.strictObject({ length: z.string().min(1), temperature: z.string().min(1) }),
  start: z.strictObject({ time: z.number().nonnegative(), diffusivity: z.number().positive() }).optional(),
  tune: z
    .strictObject({
      time: tuneRange.refine((r) => r.min >= 0, "time runs from 0: its range starts at 0 or later"),
      diffusivity: tuneRange.refine((r) => r.min > 0, "a diffusivity is above 0"),
    })
    .optional(),
});

/** An STL listing as the S7 core runs it: the listing, the operands students set, and the watch table. */
const stlModel = z.strictObject({
  /** The listing in STEP 7 source form, line for line as the Professor wrote it: one ORGANIZATION_BLOCK OB 1. */
  source: z.string().min(1),
  /** Each operand students set before a scan, by its absolute address, with its type: `"PIW 256": "INT"`. */
  inputs: z.record(z.string(), z.enum(S7_TYPES)),
  /** The watch table: each operand shown after a scan, with its type. */
  watch: z.record(z.string(), z.enum(S7_TYPES)),
});

/** A gate case the builder writes: the inputs before each scan, on top of the example's (and the scan before's). */
const stlCase = z.strictObject({
  name: z.string().min(1),
  scans: z.array(z.record(z.string(), z.number())).min(1),
});

/**
 * An STL listing (`src/sims/stl/engine.ts`), run live on the S7 core: students set the inputs and
 * step a statement or a scan at a time, with a trace. awlsim, the build oracle, runs the same
 * listing on the same cases and must agree bit for bit (`gates/stl.ts`). A listing using an
 * instruction the interpreter lacks names the Gate gap filed for it, and ships as a step-through of
 * awlsim's values.
 */
const stlSim = z.strictObject({
  kind: z.literal("stl"),
  ...simCommon,
  /** awlsim recomputes every listing at build. */
  recompute: z.literal("independent"),
  model: stlModel,
  /** The example's values: the listing opens on them. */
  start: z.record(z.string(), z.number()),
  /** The inputs students tune, each over its range; any other input stays at the example's value. */
  tune: z.record(z.string(), tuneRange),
  /** Multi-scan cases (an alarm latching, then acknowledged) beyond the ones the gate derives from `tune`. */
  cases: z.array(stlCase).default([]),
  /** The Gate gap issue filed for an instruction the interpreter lacks: the listing ships as a step-through. */
  gateGap: z.number().int().positive().optional(),
  /** An STL listing's step-through is awlsim's own trace, never a drawn figure. */
  stepThrough: z.never().optional(),
});

/** An STL listing as the template's own awlsim corpus writes one (`test/stl/`): the sim's model and cases alone. */
export const stlListing = z
  .strictObject({
    /** What it exercises, in a line. */
    covers: z.string().min(1),
    model: stlModel,
    start: z.record(z.string(), z.number()),
    tune: z.record(z.string(), tuneRange).default({}),
    cases: z.array(stlCase).default([]),
  })
  .superRefine((l, ctx) => {
    for (const p of stlProblems(l.model, l.start, l.tune, l.cases)) ctx.addIssue({ code: "custom", ...p });
  });

/**
 * An SCL listing (`src/sims/scl/engine.ts`), run live on the S7 core: each scan calls the listing's
 * FUNCTION_BLOCK once, students set its inputs and step a statement or a scan at a time, with a
 * trace. A second interpreter, written blind from the Siemens SCL manual (`oracle/scl-blind.ts`),
 * runs the same cases at build and must agree on every scan (`gates/scl.ts`).
 */
const sclSim = z.strictObject({
  kind: z.literal("scl"),
  ...simCommon,
  /** The blind interpreter recomputes every listing at build. */
  recompute: z.literal("independent"),
  model: z.strictObject({
    /** The listing as the Professor wrote it, line for line: TYPE, DATA_BLOCK, FUNCTION and FUNCTION_BLOCK units. */
    source: z.string().min(1),
    /** The FUNCTION_BLOCK each scan calls once: its VAR_INPUTs are what students set. */
    block: z.string().min(1),
    /** The watch table: variables by path (`fill_pct`, `Recipe.silo[1].kg`), shown as each statement runs. */
    watch: z.array(z.string().min(1)),
  }),
  /** The example's values, one per VAR_INPUT: the listing opens on them. */
  start: z.record(z.string(), z.number()),
  /** The inputs students tune, each over its range; any other input stays at the example's value. */
  tune: z.record(z.string(), tuneRange),
  /** Multi-scan cases (a batch run start to finish) beyond the ones the gate derives from `tune`. */
  cases: z.array(stlCase).default([]),
  /**
   * A listing the Professor builds up over several slides: one tab per build step, naming the lines
   * of the final listing that step adds (`"1-12, 30"`). `fragment` is code a slide shows only for
   * its syntax: it stays static code, never run.
   */
  walkthrough: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        lines: z.string().min(1),
        note: z.string().min(1).optional(),
        fragment: z.string().min(1).optional(),
      }),
    )
    .default([]),
  /**
   * The lines the Owner ruled a Divergence at a Checkpoint: the trace marks that line only, with the
   * Professor's result as the exam answer and a red-pen note on what a real S7 does.
   */
  divergences: z
    .array(z.strictObject({ line: z.number().int().positive(), exam: z.string().min(1), note: z.string().min(1) }))
    .default([]),
  /**
   * Where the two interpreters part and the SCL manual says nothing: each is a Checkpoint item until
   * the Owner rules it (`ruling`). `at` is the variable they part on, or `line N` where the blind
   * interpreter stops because the manual leaves the result undefined.
   */
  silent: z
    .array(z.strictObject({ at: z.string().min(1), point: z.string().min(1), ruling: z.string().min(1).optional() }))
    .default([]),
  /** An SCL listing always ships live. */
  stepThrough: z.never().optional(),
});

/**
 * An Agent-built sim (CONTEXT.md): a small model of the Professor's figure, which the engine runs
 * the same way in Node at build and in the page. Students tune it, never rewire it.
 */
export const sim = z
  .discriminatedUnion("kind", [gradientDescentSim, logicSim, tangentSim, planeWallSim, stlSim, sclSim])
  .superRefine((s, ctx) => {
    if (s.kind === "stl")
      for (const p of stlProblems(s.model, s.start, s.tune, s.cases)) ctx.addIssue({ code: "custom", ...p });
    if (s.kind === "scl")
      for (const p of sclProblems(s.model, s.start, s.tune, s.cases, s.walkthrough, s.divergences))
        ctx.addIssue({ code: "custom", ...p });
    if (s.kind === "logic") {
      // The circuit is judged once its netlist holds together: a pin in no net isn't also a loop.
      const structure = schematicProblems(s.model, s.layout);
      for (const message of structure.length > 0 ? structure : logicProblems(s.model))
        ctx.addIssue({ code: "custom", path: ["model"], message });
      for (const key of ["start", "tune"] as const) {
        const given = Object.keys(s[key] ?? {});
        if (s[key] !== undefined && given.join() !== s.model.inputs.join())
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} gives ${given.join(", ") || "nothing"}, but the inputs are ${s.model.inputs.join(", ")}, in that order`,
          });
      }
    }
    if (s.recompute === "independent") {
      for (const key of ["start", "tune"] as const) {
        if (s[key] === undefined)
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `a live sim opens on the example's values (start) and says what students tune over (tune)`,
          });
      }
    }
    for (const [input, range] of Object.entries(s.tune ?? {})) {
      const value = (s.start as Record<string, number> | undefined)?.[input];
      if (value !== undefined && (value < range.min || value > range.max)) {
        ctx.addIssue({
          code: "custom",
          path: ["start", input],
          message: `${value} is outside the range students tune it over (${range.min} to ${range.max})`,
        });
      }
    }
    if (Object.keys(s.sheet).length > 0 && s.worked === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sheet"],
        message: "the sim checks sheet cells but names no Worked example (worked)",
      });
    }
    if (s.recompute === "none" && s.stepThrough === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stepThrough"],
        message: "a sim that can't be recomputed ships as a step-through: give its figure and steps",
      });
    }
    const figure = s.stepThrough?.figure;
    const ids = new Set(figure?.elements.map((e) => e.id));
    const unknown = (path: (string | number)[]) => (id: string, i: number) => {
      if (!ids.has(id))
        ctx.addIssue({ code: "custom", path: [...path, i], message: `the figure has no element "${id}"` });
    };
    figure?.question.forEach(unknown(["stepThrough", "figure", "question"]));
    s.stepThrough?.steps.forEach((step, i) => {
      step.add.forEach(unknown(["stepThrough", "steps", i, "add"]));
      step.ring.forEach(unknown(["stepThrough", "steps", i, "ring"]));
    });
  });
export const SIM_KINDS = [
  "gradient-descent",
  "logic",
  "tangent",
  "plane-wall",
  "stl",
  "scl",
] as const satisfies readonly z.infer<typeof sim>["kind"][];

/**
 * A Pyodide tool (CONTEXT.md): real Python where real Python is the point (the Professor's own
 * code, scikit-learn, SciPy). Its code runs at build for the preview the page opens on; Pyodide
 * downloads only when the student taps Run live, and then runs the code as they edit it.
 */
export const pythonTool = z.strictObject({
  title: z.string().min(1),
  caption: z.string().min(1),
  /**
   * The code, a `.py` file beside this one in the Module's `python/` folder, run as written. It
   * ends by setting `plot` to the elements it draws (each a dict like a plot element: `id`, `kind`
   * `point` with `at`, `line` with `through`, or `guide` with `x`); what it prints is shown too.
   */
  source: z.string().regex(/^[\w-][\w.-]*\.py$/, "a .py file in the Module's python/ folder, named with no folder"),
  /** The Pyodide packages it imports, by their name in Pyodide's lock (numpy, scikit-learn…). */
  packages: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "a Pyodide package name, e.g. numpy or scikit-learn"))
    .default([]),
  /** The frame its plot is drawn in. */
  figure: z.strictObject({ caption: z.string().min(1), x: axis, y: axis }),
  /** Labels for the plot's elements, by the id the code gives them. */
  labels: z.record(elementId, z.string().min(1)).default({}),
  /** The Worked example it sits in, by its file number in the Module's `worked/` folder. */
  worked: z.string().regex(/^\d+$/, "a Worked example's file number, e.g. 1").optional(),
  ...tagged,
});

const point3 = z.tuple([z.number(), z.number(), z.number()]);
/** How far apart a dimension's ends may lie from its value: the model is exact, so float noise only. */
const DIMENSION_SLACK_MM = 1e-6;

/**
 * One dimension the drawing gives a part, in millimetres, in the script's frame (z up). A `length` or
 * `diameter` runs between two points on the part, each on a surface it meets square: two faces, or
 * the two sides of a diameter. A `centres` dimension locates features: it runs between two points on
 * the axes of round features (holes, bosses), square to them, as a pitch-circle diameter or a hole
 * spacing does. The part gates check both ends on the solid and on its GLB.
 */
const partDimension = z.strictObject({
  id: elementId,
  /** What it measures, as the drawing names it (e.g. Flange diameter). */
  label: z.string().min(1),
  /** A diameter is printed with Ø; `centres` runs between the axes of two round features. */
  kind: z.enum(["length", "diameter", "centres"]).default("length"),
  value: z.number().positive(),
  /** Its Provenance tag: a scaled or assumed dimension goes to the Owner as a Checkpoint item. */
  tag: z.enum(PROVENANCE_TAGS),
  /** The Owner confirmed this scaled or assumed reading at a Checkpoint: it isn't asked again. */
  confirmed: z.boolean().default(false),
  from: point3,
  to: point3,
});

/**
 * A machine part (CONTEXT.md, Toolkit: machinery): an exact solid built by a build123d script
 * beside this file, exported to GLB by `npm run parts`, and shown in the 3D viewer. Students turn
 * and zoom it; nothing about it is tuned.
 */
export const part = z
  .strictObject({
    title: z.string().min(1),
    caption: z.string().min(1),
    /** The build123d script, a `.py` file in the Module's `parts/` folder; it leaves the solid in `part`. */
    source: z.string().regex(/^[\w-][\w.-]*\.py$/, "a .py file in the Module's parts/ folder, named with no folder"),
    /** The Worked example it sits in, by its file number in the Module's `worked/` folder. */
    worked: z.string().regex(/^\d+$/, "a Worked example's file number, e.g. 1").optional(),
    dimensions: z.array(partDimension).min(1),
    ...tagged,
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    p.dimensions.forEach((d, i) => {
      if (ids.has(d.id))
        ctx.addIssue({ code: "custom", path: ["dimensions", i, "id"], message: `"${d.id}" is used twice` });
      ids.add(d.id);
      const apart = Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1], d.to[2] - d.from[2]);
      if (Math.abs(apart - d.value) > DIMENSION_SLACK_MM)
        ctx.addIssue({
          code: "custom",
          path: ["dimensions", i, "value"],
          message: `its ends lie ${Number(apart.toFixed(6))} mm apart, not ${d.value}: a dimension runs between the two points it measures`,
        });
      if (d.confirmed && d.tag !== "scaled" && d.tag !== "assumed")
        ctx.addIssue({
          code: "custom",
          path: ["dimensions", i, "confirmed"],
          message: `only a scaled or assumed dimension waits on the Owner's word; a ${d.tag} one needs none`,
        });
    });
  });

/** A Summary beat's frontmatter; its body is plain Markdown of at most 90 words. */
export const beat = z.strictObject({
  title: z.string().min(1),
  /** The one figure the beat is written around, plotted on the sheet. */
  figure: plotFigure.omit({ question: true }).optional(),
  /** The beat's Arabic note, shown below its text; it isn't counted in the beat's 90 words. */
  arabic: arabicNote.optional(),
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
