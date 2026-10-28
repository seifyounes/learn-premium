// The captions a pneumatic run is told in: each step's causal chain in the order the circuit
// settles (a roller made, a line changing, a valve shifting, a cylinder setting off). Written from
// the engine's events alone, so a caption can only say what the engine did.
import type { Level, PneumaticModel } from "./model.ts";
import type { PneumaticEvent } from "./engine.ts";

/** A movement as the page prints it: the minus sign is U+2212. */
export const display = (movement: string) => movement.replace(/-$/, "−");

/** One step's story: what ended or was pressed, then what that set off, in order. */
export function stepCaption(model: PneumaticModel, events: readonly PneumaticEvent[], done = false): string {
  const signal = new Set(model.signals);
  const buttons = new Set(model.parts.filter((p) => p.kind === "valve-32-button").map((p) => p.id));
  const head = [
    ...events.flatMap((e) => (e.kind === "end" ? [`${e.part} ${e.at === "extended" ? "out" : "back"}`] : [])),
    ...events.flatMap((e) => (e.kind === "press" ? [`${e.part} pressed`] : [])),
  ].join(", ");
  const chain: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length > 0) chain.push(lines.join(", "));
    lines = [];
  };
  const say = (text: string) => {
    flush();
    chain.push(text);
  };
  for (const e of events) {
    if (e.kind === "line") {
      if (signal.has(e.net)) lines.push(`line ${e.net} ${e.level ? "on" : "off"}`);
    } else if (e.kind === "made") {
      // A button's own made and freed are its press and release.
      if (!buttons.has(e.part)) say(`${e.part} made`);
    } else if (e.kind === "shift") say(`${e.part} shifts to ${e.to}`);
    else if (e.kind === "overlap") say(`${e.part} has both pilots pressurised (a signal overlap)`);
    else if (e.kind === "start")
      say(`${e.part} ${e.dir === 1 ? "extends" : "retracts"} (${display(`${e.part}${e.dir === 1 ? "+" : "-"}`)})`);
    else if (e.kind === "release") say(`${e.part} let go`);
  }
  flush();
  if (done) chain.push("back at rest, the cycle is done");
  if (chain.length === 0) return head === "" ? "Nothing changes." : head;
  return head === "" ? chain.join("; ") : `${head}: ${chain.join("; ")}`;
}

/** The circuit at rest, from the lines it settles to: which signal lines are on, and what to press. */
export function restCaption(model: PneumaticModel, lines: Readonly<Record<string, Level>>): string {
  const on = model.signals.filter((id) => lines[id] === 1).map((id) => `line ${id} on`);
  const sequence = model.sequence.map(display).join(" ");
  return `At rest: ${on.length > 0 ? on.join(", ") : "no signal line on"}. Press ${model.press.join(", ")} to run ${sequence}.`;
}
