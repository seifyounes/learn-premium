// The STL sim where students meet it: inline in the Fixture Course's Worked example W06.1, opened on
// the example's values with one scan run, then in a real browser (Chromium): it steps a statement or
// a scan at a time with a trace, OB 1 starts every scan with its registers cleared, REAL values read
// as the shortest float32 round-trip, and what FC105 leaves behind reads "left by FC105". A listing
// with an instruction the interpreter lacks (planted here from the template's step-through corpus)
// ships as a step-through of awlsim's scans instead.
import { chromium, type Browser, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify, parse } from "yaml";
import { CORPUS_DIR } from "../oracle/listings.ts";
import { buildCourse, fixtureWith } from "./build-course";
import { serve } from "./serve";

const MODULE = "06-tank-level";
// The Fixture Course, with a listing the interpreter can't run planted in Module 06 (Lab only).
const corpus = parse(readFileSync(join(CORPUS_DIR, "step-through", "byte-swap.yaml"), "utf8")) as Record<
  string,
  unknown
>;
const listing = Object.fromEntries(Object.entries(corpus).filter(([key]) => key !== "covers"));
const course = fixtureWith(`modules/${MODULE}/sims/byte-swap.yaml`, () =>
  stringify({
    kind: "stl",
    title: "Byte order for a drive",
    caption: "A step-through of the oracle's scans.",
    recompute: "independent",
    ...listing,
    gateGap: 999,
    provenance: { stated: ["$4660$ and $305419896$"] },
  }),
);
mkdirSync(join(course, "build-records", "oracle", MODULE), { recursive: true });
copyFileSync(
  join(CORPUS_DIR, "step-through", "oracle", "byte-swap.json"),
  join(course, "build-records", "oracle", MODULE, "byte-swap.json"),
);
const build = buildCourse(course);

const textOf = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&#39;/g, "'");

describe("the STL sim on the built page", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sits inline in W06.1, opened on the example's values with one scan run, its keys off until hydrated", () => {
    const page = build.page(MODULE);
    const sim = page.slice(page.indexOf('id="sim-06-tank-level-tank"'));
    expect(sim).toMatch(/component-url="\/_astro\/StlSim\.[^"]+\.js"[^>]*client="visible"/);
    // The watch table after scan 1: a half-full tank, the volume as the shortest float32 round-trip.
    const watch = [
      ...sim.matchAll(
        /<tr[^>]*><td class="stl-td text-graphite">([^<]+)<\/td><td class="stl-td stl-value text-graphite">([^<]+)<\/td>/g,
      ),
    ].map((m) => `${m[1]} = ${m[2]}`);
    expect(watch.slice(0, 7)).toEqual([
      "MW 20 = 13824",
      "MW 22 = W#16#0000",
      "MD 24 = 1.0",
      "MD 28 = 1.5707964",
      "MD 32 = 6283.1855",
      "MW 36 = 2",
      "MD 40 = L#138240",
    ]);
    expect(textOf(sim)).toMatch(/Scan 1 · statement (\d+) of \1/);
    const buttons = [...sim.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThan(3);
    for (const button of buttons.slice(0, 6)) expect(button).toContain("disabled");
  });

  it("ships a listing with an instruction the interpreter lacks as a step-through of awlsim's scans", () => {
    const lab = build.page("lab");
    const sim = lab.slice(lab.indexOf('id="sim-06-tank-level-byte-swap"'));
    expect(sim).toMatch(/data-recompute="independent"/);
    expect(sim).toContain('data-sim="stl-replay"');
    expect(textOf(sim)).toContain("the interpreter doesn't run CAW, CAD yet");
    // awlsim's values: 16#1234 with its bytes swapped is 16#3412.
    expect(sim).toContain("W#16#3412");
  });
});

