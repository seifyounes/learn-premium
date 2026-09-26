// PROTOTYPE (throwaway): the one machine every FSM candidate shows (see machine.md).
// Data only: a Moore "101" sequence detector, overlapping, one input X, one output Z.
export const DETECTOR_101 = {
  name: "Moore 101 detector (overlapping)",
  kind: "moore",
  inputs: ["X"],
  outputs: ["Z"],
  init: "S0",
  states: [
    { id: "S0", meaning: "reset: nothing useful seen", out: { Z: 0 } },
    { id: "S1", meaning: "seen 1", out: { Z: 0 } },
    { id: "S2", meaning: "seen 10", out: { Z: 0 } },
    { id: "S3", meaning: "seen 101: detected", out: { Z: 1 } },
  ],
  transitions: [
    { from: "S0", when: { X: 0 }, to: "S0" },
    { from: "S0", when: { X: 1 }, to: "S1" },
    { from: "S1", when: { X: 0 }, to: "S2" },
    { from: "S1", when: { X: 1 }, to: "S1" },
    { from: "S2", when: { X: 0 }, to: "S0" },
    { from: "S2", when: { X: 1 }, to: "S3" },
    { from: "S3", when: { X: 0 }, to: "S2" },
    { from: "S3", when: { X: 1 }, to: "S1" },
  ],
  encoding: { bits: ["Q1", "Q0"], codes: { S0: "00", S1: "01", S2: "10", S3: "11" } },
  flipflop: "D",
  test: { X: [1, 0, 1, 0, 1, 1, 0, 1] },
};
