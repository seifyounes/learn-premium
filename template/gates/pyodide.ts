// The Pyodide gate, per Module and per deploy: every Pyodide tool on a built page opens on its
// preview (the plot its code gave at build, drawn) beside a Run-live button that prints the tap's
// real download, worked out here from the files the site serves at /pyodide/ and the lock it
// serves with them. A tool whose tap would ask for a file the site doesn't serve blocks too.
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
    "every Pyodide tool opens on its build-time preview beside a Run-live button that prints the tap's real download, every file of it served from the site's own /pyodide/",
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
        if (!preview) block("it has no build-time preview: it must open on the plot its code gives at build");
        else if (elementsIn(preview, (e) => classesOf(e).some((c) => MARKS.includes(c))).length === 0)
          block("its preview draws nothing: the plot its code gave at build isn't on the figure");
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
