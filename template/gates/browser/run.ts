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
// slower CPU on Chromium), and sweeps the state that leaves.
//
// The Trap page proves each sweep could see: every sweep of it must find every seeded defect, or
// the run is void and no browser gate's verdict counts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Element as HastElement } from "hast";
import { fromHtml } from "hast-util-from-html";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { TRAP_DEFECTS, TRAP_ROUTE, type TrapDefect } from "../../src/trap/route.ts";
import { COPY_DEFECTS, RAW_TEX } from "../copy-checks.ts";
import { sitePages } from "../pages.ts";
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

/** What catches each of the Trap page's seeded defects. */
const TRAP_CATCHES: Record<TrapDefect, { gate: BrowserGateId; kinds: string[] }> = {
  "tiny-font-figure": { gate: "layout-sweep", kinds: ["tiny-text"] },
  "katex-error": { gate: "live-page-scan", kinds: ["katex-error"] },
  overlap: { gate: "layout-sweep", kinds: ["covers-figure", "text-collision"] },
  "wrong-number": { gate: "live-page-scan", kinds: ["garbled-number"] },
};

/** Heavy libraries that load only when opened or scrolled to, never with the page. */
const HEAVY_LIBRARIES = [
  { name: "three.js", url: /(?:^|[/._-])three(?:[._-]|\.module)/i, body: /\bWebGLRenderer\b/ },
  { name: "Pyodide", url: /pyodide/i, body: /\bloadPyodide\b/ },
  { name: "Plotly", url: /plotly/i, body: /\bPlotly\b[\s\S]*\bnewPlot\b|\bnewPlot\b[\s\S]*\bPlotly\b/ },
];

/** Everything a student can operate, inside an island or out. */
const CONTROLS =
  'button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="tab"], [role="checkbox"]';
const ISLAND_CONTROLS = "button, input:not([type='hidden']), textarea, select";

/** The in-page sweep, with the copy checks it shares with the rendered-page scan. */
const IN_PAGE = `window.__lpChecks = ${JSON.stringify({
  rawTex: { source: RAW_TEX.source, flags: RAW_TEX.flags },
  copy: COPY_DEFECTS.map(({ kind, what, pattern }) => ({ kind, what, source: pattern.source, flags: pattern.flags })),
})};
${readFileSync(join(import.meta.dirname, "in-page.js"), "utf8")}`;

interface Observation {
  gate: BrowserGateId;
  route: string;
  /** Which browser, width and state saw it. */
  where: string;
  kind: string;
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

/** Pages a browser has open at once. */
const PAGES_AT_ONCE = 3;

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

interface PageSweep {
  layout: { kind: string; detail: string; trap?: string }[];
  text: { kind: string; detail: string; trap?: string }[];
  coverage: { collapsibles: number; views: number; texts: number; figures: number; formulas: number };
  collapsiblesOnPage: number;
}

async function execute(input: GateInput): Promise<BrowserRun> {
  const pages = sitePages(input);
  if (pages.length === 0) throw new Error("no built page in scope for the browsers to open");
  const served = input.siteUrl === undefined ? await serveSite(input.distDir ?? "") : undefined;
  const base = (input.siteUrl ?? served?.url ?? "").replace(/\/$/, "");
  const observations: Observation[] = [];
  const observe = (o: Observation) => observations.push(o);
  const coverage = {
    layout: {
      browsers: 0,
      widths: WIDTHS.length,
      pages: pages.length,
      sweeps: 0,
      collapsibles: 0,
      views: 0,
      texts: 0,
      figures: 0,
    },
    live: { pages: pages.length, sweeps: 0, texts: 0, formulas: 0 },
    hydration: { pages: pages.length, islands: 0, controls: 0 },
    touch: { pages: 0, widths: 0, taps: 0 },
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
      const sweeps = routes.map((route) => () => sweepPage(browser, name, `${base}${route}`, route));
      const touches = pages.flatMap(({ route }) =>
        TOUCH_WIDTHS.map((width) => () => touchPage(browser, name, width, `${base}${route}`, route)),
      );
      const [swept, touched] = await Promise.all([inTurns(sweeps, PAGES_AT_ONCE), inTurns(touches, PAGES_AT_ONCE)]);
      return { name, swept, touched };
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

  for (const { name, swept, touched } of results) {
    coverage.layout.browsers += 1;
    swept.forEach((result, i) => {
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
      coverage.touch.taps += result.taps;
    }
  }
  coverage.touch.pages = pages.length;
  coverage.touch.widths = TOUCH_WIDTHS.length;

  // Before hydration: the server's HTML is what a student meets first, and it must not offer a
  // control the island can't answer yet.
  for (const { route, path } of pages) {
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
      message: `the run missed the Trap page's ${TRAP_DEFECTS[defect]} (${wheres.join("; ")}), so it is void`,
    });
  }

  const findingsOf = (gate: BrowserGateId) => aggregate(observations.filter((o) => o.gate === gate));
  const { layout, live, hydration, touch, initial, trap } = coverage;
  return {
    gates: {
      "layout-sweep": { coverage: layout, findings: findingsOf("layout-sweep") },
      "live-page-scan": { coverage: live, findings: findingsOf("live-page-scan") },
      hydration: { coverage: hydration, findings: findingsOf("hydration") },
      touch: { coverage: touch, findings: findingsOf("touch") },
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
      `can't start Playwright's ${name}; install it with \`npx playwright install chromium webkit\`: ${(error as Error).message.split("\n")[0]}`,
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
        (el) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
            const check = () => {
              if (!el.hasAttribute("ssr")) {
                clearTimeout(timer);
                resolve();
              } else requestAnimationFrame(check);
            };
            check();
          }),
      );
    } catch {
      never.push((await island.getAttribute("component-url").catch(() => null)) ?? `island ${i + 1}`);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return never;
}