describe("the STL sim in a browser", () => {
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
    await page.locator('[data-sim="stl"]').scrollIntoViewIfNeeded();
    await page.locator('[data-sim="stl"][data-ready="true"]').waitFor();
    return { page, errors };
  }
  const sim = (page: Page) => page.locator('[data-sim="stl"]');
  const press = (page: Page, name: string) => sim(page).getByRole("button", { name, exact: true }).click();
  const counter = (page: Page) => sim(page).locator(".stl-counter").innerText();
  const register = (page: Page, i: number) => sim(page).locator(".stl-register").nth(i).innerText();
  const watch = async (page: Page, operand: string) =>
    (await sim(page).locator(".stl-watch tr", { hasText: operand }).first().innerText()).split(/\s+/).at(-1);

  it("steps a statement at a time: a new scan starts OB 1 with its accumulators cleared", async () => {
    const { page, errors } = await open(1280);
    await press(page, "Step");
    expect(await counter(page)).toContain("Scan 2 · statement 1");
    expect(await sim(page).locator(".stl-statement").innerText()).toMatch(/9\s+L PIW 256/);
    // ACCU 2 took ACCU 1, which OB 1's start had cleared: the last scan's REAL is gone.
    expect(await register(page, 1)).toMatch(/ACCU 2\s+0\s+16#0000_0000/);
    expect(await register(page, 0)).toMatch(/ACCU 1\s+13624/);
    await press(page, "Step");
    await press(page, "Step");
    expect(await sim(page).locator(".stl-trace tbody tr").count()).toBe(3);
    expect(await sim(page).locator(".stl-line[data-current] .stl-number").innerText()).toBe("11");
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("shows what FC105 leaves behind as left by FC105, and its REAL OUT as the shortest float32", async () => {
    const { page } = await open(1280);
    for (let i = 0; i < 7; i++) await press(page, "Step");
    expect(await sim(page).locator(".stl-statement").innerText()).toMatch(/CALL FC 105/);
    expect(await register(page, 0)).toMatch(/left by FC105/);
    expect(await sim(page).locator(".stl-bit[data-left]").count()).toBe(5);
    expect(await watch(page, "MD 24")).toBe("1.0");
    await page.context().close();
  });

  it("runs a scan on new inputs: past the range FC105 clamps, RET_VAL is 8 and the alarm latches until acknowledged", async () => {
    const { page, errors } = await open(1280);
    const typed = sim(page).getByRole("textbox", { name: "PIW 256, typed" });
    await typed.fill("30000");
    expect(await counter(page)).toContain("new inputs from the next scan");
    await press(page, "Run a scan");
    expect(await watch(page, "MW 22")).toBe("W#16#0008");
    expect(await watch(page, "MD 24")).toBe("2.0");
    expect(await watch(page, "M 1.0")).toBe("1");
    await typed.fill("10000");
    await press(page, "Run a scan");
    expect(await watch(page, "M 1.0")).toBe("1");
    await sim(page)
      .getByRole("button", { name: /I 0\.0/ })
      .click();
    await press(page, "Run a scan");
    expect(await watch(page, "M 1.0")).toBe("0");
    await press(page, "Reset");
    expect(await counter(page)).toMatch(/Scan 1 · statement (\d+) of \1/);
    expect(await watch(page, "MD 32")).toBe("6283.1855");
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("fits a phone: nothing scrolls the page sideways, and the listing scrolls in its own box", async () => {
    const { page, errors } = await open(375);
    await press(page, "Step");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const listing = await sim(page)
      .locator(".stl-listing")
      .evaluate((e) => e.scrollHeight > e.clientHeight);
    expect(listing).toBe(true);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("steps through the step-through's precomputed scans, its inputs fixed", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${site.url}/lab/`);
    const replay = page.locator('[data-sim="stl-replay"]');
    await replay.scrollIntoViewIfNeeded();
    await page.locator('[data-sim="stl-replay"][data-ready="true"]').waitFor();
    expect(await replay.locator('input[type="range"]').count()).toBe(0);
    await replay.getByRole("button", { name: "Step", exact: true }).click();
    expect(await replay.locator(".stl-counter").innerText()).toContain("statement 1");
    await replay.getByRole("button", { name: "Finish the scan", exact: true }).click();
    expect(await replay.locator(".stl-watch tr", { hasText: "MW 2" }).first().innerText()).toContain("W#16#3412");
    await context.close();
  });
});
