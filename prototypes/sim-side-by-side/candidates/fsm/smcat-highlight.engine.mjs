// PROTOTYPE: the "tiny engine" behind the smcat candidate. A lookup table and nothing else.
import { DETECTOR_101 as M } from "./machine-101.mjs";
export const init = M.init;
export const next = (state, x) => M.transitions.find((t) => t.from === state && t.when.X === x).to;
export const z = (state) => M.states.find((s) => s.id === state).out.Z;