interface SweptPage {
  /** What the load and hydration saw, beside the sweeps. */
  observations: Observation[];
  sweeps: {
    where: string;
    observations: Observation[];
    collapsibles: number;
    views: number;
    texts: number;
    figures: number;
    formulas: number;
  }[];
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
    page.on("pageerror", (error) => errors.push(error.message.split("\n")[0] ?? ""));
    const loaded: { url: string; body: Promise<string> }[] = [];
    let initial = true;
    page.on("response", (response) => {
      if (!initial) return;
      const type = response.request().resourceType();
      const body =
        type === "script" || /\.(?:m?js|wasm)(?:[?#]|$)/.test(response.url()) ? response.text() : Promise.resolve("");
      loaded.push({ url: response.url(), body: body.catch(() => "") });
    });
    const response = await page.goto(url, { waitUntil: "load" });
    if (!response || response.status() >= 400) return "missing";
    await page.waitForTimeout(300);
    initial = false;
    for (const { url: fetched, body } of loaded) {
      const text = await body;
      for (const library of HEAVY_LIBRARIES) {
        if (library.url.test(new URL(fetched).pathname) || library.body.test(text)) {
          observe({
            gate: "initial-load",
            route,
            where: name,
            kind: "heavy-library",
            detail: `${library.name} loads with the page (${new URL(fetched).pathname}); load it when opened or scrolled to`,
          });
        }
      }
    }

    const unhydrated = await hydrate(page);
    for (const island of unhydrated) {
      observe({
        gate: "hydration",
        route,
        where: name,
        kind: "never-hydrated",
        detail: `the island ${island} never hydrated`,
      });
    }
    // Hydrating renders the server's HTML again; the island turns its controls on in an effect
    // just after, so give it a moment before calling a control dead.
    const islands = await page.evaluate(async (selector) => {
      const outermost = [...document.querySelectorAll("astro-island:not([ssr])")].filter(
        (island) => !island.parentElement?.closest("astro-island"),
      );
      const count = (island: Element) => {
        const controls = [...island.querySelectorAll<HTMLButtonElement>(selector)];
        return { controls: controls.length, enabled: controls.filter((c) => !c.disabled).length };
      };
      const deadline = performance.now() + 5_000;
      while (outermost.some((i) => count(i).controls > 0 && count(i).enabled === 0) && performance.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      return outermost.map((island) => ({
        island: island.getAttribute("component-url") ?? "an island",
        ...count(island),
      }));
    }, ISLAND_CONTROLS);
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

    const sweeps: SweptPage["sweeps"] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: heightFor(width) });
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await (window as unknown as { __lpSweep: { settle(): Promise<void> } }).__lpSweep.settle();
      });
      const actual = await page.evaluate(() => window.innerWidth);
      if (actual !== width) {
        throw new Error(
          `asked ${name} for a ${width}px viewport and the page has ${actual}px, so the sweep can't be trusted`,
        );
      }
      sweeps.push(toSweep(await sweepNow(page), route, `${name} ${width}px`));
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
    return { observations, sweeps, islands: islands.length, requests: loaded.length };
  } finally {
    await context.close();
  }
}

