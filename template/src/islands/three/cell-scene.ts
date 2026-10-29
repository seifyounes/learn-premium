// A galvanic cell on the viewer's stage (DESIGN.md, Live 3D Viewers): two beakers, a metal
// electrode in each solution, a wire over the top through a voltmeter, and a salt bridge between
// the solutions. The cell is written first | second and drawn so the home view shows the first
// electrode at the start side. The engine drives it: the electrons, the arrows beside them and the
// labels turn round when E < 0, and under reduced motion the electrons hide and only the arrows
// say which way. The red pen is never drawn inside a viewer.
//
// This module imports three.js: the viewer loads it only after first paint, never with the page.
import * as THREE from "three";
import { ION_TINTS, METAL_COLOURS, NEUTRAL_METAL } from "../../chemistry/meaning.ts";
import type { CellAnchor, CellState, Electrode } from "../../sims/nernst/apparatus.ts";
import type { Model } from "../../sims/nernst/engine.ts";
import { matte, pencilEdges, type Stage, type ViewerInks } from "./stage.ts";

type Point3 = readonly [number, number, number];

/** The first electrode's head, up, across the top through the voltmeter, down to the second's head (scene mm, +y up). */
export const WIRE: readonly Point3[] = [
  [45, 78, 0],
  [45, 95, 0],
  [-45, 95, 0],
  [-45, 78, 0],
];
/** The wire's x runs from the first electrode's head to the second's: the sign of that run. */
const RUN = Math.sign((WIRE.at(-1)?.[0] ?? 0) - (WIRE[0]?.[0] ?? 0));

/** Where each part of the cell sits: the first at one side, the second at the other. */
const BEAKER_AT: Record<Electrode, number> = { first: 55, second: -55 };
const ELECTRODE_AT: Record<Electrode, number> = { first: 45, second: -45 };
const BEAKER_RADIUS = 30;
const BEAKER_HEIGHT = 70;
const LIQUID_HEIGHT = 50;
const ARROWS_AT = [-36, -20, 20, 36];
const ELECTRONS = 6;

export interface BuiltCell {
  root: THREE.Group;
  /** Where each label's leader starts. */
  anchors: Record<CellAnchor, THREE.Object3D>;
  /** The arrows beside the wire, tip along +y of the object. */
  arrows: THREE.Object3D[];
  /** The electrons that travel the wire. */
  electrons: THREE.Object3D[];
  solutions: Record<Electrode, THREE.Mesh>;
  box: THREE.Box3;
}

const length = ([ax, ay, az]: Point3, [bx, by, bz]: Point3) => Math.hypot(bx - ax, by - ay, bz - az);

/** The point `fraction` of the way along the wire (0 at the first electrode's head, 1 at the second's). */
function along(fraction: number): THREE.Vector3 {
  const total = WIRE.slice(1).reduce((sum, p, i) => sum + length(WIRE[i] as Point3, p), 0);
  let remaining = (((fraction % 1) + 1) % 1) * total;
  for (let i = 1; i < WIRE.length; i++) {
    const from = WIRE[i - 1] as Point3;
    const to = WIRE[i] as Point3;
    const run = length(from, to);
    if (remaining <= run) {
      const t = run === 0 ? 0 : remaining / run;
      return new THREE.Vector3(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      );
    }
    remaining -= run;
  }
  const last = WIRE.at(-1) as Point3;
  return new THREE.Vector3(...last);
}

