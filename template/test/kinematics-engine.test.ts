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
  gearOutline,
  insideDepth,
  meshAt,
  outlinesAt,
  overlapOf,
  pins,
  pose,
  quantities,
  trace,
  type FourBar,
  type GearPair,
  type Point,
} from "../src/sims/mechanism/engine.ts";
import { fourBarReference, gearReference } from "./kinematics/reference.ts";

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

// The Fixture Course's spur pair: module 2, 18 and 36 teeth, 20°, 12 mm wide.
const pair: GearPair = { type: "gear-pair", module: 2, teeth: [18, 36], pressureAngle: 20, faceWidth: 12 };

const polarOf = ([x, y]: Point) => ({ rho: Math.hypot(x, y), angle: Math.atan2(y, x) });
const gap = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(ax - bx, ay - by);

describe("the gear pair", () => {
  it("the gear pair's quantities and driven angle", () => {
    const q = quantities(pair, { theta: 0 });
    expect(q["d1"]).toBe(36);
    expect(q["d2"]).toBe(72);
    expect(q["a"]).toBe(54);
    expect(q["ratio"]).toBe(2);
    expect(q["db1"]).toBeCloseTo(33.828934, 5);
    expect(q["db2"]).toBeCloseTo(67.657869, 5);
    expect(q["da1"]).toBe(40);
    expect(q["da2"]).toBe(76);
    expect(q["contactRatio"]).toBeCloseTo(1.6111060667858852, 12);
    // A space of the driven gear faces the driver's tooth at home: half a pitch from its tooth.
    expect(q["driven"]).toBe(185);
    expect(quantities(pair, { theta: 10 })["driven"]).toBe(180);
    expect(quantities(pair, { theta: 40 })["driven"]).toBe(165);
    // The pitch circles roll: r1·Δθ1 = r2·Δθ2, opposite ways.
    expect(quantities(pair, { theta: 360 })["driven"]).toBeCloseTo(5, 9);
  });

  it("a gear's outline: tip ra, root rf, CCW, its tooth πm/2 thick on the pitch circle within 1e-3 mm", () => {
    for (const which of [0, 1] as const) {
      const n = pair.teeth[which];
      const r = (pair.module * n) / 2;
      const outline = gearOutline(pair, which);
      const rho = outline.map((p) => polarOf(p).rho);
      expect(Math.max(...rho)).toBeCloseTo(r + pair.module, 9);
      expect(Math.min(...rho)).toBeCloseTo(r - 1.25 * pair.module, 9);
      // Counterclockwise: the shoelace sum is positive.
      const area = outline.reduce((sum, p, i) => {
        const q = outline[(i + 1) % outline.length] as Point;
        return sum + (p[0] * q[1] - q[0] * p[1]) / 2;
      }, 0);
      expect(area).toBeGreaterThan(0);
      // Where the polygon crosses the pitch circle either side of tooth 0, its arc is half the circular pitch.
      const crossings: number[] = [];
      outline.forEach((p, i) => {
        const q = outline[(i + 1) % outline.length] as Point;
        const [pr, qr] = [polarOf(p).rho, polarOf(q).rho];
        if ((pr - r) * (qr - r) >= 0) return;
        let [low, high] = [0, 1];
        for (let step = 0; step < 60; step++) {
          const mid = (low + high) / 2;
          const at: Point = [p[0] + (q[0] - p[0]) * mid, p[1] + (q[1] - p[1]) * mid];
          if ((polarOf(at).rho - r) * (pr - r) > 0) low = mid;
          else high = mid;
        }
        const t = (low + high) / 2;
        crossings.push(polarOf([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]).angle);
      });
      const near = crossings.filter((angle) => Math.abs(angle) < Math.PI / n).sort((u, v) => u - v);
      expect(near).toHaveLength(2);
      const thickness = r * ((near[1] ?? NaN) - (near[0] ?? NaN));
      expect(Math.abs(thickness - (Math.PI * pair.module) / 2), `gear ${which + 1}`).toBeLessThan(1e-3);
    }
  });

  it("`insideDepth` agrees with a brute-force winding test on 10 000 random points within the tip circle", () => {
    let seed = 20_261_025;
    const random = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
    for (const which of [0, 1] as const) {
      const outline = gearOutline(pair, which, 96);
      const tip = (pair.module * pair.teeth[which]) / 2 + pair.module;
      const winding = (p: Point) => {
        let inside = false;
        outline.forEach((a, i) => {
          const b = outline[(i + 1) % outline.length] as Point;
          if (a[1] > p[1] !== b[1] > p[1] && p[0] < a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
            inside = !inside;
        });
        return inside;
      };
      const distance = (p: Point) =>
        Math.min(
          ...outline.map((a, i) => {
            const b = outline[(i + 1) % outline.length] as Point;
            const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
            const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
          }),
        );
      let disagreements = 0;
      let magnitudes = 0;
      for (let i = 0; i < 10_000; i++) {
        const [rho, angle] = [tip * Math.sqrt(random()), 2 * Math.PI * random()];
        const p: Point = [rho * Math.cos(angle), rho * Math.sin(angle)];
        const depth = insideDepth(pair, which, p);
        if (depth > 0 !== winding(p)) {
          // The polygon's root arc is six chords, whose sagitta is a few thousandths of a mm: only a
          // point that near the outline may be judged the other way.
          expect(distance(p), `gear ${which + 1} at ${p}`).toBeLessThan(5e-3);
          disagreements += 1;
        }
        // Its size is the distance to the profile, to the polygon's error: a point inside by 0.1 mm is 0.1 mm deep.
        if (i % 20 === 0) {
          expect(Math.abs(Math.abs(depth) - distance(p)), `gear ${which + 1} at ${p}`).toBeLessThan(5e-3);
          magnitudes += 1;
        }
      }
      expect(disagreements).toBeLessThan(10);
      expect(magnitudes).toBe(500);
    }
  });

  it("the gear pair's driven gear matches the reference at 360 steps", () => {
    const ref = gearReference(pair, 360);
    let worstAngle = 0;
    let worstPin = 0;
    for (let k = 0; k < 360; k++) {
      const p = pose(pair, k);
      const placed = pins(pair, p);
      worstAngle = Math.max(worstAngle, Math.abs(turnBetween(p.links.driven?.angle ?? NaN, ref.driven[k] ?? NaN)));
      worstPin = Math.max(
        worstPin,
        gap(placed.driver?.H ?? [NaN, NaN], ref.H[k] ?? [NaN, NaN]),
        gap(placed.driven?.T ?? [NaN, NaN], ref.T[k] ?? [NaN, NaN]),
      );
    }
    expect(worstAngle).toBeLessThanOrEqual(0.1);
    expect(worstPin).toBeLessThanOrEqual(0.1);
    expect(worstAngle).toBeLessThanOrEqual(1e-6);
    expect(worstPin).toBeLessThanOrEqual(1e-6);
  });

  it("the Fixture pair never overlaps and always touches, at 0.5° steps until each gear has turned once", () => {
    // 18 and 36 teeth: the wheel turns once while the pinion turns twice, 720 degrees, 1440 half degrees.
    let worstOverlap = 0;
    let worstGap = 0;
    for (let k = 0; k < 1440; k++) {
      const found = meshAt(pair, k * 0.5);
      worstOverlap = Math.max(worstOverlap, found.overlap);
      worstGap = Math.max(worstGap, found.gap);
    }
    expect(worstOverlap).toBeLessThanOrEqual(1e-6);
    expect(worstGap).toBeLessThanOrEqual(0.05);
  });

  it("a 12-tooth pinion on a 48-tooth wheel at 20° interferes", () => {
    const interfering: GearPair = { ...pair, teeth: [12, 48] };
    let worst = 0;
    for (let k = 0; k < 2880; k++) worst = Math.max(worst, meshAt(interfering, k * 0.5).overlap);
    // The wheel's tips reach about 1 mm along the line of action past the pinion's base circle, where the
    // modelled flank (radial: no undercut) is already below the involute: they cut in by about 10 µm, five
    // thousand times the gate's 1e-6 mm tolerance. (Measured radially that is about 0.1 mm, but a radial
    // measure inflates wherever a flank is near-radial, so the engine reports the distance in mm.)
    expect(worst).toBeGreaterThan(5e-3);
    expect(worst).toBeLessThan(0.05);
  });

  it("a driven gear half a tooth out of phase overlaps", () => {
    const { driver, driven } = pose(pair, 0).links;
    if (!driver || !driven) throw new Error("no gear poses");
    // The same outlines, the driven gear's turned half its pitch about O2: its teeth now face the driver's.
    const turned = { at: driven.at, angle: driven.angle + 180 / pair.teeth[1] };
    const [first, second] = outlinesAt(pair, 0, 96);
    const rotate = (p: Point): Point => {
      const t = Math.PI / pair.teeth[1];
      const [x, y] = [p[0] - driven.at[0], p[1] - driven.at[1]];
      return [driven.at[0] + x * Math.cos(t) - y * Math.sin(t), driven.at[1] + y * Math.cos(t) + x * Math.sin(t)];
    };
    expect(overlapOf(pair, [first, second], [driver, driven]).overlap).toBeLessThanOrEqual(1e-6);
    expect(overlapOf(pair, [first, second.map(rotate)], [driver, turned]).overlap).toBeGreaterThan(0.5);
  });

  it("the overlap is measured, not just flagged", () => {
    // 0.3 mm closer than m(N1 + N2)/2: the teeth bite by about 0.3 sin φ along the line of action.
    const close: GearPair = { ...pair, centreDistance: 53.7 };
    let worst = 0;
    for (let k = 0; k < 40; k++) worst = Math.max(worst, meshAt(close, k * 0.5).overlap);
    expect(worst).toBeGreaterThanOrEqual(0.25 * 0.3 * Math.sin((20 * Math.PI) / 180));
    expect(worst).toBeLessThan(0.3);
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
