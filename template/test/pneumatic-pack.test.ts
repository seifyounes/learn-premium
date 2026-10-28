// The pneumatic symbol pack on the layout core: five ISO 1219 symbols, legible at 12px, pins on the
// 20px grid, every flow a valve draws one the engine runs. Pure geometry, no browser.
import { describe, expect, it } from "vitest";
import { checkDrawing, figureReading } from "../src/sims/layout/check.ts";
import type { LayoutHints, SchematicModel } from "../src/sims/layout/drawing.ts";
import { modelNets } from "../src/sims/layout/geometry.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import {
  cylinderMoving,
  PNEUMATIC_KINDS,
  PNEUMATIC_SYMBOLS,
  STROKE_PX,
  valveBoxes,
  valveOffset,
} from "../src/sims/layout/pneumatic.ts";
import { GRID, SYMBOL_KINDS, symbolOf, type SymbolDef } from "../src/sims/layout/symbols.ts";
import { PHYSICS } from "../src/sims/pneumatic/engine.ts";

describe("the pneumatic pack joins the kit", () => {
  it("each pneumatic kind is a SymbolKind a figure reading can name", () => {
    for (const kind of PNEUMATIC_KINDS) expect(SYMBOL_KINDS, kind).toContain(kind);
    expect(PNEUMATIC_KINDS).toEqual(["cylinder", "valve-52", "valve-32-roller", "valve-32-button", "air-source"]);
    const reading = {
      reading: "learn-premium figure reading v1",
      by: "test",
      parts: { VA: { kind: "valve-52", at: [0.5, 0.5], turn: 0 } },
      nets: [{ pins: ["VA.1"] }],
    };
    expect(figureReading.safeParse(reading).success).toBe(true);
    expect(
      figureReading.safeParse({ ...reading, parts: { VA: { kind: "valve-99", at: [0, 0], turn: 0 } } }).success,
    ).toBe(false);
  });

  it("is drawn for turn 0: a full orientation for every part but the air source", () => {
    for (const kind of PNEUMATIC_KINDS)
      expect(symbolOf(kind).orientation, kind).toEqual(kind === "air-source" ? { by: "any" } : { by: "full" });
  });
});

/** The router blocks every cell within 4px of a body: a pin there can't be left. */
const BODY_CLEARANCE = 4;
const onGrid = (v: number) => v % GRID === 0;

describe("pins", () => {
  it("every pneumatic symbol's pins sit on the 20px grid, each clear of its own body by more than the router's 4px clearance", () => {
    for (const kind of PNEUMATIC_KINDS) {
      const def = PNEUMATIC_SYMBOLS[kind];
      const [x0, y0, x1, y1] = def.box;
      for (const [name, pin] of Object.entries(def.pins)) {
        const [x, y] = pin.at;
        expect(onGrid(x) && onGrid(y), `${kind}.${name} at ${x},${y}`).toBe(true);
        const [cx, cy] = [Math.round(x / GRID), Math.round(y / GRID)];
        const inside =
          cx >= Math.ceil((x0 - BODY_CLEARANCE) / GRID) &&
          cx <= Math.floor((x1 + BODY_CLEARANCE) / GRID) &&
          cy >= Math.ceil((y0 - BODY_CLEARANCE) / GRID) &&
          cy <= Math.floor((y1 + BODY_CLEARANCE) / GRID);
        expect(inside, `${kind}.${name} sits inside its own body's blocked cells`).toBe(false);
      }
    }
  });
});

// A 12px glyph advances 7.5px; its box runs from 10px above the baseline to 3px below it.
const ADVANCE_12 = 7.5;
type Box = [number, number, number, number];
const boxOfText = ([x, y, text, anchor]: NonNullable<SymbolDef["text"]>[number]): Box => {
  const w = ADVANCE_12 * text.length;
  const left = anchor === "start" ? x : anchor === "middle" ? x - w / 2 : x - w;
  return [left, y - 10, left + w, y + 3];
};
const strictlyInside = (lo: number, hi: number) => {
  const first = Math.floor(lo / GRID) * GRID + GRID;
  return first < hi ? first : undefined;
};
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** What stops a symbol's own texts reading at 12px on a drawing a wire may run over. */
function textProblems(def: SymbolDef): string[] {
  const out: string[] = [];
  const texts = def.text ?? [];
  texts.forEach((t, i) => {
    const box = boxOfText(t);
    if (strictlyInside(box[0], box[2]) !== undefined) out.push(`"${t[2]}" straddles a vertical grid line`);
    if (strictlyInside(box[1], box[3]) !== undefined) out.push(`"${t[2]}" straddles a horizontal grid line`);
    texts.slice(i + 1).forEach((u) => {
      if (hit(box, boxOfText(u))) out.push(`"${t[2]}" overlaps "${u[2]}"`);
    });
  });
  return out;
}

