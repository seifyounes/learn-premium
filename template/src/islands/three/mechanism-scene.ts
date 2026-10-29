// A mechanism in 3D, drawn from the kinematic model on the viewer's stage: bars extruded from the
// four-bar's links, gears extruded from the engine's own involute outlines, in matte with pencil
// edges and graphite pins (DESIGN.md, Live 3D Viewers). No GLB: the same outlines the gates check
// are the ones drawn. The sheet frame (x along the ground line, y up, mm) is the root group's local
// XY, turned about the vertical so the home 3/4 view sees the mechanism's front, unmirrored. Each
// link is a group the pose moves; the pins are marker objects inside them, so a pin's world
// position is where the mechanism says it is. The red pen is never drawn inside a viewer.
//
// This module imports three.js: the viewer loads it only after first paint, never with the page.
import type * as THREE from "three";
import {
  gearOutline,
  linkPins,
  MOVING_LINKS,
  sweptBox,
  type LinkId,
  type Model,
  type Point,
  type Pose,
} from "../../sims/mechanism/engine.ts";
import { matte, pencilEdges, type ViewerInks } from "./stage.ts";

/** The mechanism stands upright, turned about the vertical so the home view (azimuth 40°) sees its front. */
export const MECHANISM_TURN_DEG = 105;

export interface BuiltMechanism {
  root: THREE.Group;
  /** Each link's group: the pose sets its position and its turn about z. */
  links: Map<LinkId, THREE.Group>;
  /** Each pin's marker, by `<link>.<pin>`, inside its link's group at the pin's local place. */
  pins: Map<string, THREE.Object3D>;
  /** A plane at the driving pin's depth, in the root's frame: a drag casts the pointer onto it. */
  dragPlane: THREE.Object3D;
  /** In the stage's frame (root turned): every pin and tip circle over a turn, through every layer. Frame it once. */
  box: THREE.Box3;
}

/** A bar is a slot this much of the shortest link wide, and this much thick. */
const BAR_WIDTH = 0.12;
const BAR_THICKNESS = 0.08;
/** The bars' layers sit this many thicknesses apart: a gap between them. */
const LAYER_PITCH = 1.6;
/** A gear's bore, visual only, as a share of its pitch radius. */
const BORE = 0.25;
/** The driving pin's ring, in pin radii. */
const RING = 1.9;

const RAD = Math.PI / 180;

/** The pin that students drag: the crank pin A, or the driver gear's handle H. */
export const drivingPin = (model: Model) => (model.type === "four-bar" ? "crank.A" : "driver.H");

