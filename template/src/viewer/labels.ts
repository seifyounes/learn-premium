// Where a 3D viewer's HTML labels hang: in a gutter beside the object, never on it (DESIGN.md, Live
// 3D Viewers), each level with the point it names where there is room, a line apart, in the order of
// the points, and inside the frame. Pure.

export interface Anchor {
  id: string;
  /** The named point's height on the frame, in pixels from its top. */
  y: number;
}

export interface Placed {
  /** The gutter's height: the frame's, or taller when the labels can't fit a line apart in it. */
  height: number;
  /** Each label's centre, in the order of the anchors, highest first. */
  at: Anchor[];
}

export function placeLabels(anchors: readonly Anchor[], frameHeight: number, line: number): Placed {
  const height = Math.max(frameHeight, anchors.length * line);
  const top = line / 2;
  const bottom = height - line / 2;
  const at = [...anchors].sort((a, b) => a.y - b.y).map((a) => ({ id: a.id, y: Math.min(bottom, Math.max(top, a.y)) }));
  // Down from the top, each a line below the one above it; then up from the bottom, back inside.
  for (let i = 1; i < at.length; i++) {
    const above = at[i - 1];
    const label = at[i];
    if (above && label) label.y = Math.max(label.y, above.y + line);
  }
  for (let i = at.length - 1; i >= 0; i--) {
    const below = at[i + 1];
    const label = at[i];
    if (label) label.y = Math.min(label.y, below ? below.y - line : bottom);
  }
  return { height, at };
}
