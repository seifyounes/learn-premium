// A state diagram drawn on the sheet from the layout core's drawing: states (circles, a double circle
// for the accepting one; GRAFCET's squares, a double square for the initial step) in graphite, edges
// in pencil with their arrowheads and labels, the edge the clock will take inked in graphite, and a
// token in each active state that travels the taken edge. Drawn at its own size and never scaled, so
// labels stay at 13px; a wide diagram scrolls inside its box. No red pen in it: nothing here is a
// measurement to read.
import { arrowPath, pathOf, pointAt } from "../../sims/layout/curves.ts";
import type { DiagramDrawing } from "../../sims/layout/diagram.ts";
import { actionBox } from "../../sims/layout/diagram.ts";
import { LABEL_PX } from "../../sims/layout/drawing.ts";
import { STEP_HALF, type StateDiagramKind } from "../../sims/layout/state-diagram.ts";
import { symbolOf, transformOf } from "../../sims/layout/symbols.ts";

interface Props {
  drawing: DiagramDrawing;
  /** The model edge each drawn edge is, read from geometry at build (−1 for none). */
  edges: readonly number[];
  /** The active states. */
  active: readonly string[];
  /** The states whose token is on its way out along a travelling edge. */
  leaving: readonly string[];
  /** The model edges the next clock will take, inked in graphite. */
  next: readonly number[];
  /** The model edges the last clock took, kept inked lightly. */
  taken: readonly number[];
  /** The tokens on their way: the model edges and how far along them, 0 … 1. */
  travel?: { edges: readonly number[]; t: number } | undefined;
  label: string;
}

const isStep = (kind: StateDiagramKind) => kind === "step" || kind === "step-initial";

/** The classes of an edge group. */
const edgeClass = (model: number, next: readonly number[], taken: readonly number[]) =>
  ["diagram-edge-group", next.includes(model) && "is-next", taken.includes(model) && "is-taken"]
    .filter(Boolean)
    .join(" ");

export function StateDiagram({ drawing, edges, active, leaving, next, taken, travel, label }: Props) {
  return (
    <svg
      className="schematic state-diagram"
      width={drawing.width}
      height={drawing.height}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      role="img"
      aria-label={label}
    >
      {drawing.start && (
        <g className="diagram-start" data-start>
          <line
            className="diagram-edge"
            x1={drawing.start.tail[0]}
            y1={drawing.start.tail[1]}
            x2={drawing.start.tip[0]}
            y2={drawing.start.tip[1]}
          />
          <path
            className="diagram-arrow"
            d={arrowPath({
              tip: drawing.start.tip,
              dir: [
                (drawing.start.tip[0] - drawing.start.tail[0]) / 40,
                (drawing.start.tip[1] - drawing.start.tail[1]) / 40,
              ],
            })}
          />
        </g>
      )}
      {drawing.edges.map((e, i) => {
        const model = edges[i] ?? -1;
        return (
          <g key={i} data-edge={model} className={edgeClass(model, next, taken)}>
            <path className="diagram-edge" d={pathOf(e.curve)} />
            <path className="diagram-arrow" d={arrowPath(e.arrow)} />
            {e.bar && (
              <line className="diagram-bar" x1={e.bar[0][0]} y1={e.bar[0][1]} x2={e.bar[1][0]} y2={e.bar[1][1]} />
            )}
          </g>
        );
      })}
      {drawing.edgeLabels.map((t) => (
        <text key={`${t.x},${t.y}`} className="schematic-label diagram-edge-label" x={t.x} y={t.y} fontSize={LABEL_PX}>
          {t.text}
        </text>
      ))}
      {drawing.states.map((part) => {
        const def = symbolOf(part.kind);
        const on = active.includes(part.id);
        const step = isStep(part.kind as StateDiagramKind);
        return (
          <g key={part.id} data-state={part.id} data-active={on || undefined}>
            <g transform={transformOf(part)} className={`schematic-symbol${on ? " is-high" : ""}`}>
              {def.body && <path className="diagram-body" d={def.body} />}
              {def.circles?.map(([cx, cy, r]) => (
                <circle key={`${cx},${cy},${r}`} className="schematic-circle" cx={cx} cy={cy} r={r} />
              ))}
            </g>
            {part.label && (
              <text className="schematic-label" x={part.label.x} y={part.label.y} fontSize={LABEL_PX}>
                {part.label.text}
              </text>
            )}
            {part.notes?.map((note) => {
              const [x0, y0, x1, y1] = actionBox(part, note);
              return (
                <g key={`${note.x},${note.y}`} className="diagram-action">
                  <line className="diagram-connector" x1={part.x + STEP_HALF} y1={part.y} x2={x0} y2={part.y} />
                  <rect className="diagram-action-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
                  <text className="schematic-label schematic-note" x={note.x} y={note.y} fontSize={LABEL_PX}>
                    {note.text}
                  </text>
                </g>
              );
            })}
            {on && !leaving.includes(part.id) && (
              <circle
                className="diagram-token"
                data-token={part.id}
                cx={part.x}
                cy={part.y + (step ? 13 : 17)}
                r={step ? 3.5 : 4}
              />
            )}
          </g>
        );
      })}
      {travel?.edges.map((model) => {
        const index = edges.indexOf(model);
        const e = drawing.edges[index];
        if (!e) return null;
        const [x, y] = pointAt(e.curve, travel.t);
        return (
          <circle
            key={model}
            className="diagram-token"
            data-travel={travel.t.toFixed(3)}
            data-travel-edge={model}
            cx={x}
            cy={y}
            r={4}
          />
        );
      })}
    </svg>
  );
}