const sweepNow = (page: Page) =>
  page.evaluate(() => (window as unknown as { __lpSweep: { sweep(): Promise<PageSweep> } }).__lpSweep.sweep());

function toSweep(result: PageSweep, route: string, where: string): SweptPage["sweeps"][number] {
  const observations: Observation[] = [
    ...result.layout.map((f) => ({ gate: "layout-sweep" as const, route, where, ...f })),
    ...result.text.map((f) => ({ gate: "live-page-scan" as const, route, where, ...f })),
  ];
  return {
    where,
    observations,
    collapsibles: result.collapsiblesOnPage,
    views: result.coverage.views,
    ...pick(result.coverage),
  };
}

const pick = ({ texts, figures, formulas }: PageSweep["coverage"]) => ({ texts, figures, formulas });

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
): Promise<{ observations: Observation[]; taps: number }> {
  const observations: Observation[] = [];
  const observe = (o: Observation) => observations.push(o);
  const where = `${name} ${width}px touch`;
  const context: BrowserContext = await siteContext(browser, url, {
    viewport: { width, height: heightFor(width) },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  let taps = 0;
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message.split("\n")[0] ?? ""));
    if (name === "chromium") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await page.goto(url, { waitUntil: "load" });
    await hydrate(page);
    await page.evaluate(() => {
      const w = window as unknown as { __lpMutations: number };
      w.__lpMutations = 0;
      new MutationObserver((records) => {
        w.__lpMutations += records.length;
      }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    for (let round = 0; round < 200; round++) {
      const next = await page.evaluate((selector) => {
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
        const field = candidates.find((el) => el.matches("input, textarea"));
        const el = field ?? candidates[0];
        if (!el) return null;
        el.setAttribute("data-lp-tapped", "");
        const id = String(document.querySelectorAll("[data-lp-tapped]").length);
        el.setAttribute("data-lp-control", id);
        const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
        return {
          id,
          field: el.matches("input, textarea"),
          name: `<${el.tagName.toLowerCase()}> "${label.replace(/\s+/g, " ").trim().slice(0, 32)}"`,
        };
      }, CONTROLS);
      if (!next) break;
      const control = page.locator(`[data-lp-control="${next.id}"]`);
      const before = await page.evaluate(() => (window as unknown as { __lpMutations: number }).__lpMutations);
      taps += 1;
      try {
        await control.tap({ timeout: 5_000 });
      } catch (error) {
        const why = (error as Error).message.split("\n").find((line) => /intercepts|not visible|outside/.test(line));
        observe({
          gate: "touch",
          route,
          where,
          kind: "untappable",
          detail: `${next.name} can't be tapped${why ? `: ${why.trim()}` : ""}`,
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
            detail: `typing into ${next.name} after a tap did nothing`,
          });
        continue;
      }
      const changed = await page
        .waitForFunction((count) => (window as unknown as { __lpMutations: number }).__lpMutations > count, before, {
          timeout: 2_000,
        })
        .then(() => true)
        .catch(() => false);
      if (!changed)
        observe({ gate: "touch", route, where, kind: "dead-tap", detail: `a tap on ${next.name} changed nothing` });
    }
    for (const error of errors) {
      observe({ gate: "touch", route, where, kind: "page-error", detail: `an uncaught error while tapping: ${error}` });
    }
    // The state every tap left: answers shown, steps taken, folds opened.
    await page.evaluate(() => window.scrollTo(0, 0));
    toSweep(await sweepNow(page), route, `${where} end state`).observations.forEach(observe);
  } finally {
    await context.close();
  }
  return { observations, taps };
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
      if (["button", "input", "textarea", "select"].includes(child.tagName) && !hidden) found.push(child);
      visit(child);
    }
  };
  visit(island);
  return found;
}

function describeHast(el: HastElement): string {
  const text = (node: HastElement): string =>
    node.children.map((c) => (c.type === "text" ? c.value : c.type === "element" ? text(c) : "")).join("");
  const label = typeof el.properties.ariaLabel === "string" ? el.properties.ariaLabel : text(el);
  const shown = label.replace(/\s+/g, " ").trim().slice(0, 32);
  return `<${el.tagName}>${shown ? ` "${shown}"` : ""}`;
}
