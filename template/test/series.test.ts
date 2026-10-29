// The multi-series rule for chemistry plots: at most four lines in ink at once, past four students
// toggle them, and each line has its own dash, marker and label. Pure.
import { describe, expect, it } from "vitest";
import {
  MAX_SHOWN,
  SERIES_STYLES,
  nernstSeries,
  seriesProblems,
  startSeries,
  toggleSeries,
} from "../src/chemistry/series.ts";

const ISOTHERMS = [273.15, 298.15, 323.15, 348.15, 373.15];
const defs = nernstSeries({ isotherms: ISOTHERMS });

describe("the multi-series rule", () => {
  it("nernstSeries labels each isotherm in K", () => {
    expect(defs).toEqual([
      { id: "T=273.15", label: "273.15 K", value: 273.15 },
      { id: "T=298.15", label: "298.15 K", value: 298.15 },
      { id: "T=323.15", label: "323.15 K", value: 323.15 },
      { id: "T=348.15", label: "348.15 K", value: 348.15 },
      { id: "T=373.15", label: "373.15 K", value: 373.15 },
    ]);
  });

  it("five isotherms open with four shown; showing the fifth dims the one shown longest", () => {
    expect(MAX_SHOWN).toBe(4);
    const open = startSeries(defs);
    expect(open.shown).toEqual(["T=273.15", "T=298.15", "T=323.15", "T=348.15"]);
    const fifth = toggleSeries(defs, open, "T=373.15");
    expect(fifth.shown).toEqual(["T=298.15", "T=323.15", "T=348.15", "T=373.15"]);
    // Showing the dimmed one again drops the oldest of the new four.
    expect(toggleSeries(defs, fifth, "T=273.15").shown).toEqual(["T=323.15", "T=348.15", "T=373.15", "T=273.15"]);
  });

  it("opens on the isotherms the content names, clamped to four", () => {
    expect(startSeries(defs, [373.15, 273.15]).shown).toEqual(["T=373.15", "T=273.15"]);
    expect(startSeries(defs, ISOTHERMS).shown).toHaveLength(4);
    expect(startSeries(defs, [999])).toEqual(startSeries(defs));
  });

  it("a shown line can be hidden, but the last line shown can't be", () => {
    const open = startSeries(defs);
    expect(toggleSeries(defs, open, "T=298.15").shown).toEqual(["T=273.15", "T=323.15", "T=348.15"]);
    const one = { shown: ["T=273.15"] };
    expect(toggleSeries(defs, one, "T=273.15")).toBe(one);
    expect(toggleSeries(defs, open, "T=nonsense")).toBe(open);
  });

  it("every series has its own dash and marker", () => {
    expect(SERIES_STYLES).toHaveLength(6);
    expect(new Set(SERIES_STYLES.map((s) => s.dash)).size).toBe(SERIES_STYLES.length);
    expect(new Set(SERIES_STYLES.map((s) => s.face)).size).toBe(SERIES_STYLES.length);
    expect(new Set(SERIES_STYLES.map((s) => s.dasharray)).size).toBe(SERIES_STYLES.length);
  });

  it("seriesProblems names each defect", () => {
    const plot = { many: "toggle", shown: [273.15, 298.15, 323.15, 348.15] };
    expect(seriesProblems(defs, plot)).toEqual([]);
    expect(seriesProblems(defs, {})).toEqual([
      "5 lines on one plot: past 4, let students toggle them (plot.many: toggle)",
    ]);
    expect(seriesProblems(defs, { many: "toggle", shown: ISOTHERMS })).toEqual([
      "it opens with 5 lines in ink: at most 4 are drawn at once",
    ]);
    expect(seriesProblems(defs, { many: "toggle", shown: [300] })).toEqual([
      "it opens on 300 K, which isn't one of its isotherms",
    ]);
    expect(seriesProblems(nernstSeries({ isotherms: [273.15, 298.15, 298.15, 348.15] }), {})).toEqual([
      'two lines are labelled "298.15 K": each label names one line',
    ]);
    const seven = nernstSeries({ isotherms: [1, 2, 3, 4, 5, 6, 7].map((n) => 250 + n * 10) });
    expect(seriesProblems(seven, { many: "toggle" })).toEqual(["7 lines but 6 distinct line styles: split the plot"]);
  });
});
