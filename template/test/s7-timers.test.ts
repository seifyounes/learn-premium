// The S7 core's S5 timers and counters and the IEC TON, at their interface. A ladder or FBD sim's
// timers and counters run on these; awlsim, the build oracle, runs the same instructions on the
// compiled networks. Every expected value here is awlsim 0.77.1's own (its Timer, Counter and
// SFB 4, driven at the same instants), so a point where awlsim parts from a real S7 is named.
import { describe, expect, it } from "vitest";
import {
  IecTon,
  parseCounterPreset,
  parseS5Time,
  parseTime,
  S5Counter,
  S5Timer,
  s5tSeconds,
  type S5TimerKind,
} from "../src/sims/s7/core.ts";

/** Runs one timer instruction at each instant, then reads Q, the binary value and the BCD value. */
function drive(kind: S5TimerKind, preset: string, script: [ms: number, rlo: 0 | 1][]) {
  const timer = new S5Timer();
  const s5t = parseS5Time(preset);
  return script.map(([ms, rlo]) => {
    const now = ms / 1000;
    timer.run(kind, rlo, s5t, now);
    return [ms, timer.get(now), timer.valueBin(now), timer.valueBcd(now)];
  });
}

const SCRIPT: [number, 0 | 1][] = [
  [0, 1],
  [500, 1],
  [1000, 0],
  [1500, 1],
  [2500, 1],
  [3600, 1],
  [3700, 0],
  [4000, 0],
  [6000, 0],
];

describe("S5TIME and TIME constants", () => {
  it("encode in the finest time base that holds them, as awlsim's parser does", () => {
    expect(parseS5Time("S5T#2S")).toBe(0x0200);
    expect(parseS5Time("S5T#5S")).toBe(0x0500);
    expect(parseS5Time("S5T#20S")).toBe(0x1200);
    expect(parseS5Time("S5T#1M30S")).toBe(0x1900);
    expect(parseS5Time("S5T#500MS")).toBe(0x0050);
    expect(s5tSeconds(0x1200)).toBe(20);
  });

  it("read a TIME as whole milliseconds", () => {
    expect(parseTime("T#5S")).toBe(5000);
    expect(parseTime("T#4S100MS")).toBe(4100);
    expect(parseTime("T#700MS")).toBe(700);
  });

  it("read a counter preset as its BCD value", () => {
    expect(parseCounterPreset("C#5")).toBe(0x0005);
    expect(parseCounterPreset("C#120")).toBe(0x0120);
  });

  it("refuse what isn't one", () => {
    expect(() => parseS5Time("S5T#10000S")).toThrow();
    expect(() => parseS5Time("T#5S")).toThrow();
    expect(() => parseTime("5S")).toThrow();
    expect(() => parseCounterPreset("C#1000")).toThrow();
  });
});

