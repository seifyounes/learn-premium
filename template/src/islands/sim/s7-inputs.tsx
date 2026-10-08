// The inputs a student sets on an S7 listing (STL or SCL): a key for each BOOL, and a slider with a
// typed value for each number. Only values the input's type holds, inside its range, are taken.
import { useId, useState } from "react";
import { fits, type S7Type } from "../../sims/s7/core.ts";
import type { Range } from "../../sims/tuning.ts";

interface InputKeysProps {
  /** Every input, with its type, in the listing's order: an STL operand or an SCL VAR_INPUT. */
  types: Readonly<Record<string, S7Type>>;
  tune: Record<string, Range>;
  inputs: Readonly<Record<string, number>>;
  ready: boolean;
  onChange(name: string, value: number): void;
}

/** A key for each BOOL a student sets, and a slider with its value for each number. */
export function InputKeys({ types, tune, inputs, ready, onChange }: InputKeysProps) {
  const tuned = Object.entries(types).filter(([name]) => tune[name] !== undefined);
  const bits = tuned.filter(([, type]) => type === "BOOL");
  const numbers = tuned.filter(([, type]) => type !== "BOOL");
  return (
    <div className="stl-inputs">
      {bits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {bits.map(([name]) => (
            <button
              key={name}
              type="button"
              className="button-print note-button logic-input"
              aria-pressed={inputs[name] === 1}
              disabled={!ready}
              onClick={() => onChange(name, inputs[name] === 1 ? 0 : 1)}
            >
              <span className="font-quantity">{name}</span>
              <span className="font-quantity font-semibold tabular-nums">{inputs[name] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {numbers.map(([name, type]) => (
        <NumberInput
          key={name}
          name={name}
          type={type}
          range={tune[name] as Range}
          value={inputs[name] ?? 0}
          ready={ready}
          onChange={(v) => onChange(name, v)}
        />
      ))}
    </div>
  );
}

function NumberInput(props: {
  name: string;
  type: S7Type;
  range: Range;
  value: number;
  ready: boolean;
  onChange(v: number): void;
}) {
  const { name, type, range, value, ready, onChange } = props;
  const id = useId();
  // What is typed stays as typed; a value the input can hold, inside the range, is taken.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const take = (text: string) => {
    setDraft(text);
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v) && v >= range.min && v <= range.max && fits(type, v)) onChange(v);
  };
  return (
    <div className="sim-slider">
      <div className="sim-slider-head">
        <label htmlFor={id} className="font-quantity">
          {name} <span className="text-pencil">({type})</span>
        </label>
        <input
          type="text"
          inputMode={type === "REAL" ? "decimal" : "numeric"}
          className="stl-number-input font-quantity tabular-nums"
          aria-label={`${name}, typed`}
          value={draft ?? String(value)}
          disabled={!ready}
          onChange={(event) => take(event.currentTarget.value)}
          onBlur={() => setDraft(undefined)}
        />
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={!ready}
        onChange={(event) => {
          setDraft(undefined);
          onChange(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
