// A molecule on the built Fixture Course (Module 13's glycine): the 2D structure inlined exactly as
// RDKit drew it, its formula set by mhchem, the 3D viewer an island that loads 3Dmol.js only once it
// is on screen, in standard Jmol CPK with an element key. Then in Chromium: 3Dmol.js stays out of the
// initial load, the atoms are drawn in the palette the key shows, the page scrolls over the viewer
// until it is tapped, a tap on an atom names it, and the stage gives its WebGL context back off screen.
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { elementCounts } from "../src/molecules/formula.ts";
import { inlineSvg } from "../src/molecules/svg.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "13-cell-potential";
const SVG = readFileSync(join(FIXTURE_COURSE, "modules", MODULE, "molecules", "glycine.svg"), "utf8");
const build = buildCourse(FIXTURE_COURSE);
const is3Dmol = (url: string) => /3dmol/i.test(new URL(url).pathname);

describe("the molecule on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sits below its Worked example, in the Lab and in the Tool gallery", () => {
    for (const route of [MODULE, "lab", "tool-gallery"]) {
      const page = build.page(route);
      expect(page, route).toContain(`id="molecule-${MODULE}-glycine"`);
    }
    const worked = build.page(MODULE);
    expect(worked.indexOf(`id="molecule-${MODULE}-glycine"`)).toBeGreaterThan(worked.indexOf("W13.1"));
    // After the Nernst cell: the cell is the Worked example's sim, the molecule is its figure.
    expect(worked.indexOf(`id="molecule-${MODULE}-glycine"`)).toBeGreaterThan(
      worked.indexOf(`id="sim-${MODULE}-cell"`),
    );
  });

  it("the page inlines the structure exactly as built", () => {
    expect(build.page(MODULE)).toContain(inlineSvg(SVG, "Glycine"));
    // The drawing is graphite, and not a pixel of it scaled: it keeps RDKit's own size in a box that scrolls.
    expect(inlineSvg(SVG, "Glycine")).toMatch(/^<svg role="img" aria-label="Glycine" class="structure-svg"/);
    expect(build.page(MODULE)).toMatch(/<div class="structure-box" dir="ltr">\s*<svg /);
  });

  it("sets the formula with mhchem: C2H5NO2 as a KaTeX \\ce", () => {
    const line = /<p class="molecule-formula"[^>]*>([\s\S]*?)<\/p>/.exec(build.page(MODULE))?.[1] ?? "";
    expect(line).toContain('class="katex"');
    expect(line).toContain("\\ce{C2H5NO2}");
    expect(line).not.toContain("katex-error");
    expect(elementCounts("NH2CH2COOH")).toEqual(elementCounts("C2H5NO2"));
  });

  it("is an island that loads when visible, its controls off until it hydrates", () => {
    const page = build.page(MODULE);
    expect(page).toMatch(/component-url="\/_astro\/MoleculeViewer\.[^"]+\.js"[^>]*client="visible"/);
    const card = page.slice(page.indexOf(`id="molecule-${MODULE}-glycine"`));
    const buttons = [...card.slice(0, card.indexOf("</article>")).matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(1); // Reset view
    expect(buttons[0]).toContain("disabled");
    expect(card).toContain('aria-disabled="true"');
    expect(card).not.toContain("data-viewer>");
    expect(card).not.toMatch(/<div class="sim viewer molecule-viewer"[^>]* data-viewer[ >]/);
  });

  it("3dmol isn't in the island's static imports", () => {
    const island = /component-url="\/_astro\/(MoleculeViewer\.[^"]+\.js)"/.exec(build.page(MODULE))?.[1] ?? "";
    const code = readFileSync(join(build.outDir, "_astro", island), "utf8");
    expect(code).not.toContain("$3Dmol");
    const staticImports = [...code.matchAll(/^import[^;]*from["'`]\.\/([^"'`]+)["'`]/gm)].map((m) => m[1] ?? "");
    for (const file of staticImports) {
      expect(file, "a static import of 3Dmol").not.toMatch(/3dmol/i);
      expect(readFileSync(join(build.outDir, "_astro", file), "utf8"), file).not.toContain("$3Dmol");
    }
    // It is a chunk of its own, reached by a dynamic import.
    expect(code).toMatch(/import\(["'`]\.\/3Dmol\.[^"'`]+\.js["'`]\)/);
  });

  it("lists C, H, N and O in the key, each dotted in its CPK colour", () => {
    const page = build.page(MODULE);
    const key = /<ul class="element-key"[^>]*>([\s\S]*?)<\/ul>/.exec(page)?.[1] ?? "";
    const entries = [...key.matchAll(/<li data-element="(\w+)">[\s\S]*?background-color:(#[0-9A-F]{6})/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(entries).toEqual([
      ["C", "#909090"],
      ["H", "#FFFFFF"],
      ["N", "#3050F8"],
      ["O", "#FF0D0D"],
    ]);
  });
});

describe("the molecule's viewer in a browser", () => {
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

  const viewer = (page: Page) => page.locator(".molecule-viewer").first();
  const object = (page: Page) => viewer(page).locator("[data-viewer-object]");
  const reset = (page: Page) => viewer(page).getByRole("button", { name: "Reset view" });
  const state = (page: Page) => object(page).getAttribute("data-viewer-state");
  async function drawn(page: Page) {
    await object(page).scrollIntoViewIfNeeded();
    await page.locator('.molecule-viewer[data-drawn="true"]').first().waitFor({ timeout: 60_000 });
  }
  const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
  const centre = async (page: Page) => {
    const box = await object(page).boundingBox();
    if (!box) throw new Error("the viewer has no box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  it("keeps 3Dmol.js out of the initial load, fetching it once the viewer is on screen", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors, requests } = await open(context, `/${MODULE}/`);
    await page.waitForTimeout(500);
    expect(requests.filter(is3Dmol)).toEqual([]);
    await drawn(page);
    expect(requests.filter(is3Dmol).length).toBeGreaterThan(0);
    expect(await state(page)).toBe("drawn");
    // The molecule is drawn: the frame looks different with its canvas hidden.
    const frame = object(page);
    const before = await frame.screenshot();
    await frame.evaluate((el) => el.querySelector("canvas")?.style.setProperty("visibility", "hidden"));
    expect(before.equals(await frame.screenshot())).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("3Dmol draws each atom in the palette its key shows", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, `/${MODULE}/`);
    await drawn(page);
    const root = viewer(page);
    const drawnPalette = JSON.parse((await root.getAttribute("data-drawn-palette")) ?? "{}") as Record<string, string>;
    expect(drawnPalette).toEqual({ C: "#909090", H: "#FFFFFF", N: "#3050F8", O: "#FF0D0D" });
    // What the viewer was asked to draw is what the key shows, dot for dot.
    expect(JSON.parse((await root.getAttribute("data-palette")) ?? "{}")).toEqual(drawnPalette);
    const key = await root
      .locator(".element-key li")
      .evaluateAll((items) =>
        items.map((li) => [
          li.getAttribute("data-element"),
          getComputedStyle(li.querySelector(".element-dot") as Element).backgroundColor,
        ]),
      );
    expect(key).toEqual([
      ["C", "rgb(144, 144, 144)"],
      ["H", "rgb(255, 255, 255)"],
      ["N", "rgb(48, 80, 248)"],
      ["O", "rgb(255, 13, 13)"],
    ]);
    // And on the canvas: the pixels at an oxygen are red, at a nitrogen blue.
    await page.evaluate(() =>
      document.querySelector(".molecule-viewer [data-viewer-object]")?.scrollIntoView({ block: "center" }),
    );
    await page.waitForTimeout(300);
    const atoms = JSON.parse((await object(page).getAttribute("data-atom-screen")) ?? "[]") as [
      string,
      number,
      number,
    ][];
    expect(
      atoms
        .map(([element]) => element)
        .sort()
        .join(""),
    ).toBe("CCHHHHHNOO");
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const shot = (await page.screenshot({ type: "png" })).toString("base64");
    /** The mean colour of the 3 x 3 pixels round an atom, read back from the page's own screenshot. */
    const pixel = ([, x, y]: [string, number, number]) =>
      page.evaluate(
        async ([png, px, py]) => {
          const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const g = canvas.getContext("2d") as CanvasRenderingContext2D;
          g.drawImage(image, 0, 0);
          const data = g.getImageData(Number(px) - 1, Number(py) - 1, 3, 3).data;
          const mean = [0, 0, 0];
          for (let i = 0; i < data.length; i += 4)
            for (let c = 0; c < 3; c++) mean[c] = (mean[c] ?? 0) + (data[i + c] ?? 0) / 9;
          return mean;
        },
        [shot, x - scroll.x, y - scroll.y] as const,
      );
    const [r = 0, , b = 0] = await pixel(atoms.find(([e]) => e === "N") as [string, number, number]);
    expect(b).toBeGreaterThan(r + 60);
    // The two oxygens: red. One may sit behind a hydrogen's highlight, so one of them is read.
    const reds = await Promise.all(atoms.filter(([e]) => e === "O").map(pixel));
    expect(reds.some(([or = 0, og = 255, ob = 255]) => or > 150 && og < 90 && ob < 90)).toBe(true);
    await context.close();
  });

  it("lets the wheel scroll the page over it until it is tapped, then zooms, and hands the page back on Esc", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, `/${MODULE}/`);
    await drawn(page);
    await page.evaluate(() =>
      document.querySelector(".molecule-viewer [data-viewer-object]")?.scrollIntoView({ block: "center" }),
    );
    const at = await centre(page);
    await page.mouse.move(at.x, at.y);
    let before = await scrollY(page);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
    expect(await reset(page).isDisabled()).toBe(true);

    // A tap on the molecule takes it: the wheel zooms it now, and the page stays.
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
    // The molecule is near the page's end, so the page scrolls back up: it has the wheel again.
    await page.mouse.wheel(0, -300);
    await expect.poll(() => scrollY(page)).toBeLessThan(before);
    await context.close();
  });

  it("a tap on an atom names it: its symbol shows in the gutter", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(context, `/${MODULE}/`);
    await drawn(page);
    await page.evaluate(() =>
      document.querySelector(".molecule-viewer [data-viewer-object]")?.scrollIntoView({ block: "center" }),
    );
    const picked = () => viewer(page).locator("[data-picked-atom]").textContent();
    expect(await picked()).toBe("");
    // The first tap takes the viewer; each later one names the atom nearest it.
    const here = await centre(page);
    await page.mouse.click(here.x, here.y);
    await expect.poll(() => object(page).getAttribute("aria-pressed")).toBe("true");
    const atoms = JSON.parse((await object(page).getAttribute("data-atom-screen")) ?? "[]") as [
      string,
      number,
      number,
    ][];
    const nitrogen = atoms.find(([element]) => element === "N");
    const oxygen = atoms.find(([element]) => element === "O");
    expect(nitrogen && oxygen).toBeTruthy();
    // The atoms' places are the page's: the viewport's are those less the scroll.
    const at = async ([, x, y]: [string, number, number]) =>
      page.evaluate(([px, py]) => ({ x: (px ?? 0) - window.scrollX, y: (py ?? 0) - window.scrollY }), [x, y] as const);
    for (const atom of [nitrogen, oxygen] as [string, number, number][]) {
      const there = await at(atom);
      await page.mouse.click(there.x, there.y);
      await expect.poll(picked).toBe(atom[0]);
    }
    expect(await picked()).toMatch(/^(C|H|N|O)$/);
    // Hovering names an atom too, with no tap.
    await page.keyboard.press("Escape");
    const hover = await at(nitrogen as [string, number, number]);
    await page.mouse.move(hover.x + 40, hover.y + 40);
    await page.mouse.move(hover.x, hover.y);
    await page.mouse.move(hover.x + 1, hover.y + 1);
    await expect.poll(picked).toBe("N");
    await context.close();
  });

  it("gives its WebGL context back when scrolled far away, and draws again on the way back", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(context, `/${MODULE}/`);
    await drawn(page);
    expect(await object(page).locator("canvas").count()).toBe(1);
    // Far away: a tall gap above the viewer, the page at its top.
    await page.evaluate(() => {
      const gap = document.createElement("div");
      gap.style.blockSize = "6000px";
      document.querySelector(".molecule-card")?.before(gap);
      window.scrollTo(0, 0);
    });
    await expect.poll(() => state(page), { timeout: 15_000 }).toBe("waiting");
    expect(await object(page).locator("canvas").count()).toBe(0);
    await page.evaluate(() => document.querySelector(".molecule-viewer")?.scrollIntoView({ block: "center" }));
    await expect.poll(() => state(page), { timeout: 30_000 }).toBe("drawn");
    expect(await object(page).locator("canvas").count()).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });
});
