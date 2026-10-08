// The ladder sim's timing chart: each input and watched bit as a square trace over the last ten
// seconds of scans, a watched TIME (a TON's ET) as a ramp up to its preset, and each timer's delay
// measured in red pen from its input rising to its Q rising. Drawn at its own size so its labels
// stay at 13px; a narrow screen scrolls it inside its box.
import { measures, seconds, type Moment } from "../../sims/ladder/view.ts";
import type { LadderModel } from "../../sims/ladder/model.ts";

interface Props {
  model: LadderModel;
  history: readonly Moment[];
  /** Each TIME row's full scale (ms): the preset of the TON that writes it. */
  scales: Readonly<Record<string, number>>;
  label: string;
}

const LABEL_W = 64;
const PLOT_W = 440;
const ROW_H = 30;
const AXIS_H = 26;
const WINDOW_MS = 10_000;
const MEASURE_H = 26;

export function TimingChart({ model, history, scales, label }: Props) {
  const last = history.at(-1)?.ms ?? 0;
  const t1 = Math.max(WINDOW_MS, last);
  const t0 = t1 - WINDOW_MS;
  const shown = history.filter((m) => m.ms >= t0);
  const x = (ms: number) => LABEL_W + ((ms - t0) / WINDOW_MS) * PLOT_W;
  const bits = [
    ...model.inputs,
    ...Object.entries(model.watch)
      .filter(([, type]) => type === "BOOL")
      .map(([operand]) => operand),
  ];
  const ramps = Object.entries(model.watch)
    .filter(([operand, type]) => type === "TIME" && scales[operand])
    .map(([operand]) => operand);
  const rows = [...bits, ...ramps];
  const found = measures(model, history).filter((m) => m.to >= t0);
  const plotH = rows.length * ROW_H;
  const height = plotH + (found.length > 0 ? MEASURE_H : 0) + AXIS_H;
  const valueOf = (m: Moment, operand: string) => {
    if (operand in m.watch) return m.watch[operand] ?? 0;
    // An input: the bit as the scan read it.
    return m.inputs[operand] ?? 0;
  };
  const trace = (operand: string, row: number) => {
    const top = row * ROW_H;
    const scale = scales[operand];
    const y = (v: number) =>
      scale ? top + ROW_H - 6 - (Math.min(v, scale) / scale) * (ROW_H - 12) : v ? top + 6 : top + ROW_H - 6;
    const points: string[] = [];
    shown.forEach((m, i) => {
      const v = valueOf(m, operand);
      const prev = shown[i - 1];
      if (prev && !scale) points.push(`${x(m.ms)},${y(valueOf(prev, operand))}`);
      points.push(`${x(m.ms)},${y(v)}`);
    });
    return points.join(" ");
  };
  const ticks = Array.from({ length: WINDOW_MS / 1000 + 1 }, (_, i) => Math.ceil(t0 / 1000) * 1000 + i * 1000).filter(
    (ms) => ms <= t1,
  );
  return (
    <svg
      className="timing-chart"
      width={LABEL_W + PLOT_W + 16}
      height={height}
      viewBox={`0 0 ${LABEL_W + PLOT_W + 16} ${height}`}
      role="img"
      aria-label={label}
    >
      {ticks.map((ms) => (
        <line key={ms} className="timing-grid" x1={x(ms)} x2={x(ms)} y1={0} y2={plotH} />
      ))}
      {rows.map((operand, row) => (
        <g key={operand} data-row={operand}>
          <text className="timing-label" x={0} y={row * ROW_H + ROW_H / 2 + 5} fontSize={13}>
            {operand}
          </text>
          <line
            className="timing-base"
            x1={LABEL_W}
            x2={LABEL_W + PLOT_W}
            y1={row * ROW_H + ROW_H - 6}
            y2={row * ROW_H + ROW_H - 6}
          />
          <polyline className="timing-trace" points={trace(operand, row)} />
        </g>
      ))}
      {found.map((m) => {
        const y = plotH + MEASURE_H / 2;
        const [a, b] = [Math.max(LABEL_W, x(m.from)), x(m.to)];
        return (
          <g key={`${m.part}${m.from}`} className="timing-measure" data-measure={m.part}>
            <line x1={x(m.from)} x2={x(m.from)} y1={0} y2={y} className="timing-guide" />
            <line x1={b} x2={b} y1={0} y2={y} className="timing-guide" />
            <path
              d={`M${a} ${y}H${b}M${a + 5} ${y - 4}L${a} ${y}L${a + 5} ${y + 4}M${b - 5} ${y - 4}L${b} ${y}L${b - 5} ${y + 4}`}
            />
            <text className="timing-measure-text" x={(a + b) / 2} y={y - 5} textAnchor="middle" fontSize={13}>
              {seconds(m.to - m.from)}
            </text>
          </g>
        );
      })}
      {ticks
        .filter((ms) => ms % 2000 === 0)
        .map((ms) => (
          <text key={ms} className="timing-label" x={x(ms)} y={height - 6} textAnchor="middle" fontSize={13}>
            {ms / 1000} s
          </text>
        ))}
    </svg>
  );
}
