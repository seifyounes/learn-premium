import { describe, expect, it } from "vitest";
import { plantedExample } from "../gates/teaching.ts";
import { worked } from "../src/content/contract.ts";

type Planted = ReturnType<typeof plantedExample> & { steps: [unknown, { fill: string[] }] };

describe("the Worked example contract", () => {
  it("names a malformed or missing cell rather than failing on it", () => {
    const example = plantedExample() as Planted;
    example.steps[1].fill = ["b1", "Z9"];
    const issues = worked.safeParse(example).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(issues).toEqual([
      "steps.1.fill.0: a cell is named by its column letter and row number, e.g. D2",
      "steps.1.fill.1: the table has no cell Z9",
    ]);
  });
});
