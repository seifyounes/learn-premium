import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { BROWSER_GATES } from "../gates/browser.ts";
import { sitePages } from "../gates/pages.ts";
import { assertWidth, browserRun, IN_PAGE, WIDTH_ARRIVES_MS, WIDTHS } from "../gates/browser/run.ts";
import { GATES } from "../gates/index.ts";
import { runGates, type Gate, type GateInput } from "../gates/runner.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BROWSERS = 2;

/** What each negative control's finding must say: the check that names its defect caught it. */
const CAUGHT_BY: Record<string, RegExp> = {
  "a block wider than the viewport, so the page scrolls sideways": /the page scrolls sideways/,
  "a value chip positioned over a figure's line": /"9\.6 kW" covers its path/,
  "a value chip positioned over a figure drawn in layers": /"7\.2 kW" covers its path/,
  "content lifted above the top of the page": /"Lifted off the page\." sits \d+px above the page/,
  "two paragraphs drawn on the same pixels":
    /"Heat flows from hot to cold\." and .*"Resistances in series add\." overlap/,
  "a height-locked box whose content is taller than it": /holds \d+px of content in a 24px box/,
  "text set under the 12px floor": /"Small print under the floor\." is drawn at 10\.0px, under the 12px floor/,
  "a KaTeX error span on the page": /a KaTeX error on the page: ParseError: planted/,
  "raw TeX a script wrote into the page": /raw TeX on the page: "so \$R = \\frac\{L\}\{kA\}\$"/,
  "a hollow 0/0 score a script wrote": /a hollow 0\/0 on the page: "Score: 0\/0"/,
  "floating-point noise a script computed":
    /a wrong number \(floating-point noise\) on the page: "Heat loss: 0\.30000000000000004 kW"/,
  "NaN a script computed": /a wrong number \(NaN\) on the page: "Heat loss: NaN kW"/,
  "an object a script printed": /an \[object Object\] on the page: "Answer: \[object Object\]"/,
  "a placeholder a script never filled": /an unrendered \{\{placeholder\}\} on the page: "\{\{MODULE_TITLE\}\}"/,
  "an uncaught error as the page loads": /an uncaught error on the page: planted/,
  "an island control that works before its island hydrates": /<button> "Try first" works before its island hydrates/,
  "an island that hydrates and leaves every control off":
    /every control of the island \/_astro\/inert\.planted\.js is still disabled after it hydrated/,
  "an island that never hydrates": /the island \/_astro\/missing\.js never hydrated/,
  "a button that does nothing when tapped": /a tap on <button> "Does nothing" changed nothing/,
  "a field that drops what is typed": /typing into <input> "" after a tap did nothing/,
  "a button that throws when tapped": /an uncaught error while tapping: planted on tap/,
  "a button under a transparent layer that takes the tap": /<button> "Tap me" can't be tapped/,
  "three.js loaded with the page": /three\.js loads with the page/,
  "Pyodide loaded with the page": /Pyodide loads with the page/,
  "Plotly loaded with the page": /Plotly loads with the page/,
  "three.js asked for from a CDN with the page":
    /three\.js loads with the page \(https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/build\/three\.module\.js\)/,
  "a Trap page whose folded figure is labelled at a legal size":
    /missed the Trap page's seeded figure labelled under the 12px floor/,
  "a Trap page without its KaTeX error": /missed the Trap page's seeded KaTeX error/,
  "a Trap page whose value chip sits clear of its figure":
    /missed the Trap page's seeded value chip laid over a figure/,
  "a Trap page that computes its number right": /missed the Trap page's seeded wrong number/,
  "a build without the Trap page": /no Trap page at \/trap\//,
};

const gate = (id: string) => BROWSER_GATES.find((g) => g.id === id) as Gate;

