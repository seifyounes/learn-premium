// The plot a Pyodide tool's code leaves behind, read the same way at build (the preview) and in the
// page (a live run): the sheet's plot elements, or one sentence saying what is wrong with it.
import { describe, expect, it } from "vitest";
import { readPlot, strayLabels } from "../src/python/plot.ts";

describe("strayLabels", () => {
  const drawn = readPlot(
    [
      { id: "p1", kind: "point", at: [0, 1] },
      { id: "fit", kind: "guide", x: 1 },
    ],
    {},
  );
  if (typeof drawn === "string") throw new Error(drawn);

  it("is nothing when every label names an element the plot draws", () => {
    expect(strayLabels(drawn, { fit: "fit", p1: "a point" })).toBeUndefined();
  });

  it("names each label whose id the plot doesn't draw: a typo or a stale id", () => {
    expect(strayLabels(drawn, { fti: "fit", p1: "a point", old: "gone" })).toBe(
      'labels names "fti" and "old", which the plot doesn\'t draw (it draws "p1" and "fit")',
    );
  });
});

describe("readPlot", () => {
  it("reads points, lines and guides, giving each label from the tool's labels by id", () => {
    const plot = [
      { id: "p1", kind: "point", at: [0, 1] },
      {
        id: "fit",
        kind: "line",
        through: [
          [0, 1.5],
          [3, 6],
        ],
      },
      { id: "x-bar", kind: "guide", x: 1 },
    ];
    expect(readPlot(plot, { fit: "<b>fit</b>" })).toEqual([
      { id: "p1", kind: "point", at: [0, 1], side: "end" },
      {
        id: "fit",
        kind: "line",
        through: [
          [0, 1.5],
          [3, 6],
        ],
        labelHtml: "<b>fit</b>",
      },
      { id: "x-bar", kind: "guide", x: 1 },
    ]);
  });

  it("takes a point's label side when the code gives one", () => {
    expect(readPlot([{ id: "a", kind: "point", at: [1, 2], side: "above" }], {})).toEqual([
      { id: "a", kind: "point", at: [1, 2], side: "above" },
    ]);
  });

  it.each([
    ["not a list", { id: "a" }, /plot must be a list/],
    ["an empty list", [], /plot draws nothing/],
    ["an element with no id", [{ kind: "point", at: [0, 0] }], /plot\[0\]: an id/],
    [
      "an id used twice",
      [
        { id: "a", kind: "point", at: [0, 0] },
        { id: "a", kind: "point", at: [1, 1] },
      ],
      /"a" is used twice/,
    ],
    ["a kind the sheet doesn't draw", [{ id: "a", kind: "bar", x: 1 }], /plot\[0\]: kind is point, line or guide/],
    ["a point that isn't a number pair", [{ id: "a", kind: "point", at: [0] }], /plot\[0\]: at is an \[x, y\] pair/],
    [
      "a NaN coordinate",
      [{ id: "a", kind: "point", at: [0, Number.NaN] }],
      /plot\[0\]: at is an \[x, y\] pair of finite numbers/,
    ],
    [
      "a line through one point",
      [{ id: "a", kind: "line", through: [[0, 0]] }],
      /plot\[0\]: through lists at least two/,
    ],
    ["a guide with no x", [{ id: "a", kind: "guide" }], /plot\[0\]: x is a finite number/],
    [
      "a label side that isn't one",
      [{ id: "a", kind: "point", at: [0, 0], side: "left" }],
      /side is above, below, start or end/,
    ],
  ])("refuses %s", (_what, plot, message) => {
    expect(readPlot(plot, {})).toMatch(message);
  });
});
