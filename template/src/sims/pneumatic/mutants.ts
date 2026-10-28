// The pneumatic-cycle gate's negative controls on the engine: five broken engines, each run through
// a circuit's cycle at every build. A broken engine whose defect the cycle reaches (its states
// differ from the engine's) must disagree with the independent recompute's trace, or the gate can't
// see what it claims to. One whose defect the cycle never reaches (the cascade never has both
// pilots of a valve pressurised, so a signal overlap read the wrong way is never shown) is reported,
// not blocked.
import { PHYSICS, runCycle, type Cycle, type Physics, type PneumaticModel } from "./engine.ts";
import { compareTrace, type PneumaticLog } from "./log.ts";

export interface Mutant {
  defect: string;
  physics: Physics;
}

/** A 5/2 valve's boxes the other way round: its pilot 14 side passes what its 12 side does. */
const flipped = (state: "12" | "14") => (state === "14" ? "12" : "14");

export const MUTANTS: readonly Mutant[] = [
  {
    defect: "a 5/2 valve whose pilots act the wrong way round (14 connects 1 to 2)",
    physics: {
      ...PHYSICS,
      passages: (kind, state) => PHYSICS.passages(kind, kind === "valve-52" ? flipped(state as "12" | "14") : state),
    },
  },
  {
    defect: "a cylinder whose ports act the other way round (the rod port extends it)",
    physics: { ...PHYSICS, drive: (cap, rod) => PHYSICS.drive(rod, cap) },
  },
  {
    defect: "a roller valve made as its cylinder sets off towards it, not at the stroke's end",
    physics: { ...PHYSICS, made: (atEnd, away, toward) => (atEnd && !away) || toward },
  },
  {
    defect: "a 3/2 valve that passes air while released (normally open read as normally closed)",
    physics: {
      ...PHYSICS,
      passages: (kind, state) =>
        kind === "valve-32-roller" || kind === "valve-32-button"
          ? PHYSICS.passages(kind, state === "made" ? "freed" : "made")
          : PHYSICS.passages(kind, state),
    },
  },
  {
    defect:
      "a double-pilot valve that takes pilot 14 when both pilots are pressurised (a signal overlap read as a signal)",
    physics: { ...PHYSICS, pilot: (p14, p12, now) => (p14 ? "14" : PHYSICS.pilot(p14, p12, now)) },
  },
];

export interface ControlOutcome {
  defect: string;
  outcome: "caught" | "missed" | "not-reached";
}

/** A cycle as the recompute logs it: the circuit at rest, then at every step line. */
const logged = (cycle: Cycle) => JSON.stringify([cycle.rest, ...cycle.steps]);

/** Each broken engine through the circuit's cycle, against the true engine and the recompute's trace. */
export function runControls(
  model: PneumaticModel,
  held: Readonly<Record<string, number>>,
  trace: PneumaticLog["trace"],
): ControlOutcome[] {
  const truth = logged(runCycle(model, held));
  return MUTANTS.map(({ defect, physics }) => {
    let cycle: Cycle;
    try {
      cycle = runCycle(model, held, physics);
    } catch {
      // A broken engine that stops (a short, a circuit that never settles) differs from the true one.
      return { defect, outcome: "caught" };
    }
    if (logged(cycle) === truth) return { defect, outcome: "not-reached" };
    return { defect, outcome: compareTrace(cycle, trace).mismatches.length > 0 ? "caught" : "missed" };
  });
}
