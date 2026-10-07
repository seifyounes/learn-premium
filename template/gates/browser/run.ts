// One browser run per gate input: headless Playwright on Chromium and WebKit (WebKit stands in for
// iPhone Safari) against the served build, or a preview URL. Every browser gate is a slice of it,
// so the pages load once however many gates read them.
//
// For each browser, every page in scope and the Trap page:
//   - loads at 1440px, recording what the initial load fetches, before anything is scrolled;
//   - scrolls every island into view and waits for it to hydrate, then checks its controls work;
//   - sweeps at each of the eight widths, the viewport width asserted first, every collapsible open
//     (`in-page.js` measures);
// then taps every control of every page in scope with emulated phone touch at 375 and 390px (4×
// slower CPU on Chromium; WebKit has no CPU throttling), and sweeps the state that leaves.
//
// The Trap page proves each sweep could see: every sweep of it must find every seeded defect, or
// the run is void and no browser gate's verdict counts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Element as HastElement } from "hast";
import { fromHtml } from "hast-util-from-html";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { PYODIDE_PATH } from "../../src/python/download.ts";
import { TRAP_DEFECTS, TRAP_ROUTE, type TrapDefect } from "../../src/trap/route.ts";
import { COPY_DEFECTS, quote, RAW_TEX, type CopyDefect } from "../copy-checks.ts";
import { sitePages, textIn } from "../pages.ts";
import type { Finding, GateInput, GateRun } from "../runner.ts";
import { serveSite } from "./serve.ts";

export const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440] as const;
export const TOUCH_WIDTHS = [375, 390] as const;
const BROWSERS = { chromium, webkit } as const;
type BrowserName = keyof typeof BROWSERS;

export const BROWSER_GATE_IDS = [
  "layout-sweep",
  "live-page-scan",
  "hydration",
  "touch",
  "initial-load",
  "trap-page",
] as const;
export type BrowserGateId = (typeof BROWSER_GATE_IDS)[number];

/** What `in-page.js` reports: the layout checks, and the live page's text checks. */
type LayoutKind =
  "page-scroll" | "covers-figure" | "above-viewport" | "text-collision" | "height-overflow" | "tiny-text";
type TextKind = "katex-error" | "raw-tex" | CopyDefect["kind"];
type Kind =
  | LayoutKind
  | TextKind
  | "load"
  | "page-error"
  | "heavy-library"
  | "never-hydrated"
  | "disabled-after-hydration"
  | "enabled-before-hydration"
  | "untappable"
  | "dead-field"
  | "dead-tap";

/** What catches each of the Trap page's seeded defects. */
const TRAP_CATCHES: Record<TrapDefect, { gate: BrowserGateId; kinds: Kind[] }> = {
  "tiny-font-figure": { gate: "layout-sweep", kinds: ["tiny-text"] },
  "katex-error": { gate: "live-page-scan", kinds: ["katex-error"] },
  overlap: { gate: "layout-sweep", kinds: ["covers-figure", "text-collision"] },
  "wrong-number": { gate: "live-page-scan", kinds: ["garbled-number"] },
};

/**
 * Heavy libraries that load only when opened or scrolled to, never with the page: named by the
 * address asked for (a request to another site is blocked, but still asked for) or by the body.
 */
const HEAVY_LIBRARIES = [
  { name: "three.js", url: /(?:^|[/._-])three(?:[._@-]|\.module)/i, body: /\bWebGLRenderer\b/ },
  { name: "Pyodide", url: /pyodide/i, body: /\bloadPyodide\b/ },
  { name: "Plotly", url: /plotly/i, body: /\bPlotly\b[\s\S]*\bnewPlot\b|\bnewPlot\b[\s\S]*\bPlotly\b/ },
];

/** The controls an island renders, which it must keep off until it hydrates. */
const ISLAND_CONTROL_TAGS = ["button", "input", "textarea", "select"];
const ISLAND_CONTROLS = ISLAND_CONTROL_TAGS.map((tag) => (tag === "input" ? 'input:not([type="hidden"])' : tag)).join(
  ", ",
);
/** The fields a student types into: tapped, then typed into. */
const TEXT_FIELDS =
  'textarea, input:not([type]), input[type="text"], input[type="number"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"]';
/** Everything a student can operate, inside an island or out. */
const CONTROLS = `${ISLAND_CONTROLS}, summary, [role="button"], [role="tab"], [role="checkbox"]`;

