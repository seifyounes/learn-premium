// The logic sim (an Agent-built sim): the Professor's gate circuit, redrawn by the layout core,
// beside its truth table. Tapping a row, or an input, sets the inputs; every wire carrying a 1 inks
// in over its pencil line, and the red pen rings the row's outputs. Students set inputs, never
// rewire the gates. It opens on the Worked example's row, and the engine is the one the build's
// truth-table gate replays.
import { MotionConfig } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import type { Drawing } from "../sims/layout/drawing.ts";
import { levels, rowName, truthTable, type Bit, type LogicModel } from "../sims/logic/engine.ts";
import { Schematic } from "./sim/Schematic.tsx";
import { PenRing } from "./worked/pen.tsx";
import { MARK_PAUSE } from "./worked/timing.ts";

interface Props {
  model: LogicModel;
  /** The figure, laid out at build from the model and its Layout hints. */
  drawing: Drawing;
  /** Each wire's net and each dot's, read from the drawing's geometry at build. */
  nets: { wires: (string | undefined)[]; dots: (string | undefined)[] };
  /** The Worked example's input bits: the sim opens on them. */
  start: Record<string, Bit>;
  /** What the sim is, for assistive tech. */
  label: string;
}

export default function LogicSim({ model, drawing, nets, start, label }: Props) {
  const [ready, setReady] = useState(false);
  const [bits, setBits] = useState<Record<string, Bit>>(start);
  // The opening drawing is inked at once; a change the student makes draws itself in.
  const [touched, setTouched] = useState(false);
  const captionId = useId();
  useEffect(() => setReady(true), []);

  const rows = useMemo(() => truthTable(model), [model]);
  const level = useMemo(() => levels(model, bits), [model, bits]);
  const current = rowName(model, bits);
  const terminalNets = useMemo(
    () =>
      Object.fromEntries(
        [...model.inputs, ...model.outputs].map((id) => [id, model.nets.find((n) => n.pins.includes(`${id}.t`))?.id]),
      ),
    [model],
  );
  const labelOf = (id: string) => model.parts.find((p) => p.id === id)?.label ?? id;
  const valueOf = (id: string): Bit => {
    const net = terminalNets[id];
    return net === undefined ? 0 : (level[net] ?? 0);
  };
  const set = (next: Record<string, Bit>) => {
    setTouched(true);
    setBits(next);
  };

  return (
    <MotionConfig reducedMotion="user">
      <section className="sim logic-sim" aria-label={label} data-ready={ready} data-sim="logic">
        <div className="logic-grid">
          <figure className="sim-figure logic-figure" aria-labelledby={captionId}>
            <div className="logic-stage" dir="ltr">
              <Schematic
                drawing={drawing}
                nets={nets}
                high={(net) => net !== undefined && level[net] === 1}
                draw={touched}
                terminalNets={terminalNets}
                label={`${label}: the circuit with inputs ${model.inputs.map((id) => `${labelOf(id)} = ${bits[id] ?? 0}`).join(", ")}`}
              />
            </div>
            <figcaption id={captionId} className="sim-caption">
              <span className="field-label pbs-[3px]">Fig.</span>
              <span>The figure's circuit. A wire carrying a 1 is inked; a 0 stays in pencil.</span>
            </figcaption>
          </figure>

          <div className="logic-controls">
            <span className="field-label">Inputs</span>
            <div className="flex flex-wrap gap-2">
              {model.inputs.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="button-print note-button logic-input"
                  aria-pressed={bits[id] === 1}
                  disabled={!ready}
                  onClick={() => set({ ...bits, [id]: bits[id] === 1 ? 0 : 1 })}
                >
                  {/* The terminal's name as the figure prints it, never set in capitals. */}
                  <span className="font-quantity">{labelOf(id)}</span>
                  <span className="font-quantity font-semibold tabular-nums">{bits[id] ?? 0}</span>
                </button>
              ))}
            </div>
            <p className="sim-readout" aria-live="polite">
              {model.outputs.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  {labelOf(id)} = <span className="font-quantity">{valueOf(id)}</span>
                </span>
              ))}
            </p>
          </div>

          <div className="logic-table">
            <div className="table-box">
              <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
                <thead>
                  <tr>
                    <th scope="col" className="border border-pencil p-0 font-normal">
                      <span
                        className="logic-bits"
                        style={{ gridTemplateColumns: `repeat(${model.inputs.length}, minmax(2.75rem, 1fr))` }}
                      >
                        {model.inputs.map((id) => (
                          <span key={id}>{labelOf(id)}</span>
                        ))}
                      </span>
                    </th>
                    {model.outputs.map((id) => (
                      <th
                        key={id}
                        scope="col"
                        className="border border-pencil px-3 pbs-1 pbe-1.5 text-center font-normal"
                      >
                        {labelOf(id)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isCurrent = row.name === current;
                    return (
                      <tr key={row.name} className="h-[33px]" data-row={row.name} data-current={isCurrent || undefined}>
                        <td className="border border-pencil p-0">
                          <button
                            type="button"
                            className="logic-row"
                            aria-current={isCurrent || undefined}
                            aria-label={`Set ${model.inputs.map((id) => `${labelOf(id)} = ${row.bits[id]}`).join(", ")}`}
                            disabled={!ready}
                            onClick={() => set(row.bits)}
                          >
                            <span
                              className="logic-bits"
                              style={{ gridTemplateColumns: `repeat(${model.inputs.length}, minmax(2.75rem, 1fr))` }}
                            >
                              {model.inputs.map((id) => (
                                <span key={id}>{row.bits[id]}</span>
                              ))}
                            </span>
                          </button>
                        </td>
                        {model.outputs.map((id) => {
                          const net = terminalNets[id];
                          return (
                            <td key={id} className="relative border border-pencil px-3 text-center text-pencil">
                              {net === undefined ? "" : row.levels[net]}
                              {isCurrent && (
                                <PenRing
                                  key={current}
                                  draw={touched}
                                  delay={MARK_PAUSE}
                                  className="absolute inset-s-[-2px] inset-bs-[-2px] size-[calc(100%+4px)]"
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
