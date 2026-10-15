// How many Module waves run at once. Each runs in its own worktree with its own `npm ci` of the template
// (hundreds of MB and minutes of CPU), and a machine running many at once has run out of disk and crashed.
// The Owner raises or lowers the cap with LEARN_PREMIUM_MAX_WAVES.
import { LedgerError } from "./file.ts";

export const DEFAULT_MAX_WAVES = 3;
export const MAX_WAVES_ENV = "LEARN_PREMIUM_MAX_WAVES";

export function maxWaves(): number {
  const given = process.env[MAX_WAVES_ENV];
  if (given === undefined || given === "") return DEFAULT_MAX_WAVES;
  if (!/^[1-9]\d*$/.test(given)) {
    throw new LedgerError("invalid", `${MAX_WAVES_ENV} must be a whole number of 1 or more, not "${given}"`);
  }
  return Number(given);
}
