// The Nernst sim where students meet it: inline in W13.1 on Module 13, in the Lab and in the Tool
// gallery, on the built Fixture Course; then in a real browser (Chromium): the 3D cell opens first
// and three.js stays out of the initial load, sliding c1 past c2 turns the electrons, the anode and
// the voltmeter's sign round, no current at equal concentrations, reduced motion leaves the arrows
// alone, the plot draws at most four isotherms in ink, and a phone keeps the page from scrolling sideways.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "13-cell-potential";
const build = buildCourse(FIXTURE_COURSE);
const CARD = `id="sim-${MODULE}-cell"`;
const isThree = (url: string, body = "") => /three/i.test(new URL(url).pathname) || body.includes("WebGLRenderer");

/** A Worked example's article on a built page, with the sim card that follows it. */
const articleOf = (page: string, code: string) => {
  const start = page.indexOf(`<article id="worked-${code}"`);
  const next = page.indexOf('<article id="worked-', start + 1);
  return start < 0 ? "" : page.slice(start, next < 0 ? undefined : next);
};

describe("the Nernst sim on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sits below W13.1, once in the Lab and once in the Tool gallery", () => {
    const article = articleOf(build.page(MODULE), "W13.1");
    expect(article).toContain(CARD);
    expect(article).toContain('data-sim-kind="nernst"');
    expect(article).toContain('data-recompute="independent"');
    for (const route of ["lab", "tool-gallery"]) expect(build.page(route).match(new RegExp(CARD, "g"))).toHaveLength(1);
  });

  it("is a client:visible island, every slider, tab and toggle disabled until it hydrates", () => {
    const article = articleOf(build.page(MODULE), "W13.1");
    expect(article).toMatch(/component-url="\/_astro\/NernstSim\.[^"]+\.js"[^>]*client="visible"/);
    const sim = article.slice(article.indexOf('class="sim nernst"'));
    const controls = [...sim.matchAll(/<(?:input|button)[^>]*>/g)]
      .map((m) => m[0])
      .filter((c) => !/aria-label="Reset/.test(c));
    // Three sliders, two tabs, Back to the example, five toggles and the cell's Reset view.
    expect(controls.filter((c) => c.includes('type="range"'))).toHaveLength(3);
    expect(controls.filter((c) => c.includes('role="tab"'))).toHaveLength(2);
    expect(controls.filter((c) => c.includes("data-series="))).toHaveLength(5);
    for (const control of controls) expect(control, control).toContain("disabled");
  });

  it("is server-rendered on the example's values: the electrons run first to second, the voltmeter reads 0.0592", () => {
    const sim = articleOf(build.page(MODULE), "W13.1");
    expect(sim).toContain('data-electron-flow="first-to-second"');
    expect(sim).toContain('data-e="0.0592"');
    expect(sim).toContain('data-view="cell"');
    // The cell as written, set by mhchem.
    expect(sim).toContain("data-cell-notation");
    expect(sim).toContain("\\ce{Cu | Cu^2+ || Cu^2+ | Cu}");
    expect(sim).not.toContain("katex-error");
    expect(sim).not.toContain("data-viewer>");
  });

  it("keeps three.js out of the island's static imports: the viewer loads it after first paint", () => {
    const island = /component-url="\/_astro\/(NernstSim\.[^"]+\.js)"/.exec(build.page(MODULE))?.[1] ?? "";
    const code = readFileSync(join(build.outDir, "_astro", island), "utf8");
    expect(code).not.toContain("WebGLRenderer");
    const staticImports = [...code.matchAll(/^import[^;]*from["'`]\.\/([^"'`]+)["'`]/gm)].map((m) => m[1] ?? "");
    for (const file of staticImports) {
      expect(file, "a static import of three.js").not.toMatch(/three|stage|cell-scene/i);
      expect(readFileSync(join(build.outDir, "_astro", file), "utf8"), file).not.toContain("WebGLRenderer");
    }
  });
});

describe("the Nernst sim in a browser", () => {
  let site: Awaited<ReturnType<typeof serve>>;
  let browser: Browser;

  beforeAll(async () => {
    site = await serve(build.outDir);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  async function open(context: BrowserContext, route = `/${MODULE}/`) {
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    // The scripts the page fetched: three.js sits in a hashed chunk, known by what it holds.
    const scripts: Promise<string>[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    page.on("response", (r) => {
      if (r.url().endsWith(".js")) scripts.push(r.text().catch(() => ""));
    });
    await page.goto(`${site.url}${route}`, { waitUntil: "load" });
    /** Whether three.js has been fetched so far. */
    const threeFetched = async () => (await Promise.all(scripts)).some((body) => body.includes("WebGLRenderer"));
    return { page, errors, requests, threeFetched };
  }

  const sim = (page: Page) => page.locator('[data-sim="nernst"]').first();
  const label = (page: Page, anchor: string) => sim(page).locator(`[data-cell-label="${anchor}"]`);
  /** A label's words, with its no-break spaces read as spaces. */
  const words = async (page: Page, anchor: string) =>
    ((await label(page, anchor).textContent()) ?? "").replaceAll(" ", " ");
  const slider = (page: Page, i: number) => sim(page).locator('input[type="range"]').nth(i);
  async function drawn(page: Page) {
    await sim(page).scrollIntoViewIfNeeded();
    await sim(page).locator('[data-viewer-state="drawn"]').waitFor({ timeout: 60_000 });
    // The labels hang once the first frame is drawn.
    await label(page, "first-electrode").waitFor({ timeout: 15_000 });
  }

  it("opens on the Cell tab, three.js out of the initial load and fetched once the cell is on screen", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors, requests, threeFetched } = await open(context);
    await page.waitForTimeout(500);
    expect(requests.filter((u) => isThree(u))).toEqual([]);
    expect(await threeFetched()).toBe(false);
    await expect(sim(page).getByRole("tab", { name: "Cell" }).getAttribute("aria-selected")).resolves.toBe("true");
    await drawn(page);
    expect(await threeFetched()).toBe(true);
    expect(await sim(page).getAttribute("data-view")).toBe("cell");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("labels the cell at the start: the first electrode the anode, the voltmeter at 0.0592", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    await drawn(page);
    expect(await words(page, "first-electrode")).toBe("Cu, anode (−)");
    expect(await words(page, "second-electrode")).toBe("Cu, cathode (+)");
    expect(await words(page, "voltmeter")).toBe("E = 0.0592 V");
    expect(await words(page, "first-solution")).toBe("Cu²⁺ 0.010 M");
    expect(await sim(page).getAttribute("data-electron-flow")).toBe("first-to-second");
    await context.close();
  });

  it("sliding c1 past c2 reverses the cell", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    await drawn(page);
    await slider(page, 0).fill("1.5");
    await expect.poll(() => sim(page).getAttribute("data-electron-flow")).toBe("second-to-first");
    expect(await words(page, "first-electrode")).toBe("Cu, cathode (+)");
    expect(await words(page, "second-electrode")).toBe("Cu, anode (−)");
    expect(await words(page, "voltmeter")).toBe("E = −0.0052 V");
    expect(await words(page, "wire")).toBe("← e⁻");
    expect(await sim(page).getAttribute("data-e")).toBe("−0.0052");

    // Equal concentrations: no current, no anode, no electrons.
    await slider(page, 0).fill("1");
    await expect.poll(() => sim(page).getAttribute("data-electron-flow")).toBe("none");
    expect(await words(page, "first-electrode")).toBe("Cu, no current");
    expect(await words(page, "wire")).toBe("no current");
    await expect.poll(() => sim(page).locator(".cell-viewer").getAttribute("data-particles")).toBe("none");

    // And back to the example.
    await sim(page).getByRole("button", { name: "Back to the example" }).click();
    await expect.poll(() => sim(page).getAttribute("data-electron-flow")).toBe("first-to-second");
    expect(await words(page, "first-electrode")).toBe("Cu, anode (−)");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("under reduced motion the electrons are static arrows", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    await drawn(page);
    const cell = sim(page).locator(".cell-viewer");
    await expect.poll(() => cell.getAttribute("data-particles")).toBe("moving");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => cell.getAttribute("data-particles")).toBe("static");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => cell.getAttribute("data-particles")).toBe("moving");
    await context.close();
    // Opened already reduced: the cell opens still.
    const still = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const { page: stilled } = await open(still);
    await drawn(stilled);
    expect(await sim(stilled).locator(".cell-viewer").getAttribute("data-particles")).toBe("static");
    await still.close();
  });

  it("the plot never draws more than four isotherms in ink", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await open(context);
    await sim(page).scrollIntoViewIfNeeded();
    await sim(page).getByRole("tab", { name: "Plot" }).click();
    const toggles = sim(page).locator("button.series-toggle");
    await expect.poll(() => toggles.count()).toBe(5);
    expect(await toggles.evaluateAll((l) => l.filter((b) => b.getAttribute("aria-pressed") === "true").length)).toBe(4);
    const shown = () => sim(page).locator('path[data-series][data-shown="true"]').count();
    await expect.poll(shown).toBe(4);
    expect(await sim(page).locator("[data-operating-point]").count()).toBe(1);
    // Showing the fifth dims the one drawn longest: still four.
    await toggles.filter({ hasText: "348.15 K" }).click();
    await expect.poll(() => sim(page).locator('path[data-series="T=273.15"]').getAttribute("data-shown")).toBe("false");
    expect(await shown()).toBe(4);
    expect(await toggles.evaluateAll((l) => l.filter((b) => b.getAttribute("aria-pressed") === "true").length)).toBe(4);
    // Every line carries its label at its end, drawn lines only.
    expect(await sim(page).locator(".sim-board-label", { hasText: " K" }).count()).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual([]);
    await context.close();
  });

  /** The plot's board: its stage and its svg, with the widths they have now. */
  const boardWidths = (page: Page) =>
    sim(page).evaluate((root) => {
      const stage = root.querySelector('.sim-stage[data-board="nernst"]') as HTMLElement;
      const svg = stage.querySelector("svg") as SVGSVGElement;
      return { stage: stage.clientWidth, svg: svg.getBoundingClientRect().width };
    });
  /** The region names that lie on a drawn ellipse of the plot's svg (a point's marker). */
  const labelsOnMarkers = (page: Page) =>
    sim(page).evaluate((root) => {
      const svg = root.querySelector('.sim-stage[data-board="nernst"] svg') as SVGSVGElement;
      const hits: string[] = [];
      for (const label of root.querySelectorAll("[data-region]")) {
        const r = label.getBoundingClientRect();
        for (const e of svg.querySelectorAll("ellipse")) {
          const b = e.getBoundingClientRect();
          if (b.width > 0 && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom)
            hits.push(`${(label.textContent ?? "").trim()} on a marker at ${Math.round(b.left)},${Math.round(b.top)}`);
        }
      }
      return hits;
    });

  it("keeps the plot's board the size of its stage when the stage changes twice in one frame", async () => {
    // JSXGraph watches the stage itself and applies the size it saw 10 ms later, dropping a second change
    // that arrives while it waits: so it set the board back to the first size after the island had set the last,
    // and on a slow runner the board sat at the wrong size when the layout sweep looked. Its 10 ms timer is held
    // here until the island has answered both changes, then let go: a board that answers only the island stays put.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const { page, errors } = await open(context);
    await sim(page).scrollIntoViewIfNeeded();
    await sim(page).getByRole("tab", { name: "Plot" }).click();
    await sim(page).locator('path[data-series][data-shown="true"]').first().waitFor();
    // Let JSXGraph answer the board's first size before the second change comes.
    await page.waitForTimeout(500);
    const before = await boardWidths(page);
    expect(before.svg).toBe(before.stage);
    await sim(page).evaluate(async (root) => {
      const stage = root.querySelector('.sim-stage[data-board="nernst"]') as HTMLElement;
      const held: (() => void)[] = [];
      const real = window.setTimeout.bind(window);
      (window as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number) =>
        ms === 10 ? held.push(fn) : real(fn, ms);
      let first = true;
      const second = new ResizeObserver(() => {
        if (!first) return;
        first = false;
        stage.style.width = "250px";
      });
      second.observe(stage);
      stage.style.width = "340px";
      await new Promise((done) => real(done, 400));
      second.disconnect();
      (window as unknown as { setTimeout: unknown }).setTimeout = real;
      for (const fn of held) fn();
      await new Promise((done) => real(done, 100));
    });
    const after = await boardWidths(page);
    expect(after.stage).toBe(250);
    expect(after.svg).toBe(250);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("keeps the region names clear of the plot's markers at 390px, after the plot was opened and left at other widths", async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 844 } });
    const { page, errors } = await open(context);
    await sim(page).scrollIntoViewIfNeeded();
    await sim(page).getByRole("tab", { name: "Plot" }).waitFor();
    // As the layout sweep goes: open the plot, leave it at once, change width, open it again.
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await sim(page).getByRole("tab", { name: "Plot" }).click();
      await sim(page).getByRole("tab", { name: "Cell" }).click();
    }
    await sim(page).getByRole("tab", { name: "Plot" }).click();
    await sim(page).locator('path[data-series][data-shown="true"]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await boardWidths(page)).toEqual({ stage: 356, svg: 356 });
    expect(await sim(page).locator("[data-region]").count()).toBe(2);
    expect(await labelsOnMarkers(page)).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("on a phone keeps the page from scrolling sideways, on both tabs, every label 12px or more", async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const { page, errors } = await open(context);
    await drawn(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const small = await sim(page)
      .locator(".viewer-label")
      .evaluateAll((l) => l.map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((px) => px < 12));
    expect(small).toEqual([]);
    await sim(page).getByRole("tab", { name: "Plot" }).click();
    await sim(page).locator("button.series-toggle").first().waitFor();
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await context.close();
  });
});