// How long the run waits, each named for what it waits on.
/** For requests the load started to land, before the initial load is called done. */
const LOAD_SETTLES_MS = 300;
/**
 * For an island scrolled into view to hydrate. The gate is for an island that never hydrates, not
 * a slow one (performance is reported, never gated): under a CI runner's load, with both browsers
 * and 4× slower phone CPUs running at once, a Worked example took up to 24s and did hydrate.
 */
const HYDRATES_MS = 60_000;
/** For a hydrated island to turn its controls on (it does so in an effect, just after). */
const CONTROLS_ON_MS = 5_000;
/**
 * For a control to take a tap (Playwright retries while something else would take it), and for
 * the page to answer it. Like hydration, these wait out a slow page and catch a dead one: on CI's
 * runner, with both browsers and 4× slower phone CPUs at once, live controls on the Module pages
 * and the Lab missed 5s and 2s limits on main. The touch gate reports its slowest tap and answer.
 * (`TAP_TAKES_MS` is exported for its tests.)
 */
export const TAP_TAKES_MS = 15_000;
const TAP_ANSWERS_MS = 10_000;
/** For a resized viewport to reach the page (exported for its tests). */
export const WIDTH_ARRIVES_MS = 10_000;
/** The lines of Playwright's call log that say why a tap didn't land. */
const UNTAPPABLE_BECAUSE = /intercepts|not visible|not stable|not enabled|outside|detached/;
/** At most this many taps on a page: a control that keeps adding controls can't loop forever. */
const MOST_TAPS = 200;
/** Pages a browser has open at once. */
const PAGES_AT_ONCE = 3;

/** The in-page sweep, with the copy checks it shares with the rendered-page scan (exported for its tests). */
export const IN_PAGE = `window.__lpChecks = ${JSON.stringify({
  rawTex: { source: RAW_TEX.source, flags: RAW_TEX.flags },
  copy: COPY_DEFECTS.map(({ kind, what, pattern }) => ({ kind, what, source: pattern.source, flags: pattern.flags })),
})};
${readFileSync(join(import.meta.dirname, "in-page.js"), "utf8")}`;

interface PageFinding<K extends Kind> {
  kind: K;
  detail: string;
  trap?: string;
}

interface PageSweep {
  layout: PageFinding<LayoutKind>[];
  text: PageFinding<TextKind>[];
  coverage: { collapsibles: number; views: number; texts: number; figures: number; formulas: number };
  collapsiblesOnPage: number;
}

declare global {
  interface Window {
    /** `in-page.js`. */
    __lpSweep: { sweep(): Promise<PageSweep>; settle(): Promise<void> };
    /** DOM changes since touch began counting, to tell a tap that did something. */
    __lpMutations: number;
  }
}

interface Observation {
  gate: BrowserGateId;
  route: string;
  /** Which browser, width and state saw it. */
  where: string;
  kind: Kind;
  detail: string;
  trap?: string | undefined;
}

export interface BrowserRun {
  gates: Record<BrowserGateId, GateRun>;
  /** Why the run is void (a missed Trap page defect); no browser gate's verdict then counts. */
  void?: string;
}

const runs = new Map<string, Promise<BrowserRun>>();

/** The browser run for a gate input, made once and shared by every browser gate. */
export function browserRun(input: GateInput): Promise<BrowserRun> {
  const key = JSON.stringify([input.distDir, input.siteUrl, input.module]);
  let run = runs.get(key);
  if (!run) {
    run = execute(input);
    runs.set(key, run);
    // A run that crashed may be retried (browsers missing, say); a finished one is kept.
    run.catch(() => runs.delete(key));
  }
  return run;
}

/** Runs `tasks`, at most `limit` at a time, and returns their results in the tasks' order. */
async function inTurns<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await (tasks[i] as () => Promise<T>)();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const heightFor = (width: number) => (width < 768 ? 844 : width < 1280 ? 1024 : 900);
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

