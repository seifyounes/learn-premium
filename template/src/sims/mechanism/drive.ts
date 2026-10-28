// The mechanism's play clock, a pure reducer: Play turns the driver once in six seconds, the slider
// and the pin drag set its angle and pause it, and reduced motion stops it at the angle it has and
// refuses Play while it lasts (a student under reduced motion still turns it by hand). Not
// kinematics: the poses come from the engine; this only says what angle to ask it for.

/** One driver turn while playing. */
export const TURN_SECONDS = 6;
/** A long frame (a background tab coming back) moves it no further than this much time. */
export const MAX_TICK_MS = 100;

export interface Drive {
  /** The driver's angle in degrees, [0, 360). */
  angle: number;
  playing: boolean;
  reduced: boolean;
}

export type DriveAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "tick"; ms: number }
  | { type: "set"; angle: number }
  | { type: "reduced"; reduced: boolean };

const wrap = (angle: number) => {
  const wrapped = ((angle % 360) + 360) % 360;
  return wrapped >= 360 ? 0 : wrapped;
};

export const startDrive = (angle: number, reduced: boolean): Drive => ({ angle: wrap(angle), playing: false, reduced });

export function drive(d: Drive, a: DriveAction): Drive {
  switch (a.type) {
    case "play":
      return d.reduced || d.playing ? d : { ...d, playing: true };
    case "pause":
      return d.playing ? { ...d, playing: false } : d;
    case "tick":
      if (!d.playing || d.reduced) return d;
      return { ...d, angle: wrap(d.angle + (360 * Math.min(Math.max(a.ms, 0), MAX_TICK_MS)) / (TURN_SECONDS * 1000)) };
    case "set":
      return { ...d, angle: wrap(a.angle), playing: false };
    case "reduced":
      // Stopped where it is: the angle it had reached is the angle it keeps.
      return a.reduced ? { ...d, reduced: true, playing: false } : { ...d, reduced: false };
  }
}

/**
 * The whole degrees the driver passed from `from` to `to`, the short way round, added to those
 * already inked: what the drawing's trace inks in as the mechanism turns. Both ends count.
 */
export function inkBuckets(inked: ReadonlySet<number>, from: number, to: number): Set<number> {
  const next = new Set(inked);
  const start = Math.floor(wrap(from));
  const end = Math.floor(wrap(to));
  const forward = (end - start + 360) % 360;
  const backward = (start - end + 360) % 360;
  // The shorter way: counterclockwise when it is no longer than clockwise.
  const [first, count, step] = forward <= backward ? [start, forward, 1] : [start, backward, -1];
  for (let i = 0; i <= count; i++) next.add((((first + step * i) % 360) + 360) % 360);
  return next;
}
