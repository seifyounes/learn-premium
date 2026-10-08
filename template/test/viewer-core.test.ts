// The 3D viewer's core, apart from three.js: how a drag and a pinch move the camera, how a tap is
// told from a swipe, and where the labels hang beside the object. Mechanisms (#61) and chemistry
// apparatus (#62) reuse it as it is.
import { describe, expect, it } from "vitest";
import { createGestures } from "../src/viewer/gesture";
import { placeLabels } from "../src/viewer/labels";
import { atHome, cameraOffset, homeView, turn, zoom } from "../src/viewer/orbit";

const deg = (r: number) => (r * 180) / Math.PI;

describe("the orbit", () => {
  const home = homeView({ radius: 50, fovDeg: 30, aspect: 4 / 3 });

  it("opens on a three-quarter view that fits the whole object", () => {
    expect(deg(home.azimuth)).toBeCloseTo(40);
    expect(deg(home.elevation)).toBeCloseTo(25);
    // A 50 mm sphere fills a 30° view at 50 / sin 15°.
    expect(home.distance).toBeCloseTo(50 / Math.sin((15 * Math.PI) / 180), 6);
    const [x, y, z] = cameraOffset(home);
    expect(Math.hypot(x, y, z)).toBeCloseTo(home.distance, 6);
    expect(y).toBeGreaterThan(0); // looking down on it, +y up
  });

  it("turns half a turn for a drag across the frame's height, and never tips over the pole", () => {
    const turned = turn(home, 400, 0, 400);
    expect(deg(turned.azimuth - home.azimuth)).toBeCloseTo(-180);
    expect(deg(turn(home, 0, 4000, 400).elevation)).toBeCloseTo(85);
    expect(deg(turn(home, 0, -4000, 400).elevation)).toBeCloseTo(-85);
  });

  it("zooms within limits, and knows when it is back home", () => {
    expect(zoom(home, 100, home).distance).toBeCloseTo(home.distance * 0.35);
    expect(zoom(home, 0.01, home).distance).toBeCloseTo(home.distance * 3);
    expect(atHome(home, home)).toBe(true);
    expect(atHome(zoom(home, 1.2, home), home)).toBe(false);
    expect(atHome(turn(home, 2, 0, 400), home)).toBe(false);
  });
});

describe("the gestures", () => {
  const recorder = () => {
    const seen: string[] = [];
    const g = createGestures({
      turn: (dx, dy) => seen.push(`turn ${dx} ${dy}`),
      pinch: (ratio) => seen.push(`pinch ${ratio.toFixed(2)}`),
      tap: () => seen.push("tap"),
    });
    return { g, seen };
  };

  it("calls a short, still press a tap", () => {
    const { g, seen } = recorder();
    g.down(1, 100, 100, 0);
    g.move(1, 103, 102);
    g.up(1, 0 + 200);
    expect(seen).toEqual(["turn 3 2", "tap"]);
  });

  it("turns with one finger, and a drag is never a tap", () => {
    const { g, seen } = recorder();
    g.down(1, 100, 100, 0);
    g.move(1, 130, 100);
    g.move(1, 150, 90);
    g.up(1, 300);
    expect(seen).toEqual(["turn 30 0", "turn 20 -10"]);
  });

  it("pinches with two fingers, by the change in their spread, and turns nothing meanwhile", () => {
    const { g, seen } = recorder();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    g.move(2, 300, 100);
    g.up(2, 400);
    g.up(1, 410);
    expect(seen).toEqual(["pinch 2.00"]);
  });

  it("forgets a press the browser took over (a scroll)", () => {
    const { g, seen } = recorder();
    g.down(1, 100, 100, 0);
    g.cancel(1);
    g.up(1, 100);
    expect(seen).toEqual([]);
  });
});

describe("the labels beside the object", () => {
  it("hang level with what they name when there is room", () => {
    expect(
      placeLabels(
        [
          { id: "a", y: 50 },
          { id: "b", y: 150 },
        ],
        300,
        20,
      ),
    ).toEqual({
      height: 300,
      at: [
        { id: "a", y: 50 },
        { id: "b", y: 150 },
      ],
    });
  });

  it("keep a line apart, in the order of what they name, inside the frame", () => {
    const { at } = placeLabels(
      [
        { id: "low", y: 100 },
        { id: "high", y: 95 },
        { id: "edge", y: 299 },
        { id: "top", y: -40 },
      ],
      300,
      20,
    );
    expect(at).toEqual([
      { id: "top", y: 10 },
      { id: "high", y: 95 },
      { id: "low", y: 115 },
      { id: "edge", y: 290 },
    ]);
  });

  it("grow the gutter past the frame rather than stack two labels on one line", () => {
    const anchors = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, y: 50 }));
    const { height, at } = placeLabels(anchors, 100, 20);
    expect(height).toBe(120);
    expect(at.map((l) => l.y)).toEqual([10, 30, 50, 70, 90, 110]);
  });
});
