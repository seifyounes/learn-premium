// The Drawing gate's checks, pure: the full adder's drawing and the drawings the negative control
// breaks out of it, plus the geometry rules each check rests on.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDrawing, figureReading, type FigureReading } from "../src/sims/layout/check.ts";
import type { Drawing, LayoutHints, PlacedPart, SchematicModel } from "../src/sims/layout/drawing.ts";
import { connectivity } from "../src/sims/layout/geometry.ts";
import { layOut } from "../src/sims/layout/layout.ts";
import { mutantsOf } from "../src/sims/layout/mutants.ts";
import { FIXTURE_COURSE } from "./build-course";

const read = (entry: string) =>
  JSON.parse(readFileSync(join(FIXTURE_COURSE, entry), "utf8")) as Record<string, unknown>;
const adder = read("modules/04-full-adder/sims/adder.json") as { model: SchematicModel; layout: LayoutHints };
const reading = figureReading.parse(read("build-records/figure/04-full-adder/adder.json"));
const drawing = layOut(adder.model, adder.layout);

/** The checks that fail, with their problems; `null` checks the drawing against its model alone. */
const failing = (d: Drawing, model: SchematicModel = adder.model, r: FigureReading | null = reading) =>
  Object.fromEntries(
    checkDrawing(d, model, r ?? undefined)
      .checks.filter((c) => c.problems.length > 0)
      .map((c) => [c.id, c.problems]),
  );

describe("the Drawing gate's negative control", () => {
  const { mutants, skipped } = mutantsOf(drawing, adder.model.nets);

  it("plants all eight mutants in the full adder", () => {
    expect(skipped).toEqual([]);
    expect(mutants.map((m) => m.id)).toEqual([
      "short",
      "open",
      "reversed",
      "label",
      "extra",
      "mirrored",
      "staircase",
      "no-dot",
    ]);
  });

  it.each(mutants.map((m) => [m.id, m] as const))("catches the %s mutant on its check", (_, mutant) => {
    const failed = checkDrawing(mutant.drawing, adder.model, reading)
      .checks.filter((c) => c.problems.length > 0)
      .map((c) => c.id);
    expect(
      failed.some((id) => mutant.expect.includes(id)),
      `${mutant.what}: failed ${failed.join(", ") || "nothing"}`,
    ).toBe(true);
  });

  it("catches a mirrored drawing only against the figure: its nets are intact", () => {
    const mirrored = mutants.find((m) => m.id === "mirrored")?.drawing as Drawing;
    expect(failing(mirrored, adder.model, null)).toEqual({});
    expect(Object.keys(failing(mirrored))).toContain("arrangement");
  });
});

