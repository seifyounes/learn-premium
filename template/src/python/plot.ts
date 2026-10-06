// The plot a Pyodide tool's code leaves in `plot`: a list of the sheet's plot elements (`point`,
// `line`, `guide`) that the pad's own plotted figure draws. Read the same way at build, for the
// preview, and in the page after a live run. Plain checks rather than Zod, so the page's bundle
// stays small.
import type { ElementData, LabelSide } from "../worked/sheet.ts";

const SIDES: readonly LabelSide[] = ["above", "below", "start", "end"];

const isPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * The elements `plot` draws, each labelled from `labels` (rendered HTML, by element id), or a
 * sentence naming what is wrong with it.
 */
export function readPlot(plot: unknown, labels: Readonly<Record<string, string>>): ElementData[] | string {
  if (!Array.isArray(plot)) return "plot must be a list of elements (point, line or guide)";
  if (plot.length === 0) return "plot draws nothing: give it at least one element";
  const ids = new Set<string>();
  const elements: ElementData[] = [];
  for (const [i, raw] of plot.entries()) {
    const at = `plot[${i}]`;
    if (!raw || typeof raw !== "object") return `${at}: an element is a dict with an id and a kind`;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id === "") return `${at}: an id (a string) names each element`;
    if (ids.has(e.id)) return `${at}: "${e.id}" is used twice`;
    ids.add(e.id);
    const label = labels[e.id] === undefined ? {} : { labelHtml: labels[e.id] as string };
    if (e.kind === "point") {
      if (!isPair(e.at)) return `${at}: at is an [x, y] pair of finite numbers`;
      const side = e.side ?? "end";
      if (!SIDES.includes(side as LabelSide)) return `${at}: side is above, below, start or end`;
      elements.push({ id: e.id, kind: "point", at: e.at, side: side as LabelSide, ...label });
    } else if (e.kind === "line") {
      if (!Array.isArray(e.through) || e.through.length < 2) return `${at}: through lists at least two [x, y] points`;
      if (!e.through.every(isPair)) return `${at}: through lists [x, y] pairs of finite numbers`;
      elements.push({ id: e.id, kind: "line", through: e.through, ...label });
    } else if (e.kind === "guide") {
      if (typeof e.x !== "number" || !Number.isFinite(e.x)) return `${at}: x is a finite number`;
      elements.push({ id: e.id, kind: "guide", x: e.x, ...label });
    } else {
      return `${at}: kind is point, line or guide`;
    }
  }
  return elements;
}

const quoted = (ids: string[]) =>
  ids.map((id) => `"${id}"`).join(ids.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, ", and $1");

/**
 * The tool's labels whose id names no element the plot draws, as a sentence, or undefined when
 * there are none. Checked at build only: a student editing the code live may rename an element.
 */
export function strayLabels(elements: readonly ElementData[], labels: Readonly<Record<string, string>>) {
  const drawn = elements.map((e) => e.id);
  const stray = Object.keys(labels).filter((id) => !drawn.includes(id));
  if (stray.length === 0) return undefined;
  return `labels names ${quoted(stray)}, which the plot doesn't draw (it draws ${quoted(drawn)})`;
}
