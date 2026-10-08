// The machine part's 3D viewer on the built Fixture Course, in a real browser (Chromium): three.js
// stays out of the initial load and arrives once the viewer is on screen, the part is drawn with its
// labels beside it, the page scrolls over the viewer until it is tapped or clicked, then one finger
// turns it and two pinch it inside the frame, Reset view brings the 3/4 view back, and a Checkpoint
// item's link opens it with that dimension highlighted.
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "07-flanged-hub";
const build = buildCourse(FIXTURE_COURSE);
const isThree = (url: string, body = "") => /three/i.test(new URL(url).pathname) || body.includes("WebGLRenderer");

describe("the part on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sits below its Worked example, in the Lab and in the Tool gallery, its controls off until hydrated", () => {
    for (const route of [MODULE, "lab", "tool-gallery"]) {
      const page = build.page(route);
      const card = page.slice(page.indexOf(`id="part-${MODULE}-hub"`));
      expect(card, route).toMatch(/component-url="\/_astro\/PartViewer\.[^"]+\.js"[^>]*client="visible"/);
      const buttons = [...card.slice(0, card.indexOf("</article>")).matchAll(/<button[^>]*>/g)].map((m) => m[0]);
      expect(buttons.length, route).toBe(8); // Reset view and a row per dimension
      for (const b of buttons) expect(b).toContain("disabled");
    }
    const worked = build.page(MODULE);
    expect(worked.indexOf(`id="part-${MODULE}-hub"`)).toBeGreaterThan(worked.indexOf("W07.1"));
  });

  it("lists every dimension with its Provenance tag, each row a Checkpoint item's target", () => {
    const page = build.page(MODULE);
    const rows = [...page.matchAll(/<tr id="(dim-[^"]+)"[\s\S]*?<\/tr>/g)].map((m) => [
      m[1],
      [...m[0].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1]).join(" | "),
    ]);
    expect(rows).toEqual([
      [`dim-${MODULE}-hub-flange-d`, "Ø80 | stated"],
      [`dim-${MODULE}-hub-flange-t`, "10 | stated"],
      [`dim-${MODULE}-hub-hub-d`, "Ø40 | stated"],
      [`dim-${MODULE}-hub-height`, "30 | scaled off the drawing"],
      [`dim-${MODULE}-hub-bore-d`, "Ø20 | stated"],
      [`dim-${MODULE}-hub-hole-d`, "Ø8 | assumed"],
      [`dim-${MODULE}-hub-pcd`, "60 | stated"],
    ]);
  });

  it("publishes the part's GLB beside its page, and never its script or record", () => {
    const glb = readFileSync(join(build.outDir, MODULE, "parts", "hub.glb"));
    expect(glb.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(() => readFileSync(join(build.outDir, MODULE, "parts", "hub.py"))).toThrow();
    expect(() => readFileSync(join(build.outDir, MODULE, "parts", "hub.json"))).toThrow();
  });

  it("keeps three.js out of the island: it imports it only after first paint", () => {
    const island = /component-url="\/_astro\/(PartViewer\.[^"]+\.js)"/.exec(build.page(MODULE))?.[1] ?? "";
    const code = readFileSync(join(build.outDir, "_astro", island), "utf8");
    expect(code).not.toContain("WebGLRenderer");
    const staticImports = [...code.matchAll(/^import[^;]*from["'`]\.\/([^"'`]+)["'`]/gm)].map((m) => m[1] ?? "");
    for (const file of staticImports)
      expect(readFileSync(join(build.outDir, "_astro", file), "utf8"), file).not.toContain("WebGLRenderer");
  });
});

describe("the part's viewer in a browser", () => {
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
    await page.goto(`${site.url}${route}`, { waitUntil: "load" });
    return { page, errors, requests };
  }

  const viewer = (page: Page) => page.locator("[data-viewer]").first();
  const object = (page: Page) => page.locator("[data-viewer-object]").first();
  const reset = (page: Page) => viewer(page).getByRole("button", { name: "Reset view" });
  async function drawn(page: Page) {
    await object(page).scrollIntoViewIfNeeded();
    await page.locator('[data-viewer][data-drawn="true"]').first().waitFor({ timeout: 60_000 });
  }
  const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
  const centre = async (page: Page) => {
    const box = await object(page).boundingBox();
    if (!box) throw new Error("the viewer has no box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  it("keeps three.js out of the initial load, fetching it and the GLB once the viewer is on screen", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors, requests } = await open(context, `/${MODULE}/`);
    await page.waitForTimeout(500);
    expect(requests.filter((u) => isThree(u) || u.endsWith(".glb"))).toEqual([]);
    await drawn(page);
    expect(requests.some((u) => u.endsWith(`/${MODULE}/parts/hub.glb`))).toBe(true);
    // The part is drawn: the frame looks different with its canvas hidden.
    const frame = page.locator("[data-viewer-object]").first();
    const drawnPart = await frame.screenshot();
    await frame.evaluate((el) => el.querySelector("canvas")?.style.setProperty("visibility", "hidden"));
    expect(drawnPart.equals(await frame.screenshot())).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("hangs each label beside the part, never on it, at 12px or more", async () => {
    for (const width of [1280, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const { page } = await open(context, `/${MODULE}/`);
      await drawn(page);
      await page.locator(".viewer-label").first().waitFor();
      const labels = await page.evaluate(() => {
        const canvas = document.querySelector("[data-viewer-object] canvas")?.getBoundingClientRect();
        return [...document.querySelectorAll(".viewer-label")].map((l) => {
          const r = l.getBoundingClientRect();
          return {
            text: l.textContent,
            px: parseFloat(getComputedStyle(l).fontSize),
            onCanvas: canvas ? r.left < canvas.right - 1 : true,
            box: [r.top, r.bottom],
          };
        });
      });
      expect(labels.map((l) => l.text).sort(), `${width}px`).toEqual(["10", "30", "60", "Ø20", "Ø40", "Ø8", "Ø80"]);
      for (const l of labels) {
        expect(l.px).toBeGreaterThanOrEqual(12);
        expect(l.onCanvas, `${l.text} at ${width}px`).toBe(false);
      }
      const tops = labels.map((l) => l.box).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
      for (let i = 1; i < tops.length; i++) expect(tops[i]?.[0]).toBeGreaterThanOrEqual((tops[i - 1]?.[1] ?? 0) - 0.5);
      await context.close();
    }
  });

  it("lets the wheel scroll the page over it until it is clicked, then zooms, and hands the page back on Esc", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, `/${MODULE}/`);
    await drawn(page);
    await page.evaluate(() => {
      const el = document.querySelector("[data-viewer-object]");
      el?.scrollIntoView({ block: "center" });
    });
    const at = await centre(page);
    await page.mouse.move(at.x, at.y);
    let before = await scrollY(page);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
    await expect(reset(page).isDisabled()).resolves.toBe(true);

    const here = await centre(page);
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => object(page).getAttribute("aria-pressed")).toBe("true");
    before = await scrollY(page);
    await page.mouse.move(here.x, here.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    expect(await scrollY(page)).toBe(before);
    await expect.poll(() => reset(page).isEnabled()).toBe(true);
    await reset(page).click();
    await expect.poll(() => reset(page).isDisabled()).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => object(page).getAttribute("aria-pressed")).toBe("false");
    before = await scrollY(page);
    await page.mouse.move(here.x, here.y);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
    await context.close();
  });

  /** One finger dragged on a touch phone, by Chromium's touch input. */
  async function swipe(cdp: CDPSession, from: { x: number; y: number }, dx: number, dy: number) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
    for (let i = 1; i <= 10; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from.x + (dx * i) / 10, y: from.y + (dy * i) / 10, id: 1 }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  it("on a phone, scrolls the page under a swipe until tapped, then turns with one finger and pinches in its frame", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    const { page } = await open(context, `/${MODULE}/`);
    const cdp = await context.newCDPSession(page);
    await drawn(page);
    await page.evaluate(() => document.querySelector("[data-viewer-object]")?.scrollIntoView({ block: "center" }));
    expect(await object(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe("pan-y pinch-zoom");

    let at = await centre(page);
    let before = await scrollY(page);
    await swipe(cdp, at, 0, -200);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before + 50);
    expect(await reset(page).isDisabled()).toBe(true);

    await object(page).tap();
    await expect.poll(() => object(page).getAttribute("aria-pressed")).toBe("true");
    expect(await object(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
    before = await scrollY(page);
    at = await centre(page);
    await swipe(cdp, at, 80, -60);
    await expect.poll(() => reset(page).isEnabled()).toBe(true);
    expect(await scrollY(page)).toBe(before);
    // Clicked: Chromium takes the first tap after a drag as the drag's end, as a phone does.
    await reset(page).click();
    await expect.poll(() => reset(page).isDisabled()).toBe(true);

    // Two fingers spreading: the part zooms, the page doesn't.
    at = await centre(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: at.x - 20, y: at.y, id: 1 },
        { x: at.x + 20, y: at.y, id: 2 },
      ],
    });
    for (let i = 1; i <= 10; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: at.x - 20 - 6 * i, y: at.y, id: 1 },
          { x: at.x + 20 + 6 * i, y: at.y, id: 2 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => reset(page).isEnabled()).toBe(true);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await context.close();
  });

  it("gives its WebGL context back when scrolled far away, and draws again on the way back", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context, `/${MODULE}/`);
    await drawn(page);
    // Far away: a tall gap above the viewer, the page at its top.
    await page.evaluate(() => {
      const gap = document.createElement("div");
      gap.style.blockSize = "6000px";
      document.querySelector(".part-card")?.before(gap);
      window.scrollTo(0, 0);
    });
    await expect.poll(() => viewer(page).getAttribute("data-drawn")).toBe("false");
    expect(await page.locator("[data-viewer-object] canvas").count()).toBe(0);
    await drawn(page);
    expect(await page.locator("[data-viewer-object] canvas").count()).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("leaves every gesture to the page when its part doesn't load, and says so", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route("**/*.glb", (route) => route.abort());
    const { page } = await open(context, `/${MODULE}/`);
    await object(page).scrollIntoViewIfNeeded();
    await expect
      .poll(() => viewer(page).locator("figcaption").innerText(), { timeout: 60_000 })
      .toContain("The part didn't load");
    await page.evaluate(() => document.querySelector("[data-viewer-object]")?.scrollIntoView({ block: "center" }));
    const at = await centre(page);
    await page.mouse.click(at.x, at.y);
    expect(await object(page).getAttribute("aria-pressed")).toBe("false");
    const before = await scrollY(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
    await context.close();
  });

  it("opens a Checkpoint item's link with that dimension highlighted, and a row's button highlights another", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, `/${MODULE}/#dim-${MODULE}-hub-height`);
    const row = (id: string) => page.locator(`#dim-${MODULE}-hub-${id}`);
    await expect.poll(() => row("height").getAttribute("data-highlighted")).toBe("true");
    await expect(row("height").getByRole("button").getAttribute("aria-pressed")).resolves.toBe("true");
    await drawn(page);
    await expect.poll(() => page.locator('.viewer-label[data-strong="true"]').textContent()).toBe("30");
    await row("bore-d").getByRole("button").click();
    await expect.poll(() => page.locator('.viewer-label[data-strong="true"]').textContent()).toBe("Ø20");
    expect(await row("height").getAttribute("data-highlighted")).toBeNull();
    await context.close();
  });
});
