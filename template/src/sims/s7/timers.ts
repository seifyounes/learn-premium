// The S7 core's timers and counters: the five S5 timers (SP, SE, SD, SS, SF), the S5 counter, and
// the IEC TON (SFB 4) a ladder or FBD network calls. Each follows awlsim, the build oracle, step for
// step (its Timer, Counter and SFB4), so the gate can hold the engine to it bit for bit: the same
// float arithmetic on seconds, the same moments a timer settles its Q (only when it is run or
// read), the same rounding. Where awlsim parts from a real S7 the engine follows awlsim, and
// `test/s7-timers.test.ts` names each point. Time is the scan's: `now` in seconds, as awlsim keeps
// it. Pure: no clock is read here.

import { roundHalfEven } from "./numbers.ts";

/** English mnemonics: SP pulse, SE extended pulse, SD on-delay, SS retentive on-delay, SF off-delay. */
export const S5_TIMER_KINDS = ["SP", "SE", "SD", "SS", "SF"] as const;
export type S5TimerKind = (typeof S5_TIMER_KINDS)[number];

/** Time bases in an S5TIME word's bits 12–13. */
const TB_10MS = 0;
const TB_100MS = 1;
const TB_1S = 2;
const TB_10S = 3;

const bcd3 = (n: number) => (n % 10) | ((Math.floor(n / 10) % 10) << 4) | ((Math.floor(n / 100) % 10) << 8);
const fromBcd3 = (word: number) => (word & 0xf) + ((word >> 4) & 0xf) * 10 + ((word >> 8) & 0xf) * 100;

/** Seconds as an S5TIME word in the given base, base bits included (awlsim's `_seconds_to_s5t_tb*`). */
function inBase(seconds: number, base: number): number {
  return digitsIn(seconds, base) | (base << 12);
}

function digitsIn(seconds: number, base: number): number {
  switch (base) {
    case TB_10MS:
      return bcd3(roundHalfEven(seconds * 100.0));
    case TB_100MS:
      return bcd3(roundHalfEven(seconds * 10.0));
    case TB_1S:
      return bcd3(Math.trunc(seconds));
    default:
      return bcd3(Math.floor(roundHalfEven(seconds) / 10));
  }
}

/** Seconds as an S5TIME word, in the finest base that holds them (awlsim's `Timer_seconds_to_s5t`). */
export function secondsToS5t(seconds: number): number {
  if (seconds < 0) throw new RangeError(`${seconds} s can't be an S5TIME`);
  if (seconds <= 9.99) return inBase(seconds, TB_10MS);
  if (seconds <= 99.9) return inBase(seconds, TB_100MS);
  if (seconds <= 999.0) return inBase(seconds, TB_1S);
  if (seconds <= 9990.0) return inBase(seconds, TB_10S);
  throw new RangeError(`${seconds} s is longer than an S5TIME holds (9990 s)`);
}

/** An S5TIME word's seconds. */
export function s5tSeconds(s5t: number): number {
  const digits = [s5t & 0xf, (s5t >> 4) & 0xf, (s5t >> 8) & 0xf];
  if ((s5t & ~0x3000) > 0x999 || digits.some((d) => d > 9))
    throw new RangeError(`W#16#${s5t.toString(16).toUpperCase()} isn't an S5TIME`);
  const count = fromBcd3(s5t);
  switch ((s5t >> 12) & 3) {
    case TB_10MS:
      return count * 0.01;
    case TB_100MS:
      return count * 0.1;
    case TB_1S:
      return count * 1.0;
    default:
      return count * 10.0;
  }
}

const UNITS: [suffix: string, seconds: number][] = [
  ["MS", 0.001],
  ["S", 1.0],
  ["M", 60.0],
  ["H", 3600.0],
  ["D", 86400.0],
];

/** A `T#`/`S5T#` duration's seconds, summed from its last unit back, as awlsim's parser sums them. */
function durationSeconds(text: string, prefixes: readonly string[]): number {
  const upper = text.trim().toUpperCase();
  const prefix = prefixes.find((p) => upper.startsWith(p));
  if (prefix === undefined) throw new SyntaxError(`"${text}" isn't a ${prefixes.join(" or ")} constant`);
  let rest = upper.slice(prefix.length).replace(/_/g, "");
  if (!rest) throw new SyntaxError(`"${text}" gives no time`);
  let seconds = 0.0;
  while (rest) {
    const unit = UNITS.find(([suffix]) => rest.endsWith(suffix));
    if (!unit) throw new SyntaxError(`"${text}" has a unit that isn't MS, S, M, H or D`);
    rest = rest.slice(0, -unit[0].length);
    const digits = /\d+$/.exec(rest)?.[0];
    if (!digits) throw new SyntaxError(`"${text}" gives a unit with no amount`);
    rest = rest.slice(0, -digits.length);
    seconds += Number(digits) * unit[1];
  }
  return seconds;
}

