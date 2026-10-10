// The ladder gate's negative controls on the engine: six broken engines, each run on a model's cases
// at every build. A broken engine whose defect the cases reach (its scans differ from the engine's)
// must disagree with awlsim's log, or the gate can't see what it claims to. One whose defect the
// cases never reach (a model with no NC contact can't show a misread NC) is reported, not blocked.

import { runCase, SEMANTICS, type GateCase, type Semantics } from "./engine.ts";
import type { LadderModel } from "./model.ts";
import { asLogged, compareWithOracle, type LadderLog } from "./oracle.ts";

export interface Mutant {
  defect: string;
  semantics: Semantics;
}

export const MUTANTS: readonly Mutant[] = [
  {
    defect: "an NC contact read as an NO contact",
    semantics: { ...SEMANTICS, logic: (kind, ins, op) => SEMANTICS.logic(kind === "nc" ? "no" : kind, ins, op) },
  },
  {
    defect: "parallel branches joined in series (AND for OR)",
    semantics: { ...SEMANTICS, join: (levels) => (levels.every((b) => b === 1) ? 1 : 0) },
  },
  {
    defect: "an on-delay timer run as a pulse",
    semantics: {
      ...SEMANTICS,
      timer: (t, kind, rlo, s5t, now) => SEMANTICS.timer(t, kind === "SD" ? "SP" : kind, rlo, s5t, now),
    },
  },
  {
    defect: "an S5 timer one time-base step longer than its preset",
    semantics: { ...SEMANTICS, timer: (t, kind, rlo, s5t, now) => SEMANTICS.timer(t, kind, rlo, s5t + 1, now) },
  },
  {
    defect: "a TON that reads the clock one scan's worth late (100 ms)",
    semantics: { ...SEMANTICS, ton: (ton, ms) => SEMANTICS.ton(ton, Math.max(0, ms - 100)) },
  },
  {
    defect: "a counter that counts while CU holds, not on its rising edge",
    semantics: {
      ...SEMANTICS,
      countUp: (counter, rlo) => {
        if (rlo && counter.value < 999) counter.value += 1;
      },
    },
  },
];

export interface ControlOutcome {
  defect: string;
  outcome: "caught" | "missed" | "not-reached";
  detail?: string;
}

/** Each broken engine on the model's cases, against the true engine and awlsim's log. */
export function runControls(model: LadderModel, cases: readonly GateCase[], log: LadderLog): ControlOutcome[] {
  // What awlsim can see: memory and the timers' and counters' state after each scan (not the drawing's ink).
  const seen = (c: GateCase, s?: Semantics) => JSON.stringify(runCase(model, c, s).map((r) => asLogged(model, r)));
  const truth = cases.map((c) => seen(c));
  return MUTANTS.map(({ defect, semantics }) => {
    let reached: boolean;
    try {
      reached = cases.some((c, i) => seen(c, semantics) !== truth[i]);
    } catch {
      reached = true; // a broken engine that stops differs from the true one
    }
    if (!reached) return { defect, outcome: "not-reached" };
    const disagreement = compareWithOracle(model, cases, log, semantics).mismatches;
    return disagreement.length > 0
      ? { defect, outcome: "caught" }
      : { defect, outcome: "missed", detail: "its scans differ from the engine's, yet awlsim's log agrees with them" };
  });
}