async function execute(input: GateInput): Promise<BrowserRun> {
  const pages = sitePages(input);
  if (pages.length === 0) throw new Error("no built page in scope for the browsers to open");
  const served = input.siteUrl === undefined ? await serveSite(input.distDir ?? "") : undefined;
  const base = (input.siteUrl ?? served?.url ?? "").replace(/\/$/, "");
  const observations: Observation[] = [];
  const observe = (o: Observation) => observations.push(o);
  // Every count is of what the run looked at; one that stayed at zero covered nothing.
  const swept = { browsers: new Set<string>(), widths: new Set<number>(), pages: new Set<string>() };
  const coverage = {
    layout: { sweeps: 0, collapsibles: 0, views: 0, texts: 0, figures: 0 },
    live: { sweeps: 0, texts: 0, formulas: 0 },
    hydration: { pages: 0, islands: 0, controls: 0 },
    touch: { pages: new Set<string>(), widths: new Set<number>(), taps: 0, slowestTapMs: 0, slowestAnswerMs: 0 },
    initial: { pages: 0, requests: 0 },
    trap: { sweeps: 0, defects: 0 },
  };
  /** Each Trap page sweep, with what it found. */
  const trapSweeps: { where: string; found: Observation[] }[] = [];
  const routes = [...pages.map((p) => p.route), TRAP_ROUTE];

  // The browsers run side by side, each with a few pages open at once; the results are read back
  // in a fixed order, so a report doesn't depend on which finished first.
  const perBrowser = async (name: BrowserName) => {
    const browser = await launch(name);
    try {
      const sweeps = routes.map(
        (route) => () => againIfCrashed(() => sweepPage(browser, name, `${base}${route}`, route)),
      );
      const touches = pages.flatMap(({ route }) =>
        TOUCH_WIDTHS.map(
          (width) => () => againIfCrashed(() => touchPage(browser, name, width, `${base}${route}`, route)),
        ),
      );
      const [sweptPages, touched] = await Promise.all([
        inTurns(sweeps, PAGES_AT_ONCE),
        inTurns(touches, PAGES_AT_ONCE),
      ]);
      return { name, sweptPages, touched };
    } finally {
      await browser.close();
    }
  };
  let results: Awaited<ReturnType<typeof perBrowser>>[];
  try {
    results = await Promise.all((Object.keys(BROWSERS) as BrowserName[]).map(perBrowser));
  } finally {
    await served?.close();
  }

  for (const { name, sweptPages, touched } of results) {
    sweptPages.forEach((result, i) => {
      const route = routes[i] ?? "";
      const trap = route === TRAP_ROUTE;
      if (result === "missing") {
        if (trap) trapSweeps.push({ where: `${name}: no Trap page at ${TRAP_ROUTE}`, found: [] });
        else observe({ gate: "live-page-scan", route, where: name, kind: "load", detail: "the page didn't load" });
        return;
      }
      if (trap) {
        for (const s of result.sweeps) trapSweeps.push({ where: s.where, found: s.observations });
        return;
      }
      result.observations.forEach(observe);
      for (const s of result.sweeps) {
        s.observations.forEach(observe);
        swept.browsers.add(name);
        swept.widths.add(s.width);
        swept.pages.add(route);
        coverage.layout.sweeps += 1;
        coverage.live.sweeps += 1;
        coverage.layout.collapsibles = Math.max(coverage.layout.collapsibles, s.collapsibles);
        coverage.layout.views += s.views;
        coverage.layout.texts += s.texts;
        coverage.layout.figures += s.figures;
        coverage.live.texts += s.texts;
        coverage.live.formulas += s.formulas;
      }
      if (name === "chromium") coverage.hydration.islands += result.islands;
      coverage.initial.pages += 1;
      coverage.initial.requests += result.requests;
    });
    for (const result of touched) {
      result.observations.forEach(observe);
      coverage.touch.pages.add(result.route);
      coverage.touch.widths.add(result.width);
      coverage.touch.taps += result.taps;
      coverage.touch.slowestTapMs = Math.max(coverage.touch.slowestTapMs, result.slowest.tapMs);
      coverage.touch.slowestAnswerMs = Math.max(coverage.touch.slowestAnswerMs, result.slowest.answerMs);
    }
  }

  // Before hydration: the server's HTML is what a student meets first, and it must not offer a
  // control the island can't answer yet.
  for (const { route, path } of pages) {
    coverage.hydration.pages += 1;
    for (const island of islandsIn(readFileSync(path, "utf8"))) {
      for (const control of controlsIn(island)) {
        coverage.hydration.controls += 1;
        if (control.properties.disabled === undefined || control.properties.disabled === false) {
          observe({
            gate: "hydration",
            route,
            where: "before hydration",
            kind: "enabled-before-hydration",
            detail: `${describeHast(control)} works before its island hydrates; disable it until the island is ready`,
          });
        }
      }
    }
  }

  // The Trap page: every sweep must have found every seeded defect.
  const trapFindings: Finding[] = [];
  const missed = new Map<TrapDefect, string[]>();
  for (const sweep of trapSweeps) {
    coverage.trap.sweeps += 1;
    for (const [defect, catches] of Object.entries(TRAP_CATCHES) as [TrapDefect, (typeof TRAP_CATCHES)[TrapDefect]][]) {
      const caught = sweep.found.some(
        (o) => o.trap === defect && o.gate === catches.gate && catches.kinds.includes(o.kind),
      );
      if (caught) coverage.trap.defects += 1;
      else missed.set(defect, [...(missed.get(defect) ?? []), sweep.where]);
    }
  }
  for (const [defect, wheres] of missed) {
    trapFindings.push({
      outcome: "block",
      at: TRAP_ROUTE,
      message: `the run missed the Trap page's seeded ${TRAP_DEFECTS[defect]} (${wheres.join("; ")}), so it is void`,
    });
  }

  const findingsOf = (gate: BrowserGateId) => aggregate(observations.filter((o) => o.gate === gate));
  const { layout, live, hydration, touch, initial, trap } = coverage;
  const sweptCounts = { browsers: swept.browsers.size, widths: swept.widths.size, pages: swept.pages.size };
  return {
    gates: {
      "layout-sweep": { coverage: { ...sweptCounts, ...layout }, findings: findingsOf("layout-sweep") },
      "live-page-scan": { coverage: { pages: swept.pages.size, ...live }, findings: findingsOf("live-page-scan") },
      hydration: { coverage: hydration, findings: findingsOf("hydration") },
      touch: {
        // The slowest tap and answer: how close the runner's load came to the waits (reported, never gated).
        coverage: {
          pages: touch.pages.size,
          widths: touch.widths.size,
          taps: touch.taps,
          slowestTapMs: touch.slowestTapMs,
          slowestAnswerMs: touch.slowestAnswerMs,
        },
        findings: findingsOf("touch"),
      },
      "initial-load": { coverage: initial, findings: findingsOf("initial-load") },
      "trap-page": { coverage: trap, findings: trapFindings },
    },
    ...(trapFindings.length > 0
      ? { void: `the browser run is void: ${trapFindings.map((f) => f.message).join("; ")}` }
      : {}),
  };
}

