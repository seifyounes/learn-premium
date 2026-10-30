// The mechanism's play clock, a pure reducer: Play turns the driver once in six seconds, the slider
// and the pin drag set its angle and pause it, and reduced motion stops it at the angle it has and
// refuses Play while it lasts (a student under reduced motion still turns it by hand). Not
// kinematics: the poses come from the engine; this only says what angle to ask it for.

/** One driver turn while playing. */
export const TURN_SECONDS = 6;
/** A long frame (a background tab coming back) moves it no further than this much time. */
export const MAX_TICK_MS = 100;

export interface Drive {
  /** The driver's angle in degrees, [0, 360): what the slider and the readouts show. */
  angle: number;
  /**
   * The whole turns Play has taken it through since it was last set. A gear pair's driven gear isn't back
   * where it began after one driver turn (18 teeth driving 36 leave it half a turn on), so the pose is
   * asked for at `total(d)`, never at the wrapped angle: the driven gear keeps turning across the wrap.
   */
  turns: number;
  playing: boolean;
  reduced: boolean;
}

export type DriveAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "tick"; ms: number }
  | { type: "set"; angle: number }
  /** A pin dragged to a bearing: the nearest angle to where the driver is, so the turns it has taken carry on. */
  | { type: "drag"; angle: number }
  | { type: "reduced"; reduced: boolean };

const wrap = (angle: number) => {
  const wrapped = ((angle % 360) + 360) % 360;
  return wrapped >= 360 ? 0 : wrapped;
};

/** An angle as the engine is asked for it: its displayed part, and the whole turns it carries (360° is one turn on, 0°). */
const split = (angle: number) => ({ angle: wrap(angle), turns: Math.round((angle - wrap(angle)) / 360) });

export const startDrive = (angle: number, reduced: boolean): Drive => ({
  ...split(angle),
  playing: false,
  reduced,
});

/** The angle the engine is asked for: the displayed angle and the whole turns Play has added to it. */
export const total = (d: Drive): number => d.angle + 360 * d.turns;

const within = (d: Drive, range: { min: number; max: number }) => total(d) >= range.min && total(d) <= range.max;

/**
 * Where the slider sits: at the whole angle while that lies in its range (so the far end stays at its end, 360°,
 * where the angle alone would read 0°), else at the displayed angle, once Play has carried it past a turn.
 */
export const onSlider = (d: Drive, range: { min: number; max: number }): number =>
  within(d, range) ? total(d) : d.angle;

/**
 * The absolute angle a slider put at `value` asks for. While the slider shows the whole angle that is `value`
 * itself. While it shows the displayed angle only, `value` is a place on the turn the driver is on, so the
 * turns behind it carry on: a gear pair's driven gear moves a step with the slider, not half a turn. Its two
 * ends stay on this turn, a hair inside 0° and 360° (the slider still reads 0 and 360): exactly 360° is the next
 * turn's 0°, and exactly 0° on turn 1 is a whole-angle 360, either of which would change what the slider shows.
 */
export const fromSlider = (d: Drive, range: { min: number; max: number }, value: number): number =>
  within(d, range) ? value : Math.min(Math.max(value, END_SHORT), 360 - END_SHORT) + 360 * d.turns;

/** How far inside its ends the slider stops on a later turn: far below any slider step. */
const END_SHORT = 1e-6;

export function drive(d: Drive, a: DriveAction): Drive {
  switch (a.type) {
    case "play":
      return d.reduced || d.playing ? d : { ...d, playing: true };
    case "pause":
      return d.playing ? { ...d, playing: false } : d;
    case "tick":
      if (!d.playing || d.reduced) return d;
      {
        const next = d.angle + (360 * Math.min(Math.max(a.ms, 0), MAX_TICK_MS)) / (TURN_SECONDS * 1000);
        return next >= 360 ? { ...d, angle: wrap(next), turns: d.turns + 1 } : { ...d, angle: next };
      }
    case "set":
      return { ...d, ...split(a.angle), playing: false };
    case "drag": {
      const here = total(d);
      const bearing = wrap(a.angle);
      return { ...d, ...split(bearing + 360 * Math.round((here - bearing) / 360)), playing: false };
    }
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
