// The two mechanism gates on the Fixture Course's Module 11: `kinematics` holds what the viewer draws
// (the engine's poses) to an independent recompute at 360 steps of one driver turn, each moving link
// within 0.1° and each pin within 0.1 mm, and the sheet's values three ways; `gear-interference` holds
// a gear pair's teeth at 0.5° steps until each gear has turned once: never overlapping, always touching.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANGLE_TOLERANCE_DEG,
  compareTrace,
  gearInterferenceGate,
  kinematicsGate,
  type MechanismLog,
} from "../gates/mechanisms.ts";
import { runControls } from "../gates/runner.ts";
import { pose, trace, type FourBar, type Pose } from "../src/sims/mechanism/engine.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "11-mechanisms";
const SIMS = `modules/${MODULE}/sims`;
const LOGS = `build-records/recompute/${MODULE}`;
const check = (contentDir: string) => kinematicsGate.run({ contentDir, module: MODULE });
const messages = (result: Awaited<ReturnType<typeof check>>) =>
  result.findings.map((f) => `${f.outcome}: ${f.message}`);

type Json = Record<string, unknown>;
/** The Fixture with one JSON file edited. */
const editJson = (file: string, edit: (data: Json) => void, from = FIXTURE_COURSE) =>
  fixtureWith(
    file,
    (source) => {
      const data = JSON.parse(source) as Json;
      edit(data);
      return JSON.stringify(data, null, 2);
    },
    from,
  );
/** The Fixture's recompute log, read as the gate reads it. */
const logOf = (name: string) =>
  JSON.parse(readFileSync(`${FIXTURE_COURSE}/${LOGS}/${name}.json`, "utf8")) as MechanismLog;

const crankRocker: FourBar = {
  type: "four-bar",
  ground: 100,
  crank: 40,
  coupler: 120,
  rocker: 80,
  assembly: "open",
  couplerPoint: { along: 60, off: 30 },
};

describe("the kinematics gate", () => {
  it("kinematics passes the Fixture's four-bar and gear pair", async () => {
    const result = await check(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    // 360 steps each; the four-bar logs 3 angles and 5 pin copies (A on two links, B on two, P on one),
    // the gear pair 2 angles and 2 pin copies (H, T); 7 sheet values each, all 7 of which are logged.
    expect(result.coverage).toEqual({
      modules: 1,
      mechanisms: 2,
      stepThroughs: 0,
      steps: 720,
      angles: 1800,
      points: 2520,
      sheetValues: 14,
      recomputedValues: 14,
    });
  });

  it("every control in kinematicsGate.controls is caught, and so is every gear-interference control", async () => {
    const result = await runControls({
      input: { contentDir: FIXTURE_COURSE, module: MODULE },
      gates: [kinematicsGate, gearInterferenceGate],
    });
    for (const gate of result.gates) {
      expect(gate.positive, gate.id).toBe("pass");
      for (const control of gate.controls) expect(control.caught, `${gate.id}: ${control.defect}`).toBe(true);
    }
    expect(result.gates.map((g) => [g.id, g.controls.length])).toEqual([
      ["kinematics", 8],
      ["gear-interference", 3],
    ]);
    expect(result.ok).toBe(true);
  });

  it("names the worst link and pin it finds off, and how many steps", async () => {
    const off = editJson(`${LOGS}/linkage.json`, (log) => {
      const t = (log as unknown as MechanismLog).trace;
      const rocker = t.angles["rocker"] as number[];
      for (const k of [137, 138, 300]) rocker[k] = (rocker[k] as number) + 0.2 + k / 1000;
      const at = (t.points["P"] as [number, number][])[211] as [number, number];
      at[0] += 0.2;
    });
    const found = messages(await check(off));
    expect(found).toEqual([
      "block: rocker is 0.5° off the recompute at θ = 300° (more than 0.1°; 3 of 360 steps off)",
      "block: pin P on the coupler is 0.2 mm off the recompute at θ = 211° (more than 0.1 mm; 1 of 360 steps off)",
    ]);
  });

  it("0.05° off at one step passes", async () => {
    // The tolerance is 0.1°, not 0: a recompute that rounds a degree's hundredth still agrees.
    const near = editJson(`${LOGS}/linkage.json`, (log) => {
      const angles = (log as unknown as MechanismLog).trace.angles["coupler"] as number[];
      angles[10] = (angles[10] as number) + 0.05;
    });
    expect(messages(await check(near))).toEqual([]);
    expect(ANGLE_TOLERANCE_DEG).toBe(0.1);
  });

  it("a pose turning the coupler about B instead of A is caught", () => {
    const log = logOf("linkage");
    // The right engine passes `compareTrace` ...
    expect(compareTrace(crankRocker, (theta) => pose(crankRocker, theta), log.trace)).toEqual([]);
    // ... and a mutant whose coupler turns about its other end doesn't.
    const mutant = (theta: number): Pose => {
      const p = pose(crankRocker, theta);
      const coupler = p.links.coupler;
      const crank = p.links.crank;
      if (!coupler || !crank) throw new Error("no coupler");
      const about = (angle: number) => (angle * Math.PI) / 180;
      // Move the origin to B and keep the angle: the bar now hangs on the wrong pin.
      const at: [number, number] = [
        coupler.at[0] + 120 * Math.cos(about(coupler.angle)),
        coupler.at[1] + 120 * Math.sin(about(coupler.angle)),
      ];
      return { ...p, links: { ...p.links, coupler: { at, angle: coupler.angle } } };
    };
    const found = compareTrace(crankRocker, mutant, log.trace);
    // Every link's angle is right, so no angle is named; the pins, at every step, are not.
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^pin \w+ on the coupler is [\d.]+ mm off the recompute at θ = \d+° \(more than 0.1 mm; 360 of 360 steps off\)$/,
    );
  });

  it("a step-through mechanism is counted, not traced", async () => {
    const stepThrough = editJson(`${SIMS}/linkage.json`, (sim) => {
      sim["recompute"] = "none";
      delete sim["start"];
      delete sim["tune"];
      sim["stepThrough"] = {
        figure: {
          kind: "plot",
          caption: "A four-bar",
          x: { label: "x", min: 0, max: 2, step: 1 },
          y: { label: "y", min: 0, max: 2, step: 1 },
          elements: [
            { id: "a", kind: "point", at: [0, 0] },
            { id: "b", kind: "point", at: [1, 1] },
          ],
          question: ["a"],
        },
        steps: [
          { caption: "The crank", add: [] },
          { caption: "The coupler", add: ["b"], ring: ["b"] },
        ],
      };
    });
    const result = await check(stepThrough);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ mechanisms: 2, stepThroughs: 1, steps: 360 });
  });

  it("the engine's own trace of the crossed assembly is not the open assembly's", () => {
    const log = logOf("linkage");
    const crossed = trace({ ...crankRocker, assembly: "crossed" });
    const planted = { ...log, trace: JSON.parse(JSON.stringify(crossed)) as MechanismLog["trace"] };
    expect(compareTrace(crankRocker, (theta) => pose(crankRocker, theta), planted.trace).length).toBeGreaterThan(0);
  });
});

