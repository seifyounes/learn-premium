// The two state machines the tests run: the Fixture Course's '101' detector (a Moore FSM) and the
// drill's GRAFCET, as the Fixture Course's Module 14 writes them.
import type { MachineModel } from "../src/sims/state-machine/engine.ts";

export const detector: MachineModel = {
  states: [
    { id: "S0", kind: "state", label: "S0" },
    { id: "S1", kind: "state", label: "S1" },
    { id: "S2", kind: "state", label: "S2" },
    { id: "S3", kind: "state-accepting", label: "S3", out: ["z"] },
  ],
  edges: [
    { from: "S0", to: "S0", label: "0" },
    { from: "S0", to: "S1", label: "1" },
    { from: "S1", to: "S1", label: "1" },
    { from: "S1", to: "S2", label: "0" },
    { from: "S2", to: "S0", label: "0" },
    { from: "S2", to: "S3", label: "1" },
    { from: "S3", to: "S1", label: "1" },
    { from: "S3", to: "S2", label: "0" },
  ],
  initial: "S0",
  inputs: ["x"],
  outputs: ["z"],
  encoding: { variables: ["Q1", "Q0"], codes: { S0: "00", S1: "01", S2: "10", S3: "11" } },
  equations: [
    { name: "D1", gives: "Q1", expr: "Q0·x' + Q1·Q0'·x" },
    { name: "D0", gives: "Q0", expr: "x" },
    { name: "z", gives: "z", expr: "Q1·Q0" },
  ],
  stimulus: { x: "011010100" },
};

export const drill: MachineModel = {
  states: [
    { id: "X0", kind: "step-initial", label: "0" },
    { id: "X1", kind: "step", label: "1", out: ["KM1"] },
    { id: "X2", kind: "step", label: "2", out: ["KM2"] },
  ],
  edges: [
    { from: "X0", to: "X1", label: "m·a" },
    { from: "X1", to: "X2", label: "b" },
    { from: "X2", to: "X0", label: "a" },
  ],
  inputs: ["m", "a", "b"],
  outputs: ["KM1", "KM2"],
  stimulus: { m: "010000000", a: "111000011", b: "000011000" },
};

export const detectorLayout = {
  states: {
    S0: { at: [0, 1], loop: "below" },
    S1: { at: [2, 0], loop: "above" },
    S2: { at: [2, 2] },
    S3: { at: [4, 1] },
  },
  edges: { "S2>S3": { bow: "below" }, "S3>S2": { bow: "above" } },
  start: "left",
} as const;

export const drillLayout = {
  states: { X0: { at: [1, 0] }, X1: { at: [1, 1.2] }, X2: { at: [1, 2.4] } },
  edges: { "X2>X0": { bow: "left" } },
} as const;
