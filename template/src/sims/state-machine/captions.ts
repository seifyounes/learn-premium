// What the state-machine sim says about the clock it just ran, in the Materials' words: which
// edge the inputs took the machine along, and which outputs changed. The captions of the build's
// Fixture example are tested string for string.
import { outputsOf, stateName, type Machine, type Period } from "./engine.ts";

/** `x`, `x and y`, `m, a and b`. */
const listed = (items: readonly string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const nameOf = (machine: Machine, id: string) => {
  const s = machine.model.states.find((q) => q.id === id);
  return s ? stateName(machine.family, s) : id;
};

/** The situation in the Materials' words: `S0`, `step 0`, `steps 1 and 2`. */
const situation = (machine: Machine, ids: readonly string[]) => {
  const names = ids.map((id) => nameOf(machine, id));
  return machine.family === "grafcet" && ids.length > 1
    ? `steps ${listed(ids.map((id) => machine.model.states.find((s) => s.id === id)?.label ?? id))}`
    : listed(names);
};

/** `z = 0`, `KM1 = 0, KM2 = 1`. */
const values = (names: readonly string[], of: Readonly<Record<string, number>>) =>
  names.map((n) => `${n} = ${of[n] ?? 0}`).join(", ");

/** The caption the sim opens on. */
export function openingCaption(machine: Machine): string {
  const set = `Set ${listed(machine.model.inputs)} and press Clock.`;
  if (machine.family === "fsm")
    return `${situation(machine, machine.initial)} at reset, ${values(machine.model.outputs, outputsOf(machine, machine.initial))}. ${set}`;
  const labels = machine.initial.map((id) => machine.model.states.find((s) => s.id === id)?.label ?? id);
  const steps = labels.length === 1 ? `Step ${labels[0]}` : `Steps ${listed(labels)}`;
  return `${steps} active at the start. ${set}`;
}

/** The caption after clock `n` of the example's `total`: the period just run. */
export function clockCaption(machine: Machine, period: Period, total: number): string {
  const done = period.k === total ? ` The example's ${total} clocks are done.` : "";
  const after = outputsOf(machine, period.next);
  const changed = machine.model.outputs.filter((o) => (after[o] ?? 0) !== (period.outputs[o] ?? 0));
  const changes = changed.length > 0 ? `; ${values(changed, after)}` : "";
  if (machine.family === "fsm") {
    const inputs = values(machine.model.inputs, period.inputs);
    return `Clock ${period.k}: ${inputs} takes ${situation(machine, period.active)} to ${situation(machine, period.next)}${changes}.${done}`;
  }
  if (period.taken.length === 0)
    return `Clock ${period.k}: no receptivity holds; ${situation(machine, period.active)} ${period.active.length > 1 ? "stay" : "stays"} active.${done}`;
  const fired = period.taken.map((i) => machine.edges[i]).flatMap((e) => (e ? [e] : []));
  const labels = fired.map((e) => e.label).join(" and ");
  const links = fired.map((e) => `${nameOf(machine, e.from)} → ${nameOf(machine, e.to)}`).join(", ");
  const plural = fired.length > 1;
  return `Clock ${period.k}: ${labels} ${plural ? "hold" : "holds"}, so ${links} ${plural ? "fire" : "fires"}${changes}.${done}`;
}
