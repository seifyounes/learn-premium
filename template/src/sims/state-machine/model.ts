// A state machine as the Materials draw it: the Professor's Moore state diagram or GRAFCET, as
// states and labelled edges. No engine import: the engine re-exports this file.
import type { DiagramModel } from "../layout/diagram.ts";
import type { StateDiagramKind } from "../layout/state-diagram.ts";

export type Family = "fsm" | "grafcet";

export interface MachineState {
  id: string;
  kind: StateDiagramKind;
  /** The name the figure prints in it: S0, or a step's number. */
  label: string;
  /** The outputs it sets to 1 while active: a Moore state's output, a step's actions. */
  out?: readonly string[] | undefined;
}

export interface MachineModel {
  states: readonly MachineState[];
  edges: readonly { from: string; to: string; label: string }[];
  inputs: readonly string[];
  outputs: readonly string[];
  /** The FSM's reset state. */
  initial?: string | undefined;
  /** The FSM's state variables and each state's code on them. */
  encoding?: { variables: readonly string[]; codes: Readonly<Record<string, string>> } | undefined;
  /** The equations the Materials print: `name = expr`, giving a state variable (its next value) or an output. */
  equations?: readonly { name: string; gives: string; expr: string }[] | undefined;
  /** The input bits clock period by clock period, as the Worked example gives them. */
  stimulus: Readonly<Record<string, string>>;
}

/** How captions and the table name a state: `S0`, or `step 0`. */
export function stateName(family: Family, s: MachineState): string {
  return family === "grafcet" ? `step ${s.label}` : s.label;
}

/** What the figure prints in it: `S3/1` (name / output bits in `outputs` order), or a step's number. */
export function printedLabel(family: Family, model: MachineModel, s: MachineState): string {
  return family === "grafcet" ? s.label : `${s.label}/${outputBits(model, s)}`;
}

const outputBits = (model: MachineModel, s: MachineState) =>
  model.outputs.map((o) => (s.out?.includes(o) ? "1" : "0")).join("");

/** The model as the layout core draws it: names, printed labels and outputs, a step's actions as its `action` note. */
export function diagramOf(family: Family, model: MachineModel): DiagramModel {
  const states = model.states.map((s) => {
    const actions = (s.out ?? []).join(", ");
    return {
      id: s.id,
      kind: s.kind,
      name: s.label,
      label: printedLabel(family, model, s),
      ...(family === "fsm"
        ? { output: outputBits(model, s) }
        : actions !== ""
          ? { output: actions, notes: { action: actions } }
          : {}),
    };
  });
  return {
    states,
    edges: model.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    style: family === "fsm" ? "arcs" : "links",
    ...(family === "fsm" ? { initial: model.initial } : {}),
  };
}