export function buildMechanism(three: typeof THREE, model: Model, inks: ViewerInks): BuiltMechanism {
  const root = new three.Group();
  root.rotation.y = MECHANISM_TURN_DEG * RAD;
  const links = new Map<LinkId, THREE.Group>();
  const markers = new Map<string, THREE.Object3D>();
  const local = linkPins(model);

  const group = (link: LinkId, layer: number) => {
    const g = new three.Group();
    g.name = link;
    g.userData["layer"] = layer;
    root.add(g);
    links.set(link, g);
    return g;
  };
  /** Mesh and pencil edges in the link's own frame. */
  const solid = (into: THREE.Group, name: string, geometry: THREE.ExtrudeGeometry, colour: string) => {
    const mesh = new three.Mesh(geometry, matte(colour));
    mesh.name = name;
    into.add(mesh);
    into.add(pencilEdges([geometry], inks.pencil));
  };

  const lengths =
    model.type === "four-bar" ? [model.ground, model.crank, model.coupler, model.rocker] : [model.module * 4];
  const shortest = Math.min(...lengths);
  const width = BAR_WIDTH * shortest;
  const thickness = BAR_THICKNESS * shortest;
  const pitch = LAYER_PITCH * thickness;
  const pinRadius = 0.3 * width;

  /** A stadium from the origin to `to` along x, centred on z = 0. */
  const slot = (to: number, wide = width) => {
    const shape = new three.Shape();
    const r = wide / 2;
    shape.moveTo(0, -r);
    shape.lineTo(to, -r);
    shape.absarc(to, 0, r, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(0, r);
    shape.absarc(0, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    const geometry = new three.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geometry.translate(0, 0, -thickness / 2);
    return geometry;
  };

  /** A pin: a marker at its local place, with a graphite cylinder along z, ringed when it drives. */
  const pin = (into: THREE.Group, link: LinkId, name: string, at: Point, height: number, radius = pinRadius) => {
    const marker = new three.Object3D();
    marker.name = `${link}.${name}`;
    marker.position.set(at[0], at[1], 0);
    const cylinder = new three.Mesh(new three.CylinderGeometry(radius, radius, height, 24), matte(inks.graphite));
    cylinder.rotation.x = Math.PI / 2;
    marker.add(cylinder);
    if (marker.name === drivingPin(model)) {
      const ring = new three.Mesh(new three.TorusGeometry(radius * RING, radius * 0.22, 8, 36), matte(inks.graphite));
      marker.add(ring);
    }
    into.add(marker);
    markers.set(marker.name, marker);
  };

  /** A ground block behind the first layer, under a fixed pin. */
  const block = (into: THREE.Group, at: Point, behind: number) => {
    const size = width * 2.2;
    const shape = new three.Shape();
    shape.moveTo(-size / 2, -size / 2);
    shape.lineTo(size / 2, -size / 2);
    shape.lineTo(size / 2, size / 2);
    shape.lineTo(-size / 2, size / 2);
    shape.closePath();
    const geometry = new three.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geometry.translate(at[0], at[1], behind - thickness);
    solid(into, "ground-block", geometry, inks.sheet);
  };

  const ground = group("ground", 0);
  if (model.type === "four-bar") {
    const behind = -pitch * 0.6 - thickness / 2;
    for (const [name, at] of Object.entries(local.ground ?? {})) {
      block(ground, at, behind);
      pin(ground, "ground", name, at, thickness * 1.6);
    }
    const layers = { crank: 0, coupler: 1, rocker: 2 } as const;
    for (const link of MOVING_LINKS["four-bar"]) {
      const g = group(link, layers[link] * pitch);
      const pinsOf = local[link] ?? {};
      const far = Object.entries(pinsOf).reduce((farthest, [, at]) => Math.max(farthest, at[0]), 0);
      solid(g, "bar", slot(far), inks.desk);
      // The coupler point hangs off the coupler on a stem, so the plate reads as one rigid body.
      const point = pinsOf["P"];
      if (link === "coupler" && point) {
        const stem = slot(Math.abs(point[1]), width * 0.7);
        stem.rotateZ(point[1] >= 0 ? Math.PI / 2 : -Math.PI / 2);
        stem.translate(point[0], 0, 0);
        solid(g, "stem", stem, inks.desk);
      }
      for (const [name, at] of Object.entries(pinsOf))
        pin(g, link, name, at, thickness * (name === "P" ? 1.2 : 1.8), name === "P" ? pinRadius * 0.8 : pinRadius);
    }
  } else {
    const face = model.faceWidth;
    const behind = -face / 2 - thickness * 0.4;
    for (const [name, at] of Object.entries(local.ground ?? {})) {
      block(ground, at, behind);
      pin(ground, "ground", name, at, thickness * 1.6);
    }
    for (const [index, link] of (["driver", "driven"] as const).entries()) {
      const g = group(link, 0);
      const outline = gearOutline(model, index as 0 | 1);
      const shape = new three.Shape(outline.map(([x, y]) => new three.Vector2(x, y)));
      const bore = new three.Path();
      bore.absarc(0, 0, BORE * ((model.module * model.teeth[index as 0 | 1]) / 2), 0, 2 * Math.PI, true);
      shape.holes.push(bore);
      const geometry = new three.ExtrudeGeometry(shape, { depth: face, bevelEnabled: false });
      geometry.translate(0, 0, -face / 2);
      solid(g, "gear", geometry, inks.desk);
      for (const [name, at] of Object.entries(local[link] ?? {})) {
        // The driver's handle and the driven gear's tooth tip are marked on the front face.
        const marker = new three.Object3D();
        marker.name = `${link}.${name}`;
        marker.position.set(at[0], at[1], face / 2);
        const cylinder = new three.Mesh(
          new three.CylinderGeometry(pinRadius, pinRadius, thickness, 24),
          matte(inks.graphite),
        );
        cylinder.rotation.x = Math.PI / 2;
        marker.add(cylinder);
        if (marker.name === drivingPin(model))
          marker.add(
            new three.Mesh(new three.TorusGeometry(pinRadius * RING, pinRadius * 0.22, 8, 36), matte(inks.graphite)),
          );
        g.add(marker);
        markers.set(marker.name, marker);
      }
    }
  }

  // The pin markers in the ground group are the fixed ones; the box holds everything over a turn.
  const swept = sweptBox(model);
  const zFrom = model.type === "four-bar" ? -pitch * 0.6 - thickness * 1.5 : -model.faceWidth / 2 - thickness * 1.4;
  const zTo = model.type === "four-bar" ? 2 * pitch + thickness : model.faceWidth / 2 + thickness;
  const margin = width;
  root.updateMatrixWorld(true);
  const box = new three.Box3();
  for (let i = 0; i < 8; i++)
    box.expandByPoint(
      new three.Vector3(
        i & 1 ? swept.max[0] + margin : swept.min[0] - margin,
        i & 2 ? swept.max[1] + margin : swept.min[1] - margin,
        i & 4 ? zTo : zFrom,
      ).applyMatrix4(root.matrixWorld),
    );
  const dragPlane = new three.Object3D();
  dragPlane.name = "drag-plane";
  // The crank pin sits on the crank's layer, z = 0; the driver gear's handle on its front face.
  dragPlane.position.z = model.type === "gear-pair" ? model.faceWidth / 2 : 0;
  root.add(dragPlane);
  return { root, links, pins: markers, dragPlane, box };
}

/** Moves every link to its pose: its origin on the sheet, on its layer, turned about z. */
export function placeLinks(built: BuiltMechanism, p: Pose): void {
  for (const [link, group] of built.links) {
    const at = p.links[link];
    if (!at) continue;
    group.position.set(at.at[0], at.at[1], Number(group.userData["layer"] ?? 0));
    group.rotation.z = at.angle * RAD;
  }
}
