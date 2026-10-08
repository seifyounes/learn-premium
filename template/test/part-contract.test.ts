import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { part } from "../src/content/contract.ts";
import { FIXTURE_COURSE } from "./build-course";

const hub = () =>
  JSON.parse(readFileSync(join(FIXTURE_COURSE, "modules/07-flanged-hub/parts/hub.json"), "utf8")) as {
    source: string;
    dimensions: Record<string, unknown>[];
  };
const issues = (raw: unknown) => part.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("the machine part contract", () => {
  it("takes a build123d script and the dimensions the drawing tags, each between two points on the part", () => {
    expect(issues(hub())).toBeUndefined();
  });

  it("holds every dimension to its value: its two ends lie that far apart", () => {
    const raw = hub();
    raw.dimensions[0] = { ...raw.dimensions[0], value: 81 };
    expect(issues(raw)).toEqual([
      "dimensions.0.value: its ends lie 80 mm apart, not 81: a dimension runs between the two points it measures",
    ]);
  });

  it("names each dimension once", () => {
    const raw = hub();
    raw.dimensions[1] = { ...raw.dimensions[1], id: "flange-d" };
    expect(issues(raw)).toEqual(['dimensions.1.id: "flange-d" is used twice']);
  });

  it("lets the Owner confirm only a reading taken off the drawing or assumed", () => {
    const raw = hub();
    raw.dimensions[0] = { ...raw.dimensions[0], confirmed: true };
    expect(issues(raw)).toEqual([
      "dimensions.0.confirmed: only a scaled or assumed dimension waits on the Owner's word; a stated one needs none",
    ]);
  });

  it("names its script as a .py file beside it", () => {
    expect(issues({ ...hub(), source: "../hub.py" })).toEqual([
      "source: a .py file in the Module's parts/ folder, named with no folder",
    ]);
  });
});