/** `S5T#5S` as its S5TIME word (`W#16#0500`). */
export const parseS5Time = (text: string): number => secondsToS5t(durationSeconds(text, ["S5T#", "S5TIME#"]));

/** `T#5S` as its TIME in milliseconds. */
export function parseTime(text: string): number {
  const ms = Math.trunc(durationSeconds(text, ["T#", "TIME#"]) * 1000);
  if (ms > 0x7fffffff) throw new RangeError(`"${text}" is longer than a TIME holds`);
  return ms;
}

/** `C#5` as the BCD word a counter is set to. */
export function parseCounterPreset(text: string): number {
  const match = /^C#(\d{1,3})$/i.exec(text.trim());
  if (!match) throw new SyntaxError(`"${text}" isn't a counter preset from C#0 to C#999`);
  return bcd3(Number(match[1]));
}

/** An S5 timer, as awlsim's Timer keeps it. */
export class S5Timer {
  status: 0 | 1 = 0;
  running = false;
  /** Seconds left when the timer was last run or read. */
  remaining = 0.0;
  deadline = 0.0;
  timebase = TB_10MS;
  /** The RLO the last start instruction saw, for its edges. */
  prevS: 0 | 1 = 0;
  prevFR: 0 | 1 = 0;
  /** Whether the time running out sets Q (the delays) or drops it (the pulses). */
  private setsOnDeadline = false;

  /** Q, settled first if the time has run out. */
  get(now: number): 0 | 1 {
    this.checkDeadline(now);
    return this.status;
  }

  /** Q as `get` would give it, without settling anything: for a display that mustn't change the run. */
  peek(now: number): 0 | 1 {
    if (this.running && Math.max(0.0, this.deadline - now) <= 0.0) return this.setsOnDeadline ? 1 : 0;
    return this.status;
  }

  /** R: Q and the time drop. */
  reset(): void {
    this.running = false;
    this.status = 0;
    this.remaining = 0.0;
  }

  /** FR, the enable: a rising RLO lets the next start instruction see an edge again. */
  enable(rlo: 0 | 1): void {
    if (rlo && !this.prevFR) this.prevS = 0;
    this.prevFR = rlo;
  }

  /** The time left in time-base steps, as `L T` loads it. */
  valueBin(now: number): number {
    const left = this.remainingAt(now);
    switch (this.timebase) {
      case TB_10MS:
        return roundHalfEven(left / 0.01);
      case TB_100MS:
        return roundHalfEven(left / 0.1);
      case TB_1S:
        return roundHalfEven(left);
      default:
        return roundHalfEven(left / 10.0);
    }
  }

  /** The time left in BCD with its time base in bits 12–13, as `LC T` loads it. */
  valueBcd(now: number): number {
    return inBase(this.remainingAt(now), this.timebase);
  }

  /** One timer instruction with the RLO it sees and the S5TIME in ACCU 1. */
  run(kind: S5TimerKind, rlo: 0 | 1, s5t: number, now: number): void {
    const rising = rlo === 1 && this.prevS === 0;
    switch (kind) {
      case "SP":
        this.setsOnDeadline = false;
        if (rlo) {
          if (rising) {
            this.status = 1;
            this.start(s5t, now);
          }
        } else {
          this.checkDeadline(now);
          this.running = false;
          this.status = 0;
        }
        break;
      case "SE":
        this.setsOnDeadline = false;
        if (rising) {
          this.status = 1;
          this.start(s5t, now);
        }
        break;
      case "SD":
        this.setsOnDeadline = true;
        if (rlo) {
          if (rising) this.start(s5t, now);
        } else {
          this.checkDeadline(now);
          this.running = false;
          this.status = 0;
        }
        break;
      case "SS":
        this.setsOnDeadline = true;
        if (rising) this.start(s5t, now);
        break;
      case "SF":
        this.setsOnDeadline = false;
        if (rising) {
          this.checkDeadline(now);
          this.status = 1;
          this.running = false;
        }
        if (!rlo && this.prevS) {
          this.status = 1;
          this.start(s5t, now);
        }
        break;
    }
    this.prevS = rlo;
  }

