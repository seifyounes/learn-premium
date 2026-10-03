// The browser gates, per Module, on the Module's preview: slices of one browser run
// (`browser/run.ts`) on Chromium and WebKit. A run that missed any of the Trap page's seeded defects
// is void: the trap-page gate blocks, and every other browser gate fails rather than pass on a
// blind run. Not per deploy: a production build carries no Trap page, so every run there would be
// void. A Module-point run with no `--module` opens every page of the Course.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TRAP_ROUTE } from "../src/trap/route.ts";
import { browserRun, WIDTHS, type BrowserGateId } from "./browser/run.ts";
import { copySite, inMain, sitePages } from "./pages.ts";
import type { Gate, GateInput, NegativeControl } from "./runner.ts";

function browserGate(id: BrowserGateId, checks: string, controls: NegativeControl[]): Gate {
  return {
    id,
    checks,
    points: ["module"],
    async run(input) {
      const run = await browserRun(input);
      if (run.void !== undefined && id !== "trap-page") throw new Error(run.void);
      return run.gates[id];
    },
    controls,
  };
}

/** The route a negative control plants its page at, and scopes the run to. */
const PLANTED = "planted-negative-control";

/**
 * A whole scratch copy of the built site (scripts and media too: the browsers run it) with one
 * page added at `/planted-negative-control/`: a copy of the home page, light to sweep, or of the
 * first Module page when the control needs its islands, changed by `edit`. `files` adds or (with
 * null) removes files, by their path in the site. The run is scoped to the planted page.
 */
function planted(
  good: GateInput,
  scratch: string,
  edit: (page: string) => string,
  { from = "home", files = {} }: { from?: "home" | "module"; files?: Record<string, string | null> } = {},
): GateInput {
  // The page to copy is found in the whole site, whatever the good input is scoped to.
  const whole: GateInput = {
    contentDir: good.contentDir,
    ...(good.distDir === undefined ? {} : { distDir: good.distDir }),
  };
  const source = sitePages(whole).find((p) => (from === "home" ? p.route === "/" : p.route !== "/"));
  if (!source) throw new Error(`the built site has no ${from} page to plant a negative control in`);
  const distDir = copySite(good, scratch, { whole: true });
  const page = readFileSync(source.path, "utf8");
  const edited = edit(page);
  if (edited === page) throw new Error(`${source.route} had nothing to plant a negative control in`);
  mkdirSync(join(distDir, PLANTED), { recursive: true });
  writeFileSync(join(distDir, PLANTED, "index.html"), edited);
  for (const [file, content] of Object.entries(files)) {
    const path = join(distDir, file);
    if (content === null) rmSync(path);
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return { contentDir: good.contentDir, distDir, module: PLANTED };
}

/** A planted page with `html` at the end of its sheet. */
const plantInMain =
  (html: string, options?: Parameters<typeof planted>[3]): NegativeControl["plant"] =>
  (good, scratch) =>
    planted(good, scratch, inMain(html), options);

/** A planted page whose `<head>` loads `src`: a file in the site holding `body`, or another site's address. */
const plantScript =
  (src: string, body?: string): NegativeControl["plant"] =>
  (good, scratch) =>
    planted(good, scratch, (page) => page.replace("</head>", `<script type="module" src="${src}"></script></head>`), {
      files: body === undefined ? {} : { [src.slice(1)]: body },
    });

/** The Trap page with one of its seeded defects defused, beside a light planted page. */
const defuseTrap =
  (from: string, to: string): NegativeControl["plant"] =>
  (good, scratch) => {
    const trapPage = join(good.distDir ?? "", TRAP_ROUTE, "index.html");
    if (!existsSync(trapPage)) throw new Error(`the built site has no Trap page at ${TRAP_ROUTE} to defuse`);
    const page = readFileSync(trapPage, "utf8");
    if (!page.includes(from)) throw new Error(`the Trap page has no "${from}" to defuse`);
    return planted(good, scratch, inMain("<p>Planted beside a defused Trap page.</p>"), {
      files: { [`${TRAP_ROUTE.slice(1)}index.html`]: page.replace(from, to) },
    });
  };

export const layoutSweep = browserGate(
  "layout-sweep",
  `at ${WIDTHS.join("/")}px on Chromium and WebKit, every collapsible open: no sideways page scroll, nothing over a figure, nothing above the page, no colliding text, no height-locked overflow, no text under 12px`,
  [
    {
      defect: "a block wider than the viewport, so the page scrolls sideways",
      plant: plantInMain('<div style="inline-size: 2400px; block-size: 8px"></div>'),
    },
    {
      defect: "a value chip positioned over a figure's line",
      plant: plantInMain(
        '<figure style="position: relative"><svg viewBox="0 0 240 80" width="240" height="80"><path d="M10 40H230" fill="none" stroke="currentColor" stroke-width="2"/></svg><span style="position: absolute; inset-block-start: 28px; inset-inline-start: 72px">9.6 kW</span></figure>',
      ),
    },
    {
      defect: "content lifted above the top of the page",
      plant: plantInMain('<p style="position: relative; inset-block-start: -4000px">Lifted off the page.</p>'),
    },
    {
      defect: "two paragraphs drawn on the same pixels",
      plant: plantInMain(
        '<p>Heat flows from hot to cold.</p><p style="margin-block-start: -1.4em">Resistances in series add.</p>',
      ),
    },
    {
      defect: "a height-locked box whose content is taller than it",
      plant: plantInMain('<div style="block-size: 24px"><p>One line.</p><p>Two lines.</p><p>Three lines.</p></div>'),
    },
    {
      defect: "text set under the 12px floor",
      plant: plantInMain('<p style="font-size: 10px">Small print under the floor.</p>'),
    },
  ],
);

/** A planted page whose script writes `text` into the sheet as it loads. */
const writtenOnLoad = (text: string) =>
  plantInMain(`<p data-planted></p><script>document.querySelector("[data-planted]").textContent = ${text};</script>`);

export const livePageScan = browserGate(
  "live-page-scan",
  "the live page, as its scripts and islands left it: no KaTeX error, no raw TeX, no hollow copy like 0/0, no NaN or floating-point noise, no uncaught error",
  [
    {
      defect: "a KaTeX error span on the page",
      plant: plantInMain('<span class="katex-error" title="ParseError: planted">\\frac{L</span>'),
    },
    { defect: "raw TeX a script wrote into the page", plant: writtenOnLoad(String.raw`"so $R = \\frac{L}{kA}$"`) },
    { defect: "a hollow 0/0 score a script wrote", plant: writtenOnLoad('"Score: " + 0 + "/" + 0') },
    { defect: "floating-point noise a script computed", plant: writtenOnLoad('"Heat loss: " + 0.1 * 3 + " kW"') },
    { defect: "NaN a script computed", plant: writtenOnLoad('"Heat loss: " + 0 / 0 + " kW"') },
    { defect: "an object a script printed", plant: writtenOnLoad('"Answer: " + {}') },
    { defect: "a placeholder a script never filled", plant: writtenOnLoad('"{{" + "MODULE_TITLE" + "}}"') },
    {
      defect: "an uncaught error as the page loads",
      plant: plantInMain('<script>throw new Error("planted")</script>'),
    },
  ],
);

export const hydrationGate = browserGate(
  "hydration",
  "every island's controls are disabled in the server's HTML, and the island hydrates and turns them on",
  [
    {
      defect: "an island control that works before its island hydrates",
      plant: (good, scratch) =>
        planted(good, scratch, (page) => page.replace(/(<astro-island[\s\S]*?<button[^>]*?) disabled=""/, "$1"), {
          from: "module",
        }),
    },
    {
      defect: "an island that hydrates and leaves every control off",
      // A renderer that hydrates the island by doing nothing: the server's disabled controls stay.
      plant: (good, scratch) =>
        planted(
          good,
          scratch,
          (page) =>
            page
              .replace(/component-url="[^"]*"/, 'component-url="/_astro/inert.planted.js"')
              .replace(/renderer-url="[^"]*"/, 'renderer-url="/_astro/inert-renderer.planted.js"'),
          {
            from: "module",
            files: {
              "_astro/inert.planted.js": "export default {};\n",
              "_astro/inert-renderer.planted.js": "export default () => async () => {};\n",
            },
          },
        ),
    },
    {
      defect: "an island that never hydrates",
      plant: (good, scratch) =>
        planted(good, scratch, (page) => page.replace(/component-url="[^"]*"/, 'component-url="/_astro/missing.js"'), {
          from: "module",
        }),
    },
  ],
);

