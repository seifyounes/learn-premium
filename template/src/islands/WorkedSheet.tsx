// A Worked example as one solved sheet: title block, the Given box (passed in as static HTML),
// then the steps margin (a step strip on phones), the solving table with the step note below it,
// and the question figure pinned beside it (behind Table | Plot tabs on phones). Read-through by
// default; try-first hides each step's values until the student asks to see them.
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { markPlace, placeAnchor, recordStep } from "../progress/progress.ts";
import { readProgress, updateProgress } from "../progress/store.ts";
import type { SheetData } from "../worked/sheet.ts";
import { shownAt, startStepping, stepping, triedAt, type SteppingAction } from "../worked/stepping.ts";
import { Arrow, DoneTick } from "./worked/pen.tsx";
import { PlotFigure } from "./worked/PlotFigure.tsx";
import { SheetTable } from "./worked/SheetTable.tsx";

interface Props {
  sheet: SheetData;
  /** The Module's title, for the title block's topic cell (hidden on phones). */
  topicHtml: string;
  /** Where the student's progress through the example is kept. */
  module: string;
  /** Derived values, Slips and Divergences, rendered at build: shown with the answer. */
  outputsHtml: string;
  /** The Given box, rendered at build. */
  children?: ReactNode;
}

const WIDE = "(width >= 900px)";

export default function WorkedSheet({ sheet, topicHtml, module, outputsHtml, children }: Props) {
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [s, apply] = useReducer(
    (current: ReturnType<typeof startStepping>, action: SteppingAction) => stepping(sheet, current, action),
    sheet,
    startStepping,
  );
  // Where the student stopped moves only when they move; opening or resuming the sheet doesn't.
  const moved = useRef(false);
  const dispatch = (action: SteppingAction) => {
    moved.current = true;
    apply(action);
  };
  const root = useRef<HTMLElement>(null);
  const captionId = useId();
  useEffect(() => setReady(true), []);
  // The Given box is always open from 900px and collapsible below it. CSS shows it open where
  // `::details-content` is supported; this keeps the element's own state (and what assistive tech
  // reads) in step everywhere else.
  useEffect(() => {
    const given = root.current?.querySelector<HTMLDetailsElement>("details.given-box");
    if (!given) return;
    const wide = matchMedia(WIDE);
    const sync = () => (given.open = wide.matches);
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);

  const count = sheet.steps.length;
  const { code } = sheet;
  // Opened from the home page's resume note: back to the step the student stopped on.
  useEffect(() => {
    const last = readProgress().last;
    if (last?.kind !== "worked" || last.module !== module || last.code !== code) return;
    if (decodeURIComponent(location.hash.slice(1)) !== placeAnchor(last)) return;
    apply({ type: "go", to: last.step });
  }, [module, code]);
  const tried = triedAt(sheet, s);
  useEffect(() => {
    if (!ready) return;
    updateProgress((p) => {
      const next = recordStep(p, module, code, s.step, count, tried);
      return moved.current ? markPlace(next, { module, kind: "worked", code, step: s.step, steps: count }) : next;
    });
  }, [ready, module, code, s.step, count, tried]);
  const shown = shownAt(sheet, s, reduced);
  const { state, hidden } = shown;
  const current = sheet.steps[s.step];
  const go = (to: number) => dispatch({ type: "go", to });
  const onward = () => dispatch({ type: "onward" });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    if ((event.key === "ArrowRight") !== rtl) onward();
    else go(s.step - 1);
  };

  const atEnd = s.step === count - 1 && !hidden;
  const nextLabel = hidden ? "Show" : "Next";
  const nextAria = hidden ? `Show step ${s.step + 1}` : "Next step";

  return (
    <MotionConfig reducedMotion="user">
      <section ref={root} className="worked-sheet" aria-label="Worked example" onKeyDown={onKeyDown} data-ready={ready}>
        <div className="grid gap-px border-2 border-print bg-print worked-title-block">
          <TitleCell label="Topic" className="max-[900px]:hidden">
            <span className="text-body-small text-pencil" dangerouslySetInnerHTML={{ __html: topicHtml }} />
          </TitleCell>
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
            <span className="font-quantity text-quantity-title-phone font-medium whitespace-nowrap text-graphite tabular-nums pad:text-quantity-title">
              {s.step + 1}
              <span className="text-pencil"> / {count}</span>
            </span>
          </TitleCell>
          <TitleCell label="Mode" className="worked-mode">
            <button
              type="button"
              className="try-toggle label-action whitespace-nowrap"
              aria-pressed={s.tryFirst}
              disabled={!ready}
              onClick={() => dispatch({ type: "toggle-try-first" })}
            >
              <span className="try-box" aria-hidden="true">
                {s.tryFirst && <DoneTick draw={!reduced} />}
              </span>
              Try first
            </button>
          </TitleCell>
        </div>

        {children}

        <div className="worked-grid" data-tab={s.tab}>
          <nav className="worked-margin" aria-label="Steps">
            <span className="field-label block mbe-3">Steps</span>
            <ol className="space-y-2">
              {sheet.steps.map((item, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="step-link"
                    disabled={!ready}
                    aria-current={i === s.step ? "step" : undefined}
                    onClick={() => go(i)}
                  >
                    <StepBox index={i} current={s.step} draw={shown.animate} />
                    <span className="step-link-title" dangerouslySetInnerHTML={{ __html: item.titleHtml }} />
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
              disabled={!ready || s.step === 0}
              onClick={() => go(s.step - 1)}
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
                    aria-current={i === s.step ? "step" : undefined}
                    aria-label={`Step ${i + 1}`}
                    onClick={() => go(i)}
                  >
                    <StepBox index={i} current={s.step} draw={shown.animate} />
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="strip-button strip-next"
              aria-label={nextAria}
              disabled={!ready || atEnd}
              onClick={onward}
            >
              {hidden ? <span className="label-action text-sheet">Show</span> : <Arrow />}
            </button>
          </div>

          {sheet.figure && (
            <div className="worked-tabs" role="tablist" aria-label="Artefact view">
              {(["table", "figure"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  className="artefact-tab label-action"
                  aria-selected={s.tab === t}
                  disabled={!ready}
                  onClick={() => dispatch({ type: "pick-tab", tab: t })}
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
                {s.step + 1}
              </span>
              <h4
                className="min-w-0 flex-1 font-print text-title font-bold text-graphite [font-variation-settings:'wdth'_80]"
                dangerouslySetInnerHTML={{ __html: current?.titleHtml ?? "" }}
              />
              <div className="note-controls">
                <button
                  type="button"
                  className="button-print note-button label-action"
                  disabled={!ready || s.step === 0}
                  onClick={() => go(s.step - 1)}
                >
                  <Arrow back />
                  Prev
                </button>
                <button
                  type="button"
                  className="button-print-next note-button label-action"
                  aria-label={nextAria}
                  disabled={!ready || atEnd}
                  onClick={onward}
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
                dangerouslySetInnerHTML={{ __html: current?.noteHtml ?? "" }}
              />
            )}
            {state.last && !hidden && (
              <div className="answer-frame m-1 mbs-4 inline-block bg-sheet px-3.5 pbs-[7px] pbe-[9px]">
                <span className="field-label block mbe-1">Answer</span>
                <p className="font-semibold text-graphite" dangerouslySetInnerHTML={{ __html: sheet.answerHtml }} />
              </div>
            )}
            {state.last && !hidden && outputsHtml && (
              <div className="mbs-3 max-w-[68ch]" dangerouslySetInnerHTML={{ __html: outputsHtml }} />
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