  private remainingAt(now: number): number {
    this.checkDeadline(now);
    return this.remaining;
  }

  private start(s5t: number, now: number) {
    this.timebase = (s5t >> 12) & 3;
    this.deadline = now + s5tSeconds(s5t);
    this.remaining = Math.max(0.0, this.deadline - now);
    this.running = true;
  }

  private checkDeadline(now: number) {
    if (!this.running) return;
    this.remaining = Math.max(0.0, this.deadline - now);
    if (this.remaining <= 0.0) {
      this.running = false;
      this.status = this.setsOnDeadline ? 1 : 0;
    }
  }
}

/** An S5 counter, 0 to 999, as awlsim's Counter keeps it. */
export class S5Counter {
  value = 0;
  private prevFR: 0 | 1 = 0;
  private prevS: 0 | 1 = 0;
  private prevUp: 0 | 1 = 0;
  private prevDown: 0 | 1 = 0;

  /** Q: the count is above 0. */
  get(): 0 | 1 {
    return this.value ? 1 : 0;
  }

  valueBin(): number {
    return this.value;
  }

  valueBcd(): number {
    return bcd3(this.value);
  }

  /** S: on a rising RLO the count takes the BCD preset in ACCU 1. */
  set(rlo: 0 | 1, bcd: number): void {
    if (rlo && !this.prevS) {
      if (bcd > 0x999 || [bcd & 0xf, (bcd >> 4) & 0xf, (bcd >> 8) & 0xf].some((d) => d > 9))
        throw new RangeError(`W#16#${bcd.toString(16).toUpperCase()} isn't a BCD count`);
      this.value = fromBcd3(bcd);
    }
    this.prevS = rlo;
  }

  reset(): void {
    this.value = 0;
  }

  enable(rlo: 0 | 1): void {
    if (rlo && !this.prevFR) {
      this.prevS = 0;
      this.prevUp = 0;
      this.prevDown = 0;
    }
    this.prevFR = rlo;
  }

  /** CU: one up on a rising RLO, stopping at 999. */
  countUp(rlo: 0 | 1): void {
    if (rlo && !this.prevUp && this.value < 999) this.value += 1;
    this.prevUp = rlo;
  }

  /** CD: one down on a rising RLO, stopping at 0. */
  countDown(rlo: 0 | 1): void {
    if (rlo && !this.prevDown && this.value > 0) this.value -= 1;
    this.prevDown = rlo;
  }
}

/** The scan's time as an S7 TIME, the way awlsim reads it for SFB 4: 31-bit milliseconds. */
export const timeOfScan = (ms: number): number => Math.trunc((ms / 1000.0) * 1000.0) & 0x7fffffff;

const RUNNING = 1;
const FINISHED = 2;

/**
 * The IEC on-delay TON (SFB 4) and its instance data, as awlsim's SFB4 runs it: the CALL copies
 * IN and PT in, `run` works, and the CALL copies Q and ET out.
 */
export class IecTon {
  IN: 0 | 1 = 0;
  /** Milliseconds. */
  PT = 0;
  Q: 0 | 1 = 0;
  ET = 0;
  STATE = 0;
  STIME = 0;
  ATIME = 0;

  /** One call at the scan's time, in milliseconds since the run began. */
  run(ms: number): void {
    const PT = this.PT | 0;
    if (PT <= 0) {
      // A PT of 0 resets the timer, and the S7 clears IN with it.
      if (PT === 0) this.IN = 0;
      this.Q = 0;
      this.ET = 0;
      this.STATE = 0;
      return;
    }
    const ATIME = timeOfScan(ms);
    if (this.IN) {
      if (!(this.STATE & (RUNNING | FINISHED))) {
        this.STIME = ATIME;
        this.STATE |= RUNNING;
      }
    } else {
      this.STATE &= ~(FINISHED | RUNNING);
      this.ET = 0;
      this.Q = 0;
    }
    if (this.STATE & RUNNING) {
      this.ATIME = ATIME;
      let ET = (ATIME - this.STIME) & 0x7fffffff;
      if (ET >= PT) {
        ET = PT;
        this.Q = 1;
        this.STATE = (this.STATE & ~RUNNING) | FINISHED;
      } else this.Q = 0;
      this.ET = ET;
    }
  }
}
