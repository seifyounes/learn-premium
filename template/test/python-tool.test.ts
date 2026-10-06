// The Pyodide tool on the built Fixture Course: it opens on its build-time preview beside a
// Run-live button sized by the real download, Pyodide is served from the site's own /pyodide/, and
// the pyodide gate blocks a tool without its preview or its size. Then in a real browser
// (Chromium): nothing of Pyodide loads until the tap, the tap fetches only the site's own files,
// runs the code, redraws the plot, and the Tool gallery reports the timing run.
import { chromium, type Browser, type Page } from "@playwright/test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pyodideGate } from "../gates/pyodide.ts";
import { runControls } from "../gates/runner.ts";
import { coursePackages } from "../src/python/download.ts";
import { sizeLabel } from "../src/python/lock.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";
import { serve } from "./serve";

const MODULE = "03-gradient-descent";
const TOOL = `modules/${MODULE}/python/normal-equation.yaml`;
const CODE = `modules/${MODULE}/python/normal-equation.py`;
const build = buildCourse(FIXTURE_COURSE);

/** The bytes of every file the site serves at /pyodide/, by name. */
const served = () =>
  Object.fromEntries(
    readdirSync(join(build.outDir, "pyodide")).map((f) => [f, statSync(join(build.outDir, "pyodide", f)).size]),
  );
const total = (sizes: Record<string, number>) => Object.values(sizes).reduce((a, b) => a + b, 0);

