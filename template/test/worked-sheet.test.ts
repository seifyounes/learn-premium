import { describe, expect, it } from "vitest";
import { cellAt } from "../src/worked/cells.ts";
import { handOrder, stateAt, toSheet, type SheetData } from "../src/worked/sheet.ts";

// A 3-row table: column A given, B and C worked out; a plot with a question point and two added marks.
const sheet: SheetData = toSheet(
  {
    code: "W00.1",
    title: "Test sheet",
    statement: "Find $y$.",
    given: ["$a = 1$"],
    artefact: {
      kind: "table",
      caption: "Values",
      columns: [
        { label: "Row", given: true },
        { label: "$b$", given: false },
        { label: "$c$", unit: "K", given: false },
      ],
      rows: [
        ["one", "1", "10"],
        ["two", "2", "20"],
        ["total", "3", ""],
      ],
    },
    fillOrder: "columns",
    figure: {
      kind: "plot",
      caption: "The question",
      x: { label: "$x$", min: 0, max: 1, step: 0.5 },
      y: { label: "$y$", min: 0, max: 1, step: 0.5 },
      elements: [
        { id: "start", kind: "point", at: [0, 0], side: "end" },
        { id: "end", kind: "point", at: [1, 1], side: "end" },
        {
          id: "path",
          kind: "line",
          through: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
      question: ["start"],
    },
    steps: [
      { title: "Read", note: "Read it.", fill: [], marks: [] },
      { title: "Two", note: "Two cells.", fill: ["C2", "B1"], marks: [] },
      {
        title: "Rest",
        note: "The rest.",
        fill: ["C1", "B3", "B2"],
        marks: ["B3"],
        figure: { add: ["end", "path"], ring: ["end"], caption: "Solved" },
      },
    ],
    answer: "$y = 3$",
  },
  (prose) => `<${prose}>`,
);

describe("hand order", () => {
  it("fills column by column, top to bottom", () => {
    expect(handOrder(["C1", "B3", "B2", "C2"], "columns")).toEqual(["B2", "B3", "C1", "C2"]);
  });

  it("fills row by row, start to end, when the Professor writes across", () => {
    expect(handOrder(["C1", "B3", "B2", "C2"], "rows")).toEqual(["C1", "B2", "C2", "B3"]);
  });

  it("reads rows past 9 and names cells by column letter and row number", () => {
    expect(handOrder(["A10", "A9"], "columns")).toEqual(["A9", "A10"]);
    expect(cellAt(0, 3)).toBe("D1");
  });
});

describe("the state at a step", () => {
  it("opens on the question: nothing written, only the question figure drawn", () => {
    const first = stateAt(sheet, 0);
    expect(first.written.size).toBe(0);
    expect(first.fresh).toEqual([]);
    expect([...first.drawn]).toEqual(["start"]);
    expect(first.captionHtml).toBe("<The question>");
    expect(first.last).toBe(false);
  });

  it("writes each step's cells in hand order and keeps earlier ones", () => {
    const second = stateAt(sheet, 1);
    expect(second.fresh).toEqual(["B1", "C2"]);
    const third = stateAt(sheet, 2);
    expect(third.fresh).toEqual(["B2", "B3", "C1"]);
    expect([...third.written].sort()).toEqual(["B1", "B2", "B3", "C1", "C2"]);
  });

  it("draws the step's figure additions and its red-pen marks", () => {
    const third = stateAt(sheet, 2);
    expect(third.added).toEqual(["end", "path"]);
    expect([...third.drawn]).toEqual(["start", "end", "path"]);
    expect(third.marks).toEqual(["B3"]);
    expect(third.rings).toEqual(["end"]);
    expect(third.captionHtml).toBe("<Solved>");
    expect(third.last).toBe(true);
  });

  it("renders any step directly from its state, the same as stepping there", () => {
    // Going back is a fresh render of the earlier step, never an undo of the later one.
    const back = stateAt(sheet, 1);
    expect(back.marks).toEqual([]);
    expect([...back.drawn]).toEqual(["start"]);
    expect([...back.written].sort()).toEqual(["B1", "C2"]);
  });

  it("clamps a step index outside the sheet", () => {
    expect(stateAt(sheet, -3).index).toBe(0);
    expect(stateAt(sheet, 99).index).toBe(2);
  });
});

describe("the sheet the island gets", () => {
  it("carries every prose field as rendered HTML", () => {
    expect(sheet.titleHtml).toBe("<Test sheet>");
    expect(sheet.table.columns[2]).toEqual({ labelHtml: "<$c$>", unitHtml: "<K>", given: false });
    expect(sheet.table.rows[2]).toEqual(["<total>", "<3>", ""]);
    expect(sheet.steps[2]?.noteHtml).toBe("<The rest.>");
    expect(sheet.answerHtml).toBe("<$y = 3$>");
    expect(sheet.figure?.x).toMatchObject({ labelHtml: "<$x$>", min: 0, max: 1, step: 0.5 });
  });
});
