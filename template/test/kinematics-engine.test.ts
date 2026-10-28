// The kinematics engine, at its public interface (`src/sims/mechanism/engine.ts`): a four-bar and a
// spur gear pair solved as a pure function of the model and the driver's angle. Its answers are held
// against `test/kinematics/reference.ts`, which solves the four-bar by Newton–Raphson on the loop's
// closure and the gear pair by rolling, sharing no method with the engine.
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AssemblyError,
  fourBarProblems,
  pins,
  pose,
  quantities,
  trace,
  type FourBar,
} from "../src/sims/mechanism/engine.ts";
import { fourBarReference } from "./kinematics/reference.ts";

const TEST_DIR = import.meta.dirname;

// The Fixture Course's crank-rocker: O2O4 100, crank 40, coupler 120, rocker 80, P 60 along AB and 30 off it.
const crankRocker: FourBar = {
  type: "four-bar",
  ground: 100,
  crank: 40,
  coupler: 120,
  rocker: 80,
  assembly: "open",
  couplerPoint: { along: 60, off: 30 },
};
const crossed: FourBar = { ...crankRocker, assembly: "crossed" };

/** The check values are printed to three decimals: held to the ticket's 1e-3. */
const within = (expected: number) => (actual: number) => Math.abs(actual - expected) < 1e-3;

/** An angle difference wrapped to (−180, 180], in degrees. */
const turnBetween = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

describe("the four-bar", () => {
  it("solves the four-bar at θ2 = 60° (open)", () => {
    const p = pose(crankRocker, 60);
    const placed = pins(crankRocker, p);
    expect(placed.coupler?.B?.[0]).toSatisfy(within(133.881));
    expect(placed.coupler?.B?.[1]).toSatisfy(within(72.471));
    expect(placed.coupler?.P?.[0]).toSatisfy(within(67.483));
    expect(placed.coupler?.P?.[1]).toSatisfy(within(82.026));
    expect(p.links.coupler?.angle).toSatisfy(within(18.376));
    expect(p.links.rocker?.angle).toSatisfy(within(64.944));
    const q = quantities(crankRocker, { theta: 60 });
    expect(q.theta3).toSatisfy(within(18.376));
    expect(q.theta4).toSatisfy(within(64.944));
    expect(q.mu).toSatisfy(within(46.568));
    expect(q.Bx).toSatisfy(within(133.881));
    expect(q.By).toSatisfy(within(72.471));
    expect(q.Px).toSatisfy(within(67.483));
    expect(q.Py).toSatisfy(within(82.026));
  });

  it("the four-bar's pose matches the reference solver at 360 steps", () => {
    for (const model of [crankRocker, crossed]) {
      const ref = fourBarReference(model, 360);
      let worstAngle = 0;
      let worstPin = 0;
      for (let k = 0; k < 360; k++) {
        const p = pose(model, k);
        const placed = pins(model, p);
        const angle = (link: "coupler" | "rocker", expected: number) =>
          Math.abs(turnBetween(p.links[link]?.angle ?? NaN, expected));
        worstAngle = Math.max(
          worstAngle,
          angle("coupler", ref.theta3[k] ?? NaN),
          angle("rocker", ref.theta4[k] ?? NaN),
        );
        const off = (at: readonly [number, number] | undefined, expected: readonly [number, number] | undefined) =>
          Math.hypot((at?.[0] ?? NaN) - (expected?.[0] ?? NaN), (at?.[1] ?? NaN) - (expected?.[1] ?? NaN));
        worstPin = Math.max(
          worstPin,
          off(placed.crank?.A, ref.A[k]),
          off(placed.coupler?.A, ref.A[k]),
          off(placed.coupler?.B, ref.B[k]),
          off(placed.rocker?.B, ref.B[k]),
          off(placed.coupler?.P, ref.P?.[k]),
        );
      }
      // Within the ticket's 0.1° and 0.1 mm, and far inside them: the engine is exact, so a sloppy one can't hide.
      expect(worstAngle, `${model.assembly} angle`).toBeLessThanOrEqual(0.1);
      expect(worstPin, `${model.assembly} pin`).toBeLessThanOrEqual(0.1);
      expect(worstAngle, `${model.assembly} angle, exactly`).toBeLessThanOrEqual(1e-6);
      expect(worstPin, `${model.assembly} pin, exactly`).toBeLessThanOrEqual(1e-6);
    }
  });

  it("the coupler's B and the rocker's B coincide, and every link keeps its length, at every step", () => {
    for (const model of [crankRocker, crossed]) {
      for (let k = 0; k < 360; k++) {
        const placed = pins(model, pose(model, k));
        const at = <T extends readonly [number, number] | undefined>(point: T) => point as readonly [number, number];
        const gap = (p: readonly [number, number], q: readonly [number, number]) =>
          Math.hypot(p[0] - q[0], p[1] - q[1]);
        const [O2, A, B, O4] = [
          at(placed.ground?.O2),
          at(placed.crank?.A),
          at(placed.coupler?.B),
          at(placed.ground?.O4),
        ];
        expect(gap(at(placed.coupler?.B), at(placed.rocker?.B)), `B at ${k}°`).toBeLessThan(1e-9);
        expect(gap(at(placed.crank?.A), at(placed.coupler?.A)), `A at ${k}°`).toBeLessThan(1e-9);
        expect(gap(O2, A)).toBeCloseTo(40, 9);
        expect(gap(A, B)).toBeCloseTo(120, 9);
        expect(gap(O4, B)).toBeCloseTo(80, 9);
        expect(gap(O2, O4)).toBeCloseTo(100, 9);
      }
    }
  });

  it("a linkage that can't close throws an AssemblyError naming θ", () => {
    // A coupler of 30 can't span the gap from the crank pin (40 left of O2 at θ2 = 180°) to the rocker's circle.
    const short: FourBar = { ...crankRocker, coupler: 30 };
    let thrown: unknown;
    try {
      pose(short, 180);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AssemblyError);
    expect((thrown as AssemblyError).theta).toBe(180);
    expect((thrown as AssemblyError).message).toContain("can't close at θ = 180°");
  });

  it("`trace` steps θ = 0…359", () => {
    const t = trace(crankRocker);
    expect(t.theta).toHaveLength(360);
    expect(t.theta[0]).toBe(0);
    expect(t.theta[359]).toBe(359);
    expect(Object.keys(t.angles).sort()).toEqual(["coupler", "crank", "rocker"]);
    expect(Object.keys(t.points).sort()).toEqual(["A", "B", "P"]);
    expect(t.angles.crank?.[90]).toBe(90);
    expect(t.points.B?.[60]?.[0]).toSatisfy(within(133.881));
    // A coarser trace: θ = k·360/steps.
    expect(trace(crankRocker, 72).theta[1]).toBe(5);
  });

  it("`quantities` gives theta3, theta4, mu, Bx, By, Px, Py", () => {
    expect(Object.keys(quantities(crankRocker, { theta: 10 })).sort()).toEqual(
      ["Bx", "By", "Px", "Py", "mu", "theta3", "theta4"].sort(),
    );
    const bare: FourBar = { ...crankRocker, couplerPoint: undefined };
    expect(Object.keys(quantities(bare, { theta: 10 })).sort()).toEqual(["Bx", "By", "mu", "theta3", "theta4"].sort());
  });

  it("refuses a linkage whose crank can't turn fully, naming why", () => {
    expect(fourBarProblems(crankRocker)).toEqual([]);
    // Change point: s + l = p + q.
    const flat: FourBar = { ...crankRocker, ground: 80, crank: 40, coupler: 120, rocker: 80 };
    expect(fourBarProblems(flat)).toEqual([
      "the crank can't be driven round a full turn: a four-bar turns fully only when s + l < p + q (Grashof), and here s + l = 160 ≥ p + q = 160",
    ]);
    // Grashof, but the crank isn't the shortest and neither is the ground.
    const rockerCrank: FourBar = { ...crankRocker, crank: 80, rocker: 40, ground: 100, coupler: 120 };
    expect(fourBarProblems(rockerCrank)).toEqual([
      "the crank can't turn fully: in a Grashof four-bar only the shortest link turns fully, as the crank (crank-rocker) or the ground (double crank); here the shortest is the rocker",
    ]);
    // A double crank (the ground is the shortest) drives round.
    expect(fourBarProblems({ ...crankRocker, ground: 30, crank: 60, coupler: 70, rocker: 80 })).toEqual([]);
  });
});

