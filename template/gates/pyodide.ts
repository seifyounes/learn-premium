// The Pyodide gate, per Module and per deploy: every Pyodide tool on a built page opens on its
// preview (the plot its code gave at build, drawn, with at least one mark inside the figure's
// frame) beside a Run-live button that prints the tap's real download, worked out here from the
// files the site serves at /pyodide/ and the lock it serves with them. A tool whose tap would ask
// for a file the site doesn't serve blocks too.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { PYODIDE_PATH } from "../src/python/download.ts";
import { CORE_FILES, packageFiles, sizeLabel, type Lock } from "../src/python/lock.ts";
import { copySite, sitePages } from "./pages.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

/** The marks a plotted figure draws (`PlotFigure`): points, lines and guides. */
const MARKS = ["plot-point", "plot-line", "plot-guide"];

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];

function elementsIn(node: Nodes, keep: (e: Element) => boolean): Element[] {
  const found: Element[] = [];
  const visit = (n: Nodes) => {
    if (n.type === "element" && keep(n)) found.push(n);
    if ("children" in n) n.children.forEach(visit);
  };
  visit(node);
  return found;
}

interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Point = [number, number];

/** The plot area a plotted figure draws its marks in: its backdrop rectangle. */
function frameOf(figure: Element): Frame | undefined {
  const [rect] = elementsIn(figure, (e) => e.tagName === "rect" && e.properties.dataBackdrop !== undefined);
  if (!rect) return undefined;
  const [x = NaN, y = NaN, width = NaN, height = NaN] = ["x", "y", "width", "height"].map((k) =>
    Number(rect.properties[k]),
  );
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x0: x, y0: y, x1: x + width, y1: y + height };
}

/** Half a pixel either way: a mark on the frame's edge is in it. */
const EDGE = 0.5;

/** Whether the segment from `a` to `b` (a point when they are the same) meets the frame: Liang–Barsky. */
function meets(f: Frame, [ax, ay]: Point, [bx, by]: Point): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const sides: Point[] = [
    [-dx, ax - (f.x0 - EDGE)],
    [dx, f.x1 + EDGE - ax],
    [-dy, ay - (f.y0 - EDGE)],
    [dy, f.y1 + EDGE - ay],
  ];
  for (const [p, q] of sides) {
    if (!Number.isFinite(q)) return false;
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** The vertices an SVG path's M, L, H and V commands visit: the only ones the plot's marks use. */
function vertices(d: string): Point[] {
  const tokens = d.match(/[MLHV]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out: Point[] = [];
  let at: Point = [0, 0];
  for (let i = 0; i < tokens.length; i++) {
    const command = (tokens[i] ?? "").toUpperCase();
    const next = () => Number(tokens[++i]);
    if (command === "M" || command === "L") at = [next(), next()];
    else if (command === "H") at = [next(), at[1]];
    else if (command === "V") at = [at[0], next()];
    else continue;
    out.push(at);
  }
  return out;
}

/** Whether a mark (a point, a line or a guide) shows inside the frame, not clipped away beyond it. */
function inFrame(mark: Element, f: Frame): boolean {
  if (mark.tagName === "circle") {
    const at: Point = [Number(mark.properties.cx), Number(mark.properties.cy)];
    return meets(f, at, at);
  }
  const [first, ...rest] = vertices(String(mark.properties.d ?? ""));
  if (!first) return false;
  let from = first;
  if (rest.length === 0) return meets(f, from, from);
  return rest.some((to) => {
    const hit = meets(f, from, to);
    from = to;
    return hit;
  });
}

const textOf = (node: Nodes): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

/** What the button must print, from the files the site serves: or why the tap would fail. */
function realDownload(distDir: string, packages: string[]): { bytes: number } | { problem: string } {
  const dir = join(distDir, PYODIDE_PATH);
  const lockPath = join(dir, "pyodide-lock.json");
  if (!existsSync(lockPath)) return { problem: `the site serves no Pyodide (${PYODIDE_PATH}pyodide-lock.json)` };
  let files: string[];
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
    files = [...CORE_FILES, ...packageFiles(lock, packages).map((p) => p.file)];
  } catch (error) {
    return { problem: (error as Error).message };
  }
  const missing = files.filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0)
    return {
      problem: `Run live would fetch ${missing.map((f) => PYODIDE_PATH + f).join(", ")}, which the site doesn't serve`,
    };
  return { bytes: files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0) };
}

