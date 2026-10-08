// The 3D viewer's camera, as an orbit round the object's centre: pure, so it is the same in the page
// and in tests. Angles in radians, distances in the model's units (mm). Three.js's frame: +y up.

export interface Orbit {
  /** Round the vertical axis, from +x towards −z (three.js), i.e. from the drawing's +x towards +y. */
  azimuth: number;
  /** Above the horizontal. */
  elevation: number;
  distance: number;
}

const RAD = Math.PI / 180;
/** The default 3/4 view (DESIGN.md, Live 3D Viewers): Reset view restores it. */
export const HOME_AZIMUTH = 40 * RAD;
export const HOME_ELEVATION = 25 * RAD;
/** Never over a pole: the view would flip. */
const MAX_ELEVATION = 85 * RAD;
/** Zoom range, as multiples of the home distance. */
const NEAREST = 0.35;
const FARTHEST = 3;

/** The home view: the 3/4 view, back far enough that a sphere of `radius` fits the narrower field of view. */
export function homeView({ radius, fovDeg, aspect }: { radius: number; fovDeg: number; aspect: number }): Orbit {
  const vertical = fovDeg * RAD;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return {
    azimuth: HOME_AZIMUTH,
    elevation: HOME_ELEVATION,
    distance: radius / Math.sin(Math.min(vertical, horizontal) / 2),
  };
}

/** A drag of (dx, dy) pixels on a frame `height` tall: across its whole height turns half a turn. */
export function turn(o: Orbit, dx: number, dy: number, height: number): Orbit {
  const perPixel = Math.PI / Math.max(height, 1);
  return {
    ...o,
    azimuth: o.azimuth - dx * perPixel,
    elevation: Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, o.elevation + dy * perPixel)),
  };
}

/** Closer by `factor` (a pinch spreading to twice its width is 2), within limits of the home distance. */
export function zoom(o: Orbit, factor: number, home: Orbit): Orbit {
  const distance = o.distance / factor;
  return { ...o, distance: Math.max(home.distance * NEAREST, Math.min(home.distance * FARTHEST, distance)) };
}

/** Whether the view is the home view (Reset view then has nothing to do). */
export function atHome(o: Orbit, home: Orbit): boolean {
  const close = (a: number, b: number, scale = 1) => Math.abs(a - b) <= 1e-6 * scale;
  return (
    close(o.azimuth, home.azimuth) &&
    close(o.elevation, home.elevation) &&
    close(o.distance, home.distance, home.distance)
  );
}

/** Where the camera sits, from the object's centre. */
export function cameraOffset(o: Orbit): [number, number, number] {
  const flat = o.distance * Math.cos(o.elevation);
  return [flat * Math.cos(o.azimuth), o.distance * Math.sin(o.elevation), -flat * Math.sin(o.azimuth)];
}
