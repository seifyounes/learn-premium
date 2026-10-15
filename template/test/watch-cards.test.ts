// A YouTube card in Watch, where the student meets it: after the NotebookLM video and audio, a link
// with a lazy thumbnail until a tap swaps in the player (in a real browser, Chromium). One build of
// the Fixture Course's Module 01 with a card planted in its real media.yaml (the committed Fixture
// has none, and `abcdefghijk` is a synthetic id). Chromium reaches nothing off this origin: every
// off-origin request is logged and aborted, so no test touches YouTube or Google.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, fixtureWith } from "./build-course";
import { serve } from "./serve";

const MODULE = "01-thermal-resistance";
const ID = "abcdefghijk";
const course = fixtureWith(`modules/${MODULE}/media.yaml`, (source) =>
  [
    source.trimEnd(),
    "youtube:",
    `  - id: ${ID}`,
    "    title: Thermal resistance, the Professor's way",
    "    channel: A channel",
    "    duration: '12:05'",
    "    match: 9",
    "    why: Adds layer resistances in a table, as the sheet does.",
    "    moments: [{ at: '3:15', label: The series rule }]",
    "",
  ].join("\n"),
);
const build = buildCourse(course);

describe("a YouTube card on the built page", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("Watch runs video, audio, then the card", () => {
    const page = build.page(MODULE);
    const watch = page.slice(page.indexOf('id="watch"'), page.indexOf('id="summary"'));
    const video = watch.indexOf("Explainer video");
    const audio = watch.indexOf("Deep Dive audio");
    const card = watch.indexOf("data-video-card");
    expect(video).toBeGreaterThanOrEqual(0);
    expect(video).toBeLessThan(audio);
    expect(audio).toBeLessThan(card);
  });
});

describe("a YouTube card in a browser", () => {
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

  /** A page of Module 01 in a fresh context, with every request logged and every off-origin one aborted. */
  async function open(width: number): Promise<{ page: Page; context: BrowserContext; requests: string[] }> {
    const phone = width < 768;
    const context = await browser.newContext({
      viewport: { width, height: phone ? 812 : 800 },
      ...(phone ? { isMobile: true, hasTouch: true } : {}),
    });
    const requests: string[] = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      requests.push(url);
      return url.startsWith(site.url) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${site.url}/${MODULE}/`);
    await page.locator(`[data-video-card="${ID}"]`).scrollIntoViewIfNeeded();
    return { page, context, requests };
  }

  const offOrigin = (requests: string[]) => requests.filter((url) => !url.startsWith(site.url));
  /** A rendered element's box; a missing or hidden one fails the test. */
  async function boxOf(page: Page, selector: string): Promise<{ width: number; height: number }> {
    const box = await page.locator(selector).boundingBox();
    if (box === null) throw new Error(`${selector} has no box on the page`);
    return box;
  }
  const frameBox = (page: Page) => boxOf(page, ".video-card-frame");
  const playerBox = (page: Page) => boxOf(page, "iframe.video-card-player");
  const summaryTop = (page: Page) =>
    page.evaluate(() => (document.getElementById("summary")?.getBoundingClientRect().top ?? NaN) + window.scrollY);
  const sixteenByNine = (box: { width: number; height: number }) => Math.abs(box.height - (box.width * 9) / 16);

  describe.each([
    ["a phone", 375],
    ["a laptop", 1280],
  ])("on %s", (_name, width) => {
    const phone = width < 768;
    const press = (page: Page, selector: string) => (phone ? page.tap(selector) : page.click(selector));

    it("fits the page, and the frame is a 16:9 box before anything plays", async () => {
      const { page, context } = await open(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
        0,
      );
      expect(sixteenByNine(await frameBox(page))).toBeLessThanOrEqual(1);
      await context.close();
    });

    it("reaches YouTube only on a tap: before it, nothing but the thumbnail leaves this origin", async () => {
      const { page, context, requests } = await open(width);
      await page.waitForTimeout(300);
      for (const url of offOrigin(requests)) expect(new URL(url).hostname, url).toBe("i.ytimg.com");
      expect(requests.filter((url) => /youtube\.com|youtube-nocookie\.com|googlevideo\.com/.test(url))).toEqual([]);
      expect(await page.locator("iframe").count()).toBe(0);
      await context.close();
    });

    it("swaps in the privacy-enhanced player on a tap, in the same place, from the start", async () => {
      const { page, context, requests } = await open(width);
      const before = await frameBox(page);
      const summary = await summaryTop(page);
      await press(page, ".video-card-frame");
      const player = page.locator("iframe.video-card-player");
      await player.waitFor();
      expect(await player.getAttribute("src")).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=0`);
      expect(requests.some((url) => url.startsWith("https://www.youtube.com/embed"))).toBe(false);
      expect(await page.locator(".video-card-frame").count()).toBe(0);
      const after = await playerBox(page);
      expect(sixteenByNine(after)).toBeLessThanOrEqual(1);
      if (phone) {
        // One column: the player takes the frame's own box, and nothing below it moves.
        expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
        expect(await summaryTop(page)).toBe(summary);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
        0,
      );
      await context.close();
    });

    it("jumps into the video from a moment: 3:15 starts at 195 s", async () => {
      const { page, context } = await open(width);
      await press(page, "[data-video-at]");
      const player = page.locator("iframe.video-card-player");
      await player.waitFor();
      expect(await player.getAttribute("src")).toBe(
        `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=195`,
      );
      await context.close();
    });
  });

  it("keeps the link when a modifier is held, so a new tab can still open", async () => {
    const { page, context } = await open(1280);
    const popup = context.waitForEvent("page").catch(() => undefined);
    await page.locator(".video-card-frame").click({ modifiers: ["Control"] });
    await popup;
    expect(await page.locator("iframe").count()).toBe(0);
    expect(await page.locator(".video-card-frame").getAttribute("href")).toBe(`https://www.youtube.com/watch?v=${ID}`);
    await context.close();
  });
});
