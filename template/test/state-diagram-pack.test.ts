// The state-diagram symbol pack on the layout core: a state, the accepting state's double circle, a
// GRAFCET step and the initial step's double square. Pure geometry, no browser.
import { describe, expect, it } from "vitest";
import { figureReading } from "../src/sims/layout/check.ts";
import { textBox, type SchematicModel } from "../src/sims/layout/drawing.ts";
import { place } from "../src/sims/layout/place.ts";
import {
  ACCEPTING_R,
  FSM_KINDS,
  GRAFCET_KINDS,
  outlineOf,
  STATE_DIAGRAM_KINDS,
  STATE_DIAGRAM_SYMBOLS,
  STATE_R,
  STEP_HALF,
} from "../src/sims/layout/state-diagram.ts";
import { SYMBOL_KINDS, symbolOf } from "../src/sims/layout/symbols.ts";

describe("the state-diagram pack joins the kit", () => {
  it("each kind is a SymbolKind a reading can name", () => {
    expect(STATE_DIAGRAM_KINDS).toEqual(["state", "state-accepting", "step", "step-initial"]);
    expect(FSM_KINDS).toEqual(["state", "state-accepting"]);
    expect(GRAFCET_KINDS).toEqual(["step", "step-initial"]);
    for (const kind of STATE_DIAGRAM_KINDS) expect(SYMBOL_KINDS, kind).toContain(kind);
    const reading = {
      reading: "learn-premium figure reading v1",
      by: "test",
      parts: { S3: { kind: "state-accepting", at: [0.5, 0.5], turn: 0 } },
      nets: [{ pins: ["S3.t"] }],
    };
    expect(figureReading.safeParse(reading).success).toBe(true);
  });

  it("has no pins: an edge meets a state anywhere on its outline", () => {
    for (const kind of STATE_DIAGRAM_KINDS) {
      expect(symbolOf(kind).pins, kind).toEqual({});
      expect(symbolOf(kind).orientation, kind).toEqual({ by: "any" });
    }
  });
});

describe("the accepting state is a double circle", () => {
  it("draws two concentric circles, both inside its box; a plain state has one", () => {
    const def = symbolOf("state-accepting");
    expect(def.circles).toEqual([
      [0, 0, 30],
      [0, 0, 25],
    ]);
    const [x0, y0, x1, y1] = def.box;
    for (const [cx, cy, r] of def.circles ?? []) {
      expect(cx - r).toBeGreaterThanOrEqual(x0);
      expect(cx + r).toBeLessThanOrEqual(x1);
      expect(cy - r).toBeGreaterThanOrEqual(y0);
      expect(cy + r).toBeLessThanOrEqual(y1);
    }
    expect(symbolOf("state").circles).toEqual([[0, 0, 30]]);
    expect(STATE_R).toBe(30);
    expect(ACCEPTING_R).toBe(25);
  });
});

describe("the initial step is a double square", () => {
  it("holds both squares in its body, a step one", () => {
    expect(symbolOf("step").body).toBe("M-20 -20H20V20H-20Z");
    expect(symbolOf("step-initial").body).toBe("M-20 -20H20V20H-20ZM-16 -16H16V16H-16Z");
    expect(STEP_HALF).toBe(20);
  });
});

describe("labels and actions", () => {
  it("every kind prints its name inside; a step prints its actions in the action slot, clear of its body", () => {
    for (const kind of STATE_DIAGRAM_KINDS) expect(symbolOf(kind).labelInside, kind).toBe(true);
    const model: SchematicModel = {
      parts: [{ id: "X1", kind: "step", label: "1", notes: { action: "KM1" } }],
      nets: [],
    };
    const [part] = place(model, { parts: { X1: { at: [1, 1] } } });
    expect(part?.notes).toHaveLength(1);
    const note = part?.notes?.[0];
    expect(note && { x: note.x - (part?.x ?? 0), y: note.y - (part?.y ?? 0) }).toEqual({ x: 48, y: 5 });
    expect(note && textBox(note)[0] - (part?.x ?? 0)).toBeGreaterThan(STEP_HALF);
    // The label sits centred in the body.
    expect(part?.label?.text).toBe("1");
  });

  it("a state's name of four characters fits inside the inner circle", () => {
    const model: SchematicModel = { parts: [{ id: "S3", kind: "state-accepting", label: "S3/1" }], nets: [] };
    const [part] = place(model, { parts: { S3: { at: [1, 1] } } });
    const label = part?.label;
    const [x0, y0, x1, y1] = label ? textBox(label) : [0, 0, 0, 0];
    const corners = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ] as const;
    for (const [x, y] of corners) expect(Math.hypot(x - (part?.x ?? 0), y - (part?.y ?? 0))).toBeLessThan(ACCEPTING_R);
  });
});

describe("each kind's outline", () => {
  it("is a circle of 30 for a state, a square of 20 for a step", () => {
    expect(outlineOf("state")).toEqual({ shape: "circle", r: 30 });
    expect(outlineOf("state-accepting")).toEqual({ shape: "circle", r: 30 });
    expect(outlineOf("step")).toEqual({ shape: "square", half: 20 });
    expect(outlineOf("step-initial")).toEqual({ shape: "square", half: 20 });
    expect(Object.keys(STATE_DIAGRAM_SYMBOLS)).toEqual([...STATE_DIAGRAM_KINDS]);
  });
});
