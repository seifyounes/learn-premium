// The 3D galvanic cell, with three.js alone (no canvas, no browser): the electron arrows point the
// way the electrons run, and turn round when E goes negative; the electrons move the way the arrows
// point, and hide under reduced motion; the solutions' opacity follows the state; and the home view
// sees the first electrode at the start side.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RED_PEN } from "../src/pads/colour.ts";
import { cellState } from "../src/sims/nernst/apparatus.ts";
import type { Inputs, Model } from "../src/sims/nernst/engine.ts";
import { cameraOffset, homeView } from "../src/viewer/orbit.ts";
import { WIRE, buildCell, placeCell, tipDirection } from "../src/islands/three/cell-scene.ts";

const cu = { metal: "Cu", ion: "Cu^2+", charge: 2, e0: 0.34 };
const model: Model = { first: cu, second: cu };
const inks = { graphite: "#262B25", pencil: "#3D433C", sheet: "#F4F3EA", desk: "#D9DDD2", print: "#1B1F1A" };
const START: Inputs = { c1: 0.01, c2: 1, T: 298.15 };
const REVERSED: Inputs = { c1: 1.5, c2: 1, T: 298.15 };
const NONE: Inputs = { c1: 1, c2: 1, T: 298.15 };

const stateAt = (inputs: Inputs) => cellState(model, inputs);
/** The sign of x from the first electrode's head to the second's: the way the wire runs, first to second. */
const FIRST_TO_SECOND = Math.sign((WIRE.at(-1)?.[0] ?? 0) - (WIRE[0]?.[0] ?? 0));

function placed(inputs: Inputs, motion = { reduced: false, phase: 0 }) {
  const built = buildCell(THREE, model, inks);
  placeCell(built, stateAt(inputs), motion);
  return built;
}

describe("the 3D cell", () => {
  it("every electron arrow points first→second when E > 0, second→first when E < 0, and none shows at E = 0", () => {
    const forward = placed(START);
    expect(forward.arrows).toHaveLength(4);
    for (const arrow of forward.arrows) {
      expect(arrow.visible).toBe(true);
      expect(tipDirection(arrow).x * FIRST_TO_SECOND).toBeGreaterThan(0.99);
    }
    const reversed = placed(REVERSED);
    for (const arrow of reversed.arrows) {
      expect(arrow.visible).toBe(true);
      expect(tipDirection(arrow).x * FIRST_TO_SECOND).toBeLessThan(-0.99);
    }
    for (const arrow of placed(NONE).arrows) expect(arrow.visible).toBe(false);
  });

  it("turns the arrows round again when E comes back, on the same scene", () => {
    const built = buildCell(THREE, model, inks);
    placeCell(built, stateAt(START), { reduced: false, phase: 0 });
    placeCell(built, stateAt(REVERSED), { reduced: false, phase: 0 });
    placeCell(built, stateAt(START), { reduced: false, phase: 0 });
    for (const arrow of built.arrows) expect(tipDirection(arrow).x * FIRST_TO_SECOND).toBeGreaterThan(0.99);
  });

  it("the electrons move the way the arrows point", () => {
    for (const [inputs, way] of [
      [START, 1],
      [REVERSED, -1],
    ] as const) {
      const sooner = placed(inputs, { reduced: false, phase: 0 });
      const later = placed(inputs, { reduced: false, phase: 0.01 });
      // The electron on the wire's top run, between the electrodes: its x is what the arrows show.
      const moved = sooner.electrons.flatMap((e, i) => {
        const a = e.position;
        const b = later.electrons[i]?.position;
        return b && Math.abs(a.y - (WIRE[1]?.[1] ?? 0)) < 1e-6 && Math.abs(b.y - a.y) < 1e-6 ? [b.x - a.x] : [];
      });
      expect(moved.length).toBeGreaterThan(0);
      for (const dx of moved) expect(Math.sign(dx) * FIRST_TO_SECOND).toBe(way);
    }
  });

  it("under reduced motion the electrons hide and the arrows stay", () => {
    const still = placed(START, { reduced: true, phase: 0.3 });
    for (const electron of still.electrons) expect(electron.visible).toBe(false);
    for (const arrow of still.arrows) expect(arrow.visible).toBe(true);
    const moving = placed(START);
    for (const electron of moving.electrons) expect(electron.visible).toBe(true);
    // No current: nothing moves, and nothing is shown to.
    const none = placed(NONE);
    for (const electron of none.electrons) expect(electron.visible).toBe(false);
  });

  it("a solution's opacity follows its state", () => {
    const built = placed(START);
    const material = (which: "first" | "second") => built.solutions[which].material as THREE.MeshLambertMaterial;
    expect(material("first").opacity).toBeCloseTo(stateAt(START).solutions.first.opacity, 12);
    expect(material("second").opacity).toBeCloseTo(stateAt(START).solutions.second.opacity, 12);
    expect(material("second").opacity).toBeGreaterThan(material("first").opacity);
    placeCell(built, stateAt(REVERSED), { reduced: false, phase: 0 });
    expect(material("first").opacity).toBeCloseTo(stateAt(REVERSED).solutions.first.opacity, 12);
  });

  it("the home view sees the first electrode at the start side", () => {
    const built = placed(START);
    built.root.updateMatrixWorld(true);
    const centre = built.box.getCenter(new THREE.Vector3());
    const radius = built.box.getSize(new THREE.Vector3()).length() / 2;
    const camera = new THREE.PerspectiveCamera(30, 1.6, 1, 10_000);
    const [x, y, z] = cameraOffset(homeView({ radius, fovDeg: 30, aspect: 1.6 }));
    camera.position.set(centre.x + x, centre.y + y, centre.z + z);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    const screenX = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3()).project(camera).x;
    expect(screenX(built.anchors["first-electrode"])).toBeLessThan(screenX(built.anchors["second-electrode"]));
    expect(screenX(built.anchors["first-solution"])).toBeLessThan(screenX(built.anchors["second-solution"]));
  });

  it("names every anchor the labels hang from, and keeps the whole cell in its box", () => {
    const built = placed(START);
    expect(Object.keys(built.anchors).sort()).toEqual([
      "bridge",
      "first-electrode",
      "first-solution",
      "second-electrode",
      "second-solution",
      "voltmeter",
      "wire",
    ]);
    expect(built.box.isEmpty()).toBe(false);
    for (const anchor of Object.values(built.anchors))
      expect(built.box.containsPoint(anchor.getWorldPosition(new THREE.Vector3()))).toBe(true);
  });

  it("never draws in the red pen", () => {
    const built = placed(START);
    const colours = new Set<string>();
    built.root.traverse((o) => {
      const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : [])
        if ("color" in m) colours.add((m.color as THREE.Color).getHexString());
    });
    expect(colours.size).toBeGreaterThan(3);
    expect(colours.has(RED_PEN.slice(1).toLowerCase())).toBe(false);
  });
});
