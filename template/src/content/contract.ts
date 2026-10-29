// Content contract v0: the shape of everything a Course's writers produce. A change here is a
// major Template release, because every Course's content is checked against it.
import { z } from "astro/zod";
import { isPadKey, PAD_COLOUR, PAD_KEYS } from "../pads/catalogue.ts";
import { loopProblems } from "../sims/control/loop.ts";
import { BLOCK_DIAGRAM_KINDS } from "../sims/layout/block-diagram.ts";
import { turnSchema } from "../sims/layout/check.ts";
import { diagramProblems } from "../sims/layout/diagram.ts";
import { PNEUMATIC_KINDS } from "../sims/layout/pneumatic.ts";
import { FSM_KINDS, GRAFCET_KINDS } from "../sims/layout/state-diagram.ts";
import { SIDES } from "../sims/layout/symbols.ts";
import { schematicProblems } from "../sims/layout/validate.ts";
import { LANGUAGES, PLC_KINDS, WATCH_TYPES } from "../sims/ladder/model.ts";
import { ladderSimProblems } from "../sims/ladder/validate.ts";
import { LOGIC_KINDS, logicProblems } from "../sims/logic/engine.ts";
import { nernstProblems } from "../sims/nernst/engine.ts";
import { pneumaticProblems } from "../sims/pneumatic/model.ts";
import { fourBarProblems } from "../sims/mechanism/engine.ts";
import { PROVENANCE_TAGS } from "../provenance/values.ts";
import { S7_TYPES } from "../sims/s7/memory.ts";
import { sclProblems } from "../sims/scl/validate.ts";
import { diagramOf } from "../sims/state-machine/engine.ts";
import { machineProblems } from "../sims/state-machine/problems.ts";
import { stlProblems } from "../sims/stl/validate.ts";
import { CELL_REF, parseCell } from "../worked/cells.ts";
import { linkOnlyHost } from "./links-only.ts";

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

/**
 * A Discipline the Course lists, set at intake. One the template's Toolkit lists is just its name; one
 * added at intake carries the Toolkit the Owner confirmed (each interaction's tools, the default
 * first; none when no engine is built yet) and the ready-made tool he chose on feel for an
 * interaction. A ready-made tool is a record only: the template ships none, so the Agent-built tool
 * is what builds. PhET and Falstad are never a tool, only credited links.
 */
