// The Professor's solving table, filled to one step's state. Given columns are printed from the
// start in graphite; worked-out values are written in pencil, landing in hand order, and the red
// pen rings its marks once they have landed.
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { cellAt, type SheetData, type StepState } from "../../worked/sheet.ts";
import { PenRing } from "./pen.tsx";

/** Stagger between values landing: tighter when a step writes many. */
export const staggerFor = (count: number) => (count > 14 ? 0.024 : 0.034);
const LAND = 0.26;

export interface Shown {
  state: StepState;
  /** Values this step writes are still hidden: try-first, before the student has had a go. */
  hidden: boolean;
  /** Draw this step's changes (forward, motion allowed); otherwise render the state at once. */
  animate: boolean;
  /** Changes whenever the sheet must redraw without motion (going back, a jump). */
  epoch: number;
}

/** When this step's red-pen marks start: after the last value has landed. */
export const marksDelay = ({ state, animate }: Shown) =>
  animate && state.fresh.length > 0 ? state.fresh.length * staggerFor(state.fresh.length) + LAND : 0.1;

export function SheetTable({ table, shown }: { table: SheetData["table"]; shown: Shown }) {
  const { state, hidden, animate, epoch } = shown;
  const per = staggerFor(state.fresh.length);
  const marks = hidden ? [] : state.marks;
  const scroller = useRef<HTMLDivElement>(null);
  // A table wider than its box scrolls inside it; bring the cells this step writes into view.
  const lastFresh = state.fresh.at(-1);
  useEffect(() => {
    const box = scroller.current;
    const cell = lastFresh && box?.querySelector(`[data-cell="${lastFresh}"]`);
    if (!box || !cell) return;
    const inView = box.getBoundingClientRect();
    const at = cell.getBoundingClientRect();
    if (at.right > inView.right) box.scrollLeft += at.right - inView.right;
    else if (at.left < inView.left) box.scrollLeft -= inView.left - at.left;
  }, [lastFresh, state.index]);
  return (
    <figure className="min-w-0">
      <figcaption
        className="mbe-2 font-print text-caption font-bold text-graphite [font-variation-settings:'wdth'_80]"
        dangerouslySetInnerHTML={{ __html: table.captionHtml }}
      />
      <div ref={scroller} className="overflow-x-auto pbe-1">
        <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
          <thead>
            <tr>
              {table.columns.map((c, col) => (
                <th
                  key={col}
                  scope="col"
                  className="border border-pencil px-2 pbs-1 pbe-1.5 text-start align-bottom font-normal pad:px-3"
                >
                  <span className="field-label block" dangerouslySetInnerHTML={{ __html: c.labelHtml }} />
                  {c.unitHtml && (
                    <span className="block text-unit text-pencil" dangerouslySetInnerHTML={{ __html: c.unitHtml }} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="h-[29px]">
                {row.map((html, col) => {
                  const ref = cellAt(r, col);
                  const given = table.columns[col]?.given === true;
                  const order = state.fresh.indexOf(ref);
                  const waiting = hidden && order !== -1;
                  const written = given || (state.written.has(ref) && !waiting);
                  const markAt = marks.indexOf(ref);
                  return (
                    <td
                      key={col}
                      data-cell={ref}
                      className={`relative border border-pencil px-2 whitespace-nowrap pad:px-3 ${
                        col === 0 ? "font-prose" : "text-end"
                      } ${given ? "text-graphite" : "text-pencil"}`}
                    >
                      {waiting && <span className="try-blank" aria-label="yours to work out" />}
                      {written && html !== "" && (
                        <motion.span
                          key={epoch}
                          className="inline-block"
                          initial={animate && order !== -1 ? { opacity: 0, y: -2 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: LAND, ease: "easeOut", delay: Math.max(order, 0) * per }}
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      )}
                      {markAt !== -1 && (
                        <PenRing
                          key={`${state.index}:${epoch}`}
                          draw={animate}
                          delay={marksDelay(shown) + markAt * 0.09}
                          className="absolute inset-s-[-2px] inset-bs-[-2px] size-[calc(100%+4px)]"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