describe("the engine's public interface", () => {
  const importsUnder = (source: string) =>
    [
      ...source.matchAll(
        /from\s+["']([^"']*src\/sims\/mechanism\/[^"']+)["']|import\s+["']([^"']*src\/sims\/mechanism\/[^"']+)["']/g,
      ),
    ].map((m) => (m[1] ?? m[2] ?? "").replace(/^.*src\/sims\/mechanism\//, ""));

  it("the engine tests reach it only through engine.ts", () => {
    const tests = globSync("{kinematics-*,mechanism-*}.test.ts", { cwd: TEST_DIR });
    expect(tests).toContain("kinematics-engine.test.ts");
    for (const file of tests) {
      // drive.ts is the play clock, not kinematics.
      for (const found of importsUnder(readFileSync(join(TEST_DIR, file), "utf8")))
        expect(["engine.ts", "drive.ts"], `${file} imports ${found}`).toContain(found);
    }
    // The reference solver is independent: it imports nothing from src/.
    expect(readFileSync(join(TEST_DIR, "kinematics", "reference.ts"), "utf8")).not.toMatch(/^\s*import[^;]*\bsrc\//m);
    expect(readFileSync(join(TEST_DIR, "kinematics", "reference.ts"), "utf8")).not.toMatch(/from\s+["']\.\.\/\.\./);
  });

  it("the import scan flags a planted import of an internal file", () => {
    // Built in pieces, so this file's own scan doesn't flag the plant.
    const at = (file: string) => `../src/sims/${"mechanism"}/${file}`;
    expect(importsUnder(`import { x } from "${at("four-bar.ts")}";`)).toEqual(["four-bar.ts"]);
    expect(importsUnder(`import "${at("four-bar.ts")}";`)).toEqual(["four-bar.ts"]);
    expect(importsUnder(`import { y } from "${at("engine.ts")}";`)).toEqual(["engine.ts"]);
  });
});
