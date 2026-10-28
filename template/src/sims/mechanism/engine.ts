// The kinematics engine's public interface: a mechanism (a four-bar, a spur gear pair) solved as a
// pure function of its model and the driver's angle, in mm and degrees, in the sheet frame (x along
// the ground line, y up). The 3D scene, the 2D sheet drawing, the number gates and the tests all
// import from here, never from the files behind it: one engine answers every view.
import { transmissionAngle } from "./four-bar.ts";
import { gearQuantities } from "./gears.ts";
import type { Model } from "./model.ts";
import { pins, pose } from "./pose.ts";

export { AssemblyError, fourBarProblems } from "./four-bar.ts";
export { gearOutline, insideDepth } from "./gears.ts";
export { meshAt, outlinesAt, overlapOf } from "./mesh.ts";
export type { Meshing } from "./mesh.ts";
export { MOVING_LINKS, TRACED_PINS } from "./model.ts";
export type { FourBar, GearPair, LinkId, Model, Point } from "./model.ts";
export {
  applyMatrix,
  dragAngle,
  linkMatrix,
  linkPins,
  pins,
  pose,
  svgMatrix,
  sweptBox,
  trace,
  TRACE_STEPS,
} from "./pose.ts";
export type { LinkPose, Matrix, Pose } from "./pose.ts";

/** What students tune: the driver's angle, in degrees. */
export interface Inputs {
  theta: number;
}

/** Every number the engine gives for the model at the driver's angle, by the names sheets and logs use. */
export function quantities(model: Model, inputs: Inputs): Record<string, number> {
  const p = pose(model, inputs.theta);
  if (model.type === "four-bar") {
    const theta3 = p.links.coupler?.angle ?? NaN;
    const theta4 = p.links.rocker?.angle ?? NaN;
    const placed = pins(model, p);
    const [Bx, By] = placed.coupler?.B ?? [NaN, NaN];
    const found: Record<string, number> = { theta3, theta4, mu: transmissionAngle(theta3, theta4), Bx, By };
    const P = placed.coupler?.P;
    if (P) {
      found["Px"] = P[0];
      found["Py"] = P[1];
    }
    return found;
  }
  return gearQuantities(model, inputs.theta);
}
