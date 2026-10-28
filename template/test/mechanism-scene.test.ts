// A mechanism's 3D scene and its 2D drawing, from the same poses, in Node (three.js with no
// renderer): every pin lands where the independent reference solver puts it, at 360 steps, in both
// views; the extruded gears are the outlines the engine gives; and at the home view the mechanism
// faces the camera, unmirrored.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildMechanism, MECHANISM_TURN_DEG, placeLinks } from "../src/islands/three/mechanism-scene.ts";
import type { ViewerInks } from "../src/islands/three/stage.ts";
import {
  applyMatrix,
  linkMatrix,
  linkPins,
  outlinesAt,
  pins,
  pose,
  svgMatrix,
  type FourBar,
  type GearPair,
  type Matrix,
  type Point,
} from "../src/sims/mechanism/engine.ts";
import { cameraOffset, homeView } from "../src/viewer/orbit.ts";
import { fourBarReference, gearReference } from "./kinematics/reference.ts";

// Inks as the page's tokens give them; a test names its own.
const inks: ViewerInks = {
  graphite: "#222222",
  pencil: "#666666",
  sheet: "#fafafa",
  desk: "#e8e8e8",
  print: "#111111",
};

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
const pair: GearPair = { type: "gear-pair", module: 2, teeth: [18, 36], pressureAngle: 20, faceWidth: 12 };

// three.js holds a vertex as a 32-bit float: about 8 µm of resolution a hundred mm from the origin, so the
// extruded vertices are held to 1e-4 mm, a thousand times inside the ticket's 0.1 mm.
const FLOAT32 = 1e-4;

