// The step-through a sim falls back to when its model can't be recomputed: its figure as the
// Materials draw it, stepped with motion, nothing computed. Each step's state is what the sheet's
// plotted figure renders (`PlotFigure`), so it draws the way a Worked example's figure does.
import type { z } from "astro/zod";
import type { sim } from "../content/contract.ts";
import { toFigure, type FigureData, type StepState } from "../worked/sheet.ts";

type StepThroughSource = NonNullable<z.output<typeof sim>["stepThrough"]>;

export interface StepThroughData {
  figure: FigureData;
  steps: { captionHtml: string; add: string[]; ring: string[] }[];
}

/** The step-through with every prose field rendered by `html`. */
export function toStepThrough({ figure, steps }: StepThroughSource, html: (prose: string) => string): StepThroughData {
  return {
    figure: toFigure(figure, html, figure.question),
    steps: steps.map((s) => ({ captionHtml: html(s.caption), add: s.add, ring: s.ring })),
  };
}

/** What the figure shows at a step: the question's elements plus every step's additions so far. */
export function stepThroughAt(data: StepThroughData, requested: number): StepState {
  const index = Math.min(Math.max(requested, 0), data.steps.length - 1);
  const drawn = new Set(data.figure.question);
  for (const step of data.steps.slice(0, index + 1)) step.add.forEach((id) => drawn.add(id));
  const step = data.steps[index];
  if (!step) throw new Error("a step-through has at least two steps");
  return {
    index,
    written: new Set(),
    fresh: [],
    marks: [],
    drawn,
    added: step.add,
    rings: step.ring,
    captionHtml: step.captionHtml,
    last: index === data.steps.length - 1,
  };
}