describe("the browser gates on the Fixture Course", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const input: GateInput = { contentDir: FIXTURE_COURSE, distDir: build.outDir };

  it("builds, with the Trap page in the preview build", () => {
    expect(build.ok, build.output).toBe(true);
    expect(existsSync(join(build.outDir, "trap", "index.html"))).toBe(true);
  });

  it("run at the Module point only: a production deploy has no Trap page, so a run there would be void", () => {
    const at = (point: "job" | "module" | "deploy") => GATES.filter((g) => g.points.includes(point)).map((g) => g.id);
    for (const g of BROWSER_GATES) {
      expect(at("module")).toContain(g.id);
      expect(at("deploy")).not.toContain(g.id);
      expect(at("job")).not.toContain(g.id);
    }
  });

  it("pass on the whole Course, sweeping every page at every width in both browsers", async () => {
    // A Module-point run with no Module named opens every page of the Course.
    const report = await runGates({ point: "module", commit: COMMIT, input, gates: BROWSER_GATES });
    expect(report.green, JSON.stringify(report.gates, null, 2)).toBe(true);
    const coverage = (id: string) => report.gates.find((g) => g.id === id)?.coverage ?? {};
    // Every built page but the Trap page: the Course hubs, every Module, the Tool gallery.
    const pages = sitePages(input).length;
    expect(coverage("layout-sweep")).toMatchObject({ browsers: BROWSERS, widths: WIDTHS.length, pages });
    expect(coverage("layout-sweep").sweeps).toBe(BROWSERS * WIDTHS.length * pages);
    // The Given box is the Module page's collapsible; the sweep opened it.
    expect(coverage("layout-sweep").collapsibles).toBeGreaterThanOrEqual(1);
    // A Worked example's Table | Plot tabs add a view at the widths that show them.
    expect(coverage("layout-sweep").views).toBeGreaterThan(coverage("layout-sweep").sweeps ?? 0);
    expect(coverage("live-page-scan").formulas).toBeGreaterThan(0);
    expect(coverage("hydration").islands).toBeGreaterThan(4);
    expect(coverage("hydration").controls).toBeGreaterThan(10);
    expect(coverage("touch").taps).toBeGreaterThan(20);
    expect(coverage("initial-load").requests).toBeGreaterThan(0);
    // Every sweep of the Trap page found all four seeded defects.
    expect(coverage("trap-page")).toEqual({ sweeps: BROWSERS * WIDTHS.length, defects: BROWSERS * WIDTHS.length * 4 });
  }, 1_200_000);

  it("each catch every negative control, by the check that names its defect", async () => {
    const misses: string[] = [];
    for (const g of BROWSER_GATES) {
      expect(g.controls.length, g.id).toBeGreaterThan(0);
      for (const control of g.controls) {
        const scratch = mkdtempSync(join(tmpdir(), `lp-browser-${g.id}-`));
        try {
          const result = await g.run(control.plant(input, scratch));
          const blocks = result.findings.filter((f) => f.outcome === "block").map((f) => f.message);
          const expected = CAUGHT_BY[control.defect];
          if (!expected) misses.push(`${g.id}: no expectation for "${control.defect}"`);
          else if (!blocks.some((m) => expected.test(m)))
            misses.push(
              `${g.id}: "${control.defect}" was not caught as ${expected}; it found ${JSON.stringify(blocks)}`,
            );
        } catch (error) {
          misses.push(`${g.id}: "${control.defect}" crashed: ${(error as Error).message}`);
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }
    }
    expect(misses).toEqual([]);
  }, 1_200_000);

  it("a run that misses a Trap page defect is void: every other browser gate fails", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "lp-browser-void-"));
    try {
      const control = gate("trap-page").controls.find((c) => /KaTeX/.test(c.defect));
      const report = await runGates({
        point: "module",
        commit: COMMIT,
        input: control?.plant(input, scratch) ?? input,
        gates: BROWSER_GATES,
      });
      expect(report.green).toBe(false);
      for (const result of report.gates) {
        if (result.id === "trap-page") expect(result.status).toBe("block");
        else {
          expect(result.status, result.id).toBe("failed");
          expect(result.error).toMatch(/the browser run is void: the run missed the Trap page's seeded KaTeX error/);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("the Trap page", () => {
  it("is left out of a production build", () => {
    const build = buildCourse(FIXTURE_COURSE, { VERCEL_ENV: "production" });
    expect(build.ok, build.output).toBe(true);
    expect(existsSync(join(build.outDir, "trap"))).toBe(false);
    expect(existsSync(join(build.outDir, "index.html"))).toBe(true);
  }, 300_000);
});

describe("the layout sweep's figure check", () => {
  it("finds a label on a 1px line wherever the line falls between pixels", async () => {
    // A 1px stroke centred at x = 12 covers 11.5 to 12.5: a grid sampling every 2px from the
    // label's edge (x = 11, 13, ...) steps right over it, as it did on the Linux runner.
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
      await page.setContent(
        `<body style="margin: 0"><figure style="position: relative; margin: 0">
          <svg width="200" height="100" viewBox="0 0 200 100" style="display: block">
            <path d="M12 0V100" fill="none" stroke="black" stroke-width="1"/>
          </svg>
          <span style="position: absolute; left: 10px; top: 30px; font: 16px/20px monospace">T3</span>
        </figure></body>`,
      );
      // An init script doesn't run on set content; add the sweep to the page as it stands.
      await page.addScriptTag({ content: IN_PAGE });
      const found = await page.evaluate(() =>
        (window as unknown as { __lpSweep: { scan(): { layout: { kind: string; detail: string }[] } } }).__lpSweep
          .scan()
          .layout.filter((f) => f.kind === "covers-figure")
          .map((f) => f.detail),
      );
      expect(found).toEqual([expect.stringMatching(/"T3" covers its path/)]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("the layout sweep's settle", () => {
  it("measures a figure after its ResizeObserver redraws it, not before", async () => {
    // A frame runs its animation callbacks before its layout and its ResizeObservers. The settle
    // used to end in one, so a width that first reached the layout in that frame (a resize that
    // reached the page late, on a loaded runner) was measured before the gradient-descent sim's
    // ResizeObserver redrew its board: a tick label still placed for the old size sat on the
    // caption. A figure that places its label from a ResizeObserver, resized in the frame the
    // settle's last wait falls in, stands in for it.
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
      await page.setContent(
        `<body style="margin: 0"><figure id="figure" style="position: relative; margin: 0">
          <svg width="100%" height="100" viewBox="0 0 100 100" preserveAspectRatio="none" style="display: block">
            <path d="M50 0V100" fill="none" stroke="black" stroke-width="1" vector-effect="non-scaling-stroke"/>
          </svg>
          <span id="label" style="position: absolute; top: 30px; font: 16px/20px monospace">T3</span>
        </figure>
        <script>
          const figure = document.getElementById("figure");
          const label = document.getElementById("label");
          // 50px left of the line: clear of it, until the line moves and the label hasn't yet.
          new ResizeObserver(() => (label.style.left = figure.clientWidth / 2 - 50 + "px")).observe(figure);
        </script></body>`,
      );
      await page.addScriptTag({ content: IN_PAGE });
      type Sweep = { settle(): Promise<void>; scan(): { layout: { detail: string }[] } };
      const found = await page.evaluate(async () => {
        const sweep = (window as unknown as { __lpSweep: Sweep }).__lpSweep;
        await sweep.settle();
        const figure = document.getElementById("figure") as HTMLElement;
        // Two frames on: the frame the settle's last wait falls in.
        requestAnimationFrame(() => requestAnimationFrame(() => (figure.style.width = "320px")));
        await sweep.settle();
        return sweep.scan().layout.map((f) => f.detail);
      });
      expect(found).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

describe("the hydration check", () => {
  const build = buildCourse(FIXTURE_COURSE);

  it("waits out an island that is slow to hydrate: only one that never does fails", async () => {
    // Under a CI runner's load a Worked example took up to 24s to hydrate, and did. A renderer that
    // takes 15s stands in for it.
    expect(build.ok, build.output).toBe(true);
    const scratch = mkdtempSync(join(tmpdir(), "lp-slow-island-"));
    try {
      const site = join(scratch, "site");
      cpSync(build.outDir, site, { recursive: true });
      const path = join(site, "01-thermal-resistance", "index.html");
      const page = readFileSync(path, "utf8");
      const renderer = /renderer-url="([^"]+)"/.exec(page)?.[1];
      expect(renderer).toBeDefined();
      writeFileSync(
        join(site, "_astro", "slow-renderer.js"),
        `import real from "${renderer}";\nexport default (el) => async (...args) => { await new Promise((r) => setTimeout(r, 15000)); return real(el)(...args); };\n`,
      );
      writeFileSync(path, page.replace(/renderer-url="[^"]+"/, 'renderer-url="/_astro/slow-renderer.js"'));
      const run = await browserRun({ contentDir: FIXTURE_COURSE, distDir: site, module: "01-thermal-resistance" });
      expect(run.gates.hydration.findings).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    // Module 1 carries the plate sim, whose map loads Plotly in every throttled touch run.
  }, 900_000);
});

describe("the touch check", () => {
  const build = buildCourse(FIXTURE_COURSE);

  it("waits out a control slow to take a tap or to answer it: only one that never does fails", async () => {
    // Under a CI runner's load, the first taps after hydration took up to 4.2s to land and some
    // answered past the 2s the check waited, on controls that work. A button busy for 6s as it is
    // touched (past the old 5s), and one that answers 4s after its tap, stand in for them.
    expect(build.ok, build.output).toBe(true);
    const scratch = mkdtempSync(join(tmpdir(), "lp-slow-tap-"));
    try {
      const site = join(scratch, "site");
      cpSync(build.outDir, site, { recursive: true });
      // On a copy of the home page, quiet enough that nothing else answers for the buttons.
      const route = "planted-negative-control";
      const slow = [
        `<p><button type="button" id="held">Held</button></p>`,
        `<p><button type="button" onclick="setTimeout(() => { this.textContent = 'Answered'; }, 4000)">Answers late</button></p>`,
        `<script>`,
        `const held = document.getElementById("held");`,
        `held.addEventListener("touchstart", () => { const end = Date.now() + 6000; while (Date.now() < end); });`,
        `held.addEventListener("click", () => { held.textContent = "Tapped"; });`,
        `</script>`,
      ].join("");
      const home = readFileSync(join(site, "index.html"), "utf8");
      mkdirSync(join(site, route));
      writeFileSync(
        join(site, route, "index.html"),
        home.replace(/<main[^>]*>/, (main) => `${main}${slow}`),
      );
      const run = await browserRun({ contentDir: FIXTURE_COURSE, distDir: site, module: route });
      expect(run.gates.touch.findings.filter((f) => /Held|Answers late/.test(f.message))).toEqual([]);
      expect(run.gates.touch.coverage.slowestTapMs).toBeGreaterThanOrEqual(5000);
      expect(run.gates.touch.coverage.slowestAnswerMs).toBeGreaterThanOrEqual(4000);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 600_000);
});

describe("the width check", () => {
  it(
    "waits out a page too busy to say its width: only a wrong width fails",
    async () => {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
        await page.setViewportSize({ width: 375, height: 800 });
        // The width has arrived, but the page is at work past the wait (on CI's runner a sim still
        // drawing held it past the 2s the wait once had) and can't say so till it's done.
        await page.evaluate(
          (ms) =>
            setTimeout(() => {
              const end = Date.now() + ms;
              while (Date.now() < end);
            }),
          WIDTH_ARRIVES_MS + 2_000,
        );
        await assertWidth(page, "chromium", 375);
        await expect(assertWidth(page, "chromium", 390)).rejects.toThrow(
          "asked chromium for a 390px viewport and the page has 375px, so the sweep can't be trusted",
        );
      } finally {
        await browser.close();
      }
    },
    WIDTH_ARRIVES_MS * 2 + 60_000,
  );
});