describe("symbol text", () => {
  it("every symbol text is 12px or more, sits inside one grid cell (never across a grid line, so no wire can cross it) and overlaps no other text of its symbol", () => {
    for (const kind of PNEUMATIC_KINDS) expect(textProblems(PNEUMATIC_SYMBOLS[kind]), kind).toEqual([]);
    // The valves print their port numbers; the others print nothing.
    expect((PNEUMATIC_SYMBOLS["valve-52"].text ?? []).map((t) => t[2])).toEqual(["4", "2", "1", "14", "12"]);
    expect((PNEUMATIC_SYMBOLS["valve-32-roller"].text ?? []).map((t) => t[2])).toEqual(["2", "1"]);
  });

  it("catches two texts drawn on top of each other (negative control)", () => {
    const planted: SymbolDef = {
      ...PNEUMATIC_SYMBOLS["valve-52"],
      text: [
        [0, 0, "AB", "start"],
        [4, 0, "CD", "start"],
      ],
    };
    expect(textProblems(planted).some((p) => p.includes("overlaps"))).toBe(true);
  });

  it("catches a text drawn across a grid line (negative control)", () => {
    const planted: SymbolDef = { ...PNEUMATIC_SYMBOLS["valve-52"], text: [[-3, -26, "4", "start"]] };
    expect(textProblems(planted).some((p) => p.includes("straddles a vertical"))).toBe(true);
  });
});

describe("the flows a valve draws in each state are exactly the passages the engine runs", () => {
  const stubEnd: Record<string, Record<string, [number, number]>> = {
    "valve-52": { "1": [0, 20], "4": [-20, -20], "2": [20, -20] },
    "valve-32-roller": { "1": [0, 20], "2": [0, -20] },
    "valve-32-button": { "1": [0, 20], "2": [0, -20] },
  };
  const exhaustEnd: Record<string, Record<string, [number, number]>> = {
    "valve-52": { "2": [20, 20], "4": [-20, 20] },
    "valve-32-roller": { "2": [12, 20] },
    "valve-32-button": { "2": [12, 20] },
  };
  const kinds = ["valve-52", "valve-32-roller", "valve-32-button"] as const;
  const pairKey = (pins: readonly [string, string]) => pins.join(">");

  it.each(kinds)("%s: each flow lands on its pins' stubs, and the set equals PHYSICS.passages", (kind) => {
    const boxes = valveBoxes(kind);
    expect(boxes.map((b) => b.state)).toEqual(kind === "valve-52" ? ["14", "12"] : ["made", "freed"]);
    for (const box of boxes) {
      const offset = valveOffset(kind, box.state);
      const shifted = (p: readonly [number, number]): [number, number] => [p[0] + offset, p[1]];
      const drawn = box.flows.map((f) => {
        const [a, b] = f.pins;
        // The flow's ends, once the pair is shifted into this state, land on the stub ends.
        expect(shifted(f.from), `${kind} ${box.state} ${pairKey(f.pins)} from`).toEqual(stubEnd[kind]?.[a]);
        expect(shifted(f.to), `${kind} ${box.state} ${pairKey(f.pins)} to`).toEqual(
          b === "EXH" ? exhaustEnd[kind]?.[a] : stubEnd[kind]?.[b],
        );
        return pairKey(f.pins);
      });
      const run = PHYSICS.passages(kind, box.state).map(pairKey);
      expect(drawn.sort(), `${kind} ${box.state}`).toEqual(run.sort());
    }
  });

  it("a 3/2 valve's freed box shows port 1 blocked, its made box nothing", () => {
    for (const kind of ["valve-32-roller", "valve-32-button"] as const) {
      const [made, freed] = valveBoxes(kind);
      expect(made?.blocked).toEqual([]);
      expect(freed?.blocked).toEqual(["1"]);
    }
  });

  it("shifts a 5/2 valve's boxes onto its stubs: 14 → +30, 12 → −30; a 3/2's made → +20, freed → −20", () => {
    expect(valveOffset("valve-52", "14")).toBe(30);
    expect(valveOffset("valve-52", "12")).toBe(-30);
    expect(valveOffset("valve-32-roller", "made")).toBe(20);
    expect(valveOffset("valve-32-button", "freed")).toBe(-20);
  });
});

