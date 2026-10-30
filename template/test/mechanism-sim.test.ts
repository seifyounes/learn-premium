// The mechanisms on the built Fixture Course, in a real browser (Chromium): the four-bar and the gear
// pair of Module 11 open in 3D, three.js arriving only once they are on screen; a printed 2D | 3D
// switch shows the Professor's sheet drawing (hatched ground pins, pencil bars, the trace inking in);
// Play turns the driver once in six seconds; the ringed pin can be dragged in 2D; and reduced motion
// stops a running mechanism at the angle it has.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { fourBarReference } from "./kinematics/reference.ts";
import { serve } from "./serve";

const MODULE = "11-mechanisms";
const build = buildCourse(FIXTURE_COURSE);
/** The built chunks that hold three.js's renderer: what a page fetches only once a viewer is on screen. */
const threeChunks = () =>
  readdirSync(join(build.outDir, "_astro"))
    .filter((f) => f.endsWith(".js") && readFileSync(join(build.outDir, "_astro", f), "utf8").includes("WebGLRenderer"))
    .map((f) => `/_astro/${f}`);
const isThree = (url: string) => threeChunks().includes(new URL(url).pathname);

describe("the mechanisms on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sit below their Worked examples, in the Lab and in the Tool gallery, their controls off until hydrated", () => {
    for (const route of [MODULE, "lab", "tool-gallery"]) {
      const page = build.page(route);
      for (const name of ["linkage", "gears"]) {
        const at = page.indexOf(`id="sim-${MODULE}-${name}"`);
        expect(at, `${route}: ${name}`).toBeGreaterThan(-1);
        const card = page.slice(at, page.indexOf("</article>", at));
        expect(card, route).toMatch(/component-url="\/_astro\/MechanismSim\.[^"]+\.js"[^>]*client="visible"/);
        const controls = [...card.matchAll(/<(?:button|input)[^>]*>/g)].map((m) => m[0]);
        // 2D, 3D, Play and Reset view, and the slider.
        expect(controls.length, `${route}: ${name}`).toBe(5);
        for (const control of controls) expect(control, `${route}: ${name}`).toContain("disabled");
      }
    }
    const worked = build.page(MODULE);
    expect(worked.indexOf(`id="sim-${MODULE}-gears"`)).toBeGreaterThan(worked.indexOf("W11.1"));
    expect(worked.indexOf(`id="sim-${MODULE}-linkage"`)).toBeGreaterThan(worked.indexOf("W11.2"));
  });

  it("shows the Tool gallery one mechanism of each type", () => {
    const gallery = build.page("tool-gallery");
    expect([...gallery.matchAll(/data-sim-kind="mechanism"[^>]*data-mechanism="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "four-bar",
      "gear-pair",
    ]);
  });

  it("keeps three.js out of the island: it imports it only after first paint", () => {
    const island = /component-url="\/_astro\/(MechanismSim\.[^"]+\.js)"/.exec(build.page(MODULE))?.[1] ?? "";
    const code = readFileSync(join(build.outDir, "_astro", island), "utf8");
    expect(code).not.toContain("WebGLRenderer");
    const staticImports = [...code.matchAll(/^import[^;]*from["'`]\.\/([^"'`]+)["'`]/gm)].map((m) => m[1] ?? "");
    for (const file of staticImports)
      expect(readFileSync(join(build.outDir, "_astro", file), "utf8"), file).not.toContain("WebGLRenderer");
  });
});

describe("the mechanisms in a browser", () => {
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
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`${site.url}${route}`, { waitUntil: "load" });
    return { page, errors, requests };
  }

  const root = (page: Page, type: "four-bar" | "gear-pair") =>
    page.locator(`.mechanism[data-mechanism="${type}"]`).first();
  /** The island, scrolled into view and hydrated. */
  async function sim(page: Page, type: "four-bar" | "gear-pair") {
    const el = root(page, type);
    await el.scrollIntoViewIfNeeded();
    await page.locator(`.mechanism[data-mechanism="${type}"][data-ready="true"]`).first().waitFor({ timeout: 60_000 });
    return el;
  }
  const angle = async (el: ReturnType<typeof root>) => Number(await el.getAttribute("data-angle"));
  const tab = (el: ReturnType<typeof root>, name: "2D" | "3D") => el.getByRole("tab", { name });
  const play = (el: ReturnType<typeof root>) => el.getByRole("button", { name: /^(Play|Pause)$/ });
  /** The 3D view drawn: its surface says so. */
  const drawn = (el: ReturnType<typeof root>) => el.locator('[data-viewer-object][data-viewer-state="drawn"]');
  /** The matrix of a link group in the 2D drawing: its angle in degrees, [0, 360). */
  const linkAngle = (el: ReturnType<typeof root>, link: string) =>
    el.locator(`[data-link="${link}"]`).evaluate((g) => {
      // `matrix(a b c d e f)`, as the sheet writes it: space separated, which DOMMatrix won't parse.
      const [a = 1, b = 0] = (/\(([^)]*)\)/.exec(g.getAttribute("transform") ?? "")?.[1] ?? "")
        .split(/\s+/)
        .map(Number);
      const m = { a, b };
      return ((((Math.atan2(m.b, m.a) * 180) / Math.PI) % 360) + 360) % 360;
    });
  const inkLength = (el: ReturnType<typeof root>) =>
    el
      .locator('[data-trace="inked"]')
      .evaluateAll((lines) => lines.reduce((sum, line) => sum + (line as SVGGeometryElement).getTotalLength(), 0));

  it("opens in 3D by default, fetching three.js only once the mechanism is on screen", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors, requests } = await open(context);
    await page.waitForTimeout(500);
    expect(requests.filter((u) => isThree(u))).toEqual([]);
    const el = await sim(page, "four-bar");
    await drawn(el).waitFor({ timeout: 60_000 });
    expect(requests.some((u) => isThree(u))).toBe(true);
    expect(await el.getAttribute("data-view")).toBe("3d");
    await expect(tab(el, "3D").getAttribute("aria-selected")).resolves.toBe("true");
    expect(await el.getAttribute("data-angle")).toBe("60.000");
    // Drawn: the frame looks different with its canvas hidden.
    const frame = el.locator("[data-viewer-object]");
    const picture = await frame.screenshot();
    await frame.evaluate((node) => node.querySelector("canvas")?.style.setProperty("visibility", "hidden"));
    expect(picture.equals(await frame.screenshot())).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("Play advances the angle and Pause holds it, in 3D", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "four-bar");
    await drawn(el).waitFor({ timeout: 60_000 });
    await play(el).click();
    await expect.poll(() => play(el).textContent()).toBe("Pause");
    expect(await el.getAttribute("data-playing")).toBe("true");
    await expect.poll(() => angle(el)).toBeGreaterThan(70);
    await play(el).click();
    expect(await el.getAttribute("data-playing")).toBe("false");
    const held = await angle(el);
    await page.waitForTimeout(400);
    expect(await angle(el)).toBe(held);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("shows the sheet drawing in 2D: hatched ground pins, three links, a ringed pin and the trace inking in", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "four-bar");
    await tab(el, "2D").click();
    expect(await el.getAttribute("data-view")).toBe("2d");
    expect(await el.locator("[data-ground]").count()).toBe(2);
    expect(await el.locator("[data-link]").count()).toBe(3);
    expect(await el.locator("[data-drive-pin]").count()).toBe(1);
    // The drawing never mirrors, and is drawn at its own size.
    expect(await el.locator(".mechanism-sheet-box").getAttribute("dir")).toBe("ltr");
    const before = await inkLength(el);
    await play(el).click();
    await expect.poll(() => inkLength(el)).toBeGreaterThan(before + 5);
    await play(el).click();
    // 12px or more for every letter and digit.
    const sizes = await el
      .locator(".mechanism-letter, .mechanism-letter-sub")
      .evaluateAll((nodes) => nodes.map((n) => parseFloat(getComputedStyle(n).fontSize)));
    expect(sizes.length).toBeGreaterThan(5);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("the 2D drawing puts B where the reference does at θ2 = 60°", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    const el = await sim(page, "four-bar");
    await tab(el, "2D").click();
    expect(await el.getAttribute("data-angle")).toBe("60.000");
    // The pin circle's place in the drawing, through the browser's own matrices, back to the sheet's mm.
    const sheet = await el.locator('[data-pin="coupler.B"]').evaluate((pin) => {
      const frame = pin.closest("[data-sheet-frame]") as SVGGElement;
      const at = new DOMPoint(Number(pin.getAttribute("cx")), Number(pin.getAttribute("cy"))).matrixTransform(
        (frame.getCTM() as DOMMatrix).inverse().multiply((pin as SVGGraphicsElement).getCTM() as DOMMatrix),
      );
      return [at.x, at.y];
    });
    const reference = fourBarReference(
      { ground: 100, crank: 40, coupler: 120, rocker: 80, assembly: "open", couplerPoint: { along: 60, off: 30 } },
      360,
    ).B[60] as readonly [number, number];
    expect(Math.hypot((sheet[0] ?? NaN) - reference[0], (sheet[1] ?? NaN) - reference[1])).toBeLessThanOrEqual(0.1);
    await context.close();
  });

  it("dragging the ringed pin to 90° turns the driver there", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "four-bar");
    await tab(el, "2D").click();
    const centreOf = async (selector: string) => {
      const box = await el.locator(selector).first().boundingBox();
      if (!box) throw new Error(`no ${selector}`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const [o2, handle] = [await centreOf('[data-pin="crank.O2"]'), await centreOf(".mechanism-hit")];
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    // Straight up from O2, a hundred pixels out: the crank at 90°, the sheet's y up.
    await page.mouse.move(o2.x + 20, o2.y - 80, { steps: 5 });
    await page.mouse.move(o2.x, o2.y - 100, { steps: 5 });
    await page.mouse.up();
    expect(Math.abs((await angle(el)) - 90)).toBeLessThanOrEqual(1);
    expect(await el.getAttribute("data-playing")).toBe("false");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("in 3D, the gear pair's handle follows the pointer too, though it stands on the gear's face", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "gear-pair");
    const surface = el.locator("[data-viewer-object]");
    await drawn(el).waitFor({ timeout: 60_000 });
    await surface.click({ position: { x: 20, y: 20 } });
    await expect.poll(() => surface.getAttribute("aria-pressed")).toBe("true");
    const pinAt = async () => {
      const [x = NaN, y = NaN] = ((await surface.getAttribute("data-pin-screen")) ?? "").split(" ").map(Number);
      const box = await surface.boundingBox();
      if (!box) throw new Error("no viewer box");
      return { x: box.x + x, y: box.y + y };
    };
    // Pressing on the handle changes nothing by itself: the handle is where the pointer is.
    const start = await pinAt();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 1, start.y, { steps: 2 });
    await page.mouse.up();
    expect(Math.abs((await angle(el)) - 0), "a press on the handle").toBeLessThan(3);
    // Dragged round the driver, it goes where the pointer goes.
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const target = { x: start.x - 20, y: start.y - 40 };
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    expect(await angle(el)).toBeGreaterThan(10);
    const after = await pinAt();
    expect(Math.hypot(after.x - target.x, after.y - target.y)).toBeLessThan(
      Math.hypot(start.x - target.x, start.y - target.y),
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  it("in 2D, the gear tip's path is the driven gear's whole rim, inking in as the driven gear turns", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    const el = await sim(page, "gear-pair");
    await tab(el, "2D").click();
    // A circle of the tip radius round the driven gear: 38 mm at most 3 px per mm, not a chord across the gear.
    const path = await el.locator(".mechanism-path").evaluate((p) => {
      const box = (p as SVGGraphicsElement).getBBox();
      return [box.width, box.height];
    });
    expect(path[0]).toBeCloseTo(76, 0);
    expect(path[1]).toBeCloseTo(76, 0);
    // Two driver turns ink half the rim each: the ink at 40° of the driver lies on the rim's half, all along.
    const slider = el.getByRole("slider");
    await slider.fill("0");
    const before = await el.locator('[data-trace="inked"]').count();
    await slider.fill("180");
    const inkMm = () =>
      el
        .locator('[data-trace="inked"]')
        .evaluateAll((lines) => lines.reduce((sum, l) => sum + (l as SVGGeometryElement).getTotalLength(), 0));
    expect(before).toBeGreaterThan(0);
    // 180° of the driver is 90° of the 38 mm rim: about 60 mm of ink, not the 180° of a different path.
    await expect.poll(inkMm).toBeGreaterThan(45);
    expect(await inkMm()).toBeLessThan(75);
    await context.close();
  });

  it("in 3D, once tapped, dragging the ringed pin turns the driver and not the view, and any other drag turns the view", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "four-bar");
    const surface = el.locator("[data-viewer-object]");
    await drawn(el).waitFor({ timeout: 60_000 });
    const reset = el.getByRole("button", { name: "Reset view" });
    const pinAt = async () => {
      const [x = NaN, y = NaN] = ((await surface.getAttribute("data-pin-screen")) ?? "").split(" ").map(Number);
      const box = await surface.boundingBox();
      if (!box) throw new Error("no viewer box");
      return { x: box.x + x, y: box.y + y };
    };
    // Untapped, the page keeps its gestures: a drag on the pin turns nothing.
    const before = await pinAt();
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x - 40, before.y - 40, { steps: 4 });
    await page.mouse.up();
    expect(await angle(el)).toBe(60);
    await surface.click({ position: { x: 20, y: 20 } });
    await expect.poll(() => surface.getAttribute("aria-pressed")).toBe("true");
    // Tapped: pressing the pin and moving round the crank turns the driver the way the pointer goes.
    const start = await pinAt();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 30, start.y - 25, { steps: 6 });
    await page.mouse.up();
    const turned = await angle(el);
    expect(turned).not.toBe(60);
    expect(await el.getAttribute("data-playing")).toBe("false");
    const after = await pinAt();
    expect(Math.hypot(after.x - (start.x - 30), after.y - (start.y - 25))).toBeLessThan(
      Math.hypot(start.x - (start.x - 30), start.y - (start.y - 25)),
    );
    expect(await reset.isDisabled()).toBe(true);
    // Anywhere else, the same drag turns the view, and Reset view comes back to life.
    const box = await surface.boundingBox();
    if (!box) throw new Error("no viewer box");
    await page.mouse.move(box.x + 60, box.y + box.height - 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + box.height - 90, { steps: 6 });
    await page.mouse.up();
    expect(await angle(el)).toBe(turned);
    await expect.poll(() => reset.isEnabled()).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("lets the wheel scroll the page over the 3D view until it is tapped, then zooms it, and hands the page back on Esc", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    const el = await sim(page, "four-bar");
    await drawn(el).waitFor({ timeout: 60_000 });
    const surface = el.locator("[data-viewer-object]");
    const reset = el.getByRole("button", { name: "Reset view" });
    const scrollY = () => page.evaluate(() => window.scrollY);
    await surface.evaluate((n) => n.scrollIntoView({ block: "center" }));
    const box = await surface.boundingBox();
    if (!box) throw new Error("no viewer box");
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    let before = await scrollY();
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, 200);
    await expect.poll(scrollY).not.toBe(before);
    expect(await reset.isDisabled()).toBe(true);
    // Tapped: the wheel zooms the view and the page stays put.
    await surface.evaluate((n) => n.scrollIntoView({ block: "center" }));
    await surface.click({ position: { x: 20, y: 20 } });
    await expect.poll(() => surface.getAttribute("aria-pressed")).toBe("true");
    before = await scrollY();
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => reset.isEnabled()).toBe(true);
    expect(await scrollY()).toBe(before);
    await page.keyboard.press("Escape");
    await expect.poll(() => surface.getAttribute("aria-pressed")).toBe("false");
    await context.close();
  });

  it("a page being scrolled is never held up by the 3D view starting: it starts once the scrolling stops (final review, the scroll flake)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // A slow runner: making the WebGL context takes 1.5 s of the page's thread, once.
    await context.addInitScript(() => {
      const make = HTMLCanvasElement.prototype.getContext;
      (window as unknown as { __made: number }).__made = 0;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/.test(type)) {
          (window as unknown as { __made: number }).__made += 1;
          for (const end = performance.now() + 1500; performance.now() < end;);
        }
        return (make as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof make;
    });
    const { page } = await open(context);
    const el = root(page, "four-bar");
    await el.scrollIntoViewIfNeeded();
    await page.locator('.mechanism[data-mechanism="four-bar"][data-ready="true"]').first().waitFor({ timeout: 60_000 });
    const surface = el.locator("[data-viewer-object]");
    await surface.evaluate((n) => n.scrollIntoView({ block: "center" }));
    const box = await surface.boundingBox();
    if (!box) throw new Error("no viewer box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Two and a half seconds of wheel, a notch every 100 ms, back and forth: every round trip to the page is
    // quick, though the viewer has been near the screen for longer than it waits before it starts.
    let slowest = 0;
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, i % 2 === 0 ? 40 : -40);
      const asked = Date.now();
      await page.evaluate(() => performance.now());
      slowest = Math.max(slowest, Date.now() - asked);
      await page.waitForTimeout(100);
    }
    expect(await page.evaluate(() => (window as unknown as { __made: number }).__made), "started mid-scroll").toBe(0);
    expect(slowest, "the slowest answer of the page while it was scrolled").toBeLessThan(700);
    // Once it is still, the view does start (and takes the 1.5 s it was given).
    await surface.evaluate((n) => n.scrollIntoView({ block: "center" }));
    await drawn(el).waitFor({ timeout: 60_000 });
    expect(await page.evaluate(() => (window as unknown as { __made: number }).__made)).toBe(1);
    await context.close();
  });

  it("the slider stays at its far end, and the arrow keys come back from it", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    const el = await sim(page, "gear-pair");
    const slider = el.getByRole("slider");
    await slider.fill("360");
    await page.waitForTimeout(100);
    expect(await slider.inputValue()).toBe("360");
    await slider.press("ArrowLeft");
    await expect.poll(() => slider.inputValue()).toBe("359.5");
    await context.close();
  });

  it("after Play has taken the gear pair past one turn, a step of the slider moves the driven gear a fraction of a degree, not half a turn", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "gear-pair");
    await tab(el, "2D").click();
    await play(el).click();
    // Past the wrap: the displayed angle came round to the start of the next turn.
    let high = false;
    await expect
      .poll(
        async () => {
          const now = await angle(el);
          high ||= now > 340;
          return high && now < 120;
        },
        { timeout: 60_000, interval: 50 },
      )
      .toBe(true);
    await play(el).click();
    expect(await el.getAttribute("data-playing")).toBe("false");
    const [driver0, driven0] = [await angle(el), await linkAngle(el, "driven")];
    const slider = el.getByRole("slider");
    await slider.press("ArrowRight");
    await expect.poll(async () => await angle(el)).not.toBe(driver0);
    const [driver1, driven1] = [await angle(el), await linkAngle(el, "driven")];
    // The driver stays on its turn: its displayed angle moves a step (snapped to the slider) or less, and the driven gear half as far,
    // the other way (the sheet's matrices are rounded to a thousandth of a degree).
    expect(Math.abs(driver1 - driver0)).toBeLessThanOrEqual(1);
    const moved = ((((driven1 - driven0) % 360) + 540) % 360) - 180;
    expect(moved).toBeCloseTo(-(driver1 - driver0) / 2, 2);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("the slider turns the four-bar to a chosen angle", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context);
    const el = await sim(page, "four-bar");
    await el.getByRole("slider").fill("200");
    expect(await el.getAttribute("data-angle")).toBe("200.000");
    await context.close();
  });

  it("turns the gear pair's driven gear the opposite way, two turns of the driver to one of its own", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context);
    const el = await sim(page, "gear-pair");
    await tab(el, "2D").click();
    expect(await el.locator("[data-ground]").count()).toBe(2);
    expect(await el.locator("[data-link]").count()).toBe(2);
    const slider = el.getByRole("slider");
    await slider.fill("0");
    const [driver0, driven0] = [await linkAngle(el, "driver"), await linkAngle(el, "driven")];
    await slider.fill("40");
    const [driver1, driven1] = [await linkAngle(el, "driver"), await linkAngle(el, "driven")];
    expect(driver0).toBeCloseTo(0, 3);
    expect(driver1).toBeCloseTo(40, 3);
    // 40° of the driver turns the 36-tooth wheel 20° the other way, from its half-pitch home at 185°.
    expect(driven0).toBeCloseTo(185, 3);
    expect(driven1).toBeCloseTo(165, 3);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("reduced motion stops the running mechanism at its current angle", async () => {
    for (const view of ["3D", "2D"] as const) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: "no-preference",
      });
      const { page, errors } = await open(context);
      const el = await sim(page, "four-bar");
      if (view === "2D") await tab(el, "2D").click();
      else await drawn(el).waitFor({ timeout: 60_000 });
      await play(el).click();
      await page.waitForTimeout(400);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => el.getAttribute("data-playing"), { message: view }).toBe("false");
      const stopped = await angle(el);
      await page.waitForTimeout(600);
      expect(await angle(el), view).toBe(stopped);
      // It had moved, and it didn't snap back to where it began.
      expect(stopped, view).not.toBe(60);
      expect(stopped, view).not.toBe(0);
      expect(await play(el).isDisabled(), view).toBe(true);
      expect(await el.locator('[data-note="reduced-motion"]').innerText(), view).toContain("Motion is reduced");
      expect(errors, view).toEqual([]);
      await context.close();
    }
  });

  it("opened under reduced motion, holds its angle and still moves by hand", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const { page } = await open(context);
    const el = await sim(page, "four-bar");
    await expect.poll(() => play(el).isDisabled()).toBe(true);
    await page.waitForTimeout(600);
    expect(await el.getAttribute("data-angle")).toBe("60.000");
    await el.getByRole("slider").fill("90");
    expect(await el.getAttribute("data-angle")).toBe("90.000");
    await context.close();
  });

  it("at 375px keeps the page from scrolling sideways, the drawing scrolling inside its box", async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const { page, errors } = await open(context);
    for (const type of ["four-bar", "gear-pair"] as const) {
      const el = await sim(page, type);
      await tab(el, "2D").click();
      const box = el.locator(".mechanism-sheet-box");
      await box.scrollIntoViewIfNeeded();
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sideways, type).toBeLessThanOrEqual(0);
      expect(await box.evaluate((b) => getComputedStyle(b).overflowX), type).toBe("auto");
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  it("falls back to the sheet drawing, saying why, when the browser can't draw WebGL", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        if (/webgl/i.test(kind)) return null;
        return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest) as RenderingContext | null;
      } as typeof original;
    });
    const { page } = await open(context);
    const el = await sim(page, "four-bar");
    await expect.poll(() => el.getAttribute("data-view"), { timeout: 60_000 }).toBe("2d");
    expect(await el.locator('[data-note="no-3d"]').innerText()).toBe(
      "This browser can't draw the mechanism in 3D: it is shown as the sheet drawing.",
    );
    expect(await tab(el, "3D").isDisabled()).toBe(true);
    expect(await el.locator("[data-link]").count()).toBe(3);
    await context.close();
  });
});
