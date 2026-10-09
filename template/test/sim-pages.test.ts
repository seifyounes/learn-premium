// The Agent-built sims where students meet them: inline in their Worked examples, in the Lab and in
// the Tool gallery, on the built Fixture Course. Then in a real browser (Chromium): each hydrates,
// loads JSXGraph only once it is on screen, holds its layout at every slider's min, mid and max,
// and takes a drag by touch on a phone without trapping the page's scroll. Plotly, for the plane
// wall's heatmap, loads only on that sim's pages and only once its map is opened, and every plot
// label is set in screen pixels, 12px or more at 320px.
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
    expect(lab.match(/class="sim-card"[^>]*data-sim-kind/g)).toHaveLength(8);
    const gallery = build.page("tool-gallery");
    expect(
      [...gallery.matchAll(/data-sim-kind="([^"]+)" data-recompute="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`),
    ).toEqual([
      "gradient-descent:independent",
      "logic:independent",
      "tangent:independent",
      "plane-wall:independent",
      "stl:independent",
      "scl:independent",
      "control:independent",
      "gradient-descent:none",
    ]);
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

// The maths and heat-transfer sims: the tangent (W05.1) and the plane wall (W01.2), on JSXGraph,
// and the plane wall's map of the wall over time, the one heatmap, on Plotly.
const MATHS = "05-derivatives";
const HEAT = "01-thermal-resistance";
/** Every page the built site has, by route, the Trap page aside (the page gates never read it). */
const ROUTES = [
  "",
  "01-thermal-resistance",
  "02-convection",
  "03-gradient-descent",
  "04-full-adder",
  MATHS,
  "06-tank-level",
  "09-silo-blender",
  "lab",
  "rules",
  "about",
  "tool-gallery",
  "revision/midterm",
];

/** The `/_astro/` file an island's chunk imports lazily, picked by what its code holds. */
function lazyChunk(island: RegExp, holds: RegExp, page: string): { island: string; lazy: string[]; static: string[] } {
  const file = island.exec(page)?.[1] ?? "";
  const code = readFileSync(join(build.outDir, "_astro", file), "utf8");
  const statics = [...code.matchAll(/^import[^;]*from["'`]\.\/([^"'`]+)["'`]/gm)].map((m) => m[1] ?? "");
  const lazy = [...code.matchAll(/import\(["'`]\.\/([^"'`]+)["'`]\)/g)].map((m) => m[1] ?? "");
  return {
    island: file,
    static: statics,
    lazy: lazy.filter((f) => holds.test(readFileSync(join(build.outDir, "_astro", f), "utf8"))),
  };
}
const PLOTLY = /\bPlotly\b[\s\S]*\bnewPlot\b/;

describe("the maths and heat sims on the built pages", () => {
  it("sits each inline in its Worked example, opened on the example's values, its controls off until hydrated", () => {
    const tangent = articleOf(build.page(MATHS), "W05.1");
    expect(tangent).toMatch(/component-url="\/_astro\/TangentSim\.[^"]+\.js"[^>]*client="visible"/);
    const rows = (article: string) =>
      [...article.matchAll(/<tr class="h-\[29px\]" data-row="(\d+)">([\s\S]*?)<\/tr>/g)].map((m) =>
        [...(m[2] ?? "").matchAll(/>([−\d.]+)<\/td>/g)].map((c) => c[1]),
      );
    // Its runs as the sheet writes them, the computed values at the sheet's 4 decimals.
    expect(rows(tangent)).toEqual([
      ["1", "7.0000", "6.0000"],
      ["0.1", "1.2310", "2.3100"],
      ["0.01", "1.0203", "2.0301"],
    ]);
    expect(tangent).toMatch(/data-row="limit"[\s\S]*?>1\.0000<\/td>[\s\S]*?>2\.0000<svg/);

    const wall = articleOf(build.page(HEAT), "W01.2");
    expect(wall).toMatch(/component-url="\/_astro\/PlaneWallSim\.[^"]+\.js"[^>]*client="visible"/);
    // The Crank–Nicolson march at the sheet's one decimal, as the Fourier series gives it.
    expect(rows(wall)).toEqual([
      ["0", "20.0"],
      ["10", "37.6"],
      ["20", "44.9"],
      ["30", "37.6"],
      ["40", "20.0"],
    ]);
    for (const article of [tangent, wall]) {
      // The sim's own controls, after the sheet's.
      const card = article.slice(article.indexOf('class="sim-card"'));
      const controls = [...card.matchAll(/<(?:input[^>]*type="range"|button)[^>]*>/g)].map((m) => m[0]);
      expect(controls.length).toBeGreaterThan(2);
      for (const control of controls) expect(control).toContain("disabled");
    }
  });

  it("keeps Plotly out of every page: only the map's own chunk imports it, and only once it is opened", () => {
    const wall = lazyChunk(/component-url="\/_astro\/(PlaneWallSim\.[^"]+\.js)"/, PLOTLY, build.page(HEAT));
    expect(wall.lazy).toHaveLength(1);
    const [plotly] = wall.lazy;
    expect(plotly).toMatch(/^heatmap\./);
    expect(wall.static).not.toContain(plotly);
    for (const route of ROUTES) expect(build.page(route), route || "home").not.toContain(plotly);
    // No other island takes Plotly in, eagerly or lazily.
    const tangent = lazyChunk(/component-url="\/_astro\/(TangentSim\.[^"]+\.js)"/, PLOTLY, build.page(MATHS));
    expect(tangent.lazy).toEqual([]);
    expect(tangent.static).not.toContain(plotly);
  });
});

describe("the maths and heat sims in a browser", () => {
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

  async function open(context: BrowserContext, route: string) {
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`${site.url}/${route}${route ? "/" : ""}`);
    return { page, errors, requests };
  }
  const sim = (page: Page, kind: string) => page.locator(`[data-sim="${kind}"]`).first();
  const hydrated = async (page: Page, kind: string) => {
    await sim(page, kind).scrollIntoViewIfNeeded();
    await page.locator(`[data-sim="${kind}"][data-ready="true"] [data-board] svg`).first().waitFor();
  };
  const openMap = async (page: Page) => {
    await sim(page, "plane-wall").getByRole("tab", { name: "Map over time" }).click();
    await page.locator('[data-sim="plane-wall"] [data-map] .main-svg').first().waitFor();
  };

  it("loads Plotly on the heatmap's pages alone, and there only once the map is opened", async () => {
    const plotly = lazyChunk(/component-url="\/_astro\/(PlaneWallSim\.[^"]+\.js)"/, PLOTLY, build.page(HEAT)).lazy[0];
    if (!plotly) throw new Error("the plane-wall sim imports no Plotly chunk");
    const loadedOn: string[] = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    for (const route of ROUTES) {
      const { page, errors, requests } = await open(context, route);
      await page.waitForLoadState("networkidle");
      // Every sim on the page scrolled to and hydrated: still no Plotly.
      for (const el of await page.locator("[data-sim]").all()) {
        await el.scrollIntoViewIfNeeded();
        await expect.poll(() => el.getAttribute("data-ready")).toBe("true");
      }
      await page.waitForLoadState("networkidle");
      expect(
        requests.filter((u) => u.includes(plotly)),
        `${route || "home"} before the map is opened`,
      ).toEqual([]);
      if ((await page.locator('[data-sim="plane-wall"]').count()) > 0) {
        await openMap(page);
        if (requests.some((u) => u.includes(plotly))) loadedOn.push(route);
      }
      expect(errors, route || "home").toEqual([]);
      await page.close();
    }
    expect(loadedOn).toEqual([HEAT, "lab", "tool-gallery"]);
    await context.close();
  });

  it("starts Plotly on a 4×-slow phone in a few times JSXGraph's start, so opening the map doesn't hold the page", async () => {
    // Plotly starts in one task: no tap lands until it ends. Its prebuilt dist bundle held a
    // 4×-throttled phone for 2–4s (26× JSXGraph), and under CI's load the tap after "Map over
    // time" missed the touch gate's waits (#119); built from Plotly's sources it starts in about
    // 5× JSXGraph. Each is timed against JSXGraph in the same browser, so the machine's load cancels.
    const wall = (holds: RegExp) =>
      lazyChunk(/component-url="\/_astro\/(PlaneWallSim\.[^"]+\.js)"/, holds, build.page(HEAT));
    const [plotly] = wall(PLOTLY).lazy;
    const [jsxgraph] = wall(/\bJSXGraph\b/).lazy.filter((f) => f !== plotly);
    if (!plotly || !jsxgraph) throw new Error("the plane-wall sim imports no Plotly or no JSXGraph chunk");
    /** How long importing a chunk holds a fresh 4×-throttled phone page, its bytes already fetched. */
    const startMs = async (chunk: string) => {
      const context = await browser.newContext({
        viewport: { width: 375, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      // A page with no sim on it, settled before the CPU slows.
      await page.goto(`${site.url}/rules/`, { waitUntil: "networkidle" });
      await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
      // As source text: vitest would rewrite an import() in a function.
      const ms = await page.evaluate<number>(`(async (url) => {
        await (await fetch(url)).text();
        const started = performance.now();
        await import(url);
        return performance.now() - started;
      })(${JSON.stringify(`/_astro/${chunk}`)})`);
      await context.close();
      return ms;
    };
    const median = async (chunk: string) => {
      const runs: number[] = [];
      for (let i = 0; i < 3; i++) runs.push(await startMs(chunk));
      return runs.sort((a, b) => a - b)[1] ?? 0;
    };
    const ratio = (await median(plotly)) / (await median(jsxgraph));
    expect(ratio).toBeLessThan(10);
  });

  it("draws both boards in the pad's inks, the tangent in the pad's print", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const { page, errors } = await open(context, "tool-gallery");
    for (const kind of ["tangent", "plane-wall"]) {
      await hydrated(page, kind);
      const inks = await sim(page, kind).evaluate((root) => {
        const style = getComputedStyle(document.documentElement);
        const tokens = ["graphite", "pencil", "sheet", "grid-major", "print"].map((t) =>
          style.getPropertyValue(`--color-${t}`).trim().toLowerCase(),
        );
        const drawn = [...root.querySelectorAll("[data-board] svg *")].filter(
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
      expect(inks.used.length, kind).toBeGreaterThan(0);
      for (const colour of inks.used) expect(inks.tokens, kind).toContain(colour);
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  /** Every text on a sim's plots and their axis names, by its drawn size in screen pixels (an SVG's scale included). */
  const plotText = (page: Page, kind: string) =>
    sim(page, kind).evaluate((root) => {
      const sizes: { text: string; px: number }[] = [];
      for (const el of root.querySelectorAll("[data-board] *, [data-map] *, .sim-axis-name, .sim-axis-name *")) {
        const own = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
        );
        if (!own || !el.checkVisibility()) continue;
        const svg = el instanceof SVGElement ? el.closest("svg") : null;
        const scale = svg ? (svg.getScreenCTM()?.a ?? 1) : 1;
        sizes.push({ text: (el.textContent ?? "").trim(), px: parseFloat(getComputedStyle(el).fontSize) * scale });
      }
      return sizes;
    });

  it("sets every plot label in screen pixels: the same size at 1280px and at 320px, never under 12px", async () => {
    const measured: Record<string, number[]> = {};
    for (const width of [1280, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 760 } });
      const { page, errors } = await open(context, "tool-gallery");
      for (const kind of ["tangent", "plane-wall"]) {
        await hydrated(page, kind);
        const sizes = await plotText(page, kind);
        if (kind === "plane-wall") {
          await openMap(page);
          sizes.push(...(await plotText(page, kind)));
        }
        expect(sizes.length, `${kind} at ${width}px`).toBeGreaterThan(5);
        for (const { text, px } of sizes)
          expect(px, `"${text}" on the ${kind} sim at ${width}px`).toBeGreaterThanOrEqual(12);
        measured[`${kind}@${width}`] = sizes.map((s) => Math.round(s.px * 10) / 10).sort((a, b) => a - b);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
      await context.close();
    }
    for (const kind of ["tangent", "plane-wall"]) {
      expect([...new Set(measured[`${kind}@320`])], kind).toEqual([...new Set(measured[`${kind}@1280`])]);
    }
  });

  it("holds both layouts at every slider's min, mid and max, the map open", async () => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      const context = await browser.newContext({ viewport });
      const { page, errors } = await open(context, "tool-gallery");
      for (const kind of ["tangent", "plane-wall"]) {
        await hydrated(page, kind);
        if (kind === "plane-wall") await openMap(page);
        const sliders = sim(page, kind).locator('input[type="range"]');
        for (let i = 0; i < (await sliders.count()); i++) {
          const input = sliders.nth(i);
          const [min, max, step] = await Promise.all(["min", "max", "step"].map((a) => input.getAttribute(a)));
          const mid = Number(min) + Math.round((Number(max) - Number(min)) / 2 / Number(step)) * Number(step);
          for (const value of [Number(min), mid, Number(max)]) {
            await input.fill(String(value));
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflow, `${kind} at ${viewport.width}px, slider ${i} at ${value}`).toBeLessThanOrEqual(0);
            expect(await sim(page, kind).locator("tbody").innerText()).not.toMatch(/NaN|Infinity/);
          }
          await sim(page, kind).getByRole("button", { name: "Back to the example" }).click();
        }
      }
      // The wall cools: by 120 s its mid-plane is within a tenth of a degree of its faces.
      await sim(page, "plane-wall").locator('input[type="range"]').first().fill("120");
      await expect
        .poll(() => sim(page, "plane-wall").locator('tbody tr[data-row="2"] td').nth(1).innerText())
        .toBe("20.0");
      expect(errors).toEqual([]);
      await context.close();
    }
  });

  it("slides P along the curve by touch on a phone, and lets a swipe off it scroll the page", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const { page, errors } = await open(context, MATHS);
    await hydrated(page, "tangent");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const touch = async (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const swipe = async (from: [number, number], to: [number, number]) => {
      await touch("touchStart", ...from);
      for (let i = 1; i <= 8; i++)
        await touch("touchMove", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8);
      await touch("touchEnd", ...to);
    };

    const p = sim(page, "tangent").locator(".sim-handle").first();
    await p.scrollIntoViewIfNeeded();
    const box = await p.boundingBox();
    if (!box) throw new Error("P isn't drawn");
    const at: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
    const scrolled = await page.evaluate(() => window.scrollY);
    await swipe(at, [at[0] - 50, at[1]]);
    const a = sim(page, "tangent").locator('input[type="range"]').first();
    await expect.poll(async () => Number(await a.inputValue())).toBeLessThan(2);
    expect(await page.evaluate(() => window.scrollY), "sliding P doesn't scroll the page").toBe(scrolled);

    const board = await sim(page, "tangent").locator('[data-board="tangent"]').boundingBox();
    if (!board) throw new Error("the board isn't drawn");
    const empty: [number, number] = [board.x + 12, board.y + 12];
    await swipe(empty, [empty[0], empty[1] - 200]);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled + 50);
    expect(errors).toEqual([]);
    await context.close();
  });
});