describe("the Drawing gate's checks", () => {
  // Two ports and a gate, drawn by hand to probe one rule at a time.
  const part = (p: Omit<PlacedPart, "turn" | "flip"> & Partial<PlacedPart>): PlacedPart => ({
    turn: 0,
    flip: false,
    ...p,
  });
  const parts: PlacedPart[] = [
    part({ id: "A", kind: "port", x: 40, y: 40 }),
    part({ id: "B", kind: "port", x: 40, y: 120 }),
    part({ id: "Y", kind: "port", x: 400, y: 80 }),
    part({ id: "G", kind: "and", x: 240, y: 80 }),
  ];
  const model: SchematicModel = {
    parts: parts.map(({ id, kind }) => ({ id, kind })),
    nets: [
      { id: "a", pins: ["A.t", "G.in1"] },
      { id: "b", pins: ["B.t", "G.in2"] },
      { id: "y", pins: ["G.out", "Y.t"] },
    ],
  };
  const base: Drawing = {
    width: 440,
    height: 160,
    parts,
    wires: [
      {
        points: [
          [40, 40],
          [120, 40],
          [120, 60],
          [200, 60],
        ],
      },
      {
        points: [
          [40, 120],
          [120, 120],
          [120, 100],
          [200, 100],
        ],
      },
      {
        points: [
          [280, 80],
          [400, 80],
        ],
      },
    ],
    dots: [],
    unrouted: [],
  };

  it("passes a hand drawing that keeps every rule", () => {
    expect(failing(base, model, null)).toEqual({});
  });

  it("joins a T without a dot, and never joins a plain crossing", () => {
    // B's wire ends on A's wire: a T, connected with no dot. Then it runs straight across instead.
    const tee: Drawing = {
      ...base,
      wires: [
        base.wires[0],
        {
          points: [
            [40, 120],
            [80, 120],
            [80, 40],
          ],
        },
        base.wires[2],
      ] as Drawing["wires"],
    };
    expect(connectivity(tee).nets.find((n) => n.includes("A.t"))).toEqual(
      expect.arrayContaining(["A.t", "G.in1", "B.t"]),
    );
    const crossing: Drawing = {
      ...base,
      wires: [
        ...base.wires,
        {
          points: [
            [160, 20],
            [160, 140],
          ],
        },
      ],
    };
    expect(connectivity(crossing).nets.find((n) => n.includes("A.t"))).not.toContain("B.t");
    expect(failing(crossing, model, null).conventions).toContain("wire 3 ends in the open at (160, 20)");
  });

  it("blocks a dot on a crossing: a crossing never connects", () => {
    const dotted: Drawing = {
      ...base,
      parts: [
        ...parts,
        part({ id: "C", kind: "port", x: 160, y: 20 }),
        part({ id: "D", kind: "port", x: 160, y: 140 }),
      ],
      wires: [
        ...base.wires,
        {
          points: [
            [160, 20],
            [160, 140],
          ],
        },
      ],
      dots: [[160, 60]],
    };
    const withCd: SchematicModel = {
      parts: [...model.parts, { id: "C", kind: "port" }, { id: "D", kind: "port" }],
      nets: [...model.nets, { id: "cd", pins: ["C.t", "D.t"] }],
    };
    expect(failing(dotted, withCd, null).conventions).toEqual([
      "a dot at (160, 60) marks a crossing, which never connects",
    ]);
  });

  it("blocks pins off the 20px grid, as the old kit's gate inputs were", () => {
    const off: Drawing = { ...base, parts: parts.map((p) => (p.id === "G" ? { ...p, y: 90 } : p)) };
    expect(failing(off, model, null).conventions).toEqual(
      expect.arrayContaining(["pin G.in1 at (200, 70) is off the 20px grid"]),
    );
  });

  it("blocks a jog under 20px, a wire with more than four bends, and parallel wires under 20px apart", () => {
    const jog: Drawing = {
      ...base,
      wires: [
        {
          points: [
            [40, 40],
            [120, 40],
            [120, 50],
            [140, 50],
            [140, 60],
            [200, 60],
          ],
        },
        ...base.wires.slice(1),
      ],
    };
    expect(failing(jog, model, null).tidiness).toEqual(["wire 0 has 2 jogs under 20px"]);
    const bendy: Drawing = {
      ...base,
      wires: [
        {
          points: [
            [40, 40],
            [60, 40],
            [60, 20],
            [100, 20],
            [100, 40],
            [140, 40],
            [140, 60],
            [200, 60],
          ],
        },
        ...base.wires.slice(1),
      ],
    };
    expect(failing(bendy, model, null).tidiness).toEqual(["wire 0 bends 6 times, more than 4"]);
    const squeezed: Drawing = {
      ...base,
      wires: [
        {
          points: [
            [40, 40],
            [120, 40],
            [120, 70],
            [180, 70],
            [180, 60],
            [200, 60],
          ],
        },
        {
          points: [
            [40, 120],
            [100, 120],
            [100, 80],
            [200, 80],
            [200, 100],
          ],
        },
        base.wires[2],
      ] as Drawing["wires"],
    };
    expect(failing(squeezed, model, null).tidiness).toEqual(expect.arrayContaining(["wires 0 and 1 run 10px apart"]));
  });

  it("blocks a model whose nets differ from the Blind reader's, and lets a gate's two inputs swap", () => {
    const swapped: SchematicModel = {
      ...adder.model,
      nets: adder.model.nets.map((n) => ({
        ...n,
        pins: n.pins.map((p) => (p === "G2.in1" ? "G2.in2" : p === "G2.in2" ? "G2.in1" : p)),
      })),
    };
    expect(failing(layOut(swapped, adder.layout), swapped).netlist).toBeUndefined();
    const rewired: SchematicModel = {
      ...adder.model,
      nets: adder.model.nets.map((n) => ({
        ...n,
        pins: n.pins.map((p) => (p === "G4.in2" ? "G2.in2" : p === "G2.in2" ? "G4.in2" : p)),
      })),
    };
    expect(failing(layOut(rewired, adder.layout), rewired).netlist).toEqual(
      expect.arrayContaining(["B.t and G2.in2 connect in the figure but not in the model"]),
    );
  });

  it("blocks junction dots that don't copy the figure", () => {
    const extra = layOut(adder.model, { ...adder.layout, dots: [] });
    expect(failing(extra).dots).toHaveLength(4);
    const undottedFigure: FigureReading = { ...reading, nets: reading.nets.map((n) => ({ ...n, dotted: false })) };
    expect(failing(drawing, adder.model, undottedFigure).dots).toHaveLength(4);
  });

  it("blocks pins the router couldn't reach", () => {
    expect(failing({ ...drawing, unrouted: ["G5.in1"] }).connectivity).toContain("the router couldn't reach G5.in1");
  });
});
