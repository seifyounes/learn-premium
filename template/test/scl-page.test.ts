// The SCL sim where students meet it: inline in the Fixture Course's Worked example W09.1, opened on
// the example's values with one scan run, then in a real browser (Chromium): it steps a statement
// or runs a scan, its build steps show as walkthrough tabs (a syntax fragment as static code), the
// Divergence marks its line only, and the layout holds: on a phone the pinned Step bar never lies
// over the listing, and at 1280×800 the watch table (the SCL sim's register table) stays on screen.
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "09-silo-blender";
const build = buildCourse(FIXTURE_COURSE);

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

describe("the SCL sim on the built page", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  const sim = () => {
    const page = build.page(MODULE);
    return page.slice(page.indexOf(`id="sim-${MODULE}-blender"`));
  };

  it("sits inline in W09.1, opened on the example's values with one scan run, its keys off until hydrated", () => {
    expect(sim()).toMatch(/component-url="\/_astro\/SclSim\.[^"]+\.js"[^>]*client="visible"/);
    const watch = [
      ...sim().matchAll(
        /<tr[^>]*><td class="stl-td text-graphite">([^<]+)<\/td><td class="stl-td stl-value text-graphite">([^<]+)<\/td>/g,
      ),
    ].map((m) => `${m[1]} = ${m[2]}`);
    expect(watch.slice(0, 6)).toEqual([
      "step = 0",
      "valve = 0",
      "total_kg = 312.5",
      "fill_pct = 97.65625",
      "bags = 12",
      "mixer = FALSE",
    ]);
    expect(textOf(sim())).toMatch(/Scan 1 · statement (\d+) of \1/);
    for (const button of [...sim().matchAll(/<button[^>]*>/g)].map((m) => m[0]).slice(0, 8))
      expect(button).toContain("disabled");
  });

  it("marks the one line the Owner ruled a Divergence on, and no other", () => {
    const marked = [...sim().matchAll(/<li class="stl-line"[^>]*data-divergence="true"[^>]*><span[^>]*>(\d+)</g)];
    expect(marked.map((m) => m[1])).toEqual(["66"]);
  });

  it("opens on the final listing, with a tab for each build step before it", () => {
    const tabs = [
      ...sim().matchAll(/<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>([\s\S]*?)<\/button>/g),
    ];
    expect(tabs.map((t) => [textOf(t[2] ?? ""), t[1]])).toEqual([
      ["Build 1The data", "false"],
      ["Build 2Weighing every silo", "false"],
      ["Build 3The batch sequence", "false"],
      ["The final listing, running", "true"],
    ]);
  });
});