describe("the gear-interference gate", () => {
  const run = (contentDir: string) => gearInterferenceGate.run({ contentDir, module: MODULE });

  it("gear-interference passes the Fixture pair", async () => {
    const result = await run(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    // One pair, 18 and 36 teeth: the wheel turns once while the pinion turns twice, 1440 half degrees.
    expect(result.coverage).toEqual({ modules: 1, gearPairs: 1, steps: 1440 });
  });

  it("names a pair 0.5 mm too close, its overlap and why", async () => {
    const close = editJson(`${SIMS}/gears.json`, (sim) => {
      (sim["model"] as Json)["centreDistance"] = 53.5;
    });
    const found = (await run(close)).findings.map((f) => f.message);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^the teeth overlap by [\d.]+ mm at θ = [\d.]+° \(\d+ of 1440 steps\): the centre distance 53\.5 mm is under m\(N1 \+ N2\)\/2 = 54 mm$/,
    );
  });

  it("names a pair too far apart: its teeth never touch", async () => {
    const apart = editJson(`${SIMS}/gears.json`, (sim) => {
      (sim["model"] as Json)["centreDistance"] = 54.5;
    });
    const found = (await run(apart)).findings.map((f) => f.message);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^the teeth don't touch at θ = [\d.]+°, [\d.]+ mm apart at their closest: the centre distance 54\.5 mm is over m\(N1 \+ N2\)\/2 = 54 mm$/,
    );
  });

  it("names which gear's tips cut in when a 12-tooth pinion drives a 48-tooth wheel", async () => {
    const interfering = editJson(`${SIMS}/gears.json`, (sim) => {
      (sim["model"] as Json)["teeth"] = [12, 48];
    });
    const result = await run(interfering);
    expect(result.coverage).toEqual({ modules: 1, gearPairs: 1, steps: 2880 });
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(
        /^the teeth overlap by [\d.]+ mm at θ = [\d.]+° \(\d+ of 2880 steps\): the driven gear's tips reach below the driver's base circle \(interference\): give it fewer teeth, or the driver more$/,
      ),
    ]);
  });
});