export function buildCell(three: typeof THREE, model: Model, inks: ViewerInks): BuiltCell {
  const root = new three.Group();
  const solutions = {} as Record<Electrode, THREE.Mesh>;

  for (const which of ["first", "second"] as const) {
    const x = BEAKER_AT[which];
    const half = model[which];

    // The beaker: an open glass cylinder, drawn in the sheet's colour with a pencil rim.
    const glass = new three.CylinderGeometry(BEAKER_RADIUS, BEAKER_RADIUS, BEAKER_HEIGHT, 48, 1, true);
    const beaker = new three.Mesh(glass, matte(inks.sheet));
    const beakerMaterial = beaker.material as THREE.MeshLambertMaterial;
    beakerMaterial.transparent = true;
    beakerMaterial.opacity = 0.25;
    beakerMaterial.side = three.DoubleSide;
    beakerMaterial.depthWrite = false;
    beaker.position.set(x, BEAKER_HEIGHT / 2, 0);
    const rim = pencilEdges([glass], inks.pencil);
    rim.position.copy(beaker.position);
    root.add(beaker, rim);

    // The solution: its tint from the ion, its density from the concentration (placeCell).
    const liquid = new three.Mesh(
      new three.CylinderGeometry(BEAKER_RADIUS - 0.4, BEAKER_RADIUS - 0.4, LIQUID_HEIGHT, 48),
      matte(ION_TINTS[half.ion] ?? inks.sheet),
    );
    const liquidMaterial = liquid.material as THREE.MeshLambertMaterial;
    liquidMaterial.transparent = true;
    liquidMaterial.depthWrite = false;
    liquid.position.set(x, LIQUID_HEIGHT / 2, 0);
    solutions[which] = liquid;
    root.add(liquid);

    // The electrode: a metal plate standing in the solution, its head above the beaker.
    const plate = new three.BoxGeometry(6, 70, 14);
    const electrode = new three.Mesh(plate, matte(METAL_COLOURS[half.metal] ?? NEUTRAL_METAL));
    electrode.position.set(ELECTRODE_AT[which], 43, 0);
    const outline = pencilEdges([plate], inks.pencil);
    outline.position.copy(electrode.position);
    root.add(electrode, outline);
  }

  // The wire, and the voltmeter it runs through.
  root.add(
    new three.Line(
      new three.BufferGeometry().setFromPoints(WIRE.map(([x, y, z]) => new three.Vector3(x, y, z))),
      new three.LineBasicMaterial({ color: inks.graphite }),
    ),
  );
  const meter = new three.BoxGeometry(26, 16, 14);
  const voltmeter = new three.Mesh(meter, matte(inks.desk));
  voltmeter.position.set(0, 95, 0);
  const meterEdges = pencilEdges([meter], inks.pencil);
  meterEdges.position.copy(voltmeter.position);
  root.add(voltmeter, meterEdges);

  // The salt bridge: a U-shaped tube from one solution to the other, in front of the wire.
  const reach = Math.abs(BEAKER_AT.first) + 14;
  const bridgePath = new three.CatmullRomCurve3(
    [
      new three.Vector3(reach, 35, 18),
      new three.Vector3(reach, 80, 18),
      new three.Vector3(-reach, 80, 18),
      new three.Vector3(-reach, 35, 18),
    ],
    false,
    "catmullrom",
    0.05,
  );
  const tube = new three.TubeGeometry(bridgePath, 48, 4, 12, false);
  root.add(new three.Mesh(tube, matte(inks.sheet)), pencilEdges([tube], inks.pencil));

  // The arrows beside the wire say which way the electrons run, still or moving.
  const arrows = ARROWS_AT.map((x) => {
    const arrow = new three.Mesh(new three.ConeGeometry(3.5, 10, 16), matte(inks.graphite));
    arrow.position.set(x, 95, 0);
    root.add(arrow);
    return arrow;
  });
  // The electrons that travel it.
  const electrons = Array.from({ length: ELECTRONS }, () => {
    const electron = new three.Mesh(new three.SphereGeometry(2.2, 12, 8), matte(inks.graphite));
    root.add(electron);
    return electron;
  });

  const box = new three.Box3().setFromObject(root);
  const anchorAt = (x: number, y: number, z: number) => {
    const anchor = new three.Object3D();
    anchor.position.set(x, y, z);
    root.add(anchor);
    return anchor;
  };
  const anchors: Record<CellAnchor, THREE.Object3D> = {
    "first-electrode": anchorAt(ELECTRODE_AT.first, 80, 0),
    "second-electrode": anchorAt(ELECTRODE_AT.second, 80, 0),
    "first-solution": anchorAt(BEAKER_AT.first, 24, 0),
    "second-solution": anchorAt(BEAKER_AT.second, 24, 0),
    voltmeter: anchorAt(0, 95, 0),
    wire: anchorAt(28, 95, 0),
    bridge: anchorAt(0, 80, 18),
  };
  return { root, anchors, arrows, electrons, solutions, box };
}

/** Puts the cell in `state`: the arrows' way round, the electrons along the wire, the solutions' density. */
export function placeCell(built: BuiltCell, state: CellState, motion: { reduced: boolean; phase: number }): void {
  const flowing = state.flow !== "none";
  // The way the electrons run along the wire's x: with the run from the first electrode when E > 0, against it when E < 0.
  const way = (state.flow === "second-to-first" ? -1 : 1) * RUN;
  for (const arrow of built.arrows) {
    arrow.visible = flowing;
    // A cone's tip is its +y: turned a quarter turn about z, it points along ±x.
    arrow.rotation.set(0, 0, (-way * Math.PI) / 2);
  }
  const forward = state.flow !== "second-to-first";
  built.electrons.forEach((electron, i) => {
    electron.visible = flowing && !motion.reduced;
    electron.position.copy(along(i / built.electrons.length + (forward ? 1 : -1) * motion.phase));
  });
  for (const which of ["first", "second"] as const) {
    const material = built.solutions[which].material as THREE.MeshLambertMaterial;
    material.opacity = state.solutions[which].opacity;
  }
}

/** The way an arrow points, as a unit vector in world space: its cone's +y axis. */
export function tipDirection(arrow: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.getWorldQuaternion(new THREE.Quaternion()));
}

/** Builds the cell on the stage, frames it, and returns it for the viewer to drive. */
export function showCell(stage: Stage, model: Model): BuiltCell {
  const built = buildCell(stage.three, model, stage.inks);
  stage.scene.add(built.root);
  stage.frame(built.box);
  return built;
}