describe("the SCL sim in a browser", () => {
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

  async function open(width: number): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 812 : 800 },
      hasTouch: width < 768,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${site.url}/${MODULE}/`);
    await page.locator('[data-sim="scl"]').scrollIntoViewIfNeeded();
    await page.locator('[data-sim="scl"][data-ready="true"]').waitFor();
    return { page, errors };
  }
  const sim = (page: Page) => page.locator('[data-sim="scl"]');
  const press = (page: Page, name: string) => sim(page).getByRole("button", { name, exact: true }).click();
  const counter = (page: Page) => sim(page).locator(".stl-counter").innerText();
  const statement = (page: Page) => sim(page).locator(".stl-statement").innerText();
  const watch = async (page: Page, path: string) =>
    (await sim(page).locator(".scl-watch tr", { hasText: path }).first().innerText()).split(/\s+/).at(-1);
  /** Steps until the statement being read is on `line`. */
  async function stepTo(page: Page, line: number) {
    for (let i = 0; i < 60; i++) {
      await press(page, "Step");
      if ((await statement(page)).match(new RegExp(`^Statement\\s+${line}\\s`, "i"))) return;
    }
    throw new Error(`never reached line ${line}`);
  }

  it("steps a statement at a time: a new scan starts with what the block's first statement wrote", async () => {
    const { page, errors } = await open(1280);
    await press(page, "Step");
    expect(await counter(page)).toContain("Scan 2 · statement 1");
    expect(await statement(page)).toMatch(/54\s+"Recipe"\.silo\[1\]\.raw := raw1;/);
    expect(await sim(page).locator(".stl-written").innerText()).toContain("Recipe.silo[1].raw := 6480");
    await stepTo(page, 59);
    expect(await statement(page)).toContain("→ into the loop");
    expect(await sim(page).locator(".stl-line[data-current] .stl-number").innerText()).toBe("59");
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("shows the Professor's exam answer and the red-pen note on the Divergence line, and only there", async () => {
    const { page, errors } = await open(1280);
    await stepTo(page, 66);
    const ruling = sim(page).locator(".scl-ruling");
    expect(await ruling.count()).toBe(1);
    expect(await ruling.locator(".scl-exam").innerText()).toMatch(
      /^Exam answer, line 66\s[\s\S]*bags, the Professor rounding/i,
    );
    expect(await ruling.locator(".scl-red-pen").innerText()).toMatch(/A real S7 rounds a tie to the even number/i);
    expect(await watch(page, "bags")).toBe("12");
    expect(await sim(page).locator(".stl-trace tr[data-divergence]").count()).toBe(1);
    await press(page, "Step");
    expect(await sim(page).locator(".scl-ruling").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("shows each build step's lines in its tab, and a syntax fragment as static code that never runs", async () => {
    const { page, errors } = await open(1280);
    await sim(page)
      .getByRole("tab", { name: /Build 3/ })
      .click();
    const fragment = sim(page).locator(".scl-fragment");
    expect(await fragment.innerText()).toMatch(/Syntax only: not run\s+CASE selector OF/i);
    expect(await sim(page).locator(".stl-line[data-added]").count()).toBe(25);
    expect(await sim(page).locator(".stl-line[data-current], .stl-line[data-ran]").count()).toBe(0);
    await sim(page)
      .getByRole("tab", { name: /Build 1/ })
      .click();
    // Lines 1 to 20, and the blank lines no build step names.
    expect(await sim(page).locator(".stl-line").count()).toBe(22);
    expect(await sim(page).locator(".stl-line[data-added]").count()).toBe(20);
    expect(await sim(page).locator(".scl-fragment").count()).toBe(0);
    // Stepping goes back to the running listing.
    await press(page, "Step");
    expect(await sim(page).getByRole("tab", { name: "The final listing, running" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(await sim(page).locator(".stl-line[data-current]").count()).toBe(1);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("runs a batch on new inputs: start rises, the first short silo doses", async () => {
    const { page, errors } = await open(1280);
    await sim(page)
      .getByRole("button", { name: /^start/ })
      .click();
    expect(await counter(page)).toContain("new inputs from the next scan");
    await press(page, "Run a scan");
    expect(await watch(page, "step")).toBe("1");
    await sim(page)
      .getByRole("button", { name: /^start/ })
      .click();
    await press(page, "Run a scan");
    expect(await watch(page, "valve")).toBe("1");
    await press(page, "Reset");
    expect(await watch(page, "step")).toBe("0");
    expect(errors).toEqual([]);
    await page.context().close();
  });

  /**
   * Scrolls the page through the sim and reports every position where the pinned Step bar lies over
   * the listing box (or slips under the Module page's pinned section tabs), and how often it pinned.
   */
  const sweep = (page: Page) =>
    page.evaluate(async () => {
      const bar = document.querySelector<HTMLElement>(".scl-bar");
      const listing = document.querySelector<HTMLElement>(".scl-listing");
      const grid = document.querySelector<HTMLElement>(".scl-grid");
      const rail = document.querySelector<HTMLElement>(".section-rail");
      if (!bar || !listing || !grid) throw new Error("no SCL sim");
      const covers: string[] = [];
      let pinned = 0;
      const top = grid.getBoundingClientRect().top + window.scrollY - window.innerHeight;
      const bottom = grid.getBoundingClientRect().bottom + window.scrollY;
      for (let y = Math.max(0, top); y <= bottom; y += 24) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const b = bar.getBoundingClientRect();
        const l = listing.getBoundingClientRect();
        const railBottom = rail ? rail.getBoundingClientRect().bottom : 0;
        if (b.top <= railBottom + 2 && b.bottom > 0) pinned += 1;
        const overlap = Math.min(b.bottom, l.bottom, window.innerHeight) - Math.max(b.top, l.top, 0);
        const across = Math.min(b.right, l.right) - Math.max(b.left, l.left);
        if (overlap > 1 && across > 1) covers.push(`at ${y}px the bar covers ${Math.round(overlap)}px of the listing`);
        if (b.top < railBottom - 1 && b.bottom > 0) covers.push(`at ${y}px the bar slips under the section tabs`);
      }
      return { covers, pinned };
    });

  it("on a phone, pins the Step bar under the section tabs once the listing scrolls past, never over the listing", async () => {
    const { page, errors } = await open(375);
    const { covers, pinned } = await sweep(page);
    expect(covers).toEqual([]);
    expect(pinned).toBeGreaterThan(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("(negative control) sees a Step bar pinned above the listing cover it, as the prototype's did", async () => {
    const { page } = await open(375);
    await page.addStyleTag({
      content: '.scl-grid { grid-template-areas: "inputs" "bar" "source" "state" !important; }',
    });
    expect((await sweep(page)).covers.length).toBeGreaterThan(0);
    await page.context().close();
  });

  /** How far below the screen's bottom edge the watch table ends, scrolled to the sim's top, on the Divergence line. */
  async function belowTheFold(page: Page): Promise<number> {
    await stepTo(page, 66);
    expect(await sim(page).locator(".scl-ruling").count()).toBe(1);
    return page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".scl-grid");
      const table = document.querySelector<HTMLElement>(".scl-watch");
      if (!grid || !table) throw new Error("no SCL sim");
      window.scrollTo(0, grid.getBoundingClientRect().top + window.scrollY);
      return table.getBoundingClientRect().bottom - window.innerHeight;
    });
  }

  it("at 1280×800 keeps the watch table on screen, a Divergence's ruling showing too", async () => {
    const { page, errors } = await open(1280);
    expect(await belowTheFold(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("(negative control) sees the watch table fall below the fold when the listing is stacked above it", async () => {
    const { page } = await open(1280);
    await page.addStyleTag({
      content:
        '.scl-grid { grid-template-columns: minmax(0, 1fr) !important; grid-template-areas: "inputs" "source" "bar" "state" !important; }',
    });
    expect(await belowTheFold(page)).toBeGreaterThan(0);
    await page.context().close();
  });
});
