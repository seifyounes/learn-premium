// Counting NotebookLM usage against its two limits: a rolling 5-hour window and a weekly cap, both
// counted in the unit Settings → Usage shows. Until the Owner records the measured costs and limits,
// generations are counted but not priced, and only NotebookLM's own refusals stop the pass.
import { LIMITS, WINDOW_MS, type Limit, type MediaKind, type Usage } from "./model.ts";

/** Why new generations wait, and when they may start again (null: the item costs more than the limit itself). */
export interface Stop {
  limit: Limit;
  until: string | null;
  /** True when NotebookLM itself said so; false when the recorded numbers predict it. */
  observed: boolean;
}

export interface WindowCapacity {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  generations: number;
}

/** The generations still counting against `limit` at `at`, oldest first. A voided one never counted. */
function inWindow(usage: Usage, limit: Limit, at: number) {
  return usage.spends
    .filter((s) => s.voided === null && Date.parse(s.at) > at - WINDOW_MS[limit])
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The summed cost of these kinds, or null while any of them is unmeasured. */
export function price(usage: Usage, kinds: MediaKind[]): number | null {
  let sum = 0;
  for (const kind of kinds) {
    const cost = usage.costs[kind];
    if (cost === null) return null;
    sum += cost;
  }
  return sum;
}

export function capacity(usage: Usage, at: number): Record<Limit, WindowCapacity> {
  const one = (limit: Limit): WindowCapacity => {
    const spends = inWindow(usage, limit, at);
    const used = price(
      usage,
      spends.map((s) => s.kind),
    );
    const max = usage.limits[limit];
    return {
      limit: max,
      used,
      remaining: max === null || used === null ? null : Math.max(0, max - used),
      generations: spends.length,
    };
  };
  return { "5-hour": one("5-hour"), weekly: one("weekly") };
}

/**
 * What stops a new `kind` generation from starting at `at`, if anything: a limit NotebookLM reported
 * that hasn't lifted, or a recorded limit this generation's cost would break. When several apply, the
 * one lifting last.
 */
export function stopFor(usage: Usage, kind: MediaKind, at: number): Stop | null {
  const stops: Stop[] = usage.stops
    .filter((s) => Date.parse(s.until) > at)
    .map((s) => ({ limit: s.limit, until: s.until, observed: true }));
  const cost = usage.costs[kind];
  for (const limit of LIMITS) {
    const max = usage.limits[limit];
    const spends = inWindow(usage, limit, at);
    const used = price(
      usage,
      spends.map((s) => s.kind),
    );
    if (cost === null || max === null || used === null || used + cost <= max) continue;
    stops.push({
      limit,
      until: cost > max ? null : whenFreed(usage, spends, used + cost - max, limit),
      observed: false,
    });
  }
  return stops.reduce<Stop | null>((last, stop) => (last === null || liftsAfter(stop, last) ? stop : last), null);
}

/** When enough of the oldest spends have left the window to free `need` units. */
function whenFreed(usage: Usage, spends: Usage["spends"], need: number, limit: Limit): string {
  let freed = 0;
  for (const spend of spends) {
    freed += usage.costs[spend.kind] ?? 0;
    if (freed >= need) return new Date(Date.parse(spend.at) + WINDOW_MS[limit]).toISOString();
  }
  throw new Error("the spends in the window add up to less than they were counted as");
}

function liftsAfter(a: Stop, b: Stop): boolean {
  if (a.until === null) return b.until !== null;
  return b.until !== null && Date.parse(a.until) > Date.parse(b.until);
}
