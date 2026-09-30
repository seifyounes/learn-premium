// The Worked example sheet as the island sees it, and the state of the sheet at any step. Pure:
// the page builds the sheet at build time and the island renders any step straight from its state,
// so going back is a fresh render of the earlier step, never an undo.
import type { z } from "astro/zod";
import type { FILL_ORDERS, worked } from "../content/contract.ts";
import { parseCell } from "./cells.ts";

export type Worked = z.output<typeof worked>;
export type FillOrder = (typeof FILL_ORDERS)[number];
type Plot = NonNullable<Worked["figure"]>;
type PlotElement = Plot["elements"][number];
/** Which side of its mark a label sits on; `start` and `end` run along the x axis. */
export type LabelSide = Extract<PlotElement, { kind: "point" }>["side"];

export interface AxisData {
  labelHtml: string;
  unitHtml?: string;
  min: number;
  max: number;
  step: number;
}

export type ElementData =
  | { id: string; kind: "point"; at: [number, number]; labelHtml?: string; side: LabelSide }
  | { id: string; kind: "line"; through: [number, number][]; labelHtml?: string }
  | { id: string; kind: "guide"; x: number; labelHtml?: string };

export interface FigureData {
  captionHtml: string;
  x: AxisData;
  y: AxisData;
  elements: ElementData[];
  question: string[];
}

export interface StepData {
  titleHtml: string;
  noteHtml: string;
  fill: string[];
  marks: string[];
  figure?: { add: string[]; ring: string[]; captionHtml?: string };
}

/** Everything the Worked sheet island renders, prose already turned into HTML with paper math. */
export interface SheetData {
  titleHtml: string;
  codeHtml: string;
  fillOrder: FillOrder;
  table: {
    captionHtml: string;
    columns: { labelHtml: string; unitHtml?: string; given: boolean }[];
    /** Cell HTML by row, then column; a blank cell is "". */
    rows: string[][];
  };
  figure?: FigureData;
  steps: StepData[];
  answerHtml: string;
}

/** Cells in the order a hand writes them: column by column top to bottom, or row by row. */
export function handOrder(refs: readonly string[], order: FillOrder): string[] {
  const keyed = refs.map((ref) => ({ ref, ...parseCell(ref) }));
  const [first, second] = order === "columns" ? (["col", "row"] as const) : (["row", "col"] as const);
  return keyed.sort((a, b) => a[first] - b[first] || a[second] - b[second]).map((c) => c.ref);
}

export interface StepState {
  /** The step, counted from 0. */
  index: number;
  /** Worked-out cells whose values are on the sheet (given columns are always there). */
  written: ReadonlySet<string>;
  /** Cells this step writes, in hand order: the order they land in. */
  fresh: string[];
  /** Cells the red pen rings at this step. */
  marks: string[];
  /** Figure elements on the sheet: the question figure plus every earlier step's additions. */
  drawn: ReadonlySet<string>;
  /** Figure elements first drawn at this step. */
  added: string[];
  /** Figure elements the red pen rings at this step. */
  rings: string[];
  captionHtml?: string;
  last: boolean;
}

export function stateAt(sheet: SheetData, requested: number): StepState {
  const index = Math.min(Math.max(requested, 0), sheet.steps.length - 1);
  const written = new Set<string>();
  const drawn = new Set<string>(sheet.figure?.question ?? []);
  for (const step of sheet.steps.slice(0, index + 1)) {
    step.fill.forEach((ref) => written.add(ref));
    step.figure?.add.forEach((id) => drawn.add(id));
  }
  const step = sheet.steps[index];
  if (!step) throw new Error("a Worked example has at least one step");
  const captionHtml = step.figure?.captionHtml ?? sheet.figure?.captionHtml;
  return {
    index,
    written,
    fresh: handOrder(step.fill, sheet.fillOrder),
    marks: step.marks,
    drawn,
    added: step.figure?.add ?? [],
    rings: step.figure?.ring ?? [],
    ...(captionHtml === undefined ? {} : { captionHtml }),
    last: index === sheet.steps.length - 1,
  };
}

/** The sheet for one Worked example, with every prose field rendered by `html`. */
export function toSheet(example: Worked, html: (prose: string) => string): SheetData {
  const withUnit = <T extends { label: string; unit?: string | undefined }>({ label, unit }: T) => ({
    labelHtml: html(label),
    ...(unit === undefined ? {} : { unitHtml: html(unit) }),
  });
  const label = (text: string | undefined) => (text === undefined ? {} : { labelHtml: html(text) });
  const axis = (a: Plot["x"]): AxisData => ({ ...withUnit(a), min: a.min, max: a.max, step: a.step });
  const element = (e: PlotElement): ElementData => {
    const { label: text, ...rest } = e;
    return { ...rest, ...label(text) };
  };
  const { artefact, figure } = example;
  return {
    titleHtml: html(example.title),
    codeHtml: html(example.code),
    fillOrder: example.fillOrder,
    table: {
      captionHtml: html(artefact.caption),
      columns: artefact.columns.map((c) => ({ ...withUnit(c), given: c.given })),
      rows: artefact.rows.map((row) => row.map((cell) => (cell === "" ? "" : html(cell)))),
    },
    ...(figure === undefined
      ? {}
      : {
          figure: {
            captionHtml: html(figure.caption),
            x: axis(figure.x),
            y: axis(figure.y),
            elements: figure.elements.map(element),
            question: figure.question,
          },
        }),
    steps: example.steps.map((s) => ({
      titleHtml: html(s.title),
      noteHtml: html(s.note),
      fill: s.fill,
      marks: s.marks,
      ...(s.figure === undefined
        ? {}
        : {
            figure: {
              add: s.figure.add,
              ring: s.figure.ring,
              ...(s.figure.caption === undefined ? {} : { captionHtml: html(s.figure.caption) }),
            },
          }),
    })),
    answerHtml: html(example.answer),
  };
}