export const pyodideGate: Gate = {
  id: "pyodide",
  checks:
    "every Pyodide tool opens on its build-time preview, a mark of it inside the figure's frame, beside a Run-live button that prints the tap's real download, every file of it served from the site's own /pyodide/",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const coverage = { pages: pages.length, tools: 0 };
    const findings: Finding[] = [];
    for (const { route, path } of pages) {
      const html = readFileSync(path, "utf8");
      if (!html.includes("data-python-tool")) continue;
      const tools = elementsIn(fromHtml(html), (e) => e.properties.dataPythonTool !== undefined);
      for (const tool of tools) {
        coverage.tools += 1;
        const label = typeof tool.properties.ariaLabel === "string" ? tool.properties.ariaLabel : "a Pyodide tool";
        const block = (message: string) =>
          findings.push({ outcome: "block", at: route, message: `${label}: ${message}` });
        const [preview] = elementsIn(tool, (e) => e.properties.dataPythonPreview !== undefined);
        const marks = preview ? elementsIn(preview, (e) => classesOf(e).some((c) => MARKS.includes(c))) : [];
        const frame = preview && frameOf(preview);
        if (!preview) block("it has no build-time preview: it must open on the plot its code gives at build");
        else if (marks.length === 0)
          block("its preview draws nothing: the plot its code gave at build isn't on the figure");
        else if (!frame) block("its preview has no plot area to draw its marks in");
        else if (!marks.some((m) => inFrame(m, frame)))
          block(
            "its preview draws every mark outside its frame, so the student opens on an empty figure: widen the figure's axes or move the plot",
          );
        const [button] = elementsIn(tool, (e) => e.tagName === "button" && e.properties.dataRunLive !== undefined);
        if (!button) {
          block("it has no Run-live button");
          continue;
        }
        const printed = /^Run live · (\d+\.\d MB)$/.exec(textOf(button).trim())?.[1];
        if (!printed) {
          block(`its Run-live button doesn't say what the tap downloads ("${textOf(button).trim()}")`);
          continue;
        }
        const packages = String(tool.properties.dataPythonTool).split(/\s+/).filter(Boolean);
        const real = realDownload(siteOf(input), packages);
        if ("problem" in real) {
          block(real.problem);
          continue;
        }
        if (printed !== sizeLabel(real.bytes) || Number(button.properties.dataRunLive) !== real.bytes)
          block(
            `its Run-live button says ${printed}, but the tap downloads ${sizeLabel(real.bytes)} (${real.bytes} bytes)`,
          );
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a Pyodide tool with no build-time preview",
      plant: (good, scratch) => toolPageWith(good, scratch, (page) => page.replace(/ data-python-preview=""/g, "")),
    },
    {
      defect: "a Pyodide tool whose preview draws nothing",
      plant: (good, scratch) =>
        toolPageWith(good, scratch, (page) => page.replace(/class="plot-(point|line|guide)"/g, 'class="planted-$1"')),
    },
    {
      defect: "a Pyodide tool whose preview draws every mark outside its frame",
      plant: (good, scratch) =>
        toolPageWith(good, scratch, (page) =>
          page.replace(/<(?:circle|path)\b[^>]*>/g, (tag) =>
            /class="plot-(?:point|line|guide)"/.test(tag)
              ? tag.replace(/\bcx="[^"]*"/, 'cx="-500"').replace(/\bd="[^"]*"/, 'd="M -500 -500 L -400 -500"')
              : tag,
          ),
        ),
    },
    {
      defect: "a Run-live button that doesn't say what the tap downloads",
      plant: (good, scratch) =>
        toolPageWith(good, scratch, (page) => page.replace(/>Run live · [\d.]+ MB</g, ">Run live<")),
    },
    {
      defect: "a Run-live button that understates the download",
      plant: (good, scratch) =>
        toolPageWith(good, scratch, (page) => page.replace(/>Run live · [\d.]+ MB</g, ">Run live · 0.1 MB<")),
    },
    {
      defect: "a file the tap fetches missing from the site's /pyodide/",
      plant: (good, scratch) =>
        toolPageWith(
          good,
          scratch,
          (page) => page,
          (distDir) => rmSync(join(distDir, PYODIDE_PATH, "pyodide.asm.wasm")),
        ),
    },
  ],
};

function siteOf({ distDir }: GateInput): string {
  if (distDir === undefined) throw new Error("no built site given to check (distDir)");
  return distDir;
}

/**
 * A scratch copy of the built site (Pyodide included) with the first page holding a Pyodide tool
 * changed by `edit`, and `alsoDo` run on the copy. Throws when no page has one, so a control can't
 * silently check nothing.
 */
function toolPageWith(
  good: GateInput,
  scratch: string,
  edit: (page: string) => string,
  alsoDo?: (distDir: string) => void,
): GateInput {
  const page = sitePages(good).find((p) => readFileSync(p.path, "utf8").includes("data-python-tool"));
  if (!page) throw new Error("no built page holds a Pyodide tool to plant a negative control in");
  const distDir = copySite(good, scratch, { whole: true });
  const path = join(distDir, page.entry);
  const html = readFileSync(path, "utf8");
  const edited = edit(html);
  if (edited === html && !alsoDo) throw new Error(`${page.route} had nothing to plant a negative control in`);
  writeFileSync(path, edited);
  alsoDo?.(distDir);
  return { ...good, distDir };
}
