// The controls every live sim shares: a slider per tunable input, and an axis's name set beside its
// board rather than on it.
import { useId } from "react";
import { decimalsOf, printAt } from "../../sims/print.ts";
import type { Range } from "../../sims/tuning.ts";

/**
 * An axis's name, beside the board rather than on it: in the board's corner, or under the board
 * (`below`) where a box ending at its last tick leaves the corner no room.
 */
export function AxisName({ html, where, below = false }: { html: string; where: "x" | "y"; below?: boolean }) {
  return (
    <span className="sim-axis-name" data-axis={where} data-below={below || undefined}>
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

interface SliderProps {
  /** The input's name, as paper math or words. */
  name: string;
  range: Range;
  value: number;
  ready: boolean;
  onChange(value: number): void;
}

/** One tunable input: its name and value printed above a slider that snaps to its step. */
export function Slider({ name, range, value, ready, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className="sim-slider">
      <label htmlFor={id} className="sim-slider-head">
        <span dangerouslySetInnerHTML={{ __html: name }} />
        <output htmlFor={id} className="font-quantity text-graphite tabular-nums">
          {printAt(value, decimalsOf(range.step))}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={!ready}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}