export const touchGate = browserGate(
  "touch",
  "with emulated phone touch at 375 and 390px (4× slower CPU on Chromium), every control answers a tap",
  [
    {
      defect: "a button that does nothing when tapped",
      plant: plantInMain('<button type="button">Does nothing</button>'),
    },
    {
      defect: "a field that drops what is typed",
      plant: plantInMain(`<label>Your answer <input oninput="this.value = ''"></label>`),
    },
    {
      defect: "a button that throws when tapped",
      plant: plantInMain(
        `<button type="button" onclick="this.textContent = 'Tapped'; throw new Error('planted on tap')">Tap to fail</button>`,
      ),
    },
    {
      defect: "a button under a transparent layer that takes the tap",
      plant: plantInMain(
        '<div style="position: relative"><button type="button" onclick="this.textContent = \'Tapped\'">Tap me</button><div style="position: absolute; inset: 0"></div></div>',
      ),
    },
  ],
);

export const initialLoad = browserGate(
  "initial-load",
  "three.js, Pyodide and Plotly are absent from every page's initial load",
  [
    {
      defect: "three.js loaded with the page",
      plant: plantScript("/_astro/three.module.planted.js", "export class WebGLRenderer {}\n"),
    },
    {
      defect: "Pyodide loaded with the page",
      plant: plantScript("/_astro/runtime.planted.js", "globalThis.loadPyodide = () => {};\n"),
    },
    {
      defect: "Plotly loaded with the page",
      plant: plantScript("/_astro/charts.planted.js", "globalThis.Plotly = { newPlot() {} };\n"),
    },
    {
      defect: "three.js asked for from a CDN with the page",
      plant: plantScript("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"),
    },
  ],
);

export const trapPageGate = browserGate(
  "trap-page",
  "every browser sweep found every seeded defect on the Trap page; a run that missed one is void",
  [
    {
      defect: "a Trap page whose folded figure is labelled at a legal size",
      plant: defuseTrap('font-size="8"', 'font-size="14"'),
    },
    {
      defect: "a Trap page without its KaTeX error",
      plant: defuseTrap('class="katex-error"', 'class="katex-defused"'),
    },
    {
      defect: "a Trap page whose value chip sits clear of its figure",
      plant: defuseTrap("font-quantity absolute", "font-quantity"),
    },
    { defect: "a Trap page that computes its number right", plant: defuseTrap("String(0.1 * 3)", "String(0.5 * 3)") },
    {
      defect: "a build without the Trap page",
      plant: (good, scratch) =>
        planted(good, scratch, inMain("<p>Planted with no Trap page.</p>"), {
          files: { [`${TRAP_ROUTE.slice(1)}index.html`]: null },
        }),
    },
  ],
);

export const BROWSER_GATES: readonly Gate[] = [
  layoutSweep,
  livePageScan,
  hydrationGate,
  touchGate,
  initialLoad,
  trapPageGate,
];
