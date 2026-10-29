// What the 3D cell shows at a state, and the one rule the cell and the gate share: which electrode
// is the anode, and which way the electrons run. Pure; imports no colour. The cell is written
// first | second, so the first electrode is the anode while E > 0, and the cell turns round when
// E < 0: the electrons, the anode and cathode labels and the voltmeter's sign all swap.
import { printAt } from "../print.ts";
import { cellPotential, ionText, type Inputs, type Model } from "./engine.ts";

export type Electrode = "first" | "second";
/** The electrons' way round the wire, as the cell is written. */
export type Flow = "first-to-second" | "second-to-first" | "none";

/** Under this |E| (V) no current flows: no anode, no cathode, no electrons. */
export const NO_CURRENT_V = 1e-12;

export interface CellState {
  E: number;
  anode: Electrode | null;
  cathode: Electrode | null;
  flow: Flow;
  solutions: Record<Electrode, { ion: string; c: number; opacity: number }>;
}

/** How dense a solution is drawn: 0.1 for a trace, up to 0.65 for a strong one. */
export function solutionOpacity(c: number): number {
  return Math.min(0.65, Math.max(0.1, 0.1 + 0.55 * (1 - 10 ** -c)));
}

export function cellState(m: Model, i: Inputs): CellState {
  const { E } = cellPotential(m, i);
  const flowing = Math.abs(E) >= NO_CURRENT_V;
  const anode: Electrode | null = !flowing ? null : E > 0 ? "first" : "second";
  const cathode: Electrode | null = anode === null ? null : anode === "first" ? "second" : "first";
  return {
    E,
    anode,
    cathode,
    flow: anode === null ? "none" : anode === "first" ? "first-to-second" : "second-to-first",
    solutions: {
      first: { ion: m.first.ion, c: i.c1, opacity: solutionOpacity(i.c1) },
      second: { ion: m.second.ion, c: i.c2, opacity: solutionOpacity(i.c2) },
    },
  };
}

export type CellAnchor =
  "first-electrode" | "second-electrode" | "first-solution" | "second-solution" | "voltmeter" | "wire" | "bridge";

/** A space a label never breaks at: a value and its unit, or a role in brackets, stay together. */
const NB = " ";

/**
 * The words at each part of the cell, as plain Unicode text. `d` is the decimals of E and of c. A
 * label may wrap at its ordinary spaces (it hangs in a narrow gutter), never inside a value or a role.
 */
export function cellLabels(m: Model, s: CellState, d: { E: number; c: number }): Record<CellAnchor, string> {
  const electrode = (which: Electrode) => {
    const role = s.anode === which ? `anode${NB}(−)` : s.cathode === which ? `cathode${NB}(+)` : `no${NB}current`;
    return `${m[which].metal}, ${role}`;
  };
  const solution = (which: Electrode) =>
    `${ionText(s.solutions[which].ion)} ${printAt(s.solutions[which].c, d.c)}${NB}M`;
  return {
    "first-electrode": electrode("first"),
    "second-electrode": electrode("second"),
    "first-solution": solution("first"),
    "second-solution": solution("second"),
    voltmeter: `E = ${printAt(s.E, d.E)}${NB}V`,
    wire: s.flow === "first-to-second" ? "e⁻ →" : s.flow === "second-to-first" ? "← e⁻" : "no current",
    bridge: "salt bridge",
  };
}
