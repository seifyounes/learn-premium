// A timing diagram on the sheet: each row a band, the key (the Worked example's own diagram) drawn
// in pencil and the run inked over it in graphite, a numbered box at every step line. Generic: a
// pneumatic circuit's displacement-step diagram, and later an FSM's timing strip. Drawn at its own
// size and never scaled, so labels stay at 13px and level marks at 12px; a narrow screen scrolls it
// inside its box. There is no red pen in it: nothing here is a measurement to read.
import {
  DIAGRAM,
  diagramSize,
  lineX,
  quantityOf,
  rowPath,
  type Now,
  type TimingRow,
} from "../../sims/timing/diagram.ts";

interface Props {
  rows: readonly TimingRow[];
  /** The step lines the diagram draws, 1 … lines. */
  lines: number;
  /** The key's levels, by quantity name (`A[3]`): the Worked example's cells as printed. */
  keyLevels: Readonly<Record<string, number>>;
  /** The run's levels so far, by the same names. */
  live: Readonly<Record<string, number>>;
  /** The movement under way, which the live path stops part-way along. */
  now?: Now | undefined;
  label: string;
}

/** The step line the run has reached: the movement under way, else the last line it has a level at. */
function currentLine(rows: readonly TimingRow[], lines: number, live: Readonly<Record<string, number>>, now?: Now) {
  if (now) return now.line;
  for (let k = lines; k >= 1; k--) if (rows.some((row) => quantityOf(row.id, k) in live)) return k;
  return 0;
}

/** A row's band, from its top. */
const top = (index: number) => DIAGRAM.axisH + index * DIAGRAM.rowH;

export function TimingDiagram({ rows, lines, keyLevels, live, now, label }: Props) {
  const { width, height } = diagramSize(rows.length, lines);
  const current = currentLine(rows, lines, live, now);
  const ruleEnd = top(rows.length);
  return (
    <svg
      className="timing-diagram"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {Array.from({ length: lines }, (_, i) => i + 1).map((k) => (
        <line key={k} className="timing-rule" x1={lineX(k)} x2={lineX(k)} y1={DIAGRAM.axisH} y2={ruleEnd} />
      ))}
      {rows.map((row, i) => (
        <g key={row.id} data-row={row.id}>
          <text className="timing-label" x={0} y={top(i) + DIAGRAM.rowH / 2 + 5} fontSize={13}>
            {row.label}
          </text>
          <text className="timing-level" x={66} y={top(i) + 12} fontSize={12}>
            1
          </text>
          <text className="timing-level" x={66} y={top(i) + DIAGRAM.rowH - 6} fontSize={12}>
            0
          </text>
          <path className="timing-key" data-key-row={row.id} d={rowPath(row, i, lines, keyLevels)} />
          <path className="timing-live" data-live-row={row.id} d={rowPath(row, i, lines, live, now)} />
        </g>
      ))}
      {Array.from({ length: lines }, (_, i) => i + 1).map((k) => (
        <g key={k} data-step-box={k} className={k === current ? "timing-step is-current" : "timing-step"}>
          <rect x={lineX(k) - 12} y={4} width={24} height={24} />
          <text x={lineX(k)} y={21} textAnchor="middle" fontSize={13}>
            {k}
          </text>
        </g>
      ))}
    </svg>
  );
}
