// The step-through a sim falls back to when no independent recompute can check its model: the
// figure as the Materials draw it, stepped with the sheet's motion (marks draw in, the red pen
// rings each new point), and nothing computed, so the student never sees an unverified sim.
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { stepThroughAt, type StepThroughData } from "../sims/step-through.ts";
import { Arrow } from "./worked/pen.tsx";
import { PlotFigure } from "./worked/PlotFigure.tsx";

interface Props {
  data: StepThroughData;
  /** What the figure is, for assistive tech. */
  label: string;
}

export default function StepThrough({ data, label }: Props) {
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [view, setView] = useState({ step: 0, animate: false, epoch: 0 });
  const captionId = useId();
  useEffect(() => setReady(true), []);
  const count = data.steps.length;
  const go = (to: number) =>
    setView((v) =>
      to < 0 || to >= count || to === v.step
        ? v
        : { step: to, animate: to > v.step, epoch: to > v.step ? v.epoch : v.epoch + 1 },
    );
  const state = stepThroughAt(data, view.step);
  const shown = { state, hidden: false, animate: view.animate && !reduced, epoch: view.epoch };

  return (
    <MotionConfig reducedMotion="user">
      <section className="sim step-through" aria-label={label} data-ready={ready} data-sim="step-through">
        <div className="step-through-grid">
          <PlotFigure figure={data.figure} shown={shown} captionId={captionId} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="button-print note-button label-action"
              disabled={!ready || view.step === 0}
              onClick={() => go(view.step - 1)}
            >
              <Arrow back />
              Prev
            </button>
            <span className="font-quantity text-graphite tabular-nums" aria-live="polite">
              Step {view.step + 1}
              <span className="text-pencil"> / {count}</span>
            </span>
            <button
              type="button"
              className="button-print-next note-button label-action"
              disabled={!ready || state.last}
              onClick={() => go(view.step + 1)}
            >
              Next
              <Arrow />
            </button>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