describe("the cylinder", () => {
  it("keeps its piston and rod inside its body over the whole stroke, the rod tip on each mark at 0 and 1", () => {
    expect(STROKE_PX).toBe(60);
    const def = PNEUMATIC_SYMBOLS.cylinder;
    const [bx0, , bx1] = def.box;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const { d, fill } = cylinderMoving(f);
      // The piston's 6px bar sits at x = -40 + 60 f, inside the barrel (-60 … 60).
      const piston = /M(-?[\d.]+) -12H(-?[\d.]+)V12H(-?[\d.]+)Z/.exec(fill);
      expect(piston, `piston at ${f}`).not.toBeNull();
      expect(Number(piston?.[1])).toBeCloseTo(-40 + 60 * f - 3, 6);
      expect(Number(piston?.[2])).toBeCloseTo(-40 + 60 * f + 3, 6);
      expect(Number(piston?.[1])).toBeGreaterThanOrEqual(-60);
      expect(Number(piston?.[2])).toBeLessThanOrEqual(60);
      // The rod runs from the piston to its tip, which stays inside the body's box.
      const tip = /H(-?[\d.]+)V4H/.exec(d);
      expect(Number(tip?.[1])).toBeCloseTo(80 + 60 * f, 6);
      expect(Number(tip?.[1])).toBeLessThanOrEqual(bx1);
      expect(Number(tip?.[1])).toBeGreaterThan(bx0);
    }
    // The tip lands on each stroke-end tick, which the barrel's body draws.
    const ticks = [...def.body.matchAll(/M(\d+) -30V-18/g)].map((m) => Number(m[1]));
    expect(ticks).toEqual([80, 140]);
    expect(cylinderMoving(0).d).toContain("H80");
    expect(cylinderMoving(1).d).toContain("H140");
    // The marks print the roller valve's label at each end, over the ticks.
    expect(def.slots?.retracted?.at).toEqual([80, -34]);
    expect(def.slots?.extended?.at).toEqual([140, -34]);
  });
});

describe("the air source", () => {
  const model: SchematicModel = {
    parts: [
      { id: "P1", kind: "air-source" },
      { id: "P2", kind: "air-source" },
      { id: "VA", kind: "valve-52", label: "VA" },
      { id: "A", kind: "cylinder", label: "A", notes: { retracted: "a0", extended: "a1" } },
    ],
    nets: [
      { id: "P", pins: ["P1.t", "P2.t", "VA.1"] },
      { id: "Acap", pins: ["VA.4", "A.cap"] },
      { id: "Arod", pins: ["VA.2", "A.rod"] },
      { id: "p14", pins: ["VA.14"] },
      { id: "p12", pins: ["VA.12"] },
    ],
  };

  it("joins every other without a wire", () => {
    const groups = modelNets(model, model.nets).map((g) => g.slice().sort());
    const supply = groups.find((g) => g.includes("P1.t"));
    expect(supply).toEqual(["P1.t", "P2.t", "VA.1"]);
    expect(symbolOf("air-source").implicit?.(undefined)).toBe(symbolOf("air-source").implicit?.("anything"));
  });

  it("is keyed AIR.t by a figure reading, so the drawing checks against the figure", () => {
    expect(symbolOf("air-source").figureKey).toBe("AIR");
    const hints: LayoutHints = {
      parts: {
        A: { at: [1.4, 0], label: "left" },
        VA: { at: [1.4, 1.6], label: "above" },
        P1: { at: [1.4, 2.2] },
        P2: { at: [3.4, 2.2] },
      },
    };
    const drawing = layOut(model, hints);
    const reading = figureReading.parse({
      reading: "learn-premium figure reading v1",
      by: "test",
      parts: {
        A: { kind: "cylinder", at: [0, 0], turn: 0, label: "left", values: { retracted: "a0", extended: "a1" } },
        VA: { kind: "valve-52", at: [0, 1], turn: 0, label: "above" },
      },
      unlabelled: { "air-source": 2 },
      nets: [{ pins: ["AIR.t", "VA.1"] }, { pins: ["VA.4", "A.cap"] }, { pins: ["VA.2", "A.rod"] }],
    });
    const verdict = checkDrawing(drawing, model, reading);
    const netlist = verdict.checks.find((c) => c.id === "netlist");
    expect(netlist?.problems).toEqual([]);
  });
});