const off = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("the 3D scene", () => {
  it("the 3D scene puts every pin where the reference solver does, at 360 steps", () => {
    for (const model of [crankRocker, crossed]) {
      const built = buildMechanism(THREE, model, inks);
      const ref = fourBarReference(model, 360);
      const expected: Record<string, readonly (readonly [number, number])[] | undefined> = {
        "crank.A": ref.A,
        "coupler.A": ref.A,
        "coupler.B": ref.B,
        "rocker.B": ref.B,
        "coupler.P": ref.P,
      };
      let worst = 0;
      for (let k = 0; k < 360; k++) {
        placeLinks(built, pose(model, k));
        built.root.updateMatrixWorld(true);
        for (const [name, at] of Object.entries(expected)) {
          const marker = built.pins.get(name);
          if (!marker || !at) throw new Error(`no pin ${name}`);
          const sheet = built.root.worldToLocal(marker.getWorldPosition(new THREE.Vector3()));
          worst = Math.max(worst, off([sheet.x, sheet.y], at[k] as readonly [number, number]));
        }
      }
      expect(worst, model.assembly).toBeLessThanOrEqual(0.1);
      expect(worst, `${model.assembly}, exactly`).toBeLessThanOrEqual(1e-4); // three.js holds floats
    }
    const built = buildMechanism(THREE, pair, inks);
    const ref = gearReference(pair, 360);
    let worst = 0;
    for (let k = 0; k < 360; k++) {
      placeLinks(built, pose(pair, k));
      built.root.updateMatrixWorld(true);
      for (const [name, at] of [
        ["driver.H", ref.H],
        ["driven.T", ref.T],
      ] as const) {
        const marker = built.pins.get(name);
        if (!marker) throw new Error(`no pin ${name}`);
        const sheet = built.root.worldToLocal(marker.getWorldPosition(new THREE.Vector3()));
        worst = Math.max(worst, off([sheet.x, sheet.y], at[k] as readonly [number, number]));
      }
    }
    expect(worst).toBeLessThanOrEqual(0.1);
  });

  it("layers the bars one above another, the crank first, and the ground behind them", () => {
    const built = buildMechanism(THREE, crankRocker, inks);
    placeLinks(built, pose(crankRocker, 60));
    const z = (link: "crank" | "coupler" | "rocker") => built.links.get(link)?.position.z ?? NaN;
    expect(z("crank")).toBe(0);
    expect(z("coupler")).toBeGreaterThan(0);
    expect(z("rocker")).toBeGreaterThan(z("coupler"));
    expect(z("rocker") - z("coupler")).toBeCloseTo(z("coupler") - z("crank"), 9);
    expect(built.box.min.z).toBeLessThan(0);
    expect(built.box.isEmpty()).toBe(false);
  });

  it("the extruded gears are the outlines `outlinesAt` gives", () => {
    const built = buildMechanism(THREE, pair, inks);
    for (const theta of [0, 37.5, 200]) {
      placeLinks(built, pose(pair, theta));
      built.root.updateMatrixWorld(true);
      const outlines = outlinesAt(pair, theta);
      for (const [index, link] of (["driver", "driven"] as const).entries()) {
        const group = built.links.get(link);
        const mesh = group?.getObjectByName("gear") as THREE.Mesh | undefined;
        if (!group || !mesh) throw new Error(`no gear on ${link}`);
        const position = mesh.geometry.getAttribute("position");
        const front: Point[] = [];
        const to = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) {
          to.fromBufferAttribute(position, i);
          if (Math.abs(to.z - pair.faceWidth / 2) > 1e-9) continue;
          to.applyMatrix4(mesh.matrixWorld);
          const sheet = built.root.worldToLocal(to.clone());
          front.push([sheet.x, sheet.y]);
        }
        // The front face holds every outline vertex (and the bore's), and no vertex off the outline.
        const outline = outlines[index] as Point[];
        for (const vertex of outline)
          expect(Math.min(...front.map((f) => off(f, vertex))), `${link} at ${theta}°`).toBeLessThan(FLOAT32);
        const bore = (pair.module * pair.teeth[index as 0 | 1]) / 2 / 4;
        const centre = pose(pair, theta).links[link]?.at as Point;
        for (const f of front)
          expect(
            Math.min(...outline.map((v) => off(f, v)), Math.abs(off(f, centre) - bore)),
            `${link} at ${theta}°`,
          ).toBeLessThan(FLOAT32);
      }
    }
  });

  it("the 2D drawing's transforms put every pin where the reference does", () => {
    // What the drawing's `<g transform>` says, read back the way an SVG parser reads it.
    const read = (transform: string): Matrix => {
      const numbers = /^matrix\(([^)]*)\)$/.exec(transform)?.[1]?.split(" ").map(Number);
      if (numbers?.length !== 6 || numbers.some((n) => !Number.isFinite(n))) throw new Error(transform);
      return numbers as unknown as Matrix;
    };
    for (const model of [crankRocker, crossed]) {
      const ref = fourBarReference(model, 360);
      let worst = 0;
      for (let k = 0; k < 360; k++) {
        const p = pose(model, k);
        const local = linkPins(model);
        const at = (link: "crank" | "coupler" | "rocker", pin: string) => {
          const pinAt = local[link]?.[pin] as Point;
          const linkPose = p.links[link];
          if (!linkPose) throw new Error(link);
          return applyMatrix(read(svgMatrix(linkPose)), pinAt);
        };
        worst = Math.max(
          worst,
          off(at("crank", "A"), ref.A[k] as Point),
          off(at("coupler", "B"), ref.B[k] as Point),
          off(at("rocker", "B"), ref.B[k] as Point),
          off(at("coupler", "P"), (ref.P as Point[])[k] as Point),
        );
        // `svgMatrix` prints six decimals, `linkMatrix` carries the rest.
        const exact = applyMatrix(linkMatrix(p.links.coupler as NonNullable<typeof p.links.coupler>), [0, 0]);
        expect(off(exact, (pins(model, p).coupler?.A ?? [NaN, NaN]) as Point)).toBeLessThan(1e-9);
      }
      expect(worst, model.assembly).toBeLessThanOrEqual(0.1);
      expect(worst, `${model.assembly}, to the matrix's printed digits`).toBeLessThanOrEqual(1e-3);
    }
  });

  it("at the home view the mechanism faces the camera, unmirrored", () => {
    for (const model of [crankRocker, pair]) {
      const built = buildMechanism(THREE, model, inks);
      placeLinks(built, pose(model, 90));
      built.root.updateMatrixWorld(true);
      expect(built.root.rotation.y).toBeCloseTo((MECHANISM_TURN_DEG * Math.PI) / 180, 12);
      const target = built.box.getCenter(new THREE.Vector3());
      const radius = built.box.getSize(new THREE.Vector3()).length() / 2;
      const camera = new THREE.PerspectiveCamera(30, 1.6, 1, 100_000);
      const [x, y, z] = cameraOffset(homeView({ radius, fovDeg: 30, aspect: 1.6 }));
      camera.position.set(target.x + x, target.y + y, target.z + z);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const screen = (name: string) => {
        const marker = built.pins.get(name);
        if (!marker) throw new Error(name);
        return marker.getWorldPosition(new THREE.Vector3()).project(camera);
      };
      const [O2, O4, A] =
        model.type === "four-bar"
          ? [screen("ground.O2"), screen("ground.O4"), screen("crank.A")]
          : [screen("ground.O1"), screen("ground.O2"), screen("driver.H")];
      // O4 (or the driven gear's centre) lies to the right of O2; the driver at 90° lies above it.
      expect(O4?.x ?? NaN, model.type).toBeGreaterThan(O2?.x ?? NaN);
      expect(A?.y ?? NaN, model.type).toBeGreaterThan(O2?.y ?? NaN);
      // The sheet's front face (+z, towards the viewer of the drawing) turns to the camera.
      const front = new THREE.Vector3(0, 0, 1).transformDirection(built.root.matrixWorld);
      expect(front.dot(camera.position.clone().sub(target).normalize()), model.type).toBeGreaterThan(0.5);
    }
  });
});
