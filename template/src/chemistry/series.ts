// The multi-series rule for chemistry plots, pure. A plot draws at most MAX_SHOWN lines in ink at
// once, each with its own line style and marker and a label at the line. Past that, students toggle
// the lines: hidden ones dim to pencil, and showing one more dims the one shown longest. Four is
// the most an eye can follow on a sheet of graphite.
import { asWritten } from "../sims/print.ts";

export const MAX_SHOWN = 4;

/**
 * Distinct line styles: JSXGraph's dash and point face, and the same dash as the toggle swatch's
 * stroke-dasharray. Graphite or pencil only, so a line is told from another by its shape, never
 * its colour.
 */
export const SERIES_STYLES: readonly { dash: number; face: "o" | "[]" | "^" | "<>" | "x" | "+"; dasharray: string }[] =
  [
    { dash: 0, face: "o", dasharray: "none" },
    { dash: 2, face: "[]", dasharray: "6 3" },
    { dash: 3, face: "^", dasharray: "10 4" },
    { dash: 1, face: "<>", dasharray: "2 3" },
    { dash: 4, face: "x", dasharray: "8 3 2 3" },
    { dash: 5, face: "+", dasharray: "14 4" },
  ];

export interface SeriesDef {
  id: string;
  label: string;
  value: number;
}
/** Which series are drawn in ink, the one shown longest first. */
export interface SeriesState {
  shown: readonly string[];
}

/** A Nernst plot's isotherms as series: one line per temperature. */
export function nernstSeries(plot: { isotherms: readonly number[] }): SeriesDef[] {
  return plot.isotherms.map((T) => ({ id: `T=${T}`, label: `${asWritten(T)} K`, value: T }));
}

/** The series shown when the plot opens: `shown` (clamped to MAX_SHOWN) or the first MAX_SHOWN. */
export function startSeries(defs: readonly SeriesDef[], shown?: readonly number[]): SeriesState {
  const chosen = (shown ?? []).flatMap((value) => defs.find((d) => d.value === value)?.id ?? []);
  const ids = chosen.length > 0 ? chosen : defs.map((d) => d.id);
  return { shown: ids.slice(0, MAX_SHOWN) };
}

/**
 * A shown series is hidden, unless it is the only one shown. A hidden one is shown, and when that
 * makes more than MAX_SHOWN the one shown longest dims.
 */
export function toggleSeries(defs: readonly SeriesDef[], s: SeriesState, id: string): SeriesState {
  if (!defs.some((d) => d.id === id)) return s;
  if (s.shown.includes(id)) return s.shown.length <= 1 ? s : { shown: s.shown.filter((shown) => shown !== id) };
  return { shown: [...s.shown, id].slice(-MAX_SHOWN) };
}

/** What a plot gets wrong about its series, one message each; [] when it follows the rule. */
export function seriesProblems(
  defs: readonly SeriesDef[],
  plot: { many?: string | undefined; shown?: readonly number[] | undefined },
): string[] {
  const problems: string[] = [];
  if (defs.length > MAX_SHOWN && plot.many !== "toggle")
    problems.push(`${defs.length} lines on one plot: past ${MAX_SHOWN}, let students toggle them (plot.many: toggle)`);
  if ((plot.shown?.length ?? 0) > MAX_SHOWN)
    problems.push(`it opens with ${plot.shown?.length} lines in ink: at most ${MAX_SHOWN} are drawn at once`);
  for (const value of plot.shown ?? [])
    if (!defs.some((d) => d.value === value))
      problems.push(`it opens on ${asWritten(value)} K, which isn't one of its isotherms`);
  const seen = new Set<string>();
  for (const { label } of defs) {
    if (seen.has(label)) problems.push(`two lines are labelled "${label}": each label names one line`);
    seen.add(label);
  }
  if (defs.length > SERIES_STYLES.length)
    problems.push(`${defs.length} lines but ${SERIES_STYLES.length} distinct line styles: split the plot`);
  return problems;
}