/** One finding per defect and page, naming every browser, width and state that saw it. */
function aggregate(observations: Observation[]): Finding[] {
  const byDefect = new Map<string, { route: string; detail: string; wheres: string[] }>();
  for (const o of observations) {
    const key = `${o.route}\n${o.detail}`;
    const seen = byDefect.get(key) ?? { route: o.route, detail: o.detail, wheres: [] };
    if (!seen.wheres.includes(o.where)) seen.wheres.push(o.where);
    byDefect.set(key, seen);
  }
  return [...byDefect.values()].map(({ route, detail, wheres }) => ({
    outcome: "block",
    at: route,
    message: `${detail} (${wheres.join(", ")})`,
  }));
}

async function launch(name: BrowserName): Promise<Browser> {
  try {
    return await BROWSERS[name].launch();
  } catch (error) {
    throw new Error(
      `can't start Playwright's ${name}; install it with \`npx playwright install chromium webkit\`: ${firstLine(error)}`,
      { cause: error },
    );
  }
}

/** A context that only reaches the site under test (no YouTube, no CDN), with the sweep injected. */
async function siteContext(browser: Browser, url: string, options: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext(options);
  const origin = new URL(url).origin;
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await context.addInitScript({ content: IN_PAGE });
  return context;
}

/**
 * Scrolls each island into view in turn (they hydrate when visible) and waits for it to hydrate.
 * Returns the islands that never did.
 */
