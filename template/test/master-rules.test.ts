import { describe, expect, it } from "vitest";
import { bareSlashes } from "../gates/master-rules.ts";
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
