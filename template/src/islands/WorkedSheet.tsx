// A Worked example as one solved sheet: title block, the Given box (passed in as static HTML),
// then the steps margin (a step strip on phones), the solving table with the step note below it,
// and the question figure pinned beside it (behind Table | Plot tabs on phones). Read-through by
// default; try-first hides each step's values until the student asks to see them.
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { stateAt, type SheetData } from "../worked/sheet.ts";
import { Arrow, DoneTick } from "./worked/pen.tsx";
import { PlotFigure } from "./worked/PlotFigure.tsx";
import { SheetTable, type Shown } from "./worked/SheetTable.tsx";

interface Props {
  sheet: SheetData;
  /** The Given box, rendered at build. */
  children?: ReactNode;
}

type Tab = "table" | "figure";

interface View {
  step: number;
  /** Draw this step's changes; false renders the state at once (going back, jumps back). */
  animate: boolean;
  /** Bumped to redraw every mark without motion. */
  epoch: number;
}

export default function WorkedSheet({ sheet, children }: Props) {
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ step: 0, animate: false, epoch: 0 });
  const [tryFirst, setTryFirst] = useState(false);
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(new Set());
  const [tab, setTab] = useState<Tab>(sheet.figure ? "figure" : "table");
  const [tabPicked, setTabPicked] = useState(false);
  const captionId = useId();
  useEffect(() => setReady(true), []);

  const count = sheet.steps.length;
  const state = stateAt(sheet, view.step);
  const hidden = tryFirst && !attempted.has(view.step);
  const shown: Shown = { state, hidden, animate: view.animate && !reduced, epoch: view.epoch };
  const step = sheet.steps[view.step];

  const go = (to: number) => {
    if (to < 0 || to >= count || to === view.step) return;
    const forward = to > view.step;
    const next = stateAt(sheet, to);
    setView((v) => ({ step: to, animate: forward, epoch: forward ? v.epoch : v.epoch + 1 }));
    // In try-first, stepping back or jumping ahead shows the steps passed over as worked.
    if (tryFirst) setAttempted((a) => new Set([...a, ...Array.from({ length: to }, (_, i) => i)]));
    // On a phone the region follows the work, until the student picks a tab themselves.
    if (!tabPicked && sheet.figure) {
      if (next.fresh.length > 0) setTab("table");
      else if (next.added.length > 0) setTab("figure");
    }
  };
  const reveal = () => {
    setAttempted((a) => new Set([...a, view.step]));
    setView((v) => ({ ...v, animate: true }));
  };
  const primary = () => (hidden ? reveal() : go(view.step + 1));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const onward = (event.key === "ArrowRight") !== rtl;
    if (onward) primary();
    else go(view.step - 1);
  };
  const pickTab = (t: Tab) => {
    setTab(t);
    setTabPicked(true);
  };

  const atEnd = view.step === count - 1 && !hidden;
  const nextLabel = hidden ? "Show" : "Next";
  const nextAria = hidden ? `Show step ${view.step + 1}` : "Next step";

  return (
    <MotionConfig reducedMotion="user">
      <section className="worked-sheet" aria-label="Worked example" onKeyDown={onKeyDown} data-ready={ready}>
        <div className="grid gap-px border-2 border-print bg-print worked-title-block">
          <TitleCell label="Title" className="worked-title">
            <h3
              className="font-print text-sheet-title-phone font-semibold text-graphite [font-variation-settings:'wdth'_87] pad:text-sheet-title"
              dangerouslySetInnerHTML={{ __html: sheet.titleHtml }}
            />
          </TitleCell>
          <TitleCell label="Example">
            <span
              className="font-quantity text-quantity text-graphite"
              dangerouslySetInnerHTML={{ __html: sheet.codeHtml }}
            />
          </TitleCell>
          <TitleCell label="Step">
            <span className="font-quantity text-[19px] leading-none font-medium text-graphite tabular-nums pad:text-[21px]">
              {view.step + 1}
              <span className="text-pencil"> / {count}</span>
            </span>
          </TitleCell>
          <TitleCell label="Mode">
            <button
              type="button"
              className="try-toggle label-action text-[14px]"
              aria-pressed={tryFirst}
              disabled={!ready}
              onClick={() => setTryFirst((t) => !t)}
            >
              <span className="try-box" aria-hidden="true">
                {tryFirst && <DoneTick draw={!reduced} />}
              </span>
              Try first
            </button>
          </TitleCell>
        </div>

        {children}

        <div className="worked-grid" data-tab={tab}>
          <nav className="worked-margin" aria-label="Steps">
            <span className="field-label block mbe-3">Steps</span>
            <ol className="space-y-2">
              {sheet.steps.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="step-link"
                    disabled={!ready}
                    aria-current={i === view.step ? "step" : undefined}
                    onClick={() => go(i)}
                  >
                    <StepBox index={i} current={view.step} draw={shown.animate} />
                    <span className="step-link-title" dangerouslySetInnerHTML={{ __html: s.titleHtml }} />
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="worked-strip">
            <button
              type="button"
              className="strip-button"
              aria-label="Previous step"
              disabled={!ready || view.step === 0}
              onClick={() => go(view.step - 1)}
            >
              <Arrow back />
            </button>
            <ol className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Steps">
              {sheet.steps.map((_, i) => (
                <li key={i} className="flex-1">
                  <button
                    type="button"
                    className="strip-box"
                    disabled={!ready}
                    aria-current={i === view.step ? "step" : undefined}
                    aria-label={`Step ${i + 1}`}
                    onClick={() => go(i)}
                  >
                    <StepBox index={i} current={view.step} draw={shown.animate} />
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="strip-button strip-next"
              aria-label={nextAria}
              disabled={!ready || atEnd}
              onClick={primary}
            >
              {hidden ? <span className="label-action text-[14px] text-sheet">Show</span> : <Arrow />}
            </button>
          </div>

          {sheet.figure && (
            <div className="worked-tabs" role="tablist" aria-label="Artefact view">
              {(["table", "figure"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  className="artefact-tab label-action text-[14px]"
                  aria-selected={tab === t}
                  disabled={!ready}
                  onClick={() => pickTab(t)}
                >
                  {t === "table" ? "Table" : "Plot"}
                </button>
              ))}
            </div>
          )}

          <div className="worked-table">
            <SheetTable table={sheet.table} shown={shown} />
          </div>

          {sheet.figure && (
            <div className="worked-figure">
              <PlotFigure figure={sheet.figure} shown={shown} captionId={captionId} />
            </div>
          )}

          <div className="worked-note" aria-live="polite">
            <div className="flex items-start gap-3">
              <span className="note-number" aria-hidden="true">
                {view.step + 1}
              </span>
              <h4
                className="min-w-0 flex-1 font-print text-title font-bold text-graphite [font-variation-settings:'wdth'_80]"
                dangerouslySetInnerHTML={{ __html: step?.titleHtml ?? "" }}
              />
              <div className="note-controls">
                <button
                  type="button"
                  className="button-print note-button label-action"
                  disabled={!ready || view.step === 0}
                  onClick={() => go(view.step - 1)}
                >
                  <Arrow back />
                  Prev
                </button>
                <button
                  type="button"
                  className="button-print-next note-button label-action"
                  aria-label={nextAria}
                  disabled={!ready || atEnd}
                  onClick={primary}
                >
                  {nextLabel}
                  <Arrow />
                </button>
              </div>
            </div>
            {hidden ? (
              <p className="mbs-2 max-w-[68ch] text-muted">
                Work this step on paper first, then press <span className="font-semibold text-graphite">Show</span>.
              </p>
            ) : (
              <div
                className="mbs-2 max-w-[68ch] leading-[1.55]"
                dangerouslySetInnerHTML={{ __html: step?.noteHtml ?? "" }}
              />
            )}
            {state.last && !hidden && (
              <div className="answer-frame m-1 mbs-4 inline-block bg-sheet px-3.5 pbs-[7px] pbe-[9px]">
                <span className="field-label block mbe-1">Answer</span>
                <p className="font-semibold text-graphite" dangerouslySetInnerHTML={{ __html: sheet.answerHtml }} />
              </div>
            )}
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}

function TitleCell({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col justify-between gap-2 bg-sheet px-3 pbs-[7px] pbe-[9px] text-pencil ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** A step's square box: graphite when current, ticked once done. */
function StepBox({ index, current, draw }: { index: number; current: number; draw: boolean }) {
  const done = index < current;
  return (
    <span className="step-box" data-state={index === current ? "current" : done ? "done" : "todo"}>
      {index + 1}
      {done && <DoneTick draw={draw && index === current - 1} />}
    </span>
  );
}