describe("the five S5 timers, against awlsim", () => {
  it("SP, the pulse: Q while the RLO holds and the time runs", () => {
    expect(drive("SP", "S5T#2S", SCRIPT)).toEqual([
      [0, 1, 200, 0x200],
      [500, 1, 150, 0x150],
      [1000, 0, 100, 0x100],
      [1500, 1, 200, 0x200],
      [2500, 1, 100, 0x100],
      [3600, 0, 0, 0],
      [3700, 0, 0, 0],
      [4000, 0, 0, 0],
      [6000, 0, 0, 0],
    ]);
  });

  it("SE, the extended pulse: Q for the whole time once started", () => {
    expect(drive("SE", "S5T#2S", SCRIPT).map(([, q]) => q)).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("SD, the on-delay: Q once the time has run with the RLO held, dropped with the RLO", () => {
    expect(drive("SD", "S5T#2S", SCRIPT).map(([, q]) => q)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0]);
  });

  it("SS, the retentive on-delay: Q latched until a reset", () => {
    expect(drive("SS", "S5T#2S", SCRIPT).map(([, q]) => q)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("SF, the off-delay: Q with the RLO, held for the time after it falls", () => {
    expect(drive("SF", "S5T#2S", SCRIPT)).toEqual([
      [0, 1, 0, 0],
      [500, 1, 0, 0],
      [1000, 1, 200, 0x200],
      [1500, 1, 150, 0x150],
      // awlsim stops the running time at the rising edge and keeps the value it had (real S7: reset).
      [2500, 1, 150, 0x150],
      [3600, 1, 150, 0x150],
      [3700, 1, 200, 0x200],
      [4000, 1, 170, 0x170],
      [6000, 0, 0, 0],
    ]);
  });

  it("counts the last time-base step by rounding, as awlsim does (a real S7 counts down whole steps)", () => {
    expect(
      drive("SD", "S5T#5S", [
        [0, 1],
        [1000, 1],
        [4990, 1],
        [5000, 1],
      ]),
    ).toEqual([
      [0, 0, 500, 0x500],
      [1000, 0, 400, 0x400],
      [4990, 0, 1, 0x001],
      [5000, 1, 0, 0],
    ]);
  });

  it("loads its BCD value with the time base in bits 12–13, as LC T does", () => {
    expect(
      drive("SD", "S5T#20S", [
        [0, 1],
        [1000, 1],
      ]),
    ).toEqual([
      [0, 0, 200, 0x1200],
      [1000, 0, 190, 0x1190],
    ]);
  });

  it("SS settles its Q only when it is read: restarted unread after its time, it stays 0 (awlsim; a real S7 holds 1)", () => {
    const timer = new S5Timer();
    const s5t = parseS5Time("S5T#2S");
    timer.run("SS", 1, s5t, 0);
    timer.run("SS", 0, s5t, 0.1);
    timer.run("SS", 1, s5t, 2.5);
    expect([timer.status, timer.running]).toEqual([0, true]);
    expect(timer.get(2.6)).toBe(0);
  });

  it("a reset drops Q and the time", () => {
    const timer = new S5Timer();
    const s5t = parseS5Time("S5T#2S");
    timer.run("SS", 1, s5t, 0);
    expect(timer.get(3)).toBe(1);
    timer.reset();
    expect([timer.get(3), timer.valueBin(3)]).toEqual([0, 0]);
  });
});

describe("the S5 counter, against awlsim", () => {
  it("counts up and down on rising edges, Q while above 0", () => {
    const counter = new S5Counter();
    const seen = (
      [
        [1, 0],
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
        [0, 1],
      ] as const
    ).map(([cu, cd]) => {
      counter.countUp(cu);
      counter.countDown(cd);
      return [counter.valueBin(), counter.valueBcd(), counter.get()];
    });
    expect(seen).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [2, 2, 1],
      [1, 1, 1],
      [1, 1, 1],
      [0, 0, 0],
    ]);
  });

  it("sets its preset on a rising edge, stops at 999 and at 0, and resets", () => {
    const counter = new S5Counter();
    counter.set(1, parseCounterPreset("C#999"));
    counter.countUp(1);
    expect(counter.valueBin()).toBe(999);
    counter.set(1, parseCounterPreset("C#5"));
    expect(counter.valueBin()).toBe(999);
    counter.reset();
    counter.countDown(1);
    expect([counter.valueBin(), counter.get()]).toEqual([0, 0]);
  });
});

describe("the IEC TON (SFB 4), against awlsim", () => {
  it("sets Q once IN has held for PT, with ET counting up to PT and dropping with IN", () => {
    const ton = new IecTon();
    const seen = (
      [
        [0, 1],
        [1000, 1],
        [2900, 1],
        [3000, 1],
        [3500, 1],
        [4000, 0],
      ] as const
    ).map(([ms, IN]) => {
      ton.IN = IN;
      ton.PT = parseTime("T#3S");
      ton.run(ms);
      return [ton.Q, ton.ET];
    });
    expect(seen).toEqual([
      [0, 0],
      [0, 1000],
      [0, 2900],
      [1, 3000],
      [1, 3000],
      [0, 0],
    ]);
  });

  it("resets on a PT of 0, clearing IN as awlsim (and an S7) does", () => {
    const ton = new IecTon();
    ton.IN = 1;
    ton.PT = 0;
    ton.run(100);
    expect([ton.IN, ton.Q, ton.ET, ton.STATE]).toEqual([0, 0, 0, 0]);
  });
});
