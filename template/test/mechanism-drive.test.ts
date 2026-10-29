// The mechanism's play clock, a pure reducer: Play turns the driver once in six seconds, a long frame
// (a background tab coming back) moves it no further than a tenth of a second's worth, the slider and
// the pin drag pause it, and reduced motion stops it at the angle it has.
import { describe, expect, it } from "vitest";
import {
  drive,
  fromSlider,
  inkBuckets,
  MAX_TICK_MS,
  onSlider,
  startDrive,
  total,
  TURN_SECONDS,
} from "../src/sims/mechanism/drive.ts";
import { pose, type GearPair } from "../src/sims/mechanism/engine.ts";

const playing = (angle: number) => drive(startDrive(angle, false), { type: "play" });
const FULL_TURN = { min: 0, max: 360 };
/** The Fixture's pair: 18 teeth driving 36 leave the driven gear half a turn on after one driver turn. */
const PAIR: GearPair = { type: "gear-pair", module: 2, teeth: [18, 36], pressureAngle: 20, faceWidth: 12 };
const drivenAt = (d: ReturnType<typeof startDrive>) => pose(PAIR, total(d)).links.driven?.angle ?? NaN;

describe("the mechanism's play clock", () => {
  it("reduced motion stops a playing mechanism where it is", () => {
    const running = drive(playing(37.5), { type: "tick", ms: 50 });
    expect(running.playing).toBe(true);
    const at = running.angle;
    const stopped = drive(drive(playing(37.5), { type: "tick", ms: 0 }), { type: "reduced", reduced: true });
    expect(stopped).toEqual({ angle: 37.5, turns: 0, playing: false, reduced: true });
    // Time passing moves nothing, and Play is refused while the motion is reduced.
    expect(drive(stopped, { type: "tick", ms: 1000 }).angle).toBe(37.5);
    expect(drive(stopped, { type: "play" }).playing).toBe(false);
    // Reduced mid-run keeps the angle it had reached, not the one it began on.
    expect(drive(running, { type: "reduced", reduced: true })).toEqual({
      angle: at,
      turns: 0,
      playing: false,
      reduced: true,
    });
    // Un-reduced, Play resumes from where it stopped.
    const back = drive(drive(stopped, { type: "reduced", reduced: false }), { type: "play" });
    expect(back).toEqual({ angle: 37.5, turns: 0, playing: true, reduced: false });
    expect(drive(back, { type: "tick", ms: 50 }).angle).toBeGreaterThan(37.5);
  });

  it("opened under reduced motion, it holds its angle and still moves by hand", () => {
    const held = startDrive(60, true);
    expect(drive(held, { type: "play" })).toEqual(held);
    expect(drive(held, { type: "tick", ms: 100 })).toEqual(held);
    expect(drive(held, { type: "set", angle: 90 })).toEqual({ angle: 90, turns: 0, playing: false, reduced: true });
  });

  it("play runs one turn in 6 s", () => {
    let d = playing(0);
    const frame = 16;
    const frames = (TURN_SECONDS * 1000) / frame;
    for (let i = 0; i < frames; i++) d = drive(d, { type: "tick", ms: frame });
    // A whole turn lands back at 0 (mod 360), to float rounding.
    expect(Math.min(d.angle, 360 - d.angle)).toBeLessThan(1e-6);
    expect(drive(playing(0), { type: "tick", ms: 100 }).angle).toBeCloseTo(6, 9);
    expect(drive(playing(355), { type: "tick", ms: 100 }).angle).toBeCloseTo(1, 9);
  });

  it("keeps the turns Play has taken, so a gear pair's driven gear carries on across the wrap", () => {
    const across = drive(playing(359), { type: "tick", ms: 100 });
    expect(across.angle).toBeCloseTo(5, 9);
    expect(across.turns).toBe(1);
    expect(total(across)).toBeCloseTo(365, 9);
    // Two whole turns of play are two on the count; setting the angle starts the count again.
    let d = playing(0);
    for (let i = 0; i < (2 * TURN_SECONDS * 1000) / 50; i++) d = drive(d, { type: "tick", ms: 50 });
    expect(d.turns).toBe(2);
    expect(total(d)).toBeCloseTo(720, 6);
    expect(drive(d, { type: "set", angle: 30 }).turns).toBe(0);
    // The slider's far end is a whole turn on, not 0°: a gear pair's driven gear sits where 360° puts it.
    const end = drive(d, { type: "set", angle: 360 });
    expect(end.angle).toBe(0);
    expect(total(end)).toBe(360);
    expect(total(startDrive(365, false))).toBe(365);
    expect(total(startDrive(-90, false))).toBe(-90);
  });

  it("a dragged pin carries on from where the driver is, across 359° and 1°, and after Play's turns", () => {
    // The wrapped bearing a pointer gives is taken to the nearest angle to the driver's own.
    const at359 = startDrive(359, false);
    const over = drive(at359, { type: "drag", angle: 1 });
    expect(total(over)).toBe(361);
    expect(drive(over, { type: "drag", angle: 359 }).turns).toBe(0);
    // After a turn of Play, a drag stays on the turns Play has taken.
    const played = drive(playing(359), { type: "tick", ms: 100 });
    expect(total(drive(played, { type: "drag", angle: 10 }))).toBe(370);
    expect(drive(played, { type: "drag", angle: 10 }).playing).toBe(false);
    // A set (the slider) is absolute, and a drag is not.
    expect(total(drive(played, { type: "set", angle: 10 }))).toBe(10);
  });

  it("a slider nudged after Play's turn moves the driven gear a half degree, not half a turn (final review F14)", () => {
    // Played through one driver turn and a little more: the slider shows the wrapped angle, 5, with the turn behind it.
    const played = drive(playing(359), { type: "tick", ms: 100 });
    expect(total(played)).toBeCloseTo(365, 9);
    expect(onSlider(played, FULL_TURN)).toBeCloseTo(5, 9);
    const nudged = drive(played, { type: "set", angle: fromSlider(played, FULL_TURN, 6) });
    expect(total(nudged)).toBeCloseTo(366, 9);
    expect(drivenAt(nudged)).toBeCloseTo(drivenAt(played) - 0.5, 9);
    // Negative control: the slider's raw value as an absolute angle is the old half-turn jump.
    const jumped = drive(played, { type: "set", angle: 6 });
    expect(total(jumped)).toBe(6);
    expect(Math.abs(drivenAt(jumped) - drivenAt(played))).toBeGreaterThan(170);
  });

  it("a slider that shows the whole angle is absolute, and the far end stays at its end", () => {
    // Within the range the slider reads total(d): a set is the angle it was put at, and the turns start again.
    const mid = startDrive(100, false);
    expect(onSlider(mid, FULL_TURN)).toBe(100);
    expect(fromSlider(mid, FULL_TURN, 140)).toBe(140);
    // 360° is one turn on, 0°: the slider reads 360 there and a set from it is still absolute.
    const end = drive(mid, { type: "set", angle: 360 });
    expect(onSlider(end, FULL_TURN)).toBe(360);
    expect(total(drive(end, { type: "set", angle: fromSlider(end, FULL_TURN, 359) }))).toBe(359);
    // A mechanism opened below 0 reads its wrapped angle and keeps the turn it is on.
    const below = startDrive(-90, false);
    expect(onSlider(below, FULL_TURN)).toBe(270);
    expect(total(drive(below, { type: "set", angle: fromSlider(below, FULL_TURN, 271) }))).toBe(-89);
  });

  it("a long frame moves it at most 100 ms' worth", () => {
    expect(MAX_TICK_MS).toBe(100);
    const long = drive(playing(0), { type: "tick", ms: 60_000 });
    expect(long.angle).toBeCloseTo((360 * MAX_TICK_MS) / (TURN_SECONDS * 1000), 9);
  });

  it("set pauses", () => {
    expect(drive(playing(10), { type: "set", angle: 200 })).toEqual({
      angle: 200,
      turns: 0,
      playing: false,
      reduced: false,
    });
    expect(drive(startDrive(0, false), { type: "set", angle: 360 }).angle).toBe(0);
    expect(drive(startDrive(0, false), { type: "set", angle: -90 }).angle).toBe(270);
  });

  it("pause stops it where it is", () => {
    const paused = drive(drive(playing(10), { type: "tick", ms: 100 }), { type: "pause" });
    expect(paused.playing).toBe(false);
    expect(paused.angle).toBeCloseTo(16, 9);
    expect(drive(paused, { type: "tick", ms: 100 }).angle).toBeCloseTo(16, 9);
  });
});

describe("the trace's ink", () => {
  const inked = (...degrees: number[]) => new Set(degrees);

  it("adds the whole degrees passed, ends included", () => {
    expect([...inkBuckets(inked(), 60, 63)].sort((a, b) => a - b)).toEqual([60, 61, 62, 63]);
    expect([...inkBuckets(inked(), 60.4, 61.2)].sort((a, b) => a - b)).toEqual([60, 61]);
    expect([...inkBuckets(inked(5), 60, 60)]).toEqual([5, 60]);
  });

  it("goes the short way round", () => {
    expect([...inkBuckets(inked(), 358, 2)].sort((a, b) => a - b)).toEqual([0, 1, 2, 358, 359]);
    expect([...inkBuckets(inked(), 2, 358)].sort((a, b) => a - b)).toEqual([0, 1, 2, 358, 359]);
  });

  it("keeps what was inked, and leaves its input alone", () => {
    const before = inked(10, 11);
    const after = inkBuckets(before, 20, 21);
    expect([...before]).toEqual([10, 11]);
    expect([...after].sort((a, b) => a - b)).toEqual([10, 11, 20, 21]);
  });
});