const courseDiscipline = z
  .strictObject({
    name: z.string().min(1),
    /** The nearest listed Discipline the Toolkit was proposed from. */
    nearest: z.string().min(1).optional(),
    toolkit: z.record(z.string().min(1), z.array(z.string())).optional(),
    /** Interaction → the ready-made tool chosen for it; each key is one of the Toolkit's interactions. */
    readyMade: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .superRefine((d, ctx) => {
    const linksOnly = "PhET and Falstad appear only as credited links, never as a tool";
    const ships = [...SIM_KINDS, "pyodide", "part"] as readonly string[];
    for (const [interaction, tools] of Object.entries(d.toolkit ?? {}))
      tools.forEach((tool, i) => {
        if (!ships.includes(tool))
          ctx.addIssue({
            code: "custom",
            path: ["toolkit", interaction, i],
            message: `"${tool}" isn't a tool this template ships (it ships: ${ships.join(", ")}); ${linksOnly}`,
          });
      });
    for (const [interaction, name] of Object.entries(d.readyMade ?? {})) {
      if (/\b(phet|falstad)\b/i.test(name))
        ctx.addIssue({ code: "custom", path: ["readyMade", interaction], message: `"${name}": ${linksOnly}` });
      if (!Object.hasOwn(d.toolkit ?? {}, interaction))
        ctx.addIssue({
          code: "custom",
          path: ["readyMade", interaction],
          message: `"${interaction}" isn't an interaction of ${d.name}'s Toolkit`,
        });
    }
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
    /** The Owner-confirmed Disciplines, the main one first, set at intake. */
    disciplines: z.array(courseDiscipline).default([]),
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

/**
 * A credited "go further" link (PhET, Falstad…): a plain link in a new tab to a page another site
 * made, never framed, embedded or copied. A PhET or Falstad page is credited as its makers ask.
 */
const furtherLink = z
  .strictObject({
    title: z.string().min(1),
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "an https:// address"),
    /** As its makers ask to be credited. */
    credit: z.string().min(1),
    licence: z.string().min(1).optional(),
  })
  .superRefine((l, ctx) => {
    const host = linkOnlyHost(l.url);
    if (!host) return;
    if (!l.credit.includes(host.credit))
      ctx.addIssue({
        code: "custom",
        path: ["credit"],
        message: `${host.site}'s pages are credited to ${host.credit}`,
      });
    if (l.licence === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["licence"],
        message: `${host.site}'s pages carry a licence: name it, e.g. CC BY-NC 4.0`,
      });
  });

export const module = z.strictObject({
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Ringed in red pen on the contents sheet: where limited time is best spent. */
  highYield: z.boolean().default(false),
  /** Credited links to other sites' pages (PhET, Falstad…), shown at the end of the Module as "Go further". */
  further: z.array(furtherLink).default([]),
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

/** A root of G(s) as the Materials write it: a real number, or a complex pair re ± j·im as [re, im]. */
const root = z.union([z.number(), z.tuple([z.number(), z.number().positive()])]);
const degree = (roots: readonly z.infer<typeof root>[]) =>
  roots.reduce<number>((n, r) => n + (typeof r === "number" ? 1 : 2), 0);

/**
 * A control loop (`src/sims/control/engine.ts`): the gain K in front of the Professor's plant G(s),
 * under unity negative feedback, its block diagram drawn by the layout core from its hints. Every
 * view (root locus, step, Bode, Nyquist) is drawn on JSXGraph; the step characteristics are read by
 * the definitions the Course style sheet pins. Students tune K, by slider or by dragging a
 * closed-loop pole along the locus, never the plant.
 */
const controlSim = z.strictObject({
  kind: z.literal("control"),
  ...simCommon,
  model: z.strictObject({
    /** G(s) = gain · Π(s − zero) / Π(s − pole), strictly proper. */
    plant: z
      .strictObject({
        gain: z.number().refine((g) => g !== 0, "a plant's gain is never 0"),
        zeros: z.array(root),
        poles: z.array(root).min(1),
      })
      .refine((p) => degree(p.zeros) < degree(p.poles), "G(s) is strictly proper: it has fewer zeros than poles"),
    /** Which part of the block diagram plays each role in the loop. */
    loop: z.strictObject({ input: partId, sum: partId, gain: partId, plant: partId, output: partId }),
    parts: z
      .array(z.strictObject({ id: partId, kind: z.enum(BLOCK_DIAGRAM_KINDS), label: z.string().min(1).optional() }))
      .min(1),
    nets: z.array(z.strictObject({ id: z.string().min(1), pins: z.array(pinRef).min(1) })).min(1),
  }),
  layout: layoutHints,
  /** The example's gain: the sim opens on it. */
  start: z.strictObject({ K: z.number().positive() }).optional(),
  tune: z
    .strictObject({ K: tuneRange.refine((r) => r.min > 0, "a loop's gain is above 0: start K's range above 0") })
    .optional(),
});

/** The Professor's ladder (LAD) or FBD networks as a netlist of the PLC pack's symbols. */
const ladderModel = z.strictObject({
  language: z.enum(LANGUAGES),
  parts: z
    .array(
      z.strictObject({
        id: partId,
        kind: z.enum(PLC_KINDS),
        /** The network it sits in, as the figure numbers them. */
        network: z.number().int().positive(),
        /** What it reads or writes: `I 0.0`, `Q 4.0`, `T 1`, `C 1`, or a TON's instance `DB 1`. */
        operand: z.string().min(1).optional(),
        /** What the figure prints above it, when not the operand (a symbolic name). */
        label: z.string().min(1).optional(),
        /** Its values by slot, as the figure prints them: `TV: S5T#5S`, `PT: T#5S`, `PV: C#5`, `BI: MW 10`, `ET: MD 20`. */
        params: z.record(z.string(), z.string().min(1)).optional(),
      }),
    )
    .min(1),
  nets: z.array(z.strictObject({ id: z.string().min(1), pins: z.array(pinRef).min(1) })).min(1),
  /** The input bits students set, in the order the controls show them. */
  inputs: z.array(z.string().min(1)).min(1).max(8),
  /** The operands shown after each scan, with their types (a TIME is a DINT of milliseconds). */
  watch: z.record(z.string(), z.enum(WATCH_TYPES)),
});

/**
 * Milliseconds from one scan to the next: 10 to 1000, a whole fraction of a second, so the view's
 * one-second step is exactly one second of scans.
 */
const scanCycle = z
  .number()
  .int()
  .min(10)
  .max(1000)
  .refine((ms) => 1000 % ms === 0, "a scan cycle divides 1000 ms: 10, 20, 50, 100, 200, 500…");

/** Inputs over time: their example values first, then each change at its scan's time (ms). */
const timeline = z.strictObject({
  until: z.number().int().nonnegative(),
  events: z.array(z.strictObject({ at: z.number().int().nonnegative(), set: z.record(z.string(), bit) })).default([]),
});

/**
 * A ladder or FBD sim (`src/sims/ladder/engine.ts`): the Professor's networks run on the S7 core,
 * scan after scan at the scans' own times, drawn by the layout core from its hints. Students set
 * the inputs and run time on; the rungs carrying power ink in, each timer shows its elapsed time, and
 * a timing chart measures it. awlsim, the build oracle, runs the networks compiled to STL on the same
 * timelines and must agree bit for bit after every scan (`gates/ladder.ts`).
 */
const ladderSim = z.strictObject({
  kind: z.literal("ladder"),
  ...simCommon,
  /** awlsim recomputes every model at build. */
  recompute: z.literal("independent"),
  model: ladderModel,
  layout: layoutHints,
  /** Milliseconds from one scan to the next. */
  cycle: scanCycle,
  /** The example's input bits: the sim opens on them. */
  start: z.record(z.string(), bit),
  /** Each input, 0 or 1. */
  tune: z.record(z.string(), z.strictObject({ min: z.literal(0), max: z.literal(1), step: z.literal(1) })),
  /** The Worked example's timeline: the sheet reads the watched values at its scans. */
  scenario: timeline,
  /** More timelines for the gate (a timer reset part-way, a counter run to its preset). */
  cases: z.array(timeline.extend({ name: z.string().min(1) })).default([]),
  /** A ladder's step-through would be a drawn figure: it always ships live, checked by awlsim. */
  stepThrough: z.never().optional(),
});

/** A ladder or FBD model as the template's own awlsim corpus writes one (`test/ladder/`): no drawing, just cases. */
export const ladderListing = z
  .strictObject({
    /** What it exercises, in a line. */
    covers: z.string().min(1),
    model: ladderModel,
    cycle: scanCycle,
    start: z.record(z.string(), bit),
    cases: z.array(timeline.extend({ name: z.string().min(1) })).min(1),
  })
  .superRefine((l, ctx) => {
    for (const p of ladderSimProblems(l)) ctx.addIssue({ code: "custom", ...p });
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

const pneumaticPart = z.strictObject({
  id: partId,
  kind: z.enum(PNEUMATIC_KINDS),
  label: z.string().min(1).optional(),
  /** A cylinder's stroke-end marks as the figure prints them: the roller valve at each end (`retracted: a0`). */
  notes: z.record(z.string(), z.string().min(1)).optional(),
  /** Where the figure draws it at rest: a cylinder's end, a 5/2 valve's pilot side. */
  rest: z.enum(["retracted", "extended", "12", "14"]).optional(),
});

/**
 * A pneumatic circuit (`src/sims/pneumatic/engine.ts`): the Professor's ISO 1219 figure as a netlist
 * of the pneumatic pack, drawn by the layout core from its hints. Students press or hold its push
 * buttons and step the cycle; pressurised lines ink in, spools shift, pistons travel, and the
 * displacement-step diagram inks itself over the key. They never rewire it.
 */
const pneumaticSim = z.strictObject({
  kind: z.literal("pneumatic"),
  ...simCommon,
  model: z.strictObject({
    parts: z.array(pneumaticPart).min(1),
    nets: z.array(z.strictObject({ id: z.string().min(1), pins: z.array(pinRef).min(1) })).min(1),
    /** The movements the Materials state, in order: `A+` extends cylinder A, `A-` retracts it. */
    sequence: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*[+-]$/, "a movement is a cylinder and + or -, e.g. A+"))
      .min(2),
    /** The push buttons the example presses once, at rest, to run the cycle. */
    press: z.array(partId).min(1),
    /** The nets the timing diagram draws as signal rows (the cascade's group lines), beside every cylinder. */
    signals: z.array(z.string().min(1)),
  }),
  layout: layoutHints,
  /** Each push button held (1) or not (0) as the sim opens; the figure draws every button released. */
  start: z.record(partId, bit).optional(),
  tune: z.record(partId, z.strictObject({ min: z.literal(0), max: z.literal(1), step: z.literal(1) })).optional(),
});

/** A state of a state machine: its part, the name the figure prints in it, the outputs it sets. */
const machineState = <K extends readonly [string, ...string[]]>(kinds: K) =>
  z.strictObject({
    id: partId,
    kind: z.enum(kinds),
    /** The name the figure prints in it: S0, or a step's number. */
    label: z.string().min(1),
    /** The outputs it sets to 1 while active: a Moore state's output, a step's actions. */
    out: z.array(partId).min(1).optional(),
  });
const machineEdge = z.strictObject({
  from: partId,
  to: partId,
  /** As the figure prints it: an input pattern (an FSM), a receptivity (a GRAFCET). */
  label: z.string().min(1),
});
const machineEquation = z.strictObject({ name: z.string().min(1), gives: partId, expr: z.string().min(1) });
/** The input bits clock period by clock period, as the Worked example gives them: `x: "011010100"`. */
const stimulus = z.record(partId, z.string().regex(/^[01]+$/, "a stimulus is one 0 or 1 per clock period"));
/** Layout hints for a state diagram (CONTEXT.md): each state's cell and self-loop side, an edge's bow where the figure bends it. */
const diagramHints = z.strictObject({
  states: z.record(partId, z.strictObject({ at: z.tuple([cell, cell]), loop: z.enum(SIDES).optional() })),
  edges: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]*>[A-Za-z][A-Za-z0-9_]*$/, "an edge is named from>to, e.g. S2>S3"),
      z.strictObject({
        bow: z.enum(SIDES).optional(),
        bend: cell.refine((n) => n > 0 && n <= 2, "a bend is 0.1 to 2 steps").optional(),
        label: z.enum(SIDES).optional(),
      }),
    )
    .default({}),
  start: z.enum(SIDES).optional(),
});
const machineInputs = z.record(partId, bit);
const machineTune = z.record(partId, z.strictObject({ min: z.literal(0), max: z.literal(1), step: z.literal(1) }));

/**
 * A Moore state machine (`src/sims/state-machine/engine.ts`): the Professor's state diagram, its edges
 * labelled with input patterns, drawn by the layout core and its curve drawer from the hints. Students
 * set the inputs and clock it; a token travels the taken edge, the state table's row and the equations
 * follow, and the timing strip grows over the key. They never redraw it.
 */
const fsmSim = z.strictObject({
  kind: z.literal("fsm"),
  ...simCommon,
  model: z.strictObject({
    states: z.array(machineState(FSM_KINDS)).min(2),
    edges: z.array(machineEdge).min(1),
    initial: partId,
    inputs: z.array(partId).min(1).max(3),
    outputs: z.array(partId).min(1),
    encoding: z
      .strictObject({ variables: z.array(partId).min(1), codes: z.record(partId, z.string().regex(/^[01]+$/)) })
      .optional(),
    equations: z.array(machineEquation).min(1).optional(),
    stimulus,
  }),
  layout: diagramHints,
  /** The example's first period's inputs: the sim opens on them. */
  start: machineInputs.optional(),
  tune: machineTune.optional(),
});

/** A GRAFCET (IEC 60848, SFC): steps, transitions with their receptivities, each step's actions; the same engine. */
const grafcetSim = z.strictObject({
  kind: z.literal("grafcet"),
  ...simCommon,
  model: z.strictObject({
    states: z.array(machineState(GRAFCET_KINDS)).min(2),
    edges: z.array(machineEdge).min(1),
    inputs: z.array(partId).min(1).max(6),
    outputs: z.array(partId).min(1),
    equations: z.array(machineEquation).min(1).optional(),
    stimulus,
  }),
  layout: diagramHints,
  start: machineInputs.optional(),
  tune: machineTune.optional(),
});
/** The letters a figure prints a pin with: one letter and at most one digit (`O`, `A`, `O2`). */
const pinLabels = z.record(z.string().regex(/^[A-Z][0-9]?$/), z.string().regex(/^[A-Za-z][0-9]?$/)).optional();
/** Lengths in mm and angles in degrees. No `.default()` in a model: the recompute log must carry it verbatim. */
const fourBarModel = z.strictObject({
  type: z.literal("four-bar"),
  /** O2O4, O2A, AB, O4B as the figure gives them: ground, crank (the driver), coupler, rocker. */
  ground: z.number().positive(),
  crank: z.number().positive(),
  coupler: z.number().positive(),
  rocker: z.number().positive(),
  /** `open`: B lies to the left of the line from A to O4 (sheet frame: x along O2→O4, y up); `crossed`: to its right. */
  assembly: z.enum(["open", "crossed"]),
  /** A point on the coupler whose path the drawing traces: `along` AB from A, `off` to its left (negative: right). */
  couplerPoint: z.strictObject({ along: z.number(), off: z.number() }).optional(),
  /** The figure's letters for O2, A, B, O4, P, when it prints others (one letter and at most one digit). */
  labels: pinLabels,
});
const gearPairModel = z.strictObject({
  type: z.literal("gear-pair"),
  /** Standard full-depth involute spur gears: addendum m, dedendum 1.25 m, no backlash, no profile shift. */
  module: z.number().positive(),
  /** The driver's teeth first. */
  teeth: z.tuple([z.number().int().min(8), z.number().int().min(8)]),
  pressureAngle: z.number().gt(10).lt(35),
  faceWidth: z.number().positive(),
  /** As the figure states it; m(N1 + N2)/2 when it states none. The gear-interference gate judges it. */
  centreDistance: z.number().positive().optional(),
  /** The figure's letters for O1 and O2, when it prints others. */
  labels: pinLabels,
});

/**
 * A mechanism (`src/sims/mechanism/engine.ts`): the Professor's linkage or gear pair, solved live by
 * the kinematics engine and drawn in 3D or as the sheet drawing. Students turn the driver (θ), never
 * the links.
 */
const mechanismSim = z.strictObject({
  kind: z.literal("mechanism"),
  ...simCommon,
  model: z.discriminatedUnion("type", [fourBarModel, gearPairModel]),
  /** The driver's angle the example works at: the crank's from O2→O4, counterclockwise; the driver gear's from home. */
  start: z.strictObject({ theta: z.number() }).optional(),
  tune: z.strictObject({ theta: tuneRange }).optional(),
});

/** What a mechanism's model gets wrong beyond its shape: a crank that can't turn fully, labels for pins it lacks. */
function mechanismProblems(model: z.output<typeof mechanismSim>["model"]): { path: string[]; message: string }[] {
  if (model.type === "four-bar") {
    const found = fourBarProblems(model).map((message) => ({ path: ["model"], message }));
    const pins = ["O2", "A", "B", "O4", "P"];
    for (const key of Object.keys(model.labels ?? {})) {
      if (!pins.includes(key))
        found.push({ path: ["model", "labels"], message: `a four-bar's pins are O2, A, B, O4 and P: no ${key}` });
      else if (key === "P" && model.couplerPoint === undefined)
        found.push({ path: ["model", "labels"], message: "P labels the coupler point, and the four-bar has none" });
    }
    return found;
  }
  return Object.keys(model.labels ?? {})
    .filter((key) => key !== "O1" && key !== "O2")
    .map((key) => ({ path: ["model", "labels"], message: `a gear pair's pins are O1 and O2: no ${key}` }));
}

/** One half-cell of a galvanic cell: a metal in a solution of its own ion. */
const halfCell = z.strictObject({
  /** The electrode's metal, by its symbol: Cu. */
  metal: z.string().regex(/^[A-Z][a-z]?$/, "a metal's symbol, e.g. Cu"),
  /** Its ion in the solution, as mhchem writes it: Cu^2+, Ag^+. */
  ion: z.string().regex(/^[A-Z][a-z]?\^\d?\+$/, "the metal's ion as mhchem writes it, e.g. Cu^2+ or Ag^+"),
  /** z: the electrons one atom gives up. */
  charge: z.number().int().min(1).max(4),
  /** The couple's standard reduction potential E° (V), as the Materials' table gives it. */
  e0: z.number(),
});
const positiveRange = (what: string) =>
  tuneRange.refine((r) => r.min > 0, `${what} is above 0: start its range above 0`);
/** The plot of E against log₁₀Q: one line per isotherm (K). Past four lines, students toggle them (series-limit). */
const nernstPlot = z.strictObject({
  isotherms: z.array(z.number().positive()).min(1),
  many: z.enum(["toggle"]).optional(),
  /** The isotherms drawn in ink when the sim opens; the first four when absent. */
  shown: z.array(z.number().positive()).optional(),
});

/**
 * A galvanic cell under the Nernst equation (`src/sims/nernst/engine.ts`), written first | second:
 * the first electrode is oxidised as written. Students tune the two concentrations and the
 * temperature, never the cell; the 3D cell turns round when E < 0. No default sits inside `model`:
 * the recompute log's inputs are compared with it as written.
 */
const nernstSim = z.strictObject({
  kind: z.literal("nernst"),
  ...simCommon,
  model: z.strictObject({ first: halfCell, second: halfCell }),
  start: z.strictObject({ c1: z.number().positive(), c2: z.number().positive(), T: z.number().positive() }).optional(),
  tune: z
    .strictObject({
      c1: positiveRange("a concentration"),
      c2: positiveRange("a concentration"),
      T: positiveRange("a temperature in K"),
    })
    .optional(),
  plot: nernstPlot,
});

/**
 * An Agent-built sim (CONTEXT.md): a small model of the Professor's figure, which the engine runs
 * the same way in Node at build and in the page. Students tune it, never rewire it.
 */
export const sim = z
  .discriminatedUnion("kind", [
    gradientDescentSim,
    logicSim,
    tangentSim,
    planeWallSim,
    stlSim,
    sclSim,
    controlSim,
    ladderSim,
    pneumaticSim,
    fsmSim,
    grafcetSim,
    mechanismSim,
    nernstSim,
  ])
  .superRefine((s, ctx) => {
    if (s.kind === "mechanism") for (const p of mechanismProblems(s.model)) ctx.addIssue({ code: "custom", ...p });
    if (s.kind === "nernst") for (const p of nernstProblems(s.model)) ctx.addIssue({ code: "custom", ...p });
    if (s.kind === "ladder") for (const p of ladderSimProblems(s)) ctx.addIssue({ code: "custom", ...p });
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
    if (s.kind === "control") {
      const structure = schematicProblems(s.model, s.layout);
      for (const message of structure.length > 0 ? structure : loopProblems(s.model))
        ctx.addIssue({ code: "custom", path: ["model"], message });
    }
    if (s.kind === "pneumatic") {
      const structure = schematicProblems(s.model, s.layout);
      for (const message of structure.length > 0 ? structure : pneumaticProblems(s.model))
        ctx.addIssue({ code: "custom", path: ["model"], message });
      const buttons = s.model.parts.filter((p) => p.kind === "valve-32-button").map((p) => p.id);
      for (const key of ["start", "tune"] as const) {
        const given = Object.keys(s[key] ?? {});
        if (s[key] !== undefined && given.join() !== buttons.join())
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} gives ${given.join(", ") || "nothing"}, but the push buttons are ${buttons.join(", ")}, in that order`,
          });
      }
    }
    if (s.kind === "fsm" || s.kind === "grafcet") {
      const structure = diagramProblems(diagramOf(s.kind, s.model), s.layout);
      for (const message of structure.length > 0 ? structure : machineProblems(s.kind, s.model))
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
      for (const input of s.model.inputs) {
        const first = s.model.stimulus[input]?.[0];
        if (s.start !== undefined && first !== undefined && String(s.start[input]) !== first)
          ctx.addIssue({
            code: "custom",
            path: ["start", input],
            message: `start gives ${input} = ${s.start[input]}, but the example's first period has ${input} = ${first}: the sim opens on it`,
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
  "control",
  "ladder",
  "pneumatic",
  "fsm",
  "grafcet",
  "mechanism",
  "nernst",
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

/**
 * A molecule (2D structure and 3D viewer): drawn by RDKit at build from its SMILES
 * (`npm run molecules`), then checked against its stated formula and PubChem's record of its name.
 */
export const molecule = z.strictObject({
  title: z.string().min(1),
  caption: z.string().min(1),
  /** As the Materials name it: PubChem is asked for this name. */
  name: z.string().min(1),
  /** The structure, written from the Materials' drawing or name. */
  smiles: z.string().regex(/^[A-Za-z0-9@+\-[\]()=#$:/\\.%*]+$/, "a SMILES string, e.g. NCC(=O)O"),
  /** The formula the Materials print, any order, condensed allowed (NH2CH2COOH). */
  formula: z
    .string()
    .regex(/^[A-Za-z0-9()]+$/, "a formula of element symbols, digits and brackets")
    .optional(),
  /** The Worked example it sits in, by its file number in the Module's `worked/` folder. */
  worked: z.string().regex(/^\d+$/, "a Worked example's file number, e.g. 1").optional(),
  views: z
    .array(z.enum(["structure", "viewer"]))
    .min(1)
    .default(["structure", "viewer"]),
  ...tagged,
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

/** A kind of question as the Course's own taxonomy names it (`calculation`, `explain`): kebab-case. */
const questionType = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "a question type is lower-case letters, digits and dashes");

/**
 * A numeric answer in an Exam room question, checked by the site; `key` is the Professor's printed
 * key, as printed (`'0.25'`), on a past paper only.
 */
const examNumeric = z.strictObject({
  kind: z.literal("numeric"),
  value: z.number(),
  /** Absent for a dimensionless answer. */
  unit: z.string().min(1).optional(),
  tolerance: z.number().nonnegative(),
  key: z.string().min(1).optional(),
});

/** A written answer the student marks themselves: one point per mark in `earns`. */
const examProse = z.strictObject({
  kind: z.literal("prose"),
  model: z.string().min(1),
  earns: z.array(z.string().min(1)).min(1),
});

/** One question of a past paper or a mock; its number is its order in the file. */
const examQuestion = z.strictObject({
  /** The Module it examines, by folder name. */
  module: z.string().regex(MODULE_ID, "a Module is named by its folder, e.g. 01-thermal-resistance"),
  type: questionType,
  /** Gives the result and asks for an input. */
  reverse: z.boolean().default(false),
  marks: z.number().int().positive(),
  /** Verbatim from the settled reading, on a past paper. */
  question: z.string().min(1),
  answer: z.discriminatedUnion("kind", [examNumeric, examProse]),
});

/** A past paper of an Exam sitting: the Professor's questions, in the paper's order, with their marks and key. */
export const paper = z.strictObject({
  title: z.string().min(1),
  /** The printed total. */
  marks: z.number().int().positive(),
  minutes: z.number().int().positive(),
  /** `professor`: each numeric answer carries the Professor's printed key, or, where his key sheet leaves one out, is the build's solution (recomputed, and the Owner confirms it). `solved`: the build solved it, and the Owner confirms. */
  key: z.enum(["professor", "solved"]),
  questions: z.array(examQuestion).min(1),
  ...tagged,
});

/**
 * A mock for an Exam sitting: written to the past papers' question DNA (`dna`), or to the format the
 * Professor announced (`announced`), whose answers are never keyed.
 */
export const mock = z.strictObject({
  title: z.string().min(1),
  marks: z.number().int().positive(),
  minutes: z.number().int().positive(),
  pattern: z.enum(["dna", "announced"]),
  questions: z
    .array(examQuestion.extend({ answer: z.discriminatedUnion("kind", [examNumeric.omit({ key: true }), examProse]) }))
    .min(1),
  ...tagged,
});

/** The format the Professor announced for a sitting: its slots, in order. */
export const announcedFormat = z.strictObject({
  minutes: z.number().int().positive(),
  slots: z
    .array(
      z.strictObject({
        type: questionType,
        marks: z.number().int().positive(),
        reverse: z.boolean().optional(),
      }),
    )
    .min(1),
});

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