async function hydrate(page: Page): Promise<string[]> {
  const islands = page.locator("astro-island");
  const never: string[] = [];
  for (let i = 0, count = await islands.count(); i < count; i++) {
    const island = islands.nth(i);
    try {
      // An island is `display: contents`, with no box of its own to scroll to.
      await island.evaluate((el) =>
        [...el.children].find((child) => child.getClientRects().length > 0)?.scrollIntoView({ block: "center" }),
      );
      await island.evaluate(
        (el, ms) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout")), ms);
            const check = () => {
              if (!el.hasAttribute("ssr")) {
                clearTimeout(timer);
                resolve();
              } else requestAnimationFrame(check);
            };
            check();
          }),
        HYDRATES_MS,
      );
    } catch {
      never.push((await island.getAttribute("component-url").catch(() => null)) ?? `island ${i + 1}`);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return never;
}

/**
 * The page's width must be the one asked for, or nothing measured at it can be trusted (exported
 * for its tests).
 */
export async function assertWidth(
  page: Page,
  name: BrowserName,
  width: number,
  of: "viewport" | "screen" = "viewport",
) {
  // A resize reaches the page a moment after it is asked for; a width that never arrives can't.
  // An emulated phone is judged by its screen: there, a page wider than the screen widens the
  // viewport itself (the phone zooms out), which is the page's defect, not the emulation's.
  const measure = of === "screen" ? () => window.screen.width : () => window.innerWidth;
  const arrived = await page
    .waitForFunction(
      ({ w, screen }) => (screen ? window.screen.width : window.innerWidth) === w,
      { w: width, screen: of === "screen" },
      { timeout: WIDTH_ARRIVES_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (arrived) return;
  // The poll can time out on a busy page just as the width lands: what counts is the width it has.
  const actual = await page.evaluate(measure);
  if (actual === width) return;
  throw new Error(`asked ${name} for a ${width}px ${of} and the page has ${actual}px, so the sweep can't be trusted`);
}

/**
 * Runs a page task again, once, if the browser crashed under it: a crashed renderer says nothing
 * about the page. A second crash stands, and fails the run.
 */
async function againIfCrashed<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (!/crashed|Target (?:page, context or browser )?(?:has been )?closed/i.test(firstLine(error))) throw error;
    return task();
  }
}

interface Sweep {
  where: string;
  width: number;
  observations: Observation[];
  collapsibles: number;
  views: number;
  texts: number;
  figures: number;
  formulas: number;
}

interface SweptPage {
  /** What the load and hydration saw, beside the sweeps. */
  observations: Observation[];
  sweeps: Sweep[];
  islands: number;
  requests: number;
}

async function sweepPage(
  browser: Browser,
  name: BrowserName,
  url: string,
  route: string,
): Promise<SweptPage | "missing"> {
  const observations: Observation[] = [];
  const observe = (o: Observation) => observations.push(o);
  const context = await siteContext(browser, url, {
    viewport: { width: 1440, height: heightFor(1440) },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(firstLine(error)));
    // The initial load: every address asked for (a request to another site is blocked, but was
    // still asked for), and the body of every script that arrived.
    const asked: string[] = [];
    const bodies: Promise<string>[] = [];
    let initial = true;
    page.on("request", (request) => {
      if (initial) asked.push(request.url());
    });
    page.on("response", (response) => {
      if (!initial) return;
      const script = response.request().resourceType() === "script" || /\.(?:m?js|wasm)(?:[?#]|$)/.test(response.url());
      if (script) bodies.push(response.text().catch(() => ""));
    });
    const response = await page.goto(url, { waitUntil: "load" });
    if (!response || response.status() >= 400) return "missing";
    await page.waitForTimeout(LOAD_SETTLES_MS);
    initial = false;
    const scripts = await Promise.all(bodies);
    for (const library of HEAVY_LIBRARIES) {
      const address = asked.find((a) => library.url.test(new URL(a).pathname));
      if (address === undefined && !scripts.some((body) => library.body.test(body))) continue;
      observe({
        gate: "initial-load",
        route,
        where: name,
        kind: "heavy-library",
        detail: `${library.name} loads with the page${address === undefined ? "" : ` (${address})`}; load it when opened or scrolled to`,
      });
    }

    for (const island of await hydrate(page)) {
      observe({
        gate: "hydration",
        route,
        where: name,
        kind: "never-hydrated",
        detail: `the island ${island} never hydrated`,
      });
    }
    // An island turns its controls on in an effect just after it hydrates, so it gets a moment.
    // Some stay off by design (Prev at the first step, Check before an answer), so an island is
    // dead only when every control it has is still off.
    const islands = await page.evaluate(
      async ({ selector, ms }) => {
        const outermost = [...document.querySelectorAll("astro-island:not([ssr])")].filter(
          (island) => !island.parentElement?.closest("astro-island"),
        );
        const count = (island: Element) => {
          const controls = [...island.querySelectorAll<HTMLButtonElement>(selector)];
          return { controls: controls.length, enabled: controls.filter((c) => !c.disabled).length };
        };
        const dead = () => outermost.some((i) => count(i).controls > 0 && count(i).enabled === 0);
        const deadline = performance.now() + ms;
        while (dead() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        return outermost.map((island) => ({
          island: island.getAttribute("component-url") ?? "an island",
          ...count(island),
        }));
      },
      { selector: ISLAND_CONTROLS, ms: CONTROLS_ON_MS },
    );
    for (const island of islands) {
      if (island.controls > 0 && island.enabled === 0) {
        observe({
          gate: "hydration",
          route,
          where: name,
          kind: "disabled-after-hydration",
          detail: `every control of the island ${island.island} is still disabled after it hydrated`,
        });
      }
    }

    const sweeps: Sweep[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: heightFor(width) });
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await window.__lpSweep.settle();
      });
      await assertWidth(page, name, width);
      sweeps.push(toSweep(await sweepNow(page), route, width, `${name} ${width}px`));
    }
    for (const error of errors) {
      observe({
        gate: "live-page-scan",
        route,
        where: name,
        kind: "page-error",
        detail: `an uncaught error on the page: ${error}`,
      });
    }
    return { observations, sweeps, islands: islands.length, requests: asked.length };
  } finally {
    await context.close();
  }
}

