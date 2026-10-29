// The gates whose Checkpoint items are about a printed sheet value: the Owner rules each a Slip or a
// Divergence, and the wave's gate records that ruling against exactly these. A gate that raises such an item
// but isn't listed here would accept an ordinary answer without the ruling, and refuse a recorded one.
import { describe, expect, test } from "vitest";
import { isSheetItem, SHEET_GATES } from "../scripts/wave/wave.ts";

describe("the sheet-ruling gates", () => {
  test("include the kinematics gate, whose mechanisms print values on a sheet", () => {
    expect(SHEET_GATES.has("kinematics")).toBe(true);
    expect(
      isSheetItem({ gate: "kinematics", message: "sheet cell B1 prints 18.40, but the engine ... both give 18.38" }),
    ).toBe(true);
  });

  test("still include the number gates, and leave out a gate with no sheet", () => {
    for (const gate of ["sim-numbers", "truth-table", "worked-numbers", "stl", "past-papers"])
      expect(isSheetItem({ gate, message: "sheet cell B1 prints 1" }), gate).toBe(true);
    expect(isSheetItem({ gate: "gear-interference", message: "the teeth overlap" })).toBe(false);
  });
});
