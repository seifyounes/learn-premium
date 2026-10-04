// The Agent-built sim where students meet it: inline in its Worked example, in the Lab and in the
// Tool gallery, on the built Fixture Course. Then in a real browser (Chromium): it hydrates, loads
// JSXGraph only once it is on screen, holds its layout at every slider's min, mid and max, and
// takes a drag by touch on a phone without trapping the page's scroll.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "03-gradient-descent";
const build = buildCourse(FIXTURE_COURSE);

/** The `<article>` holding a Worked example (by its code) on a built page. */
const articleOf = (page: string, code: string) =>
  page.split('<article class="mbe-10"').find((a) => a.includes(`&quot;code&quot;:[0,&quot;${code}&quot;]`)) ?? "";

describe("the sim on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sits inline in its Worked example, opened on the example's values, its controls off until hydrated", () => {
    const article = articleOf(build.page(MODULE), "W03.1");
    expect(article).toMatch(/component-url="\/_astro\/GradientDescentSim\.[^"]+\.js"[^>]*client="visible"/);
    // The first render is the example's table, at the sheet's 4 decimals.
    const rows = [...article.matchAll(/<tr class="h-\[29px\]" data-row="(\d+)">([\s\S]*?)<\/tr>/g)].map((m) =>
      [...(m[2] ?? "").matchAll(/>([−\d.]+)<\/(?:span|td)>/g)].map((c) => c[1]),
    );
    expect(rows).toEqual([
      ["0", "0.0000", "0.0000", "4.3333"],
      ["1", "0.2667", "0.3667", "2.5231"],
      ["2", "0.4700", "0.6456", "1.4741"],
    ]);
    const sliders = [...article.matchAll(/<input[^>]*type="range"[^>]*>/g)].map((m) => m[0]);
    expect(sliders).toHaveLength(4);
    for (const slider of sliders) expect(slider).toContain("disabled");
    expect(sliders.map((s) => /value="([^"]+)"/.exec(s)?.[1])).toEqual(["0.1", "0", "0", "2"]);
  });

  it("labels its illustrative constants with their Provenance tag", () => {
    const article = articleOf(build.page(MODULE), "W03.1");
    const sim = article.slice(article.indexOf('class="sim-card"'));
    expect(sim).toMatch(
      /<dt class="field-label">Assumed<\/dt><dd><span class="provenance-gloss">supplied here, not in the Materials:/,
    );
    expect(sim).toContain("up to");
  });

  it("is in the Lab with every other tool, and in the Tool gallery once per kind beside a step-through", () => {
    const lab = build.page("lab");
    expect(lab.match(/class="sim-card"/g)).toHaveLength(3);
    const gallery = build.page("tool-gallery");
    expect(
      [...gallery.matchAll(/data-sim-kind="([^"]+)" data-recompute="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`),
    ).toEqual(["gradient-descent:independent", "logic:independent", "gradient-descent:none"]);
  });

  it("falls back to a step-through for a sim marked non-recomputable: no engine ships in it", () => {
    const lab = build.page("lab");
    const fallback = lab.slice(lab.indexOf('id="sim-03-gradient-descent-descent-steps"'));
    expect(fallback).toMatch(/component-url="\/_astro\/StepThrough\.[^"]+\.js"/);
    expect(fallback).not.toMatch(/GradientDescentSim/);
    expect(fallback).toContain("A step-through, not a live sim");
  });

  it("keeps JSXGraph out of the page: the sim's island imports it only when it runs", () => {
    const island = /component-url="\/_astro\/(GradientDescentSim\.[^"]+\.js)"/.exec(build.page(MODULE))?.[1] ?? "";
    const code = readFileSync(join(build.outDir, "_astro", island), "utf8");
    const staticImports = [...code.matchAll(/^import[^;]*from["'`]\.\/([^"'`]+)["'`]/gm)].map((m) => m[1] ?? "");
    const lazy = [...code.matchAll(/import\(["'`]\.\/([^"'`]+)["'`]\)/g)].map((m) => m[1] ?? "");
    expect(lazy.length).toBeGreaterThan(0);
    const jsxgraph = lazy.filter((f) => readFileSync(join(build.outDir, "_astro", f), "utf8").includes("JSXGraph"));
    expect(jsxgraph).toHaveLength(1);
    expect(staticImports).not.toContain(jsxgraph[0]);
    expect(build.page(MODULE)).not.toContain(jsxgraph[0]);
  });
});

describe("the sim in a browser", () => {
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

  /** A page that fails the test on any console error or uncaught exception. */
  async function open(
    context: BrowserContext,
    route: string,
  ): Promise<{ page: Page; errors: string[]; requests: string[] }> {
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`${site.url}/${route}/`);
    return { page, errors, requests };
  }

  const sim = (page: Page) => page.locator('[data-sim="gradient-descent"]').first();
  const hydrated = async (page: Page) => {
    await sim(page).scrollIntoViewIfNeeded();
    await page
      .locator('[data-sim="gradient-descent"][data-ready="true"] [data-board="contours"] svg')
      .first()
      .waitFor();
  };
  const slider = (page: Page, i: number) => sim(page).locator('input[type="range"]').nth(i);
  const firstRow = (page: Page) => sim(page).locator('tbody tr[data-row="0"]').innerText();

  it("loads JSXGraph only once the sim is on screen, then draws it in the pad's inks", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors, requests } = await open(context, MODULE);
    await page.waitForLoadState("networkidle");
    const before = requests.filter((u) => u.includes("/_astro/"));
    await hydrated(page);
    const after = requests.filter((u) => u.includes("/_astro/") && !before.includes(u));
    expect(after.some((u) => u.includes("GradientDescentSim"))).toBe(true);
    expect(after.length).toBeGreaterThan(1);
    // Every stroke JSXGraph drew is one of the pad's inks or slots.
    const inks = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const tokens = ["graphite", "pencil", "sheet", "grid-major"].map((t) =>
        style.getPropertyValue(`--color-${t}`).trim().toLowerCase(),
      );
      // What is drawn: JSXGraph keeps hidden helpers (an axis's defining points) in its own colours.
      const drawn = [...document.querySelectorAll("[data-board] svg *")].filter(
        (e) => e.getAttribute("display") !== "none" && getComputedStyle(e).visibility !== "hidden",
      );
      const paint = (e: Element, attribute: "stroke" | "fill") =>
        Number(e.getAttribute(`${attribute}-opacity`) ?? 1) > 0 ? (e.getAttribute(attribute) ?? "") : "";
      const used = drawn
        .flatMap((e) => [paint(e, "stroke"), paint(e, "fill")])
        .map((c) => c.toLowerCase())
        .filter((c) => c !== "" && c !== "none" && c !== "transparent");
      return { tokens, used: [...new Set(used)] };
    });
    expect(inks.used.length).toBeGreaterThan(0);
    for (const colour of inks.used) expect(inks.tokens).toContain(colour);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("holds its layout at every slider's min, mid and max, and says when α diverges", async () => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      const context = await browser.newContext({ viewport });
      const { page, errors } = await open(context, "tool-gallery");
      await hydrated(page);
      for (let i = 0; i < 4; i++) {
        const input = slider(page, i);
        const [min, max, step] = await Promise.all(["min", "max", "step"].map((a) => input.getAttribute(a)));
        const mid = Number(min) + Math.round((Number(max) - Number(min)) / 2 / Number(step)) * Number(step);
        for (const value of [Number(min), mid, Number(max)]) {
          await input.fill(String(value));
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow, `${viewport.width}px, slider ${i} at ${value}`).toBeLessThanOrEqual(0);
          expect(await sim(page).locator("tbody").innerText()).not.toMatch(/NaN|Infinity/);
        }
        await sim(page).getByRole("button", { name: "Back to the example" }).click();
      }
      await slider(page, 0).fill("1");
      await expect.poll(() => sim(page).locator(".sim-warning").innerText()).toMatch(/is past 0\.84, the largest/);
      expect(errors).toEqual([]);
      await context.close();
    }
  });

  it("opens on the example, lands one more step and rings the new θ", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, MODULE);
    await hydrated(page);
    await sim(page).getByRole("button", { name: "One more step" }).click();
    const row = sim(page).locator('tbody tr[data-row="3"]');
    expect((await row.innerText()).split(/\s+/)).toEqual(["3", "0.6251", "0.8576", "0.8662"]);
    await expect.poll(() => row.locator("svg path").count()).toBe(2);
    expect(await sim(page).locator('tbody tr[data-row="2"] svg').count()).toBe(0);
    await context.close();
  });

  it("takes a drag of the start by touch on a phone, and lets a swipe off the start scroll the page", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const { page, errors } = await open(context, "tool-gallery");
    await hydrated(page);
    const cdp = await context.newCDPSession(page);
    // A mid-range phone: the spec's emulated touch runs at a 4× CPU slowdown.
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const touch = async (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const swipe = async (from: [number, number], to: [number, number]) => {
      await touch("touchStart", ...from);
      for (let i = 1; i <= 8; i++)
        await touch("touchMove", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8);
      await touch("touchEnd", ...to);
    };

    const handle = page.locator(".sim-handle").first();
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    if (!box) throw new Error("the start handle isn't drawn");
    const at: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
    const scrolled = await page.evaluate(() => window.scrollY);
    await swipe(at, [at[0] + 60, at[1] - 50]);
    await expect.poll(() => firstRow(page)).not.toMatch(/^0\s+0\.0000\s+0\.0000/);
    const [theta0, theta1] = await Promise.all([slider(page, 1).inputValue(), slider(page, 2).inputValue()]);
    expect(Number(theta0)).toBeGreaterThan(0);
    expect(Number(theta1)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY), "dragging the start doesn't scroll the page").toBe(scrolled);

    // A swipe that starts on the board away from the start scrolls the page instead.
    const board = await sim(page).locator('[data-board="contours"]').boundingBox();
    if (!board) throw new Error("the board isn't drawn");
    const empty: [number, number] = [board.x + board.width - 12, board.y + board.height / 2];
    await swipe(empty, [empty[0], empty[1] - 200]);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled + 50);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("steps through the fallback's figure, marks drawing in", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, "lab");
    const fallback = page.locator('[data-sim="step-through"]');
    await fallback.scrollIntoViewIfNeeded();
    await page.locator('[data-sim="step-through"][data-ready="true"]').waitFor();
    const points = () => fallback.locator(".plot-point").count();
    expect(await points()).toBe(2);
    await fallback.getByRole("button", { name: "Next" }).click();
    await expect.poll(points).toBe(3);
    expect(await fallback.innerText()).toContain("Step 2");
    await context.close();
  });
});

describe("the logic sim", () => {
  const LOGIC = "04-full-adder";
  const page = () => articleOf(build.page(LOGIC), "W04.1");

  it("sits inline in its Worked example: the figure redrawn at build, its controls off until hydrated", () => {
    const article = page();
    expect(article).toMatch(/component-url="\/_astro\/LogicSim\.[^"]+\.js"[^>]*client="visible"/);
    // The drawing is the layout core's, made at build: the server HTML already carries it.
    expect(article).toMatch(/<svg class="schematic" width="\d+" height="\d+"/);
    expect(article.match(/class="schematic-wire"/g)).toHaveLength(12);
    expect(article.match(/class="schematic-dot/g)).toHaveLength(4);
    for (const label of ["G1", "G2", "G3", "G4", "G5", "Cin", "Cout"]) expect(article).toContain(`>${label}</text>`);
    const buttons = [...article.matchAll(/<button[^>]*>/g)]
      .map((m) => m[0])
      .filter((b) => /logic-(?:row|input)/.test(b));
    // Three inputs and eight rows of the truth table, every one off until the island hydrates.
    expect(buttons).toHaveLength(3 + 8);
    for (const button of buttons) expect(button).toContain("disabled");
  });

  it("opens on the example's row, its high nets inked and its outputs read off", () => {
    const article = page();
    expect(article).toMatch(
      /<button[^>]*class="logic-row"[^>]*aria-current="true"[^>]*aria-label="Set A = 1, B = 0, Cin = 1"/,
    );
    expect(article).toContain('data-net="Cin"');
    expect(article).toContain('data-net="Cout"');
    expect(article).not.toContain('data-net="S"');
    const readout = /class="sim-readout"[^>]*>([\s\S]*?)<\/p>/.exec(article)?.[1]?.replace(/<[^>]*>/g, "");
    expect(readout).toBe("S = 0, Cout = 1");
  });

  describe("in a browser", () => {
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

    it("inks the nets a tapped row drives high, and scrolls a wide circuit inside its box on a phone", async () => {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 375, height: 812 },
      ]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768 });
        const tab = await context.newPage();
        const errors: string[] = [];
        tab.on("pageerror", (e) => errors.push(e.message));
        await tab.goto(`${site.url}/${LOGIC}/`);
        const sim = tab.locator('[data-sim="logic"]').first();
        await sim.scrollIntoViewIfNeeded();
        await tab.locator('[data-sim="logic"][data-ready="true"]').waitFor();
        const inked = () =>
          sim.locator(".schematic-wire.is-high").evaluateAll((w) => w.map((e) => e.getAttribute("data-net")));
        await sim.getByRole("button", { name: "Set A = 0, B = 0, Cin = 0" }).click();
        await expect.poll(inked).toEqual([]);
        await sim.getByRole("button", { name: "Set A = 1, B = 1, Cin = 1" }).click();
        await expect.poll(async () => [...new Set(await inked())].sort()).toEqual(["A", "AB", "B", "Cin", "Cout", "S"]);
        expect(await sim.locator(".sim-readout").innerText()).toBe("S = 1, Cout = 1");
        // An input key flips one bit: B to 0 leaves A ⊕ B high and the sum low.
        await sim.locator(".logic-input").nth(1).click();
        await expect.poll(() => sim.locator(".sim-readout").innerText()).toBe("S = 0, Cout = 1");
        const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${viewport.width}px`).toBeLessThanOrEqual(0);
        if (viewport.width < 768) {
          const stage = await sim.locator(".logic-stage").evaluate((e) => e.scrollWidth - e.clientWidth);
          expect(stage).toBeGreaterThan(0);
        }
        expect(errors).toEqual([]);
        await context.close();
      }
    });
  });
});