const sweepNow = (page: Page) => page.evaluate(() => window.__lpSweep.sweep());

function toSweep(result: PageSweep, route: string, width: number, where: string): Sweep {
  const { views, texts, figures, formulas } = result.coverage;
  return {
    where,
    width,
    observations: [
      ...result.layout.map((f) => ({ gate: "layout-sweep" as const, route, where, ...f })),
      ...result.text.map((f) => ({ gate: "live-page-scan" as const, route, where, ...f })),
    ],
    collapsibles: result.collapsiblesOnPage,
    views,
    texts,
    figures,
    formulas,
  };
}

/**
 * Emulated phone touch: taps every control on the page once, in page order, typing into fields
 * first so the controls they unlock get their turn, until nothing new appears. A tap that changes
 * nothing, or can't reach its control, blocks. The state it leaves (answers shown, steps taken) is
 * swept too.
 */
async function touchPage(
  browser: Browser,
  name: BrowserName,
  width: number,
  url: string,
  route: string,
): Promise<{
  route: string;
  width: number;
  observations: Observation[];
  taps: number;
  slowest: { tapMs: number; answerMs: number };
}> {
  const observations: Observation[] = [];
  const slowest = { tapMs: 0, answerMs: 0 };
  const observe = (o: Observation) => observations.push(o);
  const where = `${name} ${width}px touch`;
  const context = await siteContext(browser, url, {
    viewport: { width, height: heightFor(width) },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  // Run live answers its tap at once ("Loading Python…"); the 16 MB download and Python's start
  // behind it would starve every other page's taps on the slowed CPU, so the touch run refuses
  // them and the tool says Python didn't load. test/python-tool.test.ts and the real-phone pass
  // run Pyodide for real.
  await context.route(
    (address) => address.pathname.startsWith(PYODIDE_PATH),
    (route) => route.abort(),
  );
  let taps = 0;
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(firstLine(error)));
    if (name === "chromium") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await page.goto(url, { waitUntil: "load" });
    await hydrate(page);
    await page.evaluate(() => {
      window.__lpMutations = 0;
      new MutationObserver((records) => {
        window.__lpMutations += records.length;
      }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    for (let round = 0; round < MOST_TAPS; round++) {
      const next = await page.evaluate(
        ({ selector, fields }) => {
          const shown = (el: Element) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
          const candidates = [...document.querySelectorAll<HTMLElement>(`main :is(${selector})`)].filter(
            (el) =>
              !el.hasAttribute("data-lp-tapped") &&
              !(el as HTMLButtonElement).disabled &&
              !(el as HTMLInputElement).readOnly &&
              el.getAttribute("aria-current") === null &&
              el.getAttribute("aria-selected") !== "true" &&
              !el.closest("dialog:not([open])") &&
              shown(el),
          );
          // Fields first: what they unlock (a Check button) gets its turn after.
          const el = candidates.find((c) => c.matches(fields)) ?? candidates[0];
          if (!el) return null;
          el.setAttribute("data-lp-tapped", "");
          const id = String(document.querySelectorAll("[data-lp-tapped]").length);
          el.setAttribute("data-lp-control", id);
          return {
            id,
            field: el.matches(fields),
            slider: el.matches('input[type="range"]'),
            tag: el.tagName.toLowerCase(),
            label: el.getAttribute("aria-label") ?? el.textContent ?? "",
          };
        },
        { selector: CONTROLS, fields: TEXT_FIELDS },
      );
      if (!next) break;
      const control = page.locator(`[data-lp-control="${next.id}"]`);
      const named = `<${next.tag}> ${quote(next.label, 32)}`;
      const before = await page.evaluate(() => window.__lpMutations);
      taps += 1;
      const tapping = Date.now();
      try {
        await control.tap({ timeout: TAP_TAKES_MS });
        slowest.tapMs = Math.max(slowest.tapMs, Date.now() - tapping);
      } catch (error) {
        // The call log's last reason is the one the tap ran out of time on.
        const why = (error as Error).message.split("\n").findLast((line) => UNTAPPABLE_BECAUSE.test(line));
        observe({
          gate: "touch",
          route,
          where,
          kind: "untappable",
          detail: `${named} can't be tapped${why ? `: ${why.trim()}` : ""}`,
        });
        continue;
      }
      if (next.field) {
        await page.keyboard.type("1");
        const typed = await control.inputValue().catch(() => "");
        if (!typed.includes("1"))
          observe({
            gate: "touch",
            route,
            where,
            kind: "dead-field",
            detail: `typing into ${named} after a tap did nothing`,
          });
        continue;
      }
      // A slider is dragged, not tapped (a tap on its track moves nothing on an iPhone): touch holds
      // it to taking the tap, which the tap above proved.
      if (next.slider) continue;
      const answering = Date.now();
      const changed = await page
        .waitForFunction((count) => window.__lpMutations > count, before, { timeout: TAP_ANSWERS_MS })
        .then(() => true)
        .catch(() => false);
      if (changed) slowest.answerMs = Math.max(slowest.answerMs, Date.now() - answering);
      if (!changed)
        observe({ gate: "touch", route, where, kind: "dead-tap", detail: `a tap on ${named} changed nothing` });
    }
    for (const error of errors) {
      observe({ gate: "touch", route, where, kind: "page-error", detail: `an uncaught error while tapping: ${error}` });
    }
    // The state every tap left: answers shown, steps taken, folds opened.
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertWidth(page, name, width, "screen");
    const laidOut = await page.evaluate(() => window.innerWidth);
    if (laidOut > width) {
      observe({
        gate: "layout-sweep",
        route,
        where: `${where} end state`,
        kind: "page-scroll",
        detail: `the page lays out ${laidOut}px wide on a ${width}px phone screen, so the phone zooms it out`,
      });
    }
    toSweep(await sweepNow(page), route, width, `${where} end state`).observations.forEach(observe);
  } finally {
    await context.close();
  }
  return { route, width, observations, taps, slowest };
}

/** The outermost islands in a page's server HTML. */
function islandsIn(html: string): HastElement[] {
  const islands: HastElement[] = [];
  const visit = (node: HastElement | ReturnType<typeof fromHtml>) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "astro-island") islands.push(child);
      else visit(child);
    }
  };
  visit(fromHtml(html));
  return islands;
}

function controlsIn(island: HastElement): HastElement[] {
  const found: HastElement[] = [];
  const visit = (node: HastElement) => {
    for (const child of node.children) {
      if (child.type !== "element" || child.tagName === "template") continue;
      // The island's slot holds the page's static HTML (the Given box), which needs no island.
      if (child.tagName === "astro-slot") continue;
      const hidden = child.tagName === "input" && child.properties.type === "hidden";
      if (ISLAND_CONTROL_TAGS.includes(child.tagName) && !hidden) found.push(child);
      visit(child);
    }
  };
  visit(island);
  return found;
}

function describeHast(el: HastElement): string {
  const label = typeof el.properties.ariaLabel === "string" ? el.properties.ariaLabel : textIn(el);
  return `<${el.tagName}>${label.trim() ? ` ${quote(label, 32)}` : ""}`;
}
