// The layout core through its public interface: a model and its Layout hints in, a drawing out.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDrawing, figureReading } from "../src/sims/layout/check.ts";
import type { Drawing, LayoutHints, SchematicModel } from "../src/sims/layout/drawing.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { GRID, pinsOf, SYMBOL_KINDS, TURNS, type Point } from "../src/sims/layout/symbols.ts";
import { FIXTURE_COURSE } from "./build-course";

const read = (entry: string) =>
  JSON.parse(readFileSync(join(FIXTURE_COURSE, entry), "utf8")) as Record<string, unknown>;
const adder = read("modules/04-full-adder/sims/adder.json") as { model: SchematicModel; layout: LayoutHints };
const reading = figureReading.parse(read("build-records/figure/04-full-adder/adder.json"));

const onGrid = ([x, y]: Point) => x % GRID === 0 && y % GRID === 0;
const pinOf = (d: Drawing, key: string) => {
  const [id, name] = key.split(".") as [string, string];
  const part = d.parts.find((p) => p.id === id);
  if (!part) throw new Error(`no part ${id}`);
  return pinsOf(part)[name] as Point;
};
/** The wire that ends on `key`, and the point next to that end. */
const wireAt = (d: Drawing, key: string) => {
  const at = pinOf(d, key);
  for (const w of d.wires) {
    const [first, second] = w.points;
    const [last, beforeLast] = [w.points.at(-1), w.points.at(-2)];
    if (first && second && first[0] === at[0] && first[1] === at[1]) return { at, next: second };
    if (last && beforeLast && last[0] === at[0] && last[1] === at[1]) return { at, next: beforeLast };
  }
  throw new Error(`no wire ends on ${key}`);
};

describe("the layout core", () => {
  it("draws the full adder from its hints alone: every part, pin and wire corner on the 20px grid", () => {
    const d = layOut(adder.model, adder.layout);
    expect(d.unrouted).toEqual([]);
    expect(d.parts.map((p) => p.id).sort()).toEqual(adder.model.parts.map((p) => p.id).sort());
    for (const part of d.parts) {
      expect(onGrid([part.x, part.y]), `${part.id} at ${part.x}, ${part.y}`).toBe(true);
      for (const [name, at] of Object.entries(pinsOf(part))) expect(onGrid(at), `${part.id}.${name}`).toBe(true);
    }
    for (const w of d.wires) for (const p of w.points) expect(onGrid(p), `corner ${p.join(", ")}`).toBe(true);
  });

  it("draws a full adder that passes every Drawing gate check, against its model and the Blind reader's figure", () => {
    const verdict = checkDrawing(layOut(adder.model, adder.layout), adder.model, reading);
    expect(verdict.checks.filter((c) => c.problems.length > 0)).toEqual([]);
    expect(verdict.checks.map((c) => c.id)).toEqual([
      "parts",
      "connectivity",
      "labels",
      "conventions",
      "legibility",
      "tidiness",
      "netlist",
      "arrangement",
      "turn",
      "label side",
      "symbols",
      "dots",
    ]);
  });

  it("draws the same drawing every time", () => {
    expect(layOut(adder.model, adder.layout)).toEqual(layOut(adder.model, adder.layout));
  });

  it("reaches every gate input from its side and leaves every output from its side", () => {
    const d = layOut(adder.model, adder.layout);
    for (const gate of ["G1", "G2", "G3", "G4", "G5"]) {
      for (const input of ["in1", "in2"]) {
        const { at, next } = wireAt(d, `${gate}.${input}`);
        expect(next[1], `${gate}.${input} is met level`).toBe(at[1]);
        expect(next[0], `${gate}.${input} is met from the left`).toBeLessThan(at[0]);
      }
      const { at, next } = wireAt(d, `${gate}.out`);
      expect(next[1]).toBe(at[1]);
      expect(next[0]).toBeGreaterThan(at[0]);
    }
  });

  it("joins a gate's output straight into the next gate's input when the hints line them up", () => {
    const d = layOut(adder.model, adder.layout);
    const { at, next } = wireAt(d, "G1.out");
    // G1.out feeds G3.in1 and G4.in1: its wire runs level to the right before it branches.
    expect(next[1]).toBe(at[1]);
    expect(pinOf(d, "G3.in1")[1]).toBe(at[1]);
  });

  it("dots the joints of the nets the figure dots, and only those", () => {
    const dotted = layOut(adder.model, adder.layout);
    expect(dotted.dots).toHaveLength(4);
    const undotted = layOut(adder.model, { ...adder.layout, dots: [] });
    expect(undotted.dots).toEqual([]);
    expect(undotted.wires).toEqual(dotted.wires);
  });

  it("puts each label on the side the figure prints it", () => {
    const d = layOut(adder.model, adder.layout);
    const g1 = d.parts.find((p) => p.id === "G1");
    const g2 = d.parts.find((p) => p.id === "G2");
    const cin = d.parts.find((p) => p.id === "Cin");
    expect(g1?.label && g1.label.y < g1.y).toBe(true);
    expect(g2?.label && g2.label.y > g2.y).toBe(true);
    expect(cin?.label && cin.label.x < cin.x).toBe(true);
  });

  const divider: SchematicModel = {
    parts: [
      { id: "Vin", kind: "port", label: "Vin" },
      { id: "R1", kind: "resistor", label: "R1" },
      { id: "R2", kind: "resistor", label: "R2" },
      { id: "Vout", kind: "port", label: "Vout" },
      { id: "GND1", kind: "ground" },
    ],
    nets: [
      { id: "in", pins: ["Vin.t", "R1.1"] },
      { id: "mid", pins: ["R1.2", "R2.1", "Vout.t"] },
      { id: "gnd", pins: ["R2.2", "GND1.g"] },
    ],
  };
  const dividerHints: LayoutHints = {
    parts: {
      Vin: { at: [0, 0.3], label: "left" },
      R1: { at: [1, 0], label: "above" },
      R2: { at: [2, 1], turn: 90, label: "right" },
      Vout: { at: [3, 0], label: "right" },
      GND1: { at: [2.3, 2.4] },
    },
  };

  it("straightens a terminal hinted a little off the pin it feeds, so their wire is straight", () => {
    const d = layOut(divider, dividerHints);
    const { at, next } = wireAt(d, "Vin.t");
    expect(next[1]).toBe(at[1]);
    expect(at[1]).toBe(pinOf(d, "R1.1")[1]);
    const vin = d.wires.find((w) => w.points.some((p) => p[0] === at[0] && p[1] === at[1]));
    expect(vin?.points).toHaveLength(2);
  });

  it("seats a ground directly under the pin it serves", () => {
    const d = layOut(divider, dividerHints);
    const ground = pinOf(d, "GND1.g");
    const served = pinOf(d, "R2.2");
    expect(ground[0]).toBe(served[0]);
    expect(ground[1]).toBeGreaterThan(served[1]);
    expect(d.unrouted).toEqual([]);
  });

  it("draws a divider that passes the drawing ↔ model checks", () => {
    const verdict = checkDrawing(layOut(divider, dividerHints), divider);
    expect(verdict.checks.filter((c) => c.problems.length > 0)).toEqual([]);
  });

  it("puts every pin of every symbol on the 20px grid, whichever way it is turned or mirrored", () => {
    for (const kind of SYMBOL_KINDS)
      for (const turn of TURNS)
        for (const flip of [false, true]) {
          const pins = pinsOf({ kind, x: 100, y: 100, turn, flip });
          for (const [name, at] of Object.entries(pins))
            expect(onGrid(at), `${kind}.${name} at turn ${turn}`).toBe(true);
        }
  });
});
