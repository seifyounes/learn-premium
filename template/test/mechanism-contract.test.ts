// A mechanism in the content contract: a four-bar or a spur gear pair, solved live by the kinematics
// engine. Students turn the driver's angle (θ), never the links; the contract refuses a crank that
// can't turn fully, labels for pins the model doesn't have, and a gear with a part of a tooth.
import { describe, expect, it } from "vitest";
import { SIM_KINDS, sim } from "../src/content/contract.ts";
import { engineQuantities, isLive, KINDS } from "../src/sims/kinds.ts";
import { quantities } from "../src/sims/mechanism/engine.ts";

const issues = (raw: unknown) => sim.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

const linkage = () => ({
  kind: "mechanism",
  title: "A crank-rocker four-bar",
  caption: "Drag the ringed crank pin or slide the angle.",
  recompute: "independent",
  worked: "2",
  sheet: { B1: "theta3", B2: "theta4", B3: "mu" },
  model: {
    type: "four-bar",
    ground: 100,
    crank: 40,
    coupler: 120,
    rocker: 80,
    assembly: "open",
    couplerPoint: { along: 60, off: 30 },
  },
  start: { theta: 60 },
  tune: { theta: { min: 0, max: 360, step: 1 } },
});

const gears = () => ({
  kind: "mechanism",
  title: "A spur gear pair",
  caption: "Turn the driver.",
  recompute: "independent",
  worked: "1",
  sheet: { B1: "d1", B2: "d2" },
  model: { type: "gear-pair", module: 2, teeth: [18, 36], pressureAngle: 20, faceWidth: 12 },
  start: { theta: 0 },
  tune: { theta: { min: 0, max: 360, step: 0.5 } },
});

/** `raw` with `change` applied to its model. */
const withModel = (raw: ReturnType<typeof linkage> | ReturnType<typeof gears>, change: Record<string, unknown>) => ({
  ...raw,
  model: { ...raw.model, ...change },
});

describe("the mechanism sim contract", () => {
  it("a four-bar and a gear pair keep the contract", () => {
    expect(issues(linkage())).toBeUndefined();
    expect(issues(gears())).toBeUndefined();
    const parsed = sim.parse(linkage());
    expect(parsed.kind).toBe("mechanism");
    expect(isLive(parsed)).toBe(true);
    expect((SIM_KINDS as readonly string[]).at(-1)).toBe("mechanism");
  });

  it("refuses a crank that can't be driven a full turn, at the change point and when it isn't the shortest", () => {
    // s + l = p + q: a change-point linkage flips its assembly at the flat position.
    expect(issues(withModel(linkage(), { ground: 80 }))).toEqual([
      "model: the crank can't be driven round a full turn: a four-bar turns fully only when s + l < p + q (Grashof), and here s + l = 160 ≥ p + q = 160",
    ]);
    // Grashof, but the crank is the longer of the short pair and the ground isn't shortest either.
    expect(issues(withModel(linkage(), { crank: 80, rocker: 40 }))).toEqual([
      "model: the crank can't turn fully: in a Grashof four-bar only the shortest link turns fully, as the crank (crank-rocker) or the ground (double crank); here the shortest is the rocker",
    ]);
  });

  it("labels only the pins the model has", () => {
    const labelled = (labels: Record<string, string>, extra: Record<string, unknown> = {}) =>
      issues(withModel(linkage(), { labels, ...extra }));
    expect(labelled({ O2: "O", A: "B" })).toBeUndefined();
    expect(labelled({ P: "P" })).toBeUndefined();
    expect(labelled({ Q: "Q" })).toEqual(["model.labels: a four-bar's pins are O2, A, B, O4 and P: no Q"]);
    expect(labelled({ P: "P" }, { couplerPoint: undefined })).toEqual([
      "model.labels: P labels the coupler point, and the four-bar has none",
    ]);
    expect(issues(withModel(gears(), { labels: { O1: "A", O2: "B" } }))).toBeUndefined();
    expect(issues(withModel(gears(), { labels: { A: "A" } }))).toEqual([
      "model.labels: a gear pair's pins are O1 and O2: no A",
    ]);
  });

  it("takes whole teeth, from 8, and a pressure angle between 10° and 35°", () => {
    expect(issues(withModel(gears(), { teeth: [18.5, 36] }))?.[0]).toContain("model.teeth.0");
    expect(issues(withModel(gears(), { teeth: [7, 36] }))?.[0]).toContain("model.teeth.0");
    expect(issues(withModel(gears(), { pressureAngle: 10 }))?.[0]).toContain("model.pressureAngle");
    expect(issues(withModel(gears(), { pressureAngle: 35 }))?.[0]).toContain("model.pressureAngle");
  });

  it("opens inside the range students turn the driver over, and ships live only with both", () => {
    expect(issues({ ...linkage(), start: { theta: 400 } })).toEqual([
      "start.theta: 400 is outside the range students tune it over (0 to 360)",
    ]);
    const bare: Record<string, unknown> = linkage();
    delete bare.start;
    expect(issues(bare)).toEqual([
      "start: a live sim opens on the example's values (start) and says what students tune over (tune)",
    ]);
  });

  it("lets students tune the angle, never rewire the linkage", () => {
    const rewired = linkage();
    (rewired.tune as Record<string, unknown>).ground = { min: 0, max: 1, step: 1 };
    expect(issues(rewired)).toEqual(['tune: Unrecognized key: "ground"']);
  });

  it("is checked by the kinematics gate, and its engine gives the Fixture four-bar's numbers", () => {
    expect(KINDS.mechanism.checkedBy).toBe("kinematics");
    const parsed = sim.parse(linkage());
    if (!isLive(parsed)) throw new Error("the four-bar isn't live");
    const found = engineQuantities(parsed);
    expect(found["theta3"]).toBeCloseTo(18.376, 3);
    expect(found).toEqual(quantities(parsed.model as Parameters<typeof quantities>[0], { theta: 60 }));
    // The tuned angle moves it.
    expect(engineQuantities(parsed, { theta: 90 })["theta3"]).not.toBeCloseTo(18.376, 1);
  });
});