describe("the Pyodide tool on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("serves Pyodide's core and the tool's one package from the site's own /pyodide/", () => {
    expect(Object.keys(served()).sort()).toEqual([
      expect.stringMatching(/^numpy-[\d.]+-cp\d+-cp\d+-pyemscripten_[\d_]+_wasm32\.whl$/),
      "pyodide-lock.json",
      "pyodide.asm.mjs",
      "pyodide.asm.wasm",
      "pyodide.mjs",
      "python_stdlib.zip",
    ]);
  });

  it("opens on its preview, the code's plot and printout from build, beside a button sized by the real download", () => {
    const page = build.page(MODULE);
    const tool = page.slice(page.indexOf('id="python-03-gradient-descent-normal-equation"'));
    expect(tool).toMatch(/component-url="\/_astro\/PythonTool\.[^"]+\.js"[^>]*client="visible"/);
    const preview = tool.slice(tool.indexOf("data-python-preview"), tool.indexOf('class="python-work"'));
    expect(preview.match(/class="plot-point"/g)).toHaveLength(3);
    expect(preview.match(/class="plot-line"/g)).toHaveLength(1);
    expect(tool).toContain("theta0 = 1.1667\ntheta1 = 1.5000\nJ(theta) = 0.0278");
    const bytes = total(served());
    expect(tool).toContain(`data-run-live="${bytes}">Run live · ${sizeLabel(bytes)}</button>`);
    expect(tool).toMatch(/<textarea[^>]*disabled/);
  });

  it("sits below its Worked example, and in the Lab and the Tool gallery", () => {
    expect(build.page("lab")).toContain('id="python-03-gradient-descent-normal-equation"');
    expect(build.page("tool-gallery")).toContain('id="python-03-gradient-descent-normal-equation"');
  });

  it("keeps the loader out of the tool's island: only a tap imports it", () => {
    const island = /component-url="\/_astro\/(PythonTool\.[^"]+\.js)"/.exec(build.page(MODULE))?.[1] ?? "";
    const code = readFileSync(join(build.outDir, "_astro", island), "utf8");
    expect(code).not.toMatch(/loadPyodide/);
    expect(code).toMatch(/import\(["'`]\.\/live\.[^"'`]+\.js["'`]\)/);
  });
});

describe("the pyodide gate", () => {
  it("passes the built Fixture Course, having seen each tool", async () => {
    const run = await pyodideGate.run({ contentDir: FIXTURE_COURSE, distDir: build.outDir });
    expect(run.findings).toEqual([]);
    // The Module page, the Lab and the Tool gallery.
    expect(run.coverage.tools).toBe(3);
  });

  it("blocks a tool without its preview or its size, and a button that understates the download", async () => {
    const result = await runControls({
      input: { contentDir: FIXTURE_COURSE, distDir: build.outDir },
      gates: [pyodideGate],
    });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(result.gates[0]?.controls.map((c) => [c.defect, c.caught])).toEqual([
      ["a Pyodide tool with no build-time preview", true],
      ["a Pyodide tool whose preview draws nothing", true],
      ["a Pyodide tool whose preview draws every mark outside its frame", true],
      ["a Run-live button that doesn't say what the tap downloads", true],
      ["a Run-live button that understates the download", true],
      ["a file the tap fetches missing from the site's /pyodide/", true],
    ]);
  });
});

describe("a Pyodide tool that can't make its preview fails the build", () => {
  it("when its code imports a package the tool doesn't name (its button would understate)", () => {
    const course = fixtureWith(TOOL, (s) => s.replace("packages: [numpy]", "packages: []"));
    const result = buildCourse(course);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/normal-equation\.yaml: the code imports numpy from the Pyodide package "numpy"/);
  });

  it("when its code fails at build", () => {
    const course = fixtureWith(CODE, (s) => `${s}\nraise ValueError("planted")\n`);
    const result = buildCourse(course);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/its code fails at build, so it has no preview/);
    expect(result.output).toContain("ValueError: planted");
  });
});

describe("a Pyodide tool naming a Worked example its Module doesn't have", () => {
  it("fails the build instead of dropping off the Module page", () => {
    const course = fixtureWith(TOOL, (s) => s.replace("worked: '1'", "worked: '9'"));
    const result = buildCourse(course);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(
      /normal-equation\.yaml: names Worked example 9, which Module 03-gradient-descent doesn't have/,
    );
  });
});

describe("a Course's Pyodide packages", () => {
  it("must be in its pyodide/ folder, as the files Pyodide's lock names", () => {
    const course = mkdtempSync(join(tmpdir(), "lp-course-"));
    expect(() => coursePackages(course, ["numpy"])).toThrow(/has no numpy-.*\.whl.*npm run wheels/);
    cpSync(join(FIXTURE_COURSE, "pyodide"), join(course, "pyodide"), { recursive: true });
    const [wheel] = readdirSync(join(course, "pyodide"));
    writeFileSync(join(course, "pyodide", wheel ?? ""), "not numpy");
    expect(() => coursePackages(course, ["numpy"])).toThrow(/isn't the file Pyodide's lock names/);
  });
});

describe("the Pyodide tool in a browser", () => {
  let browser: Browser;
  let site: Awaited<ReturnType<typeof serve>>;
  beforeAll(async () => {
    browser = await chromium.launch();
    site = await serve(build.outDir);
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  /** The gallery opened, its Pyodide tool on screen and hydrated, with every request recorded. */
  async function gallery(): Promise<{ page: Page; requests: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`${site.url}/tool-gallery/`);
    await page.locator("[data-python-tool]").scrollIntoViewIfNeeded();
    await page.waitForSelector('[data-python-tool][data-ready="true"]');
    return { page, requests };
  }

  it("loads nothing of Pyodide until the tap, then only the site's own files: the ones the button sized", async () => {
    const { page, requests } = await gallery();
    await page.waitForTimeout(500);
    expect(requests.filter((u) => /pyodide|live\./i.test(new URL(u).pathname))).toEqual([]);

    const button = page.locator("[data-run-live]");
    const bytes = Number(await button.getAttribute("data-run-live"));
    await button.click();
    await page.waitForSelector('[data-python-tool][data-state="live"]', { timeout: 120_000 });

    expect(
      requests.every((u) => u.startsWith(site.url)),
      requests.join("\n"),
    ).toBe(true);
    const fetched = [...new Set(requests.map((u) => new URL(u).pathname).filter((p) => p.startsWith("/pyodide/")))];
    const sizes = served();
    expect(fetched.sort()).toEqual(
      Object.keys(sizes)
        .map((f) => `/pyodide/${f}`)
        .sort(),
    );
    expect(bytes).toBe(total(sizes));
    await page.close();
  });

  it("runs the code live, reports the timing run, and runs it again as the student edits it", async () => {
    const { page } = await gallery();
    await page.locator("[data-run-live]").click();
    await page.waitForSelector('[data-python-tool][data-state="live"]', { timeout: 120_000 });
    const tool = page.locator("[data-python-tool]");
    expect(await tool.locator(".python-output pre").textContent()).toContain("theta0 = 1.1667");
    const timing = JSON.parse((await tool.locator("[data-timing]").getAttribute("data-timing")) ?? "{}") as Record<
      string,
      number
    >;
    expect(timing.startMs).toBeGreaterThan(0);
    expect(timing.fetchedBytes).toBeGreaterThanOrEqual(total(served()));
    expect(await tool.locator(".python-status").textContent()).toMatch(
      /Python started in \d+\.\d s, packages loaded in \d+\.\d s, ran in \d+\.\d s; fetched \d+\.\d MB\./,
    );

    const line = await tool.locator(".python-figure .plot-line").getAttribute("d");
    const code = tool.locator("textarea");
    await code.fill(((await code.inputValue()) ?? "").replace("[1.0, 3.0, 4.0]", "[2.0, 4.0, 5.0]"));
    await tool.getByRole("button", { name: "Run again" }).click();
    await page.waitForFunction(() => document.querySelector(".python-output pre")?.textContent?.includes("2.1667"));
    expect(await tool.locator(".python-figure .plot-line").getAttribute("d")).not.toBe(line);
    // Python is already in the page: running again fetches nothing, and says so.
    const again = JSON.parse((await tool.locator("[data-timing]").getAttribute("data-timing")) ?? "{}") as Record<
      string,
      number
    >;
    expect(again.fetchedBytes).toBe(0);

    await code.fill("plot = [");
    await tool.getByRole("button", { name: "Run again" }).click();
    await page.waitForSelector('[data-python-tool][data-state="error"]');
    expect(await tool.locator(".python-error").textContent()).toMatch(/SyntaxError/);
    await tool.getByRole("button", { name: "Reset code" }).click();
    expect(await code.inputValue()).toContain("np.linalg.solve");
    await page.close();
  });

  it("keeps the page working while edited code never finishes, and stops it on Stop", async () => {
    const { page } = await gallery();
    await page.locator("[data-run-live]").click();
    await page.waitForSelector('[data-python-tool][data-state="live"]', { timeout: 120_000 });
    const tool = page.locator("[data-python-tool]");
    const code = tool.locator("textarea");
    await code.fill("while True:\n    pass");
    await tool.getByRole("button", { name: "Run again" }).click();
    await page.waitForSelector('[data-python-tool][data-state="running"]');
    // The page's own thread is free: a script answers at once, and the student can still type.
    const answered = await Promise.race([
      page.evaluate(() => "answered"),
      new Promise((resolve) => setTimeout(() => resolve("frozen"), 5_000)),
    ]);
    expect(answered).toBe("answered");
    await tool.getByRole("button", { name: "Stop" }).click({ timeout: 5_000 });
    await page.waitForSelector('[data-python-tool][data-state="stopped"]');
    expect(await tool.locator("[role=alert]").textContent()).toMatch(/Stopped/);
    // Python went with the stopped run: no timing of a past run, and the next run starts it again.
    expect(await tool.locator("[data-timing]").count()).toBe(0);
    const button = tool.locator("[data-run-live]");
    expect(await button.textContent()).toMatch(/^Run live · \d+\.\d MB$/);

    await tool.getByRole("button", { name: "Reset code" }).click();
    await button.click();
    await page.waitForSelector('[data-python-tool][data-state="loading"]');
    await page.waitForSelector('[data-python-tool][data-state="live"]', { timeout: 120_000 });
    expect(await tool.locator(".python-output pre").textContent()).toContain("theta0 = 1.1667");
    await page.close();
  });
});

describe("two Pyodide tools on one page", () => {
  const ECHO = `modules/${MODULE}/python/echo`;
  let two: ReturnType<typeof buildCourse>;
  let browser: Browser;
  let site: Awaited<ReturnType<typeof serve>>;
  beforeAll(async () => {
    const code = fixtureWith(
      `${ECHO}.py`,
      () => 'print("echo")\nplot = [{"id": "e", "kind": "point", "at": [1, 2]}]\n',
    );
    const course = fixtureWith(
      `${ECHO}.yaml`,
      () =>
        [
          "title: Echo",
          "caption: A second tool on the page.",
          "source: echo.py",
          "worked: '1'",
          "figure:",
          "  caption: One point",
          "  x: { label: '$x$', min: 0, max: 3, step: 1 }",
          "  y: { label: '$y$', min: 0, max: 6, step: 1 }",
          "",
        ].join("\n"),
      code,
    );
    two = buildCourse(course);
    expect(two.ok, two.output).toBe(true);
    browser = await chromium.launch();
    site = await serve(two.outDir);
  }, 600_000);
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  it("run one at a time, each run's output its own", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${site.url}/${MODULE}/`);
    expect(await page.locator("[data-python-tool]").count()).toBe(2);
    const first = page.locator(`#python-${MODULE}-normal-equation [data-python-tool]`);
    const second = page.locator(`#python-${MODULE}-echo [data-python-tool]`);
    // Each hydrates once it is on screen.
    for (const tool of [first, second]) {
      await tool.scrollIntoViewIfNeeded();
      await tool.and(page.locator('[data-ready="true"]')).waitFor();
    }
    // Python started once, by the first tool.
    await first.locator("[data-run-live]").click();
    await first.and(page.locator('[data-state="live"]')).waitFor({ timeout: 120_000 });
    // The first tool's run waits on an await, while the second tool's run is asked for.
    await first
      .locator("textarea")
      .fill(
        'import asyncio\nprint("a1")\nawait asyncio.sleep(1.5)\nprint("a2")\nplot = [{"id": "a", "kind": "point", "at": [1, 1]}]',
      );
    await first.getByRole("button", { name: "Run again" }).click();
    await second.locator("[data-run-live]").click();
    for (const tool of [second, first])
      await tool.and(page.locator('[data-state="live"]')).waitFor({ timeout: 120_000 });
    expect(await first.locator(".python-output pre").textContent()).toBe("a1\na2");
    expect(await second.locator(".python-output pre").textContent()).toBe("echo");
    await page.close();
  });
});
