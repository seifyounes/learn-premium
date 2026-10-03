import { describe, expect, it } from "vitest";
import { bareSlashes, hasEmoji, renderedNotes } from "../gates/master-rules.ts";
import { valuesOf } from "../src/provenance/values.ts";

describe("a bare / in a rule", () => {
  it("is found in its math and in its text", () => {
    expect(bareSlashes("$\\dot{Q} = \\Delta T / R$")).toEqual(["$\\dot{Q} = \\Delta T / R$"]);
    expect(bareSlashes("Q = dT/R")).toEqual(["Q = dT/R"]);
  });

  it("is found only in the math of a name or use line, where a / in words reads as 'or'", () => {
    expect(bareSlashes("when $q/A$ is known", true)).toEqual(["$q/A$"]);
    expect(bareSlashes("Heating/cooling", true)).toEqual([]);
  });

  it("isn't a stacked fraction, or a unit written in words", () => {
    expect(bareSlashes("$\\dot{Q} = \\frac{\\Delta T}{R}$")).toEqual([]);
    expect(bareSlashes("$R = 0.04\\ \\text{K/W}$")).toEqual([]);
    expect(bareSlashes("$h\\ \\mathrm{W/(m^{2}\\,K)}$")).toEqual([]);
  });
});

describe("the values a rule shows", () => {
  it("are every number in its name, formula and use", () => {
    const raw = { rules: [{ name: "Half", formula: "$E = \\frac{1}{2} m v^2$", use: "At 3 points." }] };
    expect(valuesOf("rules", raw).map((v) => [v.written, v.at])).toEqual([
      ["1", "rules.0.formula"],
      ["2", "rules.0.formula"],
      ["3", "rules.0.use"],
    ]);
  });
});

describe("an emoji in a rule", () => {
  it("is found whole: pictographs, flags and keycaps", () => {
    for (const text of ["Hot 🔥", "Egypt 🇪🇬", "Step 1️⃣", "Mark ©\uFE0F"]) expect(hasEmoji(text), text).toBe(true);
  });

  it("isn't a symbol a rule writes, or a number", () => {
    for (const text of ["$\\Delta T$ in °C", "Step 1", "© 2026", "→ then"]) expect(hasEmoji(text), text).toBe(false);
  });
});

describe("the provenance notes Master Rules shows", () => {
  it("are every scaled, assumed and derived value, Slip and Divergence, but not what is stated", () => {
    const notes = renderedNotes({
      stated: ["1"],
      scaled: ["a"],
      assumed: ["b"],
      derived: ["c"],
      slips: [{ value: "d", sheet: "e", note: "f" }],
      divergences: [{ value: "g", note: "h" }],
    });
    expect(notes.map((n) => n.text)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(notes[0]?.at).toBe("provenance.scaled.0");
    expect(notes.at(-1)?.at).toBe("provenance.divergences.0.note");
  });
});
