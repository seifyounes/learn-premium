import { describe, expect, it } from "vitest";
import { numbersIn, numbersInMarkdown, untagged, valuesOf } from "../src/provenance/values.ts";

const written = (prose: string) => numbersIn(prose).map((n) => n.written);

describe("the values a prose field holds", () => {
  it("reads numbers in text and in math, as magnitudes", () => {
    expect(written("A wall at $600\\ \\text{K}$ loses heat")).toEqual(["600"]);
    expect(written("the 3 layers, $T_4 = -5$ outside")).toEqual(["3", "5"]);
    expect(written("$R = \\frac{0.02}{0.5 \\times 1} = 0.04\\ \\text{K/W}$")).toEqual(["0.02", "0.5", "1", "0.04"]);
    expect(written("a load of 2,500 N and .5 m")).toEqual(["2,500", ".5"]);
    expect(numbersIn("2,500 and 0.20").map((n) => n.value)).toEqual([2500, 0.2]);
  });

  it("leaves out notation: subscripts, powers of a symbol or unit, chemistry, identifiers", () => {
    expect(written("$T_1 = 20\\ ^\\circ\\text{C}$ (inside face)")).toEqual(["20"]);
    expect(written("$R_{12} + R_\\text{total} + x_{i+1}$")).toEqual([]);
    expect(written("$A = 4\\ \\text{m}^2$, $x^2 + (x+1)^{3}$")).toEqual(["4", "1"]);
    expect(written("$\\ce{CH4 + 2O2 -> CO2 + 2H2O}$")).toEqual([]);
    expect(written("example W01.1 and CO2 in step T1")).toEqual([]);
    expect(written("$\\hspace{2em} x \\tag{3}$")).toEqual([]);
  });

  it("keeps a power of ten, whose exponent is part of the value", () => {
    expect(written("$1.2 \\times 10^{-3}$ and $10^5$")).toEqual(["1.2", "10", "3", "10", "5"]);
  });

  it("reads a unit stuck to its number, and a literal dollar", () => {
    expect(written("a 5mm gap costs \\$40")).toEqual(["5", "40"]);
  });

  it("reads Markdown without its list numbers or link targets", () => {
    const body = "1. Heat flows at $\\dot{Q} = 16.2\\ \\text{W}$.\n2. See [the table](https://example.org/t/3).\n";
    expect(numbersInMarkdown(body).map((n) => n.written)).toEqual(["16.2"]);
  });
});

describe("where each value sits in an entry", () => {
  it("walks a Practice item's prose and its answer", () => {
    const item = {
      kind: "numeric",
      question: "Find $\\dot{Q}$ at $L = 0.25$.",
      answer: { value: 9.6, unit: "kW", tolerance: 0.05 },
      model: "$9600\\ \\text{W}$",
    };
    expect(valuesOf("practice", item).map((v) => `${v.at}:${v.written}`)).toEqual([
      "question:0.25",
      "model:9600",
      "answer.value:9.6",
    ]);
  });

  it("walks a Worked example's table, given data, figure and steps, but not its code or cell names", () => {
    const example = {
      code: "W01.1",
      title: "Two layers",
      statement: "Two layers at $T_1 = 20$.",
      given: ["$A = 1$"],
      artefact: { kind: "table", caption: "Layers", columns: [{ label: "$L$", unit: "m" }], rows: [["0.02"], [""]] },
      fillOrder: "columns",
      figure: {
        kind: "plot",
        caption: "Profile",
        x: { label: "$x$", min: -0.05, max: 0.3, step: 0.05 },
        y: { label: "$T$", min: 0, max: 25, step: 5 },
        elements: [
          { id: "t1", kind: "point", at: [0, 20], label: "$T_1$" },
          { id: "face", kind: "guide", x: 0.27 },
          {
            id: "p",
            kind: "line",
            through: [
              [0, 20],
              [0.27, -5],
            ],
          },
        ],
        question: ["t1"],
      },
      steps: [{ title: "Step 1", note: "Add $0.04$.", fill: ["A1"], figure: { add: ["p"], caption: "at 25 K" } }],
      answer: "$16.2\\ \\text{W}$",
    };
    expect(valuesOf("worked", example).map((v) => `${v.at}:${v.written}`)).toEqual([
      "statement:20",
      "given.0:1",
      "artefact.rows.0.0:0.02",
      "figure.elements.0.at:0",
      "figure.elements.0.at:20",
      "figure.elements.1.x:0.27",
      "figure.elements.2.through:0",
      "figure.elements.2.through:20",
      "figure.elements.2.through:0.27",
      "figure.elements.2.through:5",
      "steps.0.title:1",
      "steps.0.note:0.04",
      "steps.0.figure.caption:25",
      "answer:16.2",
    ]);
  });

  it("walks a Summary beat's title, body and figure", () => {
    const beat = {
      title: "Two walls",
      figure: { kind: "plot", caption: "A 2 m wall", x: {}, y: {}, elements: [{ id: "a", kind: "point", at: [1, 3] }] },
    };
    expect(valuesOf("beats", beat, "One wall at $4$ K.").map((v) => `${v.at}:${v.written}`)).toEqual([
      "figure.caption:2",
      "figure.elements.0.at:1",
      "figure.elements.0.at:3",
      "body:4",
    ]);
  });
});

describe("the values no Provenance tag covers", () => {
  const item = (provenance: unknown) => ({
    kind: "numeric",
    question: "A wall $0.25\\ \\text{m}$ thick, $k = 1.0$, at $600\\ \\text{K}$.",
    answer: { value: 9.6, unit: "kW", tolerance: 0.05 },
    model: "$\\frac{1.0 \\times 600}{0.25} = 2400$, so $9.6\\ \\text{kW}$",
    provenance,
  });

  it("is none when every value is listed, however it is written there", () => {
    const tagged = item({ stated: ["$L = 0.250$", "1", "600"], derived: ["$\\dot{Q} = 9.6\\ \\text{kW}$", "2400"] });
    expect(untagged("practice", tagged)).toEqual([]);
  });

  it("names each untagged value once, with every place it sits", () => {
    expect(untagged("practice", item({ stated: ["0.25", "600"] }))).toEqual([
      { written: "1.0", at: ["question", "model"] },
      { written: "2400", at: ["model"] },
      { written: "9.6", at: ["model", "answer.value"] },
    ]);
  });

  it("counts the values a Slip or a Divergence declares", () => {
    const ruled = item({
      stated: ["0.25", "1.0", "600", "2400"],
      slips: [{ value: "$9.6\\ \\text{kW}$", sheet: "$96\\ \\text{kW}$" }],
    });
    expect(untagged("practice", ruled)).toEqual([]);
  });

  it("treats a missing provenance block as no tags at all", () => {
    expect(untagged("practice", item(undefined)).map((u) => u.written)).toEqual(["0.25", "1.0", "600", "2400", "9.6"]);
  });
});
