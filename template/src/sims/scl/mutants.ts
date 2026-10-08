// The scl gate's negative controls, run on every listing at every build: each mutant is the
// interpreter broken one known way, and the comparison with the blind interpreter must catch every
// mutant whose defect the listing's cases reach. A mutant counts only when its run really differs
// from the interpreter's (the float64 lesson of #37: the first float64 mutant slipped through
// because assigning to a REAL re-rounds it), and one that differs but passes means the gate is blind.

import { INTERPRETER, runCase, type GateCase, type Interpreter, type SclModel } from "./engine.ts";
import { compareWithBlind, type BlindScan } from "./oracle.ts";
import { parseScl } from "./parse.ts";

export interface ControlResult {
  id: string;
  defect: string;
  /** `caught`: its defect showed and the comparison saw it; `missed`: it showed and passed; `not-reached`: no case shows it. */
  outcome: "caught" | "missed" | "not-reached";
  detail?: string;
}

const MUTANTS: { id: string; defect: string; interpreter: Interpreter }[] = [
  {
    id: "real-float64",
    defect: "REAL arithmetic kept in float64, never rounded to float32",
    interpreter: { ...INTERPRETER, real: (x) => x },
  },
  {
    id: "int-unwrapped",
    defect: "INT and DINT results that don't wrap past their range",
    interpreter: { ...INTERPRETER, integer: (exact) => Number(exact) },
  },
  {
    id: "ties-up",
    defect: "REAL_TO_INT and ROUND rounding a tie up instead of to the even number",
    interpreter: { ...INTERPRETER, nearest: "up" },
  },
  {
    id: "exit-ignored",
    defect: "EXIT ignored: the loop runs on",
    interpreter: { ...INTERPRETER, exits: false },
  },
  {
    id: "for-short",
    defect: "a FOR that stops before its end value",
    interpreter: { ...INTERPRETER, forReachesEnd: false },
  },
  {
    id: "statics-forgotten",
    defect: "an FB that forgets its statics between scans",
    interpreter: { ...INTERPRETER, staticsKept: false },
  },
  {
    id: "compare-loose",
    defect: "< and > that hold for equal values",
    interpreter: { ...INTERPRETER, strictCompare: false },
  },
];

/**
 * A run's every value after its first `compared` scans (the ones the blind interpreter gives values
 * for, so the comparison can see them), or where it stopped, as one comparable string per case.
 */
function fingerprint(model: SclModel, c: GateCase, interpreter: Interpreter, compared: number): string {
  try {
    const { scans } = runCase(model, c.scans.slice(0, compared), interpreter, parseScl(model.source));
    return JSON.stringify(
      scans.map((s) => [
        s.error ?? "",
        Object.entries(s.values).map(([k, v]) => [k, v.type, Object.is(v.value, -0) ? "-0" : v.value]),
      ]),
    );
  } catch (error) {
    return `throws ${(error as Error).message}`;
  }
}

const signature = (a: ReturnType<typeof compareWithBlind>) =>
  new Set([
    ...a.mismatches,
    ...a.parted.map((p) => `${p.where}: ${p.detail}`),
    ...a.stopped.map((p) => `${p.where}: ${p.at}`),
  ]);

/** Runs every mutant on the listing's cases; each one whose defect shows must be caught by the comparison with the blind interpreter. */
export function runControls(
  model: SclModel,
  cases: readonly GateCase[],
  blind: readonly (BlindScan[] | Error)[],
): ControlResult[] {
  // A scan the blind interpreter stops on (or a case it can't run) compares nothing.
  const compared = cases.map((c, i) => {
    const runs = blind[i];
    if (!runs || runs instanceof Error) return 0;
    const stop = runs.findIndex((scan) => "stopped" in scan);
    return stop < 0 ? c.scans.length : stop;
  });
  const good = cases.map((c, i) => fingerprint(model, c, INTERPRETER, compared[i] ?? 0));
  const baseline = signature(compareWithBlind(model, cases, blind));
  return MUTANTS.map(({ id, defect, interpreter }) => {
    const shows = cases.findIndex((c, i) => fingerprint(model, c, interpreter, compared[i] ?? 0) !== good[i]);
    if (shows < 0) return { id, defect, outcome: "not-reached" };
    // Caught when the comparison's verdict changes: a new disagreement, or (where a value was
    // already in dispute) one the defect happens to settle.
    const broken = signature(compareWithBlind(model, cases, blind, interpreter));
    const found = [
      ...[...broken].filter((s) => !baseline.has(s)),
      ...[...baseline].filter((s) => !broken.has(s)).map((s) => `no longer: ${s}`),
    ];
    return found.length > 0
      ? { id, defect, outcome: "caught", detail: found[0] ?? "" }
      : {
          id,
          defect,
          outcome: "missed",
          detail: `it shows in ${cases[shows]?.name ?? "a case"}, and the comparison passes it`,
        };
  });
}
