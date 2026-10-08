// Pointer gestures on a 3D viewer, apart from the DOM: one pointer turns, two pinch, and a short
// still press is a tap (it takes the viewer from page scroll to turning). The viewer feeds pointer
// events in; what a turn or a pinch does is its business.

export interface GestureHandlers {
  /** One pointer moved by (dx, dy) pixels. */
  turn(dx: number, dy: number): void;
  /** Two pointers' spread changed by `ratio` (2: twice as far apart). */
  pinch(ratio: number): void;
  /** A press that stayed still and short, with one pointer. */
  tap(): void;
}

/** A tap moves no further than this from where it went down... */
const TAP_SLOP_PX = 8;
/** ...and lifts within this. */
const TAP_MS = 500;

export interface Gestures {
  down(id: number, x: number, y: number, time: number): void;
  move(id: number, x: number, y: number): void;
  up(id: number, time: number): void;
  /** The browser took the pointer over (it scrolls the page): forget it. */
  cancel(id: number): void;
}

export function createGestures(on: GestureHandlers): Gestures {
  const pointers = new Map<number, { x: number; y: number }>();
  /** The press that may still be a tap: where and when it went down, and whether it strayed. */
  let press: { id: number; x: number; y: number; time: number; strayed: boolean } | undefined;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  return {
    down(id, x, y, time) {
      pointers.set(id, { x, y });
      press = pointers.size === 1 ? { id, x, y, time, strayed: false } : undefined;
    },
    move(id, x, y) {
      const last = pointers.get(id);
      if (!last) return;
      if (press?.id === id && Math.hypot(x - press.x, y - press.y) > TAP_SLOP_PX) press.strayed = true;
      if (pointers.size === 1) {
        pointers.set(id, { x, y });
        on.turn(x - last.x, y - last.y);
      } else if (pointers.size === 2) {
        const before = spread();
        pointers.set(id, { x, y });
        if (before > 0) on.pinch(spread() / before);
      }
    },
    up(id, time) {
      if (!pointers.delete(id)) return;
      if (press?.id === id && !press.strayed && time - press.time <= TAP_MS) on.tap();
      if (press?.id === id) press = undefined;
    },
    cancel(id) {
      pointers.delete(id);
      if (press?.id === id) press = undefined;
    },
  };
}
