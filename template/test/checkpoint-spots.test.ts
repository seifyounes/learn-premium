import { describe, expect, it } from "vitest";
import { runGates, type Gate } from "../gates/runner.ts";
import { spotOf } from "../gates/spots.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "01-thermal-resistance";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A gate that raises one Checkpoint item at `at`. */
const raising = (at: string): Gate => ({
  id: "planted",
  checks: "raises one Checkpoint item",
  points: ["job"],
  run: async () => ({ coverage: { items: 1 }, findings: [{ outcome: "checkpoint", at, message: "rule it" }] }),
  controls: [],
});

describe("Checkpoint items in a Gate report", () => {
  it("carry the spot on the site they show at, so the batched Checkpoint links to the preview", async () => {
    const report = await runGates({
      point: "job",
      commit: COMMIT,
      input: { contentDir: FIXTURE_COURSE, module: MODULE },
      gates: [raising(`modules/${MODULE}/worked/1.json`)],
    });
    expect(report.checkpointItems).toEqual([
      {
        gate: "planted",
        outcome: "checkpoint",
        at: `modules/${MODULE}/worked/1.json`,
        message: "rule it",
        spot: `/${MODULE}/#worked-W01.1`,
      },
    ]);
  });

  it("map each kind of content file to the element its Module page renders it in", () => {
    const spot = (at: string | undefined) => spotOf(FIXTURE_COURSE, at);
    expect(spot(`modules/${MODULE}/worked/2.json:14:5`)).toBe(`/${MODULE}/#worked-W01.2`);
    expect(spot(`modules/${MODULE}/practice/3.yaml`)).toBe(`/${MODULE}/#practice-3`);
    expect(spot(`modules/${MODULE}/summary/1.md (body)`)).toBe(`/${MODULE}/#summary`);
    expect(spot(`modules/${MODULE}/sims/plate.json`)).toBe(`/${MODULE}/#sim-${MODULE}-plate`);
    expect(spot(`modules/${MODULE}/media.yaml`)).toBe(`/${MODULE}/#watch`);
    expect(spot(`modules/${MODULE}/rules.yaml`)).toBe(`/${MODULE}/`);
    expect(spot("/rules/")).toBe("/rules/");
    expect(spot("course.yaml")).toBeUndefined();
    expect(spot(undefined)).toBeUndefined();
  });
});
