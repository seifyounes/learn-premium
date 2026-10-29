// Which atom a tap or hover over a 3D molecule means: the nearest one on screen, within a
// fingertip's reach. Pure, so it is tested without a canvas.

export interface ScreenAtom {
  index: number;
  element: string;
  /** Screen position, in px. */
  x: number;
  y: number;
  /** Depth: smaller is nearer the camera. */
  z: number;
}

/** A tap is a fingertip: atoms farther than this (px) from it aren't meant. */
export const PICK_WITHIN = 18;

/**
 * The atom nearest the point (x, y) within `within` px, or undefined. When two are equally near on
 * screen, the one nearer the camera (the smaller z) wins: the front atom hides the back one.
 */
export function nearestAtom<A extends ScreenAtom>(
  atoms: readonly A[],
  x: number,
  y: number,
  within = PICK_WITHIN,
): A | undefined {
  let best: { atom: A; distance: number } | undefined;
  for (const atom of atoms) {
    const distance = Math.hypot(atom.x - x, atom.y - y);
    if (distance > within) continue;
    if (!best || distance < best.distance || (distance === best.distance && atom.z < best.atom.z))
      best = { atom, distance };
  }
  return best?.atom;
}
