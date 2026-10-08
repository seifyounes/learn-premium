// The control sim where students meet it, inline in W08.1 on the built Fixture Course: the block
// diagram drawn at build, the table opened on the example's gain at the sheet's precision, and no
// python-control (no Python at all) anywhere in the page. Then in Chromium: dragging a closed-loop
// pole along the locus sets the gain, every tab draws its board, and the step response carries the
// red pen's marks.
import { chromium, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "08-root-locus";
const build = buildCourse(FIXTURE_COURSE);

/** The sim's card on the built Module page. */
const card = () => {
  const page = build.page(MODULE);
  return page.slice(page.indexOf('data-sim-kind="control"'));
};

describe("the control sim on the built page", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("opens on the example's gain: the block diagram drawn at build, the table at the sheet's 3 decimals", () => {
    const html = card();
    expect(html).toMatch(/component-url="\/_astro\/ControlSim\.[^"]+\.js"[^>]*client="visible"/);
    expect(html).toMatch(/<svg class="schematic" width="\d+" height="\d+"/);
    for (const label of ["R(s)", "K", "G(s)", "Y(s)"]) expect(html).toContain(`>${label}</text>`);
    // One take-off point, dotted as the figure dots it.
    expect(html.match(/class="schematic-dot/g)).toHaveLength(1);
    const value = (row: string) => new RegExp(`data-row="${row}"[\\s\\S]*?<td[^>]*>([^<]*)<`).exec(html)?.[1];
    expect(["wn", "zeta", "sigma", "wd", "overshoot", "Tp", "Tr", "Ts", "wc", "PM"].map(value)).toEqual([
      "2.000",
      "0.500",
      "−1.000",
      "1.732",
      "16.303",
      "1.814",
      "0.819",
      "4.038",
      "1.572",
      "51.827",
    ]);
    const controls = [...html.matchAll(/<(?:input[^>]*type="range"|button)[^>]*>/g)].map((m) => m[0]);
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) expect(control).toContain("disabled");
  });

  it("never loads python-control: the page and the sim's chunks hold no Pyodide", () => {
    const page = build.page(MODULE);
    expect(page).not.toContain("data-python-tool");
    expect(page).not.toMatch(/\/pyodide\//);
    const island = /component-url="\/_astro\/(ControlSim\.[^"]+\.js)"/.exec(page)?.[1] ?? "";
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(join(build.outDir, "_astro", file), "utf8");
      expect(code, file).not.toMatch(/loadPyodide|pyodide\.asm/);
      for (const m of code.matchAll(/(?:from|import\()\s*["'`]\.\/([^"'`]+\.js)["'`]/g)) visit(m[1] ?? "");
    };
    visit(island);
    // The island, JSXGraph and the shared chunks it pulls in: every one read.
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe("the control sim in a browser", () => {
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

  it("sets K from a dragged pole, draws every tab's board, and marks the step response in red pen", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await context.newPage();
    const errors: string[] = [];
    tab.on("pageerror", (e) => errors.push(e.message));
    await tab.goto(`${site.url}/${MODULE}/`);
    const sim = tab.locator('[data-sim="control"]');
    await sim.scrollIntoViewIfNeeded();
    await tab.locator('[data-sim="control"][data-ready="true"]').waitFor();
    const handle = sim.locator('[data-board="locus"] .sim-handle').first();
    await handle.waitFor();
    const gain = () => sim.locator(".sim-slider output").innerText();
    expect(await gain()).toBe("4.0");
    // The upper pole dragged up the locus: a higher gain, a faster and less damped loop.
    const box = await handle.boundingBox();
    if (!box) throw new Error("the pole's handle isn't drawn");
    await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tab.mouse.down();
    await tab.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 6 });
    await tab.mouse.up();
    await expect.poll(async () => Number(await gain())).toBeGreaterThan(4);
    const zeta = await sim.locator('[data-row="zeta"] td').innerText();
    expect(Number(zeta)).toBeLessThan(0.5);
    await sim.getByRole("button", { name: "Back to the example" }).click();
    await expect.poll(gain).toBe("4.0");

    for (const [name, boards] of [
      ["Step", ["step"]],
      ["Bode", ["bode-magnitude", "bode-phase"]],
      ["Nyquist", ["nyquist"]],
    ] as const) {
      await sim.getByRole("tab", { name }).click();
      for (const board of boards)
        await expect
          .poll(() => sim.locator(`[data-board="${board}"] svg path`).count(), { message: board })
          .toBeGreaterThan(2);
    }
    // The red pen's two marks on the step response: strokes in the pen's own ink, never a fill.
    await sim.getByRole("tab", { name: "Step" }).click();
    const pen = await tab.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-red-pen").trim().toLowerCase(),
    );
    const marks = await sim.locator('[data-board="step"] svg path').evaluateAll(
      (paths, ink) =>
        paths
          .filter((p) => (p.getAttribute("stroke") ?? "").toLowerCase() === ink)
          .map((p) => {
            const style = getComputedStyle(p);
            return style.fill !== "none" && Number(style.fillOpacity) > 0;
          }),
      pen,
    );
    // Neither mark paints a fill.
    expect(marks).toEqual([false, false]);
    expect(errors).toEqual([]);
    await context.close();
  });
});
