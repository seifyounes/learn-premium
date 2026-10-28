// The pneumatic engine's public interface: tests, `kinds.ts`, the gates and the island import the
// engine only through this file. (Grown slice by slice; the physics, the rules a valve, a pilot, a
// cylinder and a roller follow, come first.)
import type { Actuation, PneumaticKind } from "../layout/pneumatic.ts";

export interface Physics {
  /** The pins a valve joins in a state; `EXH` is an exhaust, `AIR` the supply. */
  passages(kind: PneumaticKind, state: Actuation): readonly (readonly [string, string])[];
  /** A double-pilot valve's side from its pilots and its side now. */
  pilot(p14: 0 | 1, p12: 0 | 1, now: "12" | "14"): "12" | "14";
  /** A cylinder's drive from its ports: 1 extend, −1 retract, 0 hold. */
  drive(cap: 0 | 1, rod: 0 | 1): -1 | 0 | 1;
  /** Whether a roller valve is made: `atEnd` its cylinder sits at the roller's end, `away`/`toward` its motion. */
  made(atEnd: boolean, away: boolean, toward: boolean): boolean;
}

export const PHYSICS: Physics = {
  passages(kind, state) {
    switch (kind) {
      case "valve-52":
        return state === "14"
          ? [
              ["1", "4"],
              ["2", "EXH"],
            ]
          : [
              ["1", "2"],
              ["4", "EXH"],
            ];
      case "valve-32-roller":
      case "valve-32-button":
        return state === "made" ? [["1", "2"]] : [["2", "EXH"]];
      case "air-source":
        return [["t", "AIR"]];
      case "cylinder":
        return [];
    }
  },
  pilot: (p14, p12, now) => (p14 && !p12 ? "14" : p12 && !p14 ? "12" : now),
  drive: (cap, rod) => (cap && !rod ? 1 : rod && !cap ? -1 : 0),
  made: (atEnd, away) => atEnd && !away,
};
