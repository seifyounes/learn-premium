// The Exam room where students meet it, in a real browser (Chromium) on one build of the Fixture
// Course: a paper sat against the clock, a numeric answer checked, a written paper that says it is
// sat and to mark it yourself (never 0/0), a result kept, and the home page's readiness rising once
// a mock is marked. One build for the file: each is a full `astro build`.
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const build = buildCourse(FIXTURE_COURSE);

describe("the Exam room in a browser", () => {
  let site: Awaited<ReturnType<typeof serve>>;
  let browser: Browser;
  beforeAll(async () => {
    expect(build.ok, build.output).toBe(true);
    site = await serve(build.outDir);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  async function open(route: string, width = 1280): Promise<{ page: Page; errors: string[] }> {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 812 : 800 },
      hasTouch: width < 768,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${site.url}/${route}/`);
    // The island hydrates when it scrolls into view; its first control turns on once it has.
    await page.getByRole("button", { name: "Practise" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Practise" }).and(page.locator(":enabled")).waitFor();
    return { page, errors };
  }
  const answers = (page: Page) => page.locator(".answer-input");
  const clock = (page: Page) => page.locator("[data-clock]");
  const result = (page: Page) => page.locator(".paper-score");
  const stored = (page: Page) =>
    page.evaluate(() => JSON.parse(localStorage.getItem("learn-premium:progress") ?? "{}") as Record<string, unknown>);

  it("counts a timed paper down in mm:ss, left to right, and Submit marks the numeric answers", async () => {
    const { page, errors } = await open("exam/midterm/2025");
    expect(await answers(page).first().isDisabled()).toBe(true);
    await page.getByRole("button", { name: /Start timed/ }).click();
    expect(await clock(page).innerText()).toMatch(/^(30:00|29:5\d)$/);
    expect(await clock(page).getAttribute("dir")).toBe("ltr");
    await page.waitForTimeout(2200);
    const left = await clock(page).innerText();
    expect(left).toMatch(/^29:(5\d|4\d)$/);
    expect(left).not.toBe("30:00");

    await answers(page).nth(0).fill("0.25");
    await answers(page).nth(1).fill("0.5");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    // Question 1 right; question 2 (0.1) wrong; the written question waits for the student's marks.
    const verdicts = await page.locator(".check-verdict").allInnerTexts();
    expect(verdicts[0]).toMatch(/^Right/);
    expect(verdicts[1]).toMatch(/^Not right/);
    expect(await result(page).innerText()).toBe("4 / 8 auto-checked · mark 1 yourself");
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("submits the paper when the time is up", async () => {
    const { page } = await open("exam/midterm/2025");
    await page.clock.install();
    await page.getByRole("button", { name: /Start timed/ }).click();
    await answers(page).nth(0).fill("0.25");
    await page.clock.fastForward("31:00");
    await page.waitForFunction(() => document.querySelector(".paper-score") !== null);
    expect(await page.locator(".paper-result").innerText()).toContain("Time is up");
    expect(await result(page).innerText()).toBe("4 / 8 auto-checked · mark 1 yourself");
    await page.context().close();
  });

  it("practises with no clock, and a fully marked paper keeps its result", async () => {
    const { page, errors } = await open("exam/midterm/2025");
    await page.getByRole("button", { name: "Practise" }).click();
    expect(await clock(page).count()).toBe(0);
    await answers(page).nth(0).fill("0.25");
    await answers(page).nth(1).fill("0.1");
    await page.locator(".answer-text").fill("Resistances in series share one heat rate.");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    expect(await page.getByRole("button", { name: "Save result" }).isDisabled()).toBe(true);
    // Self-mark the written answer: one of its two points, then Done marking.
    await page.getByRole("checkbox").first().click();
    await page.getByRole("button", { name: "Done marking" }).click();
    expect(await result(page).innerText()).toBe("9 / 10");
    await page.getByRole("button", { name: "Save result" }).click();
    const progress = (await stored(page)) as { papers: Record<string, { last: { got: number; of: number } }> };
    expect(progress.papers["midterm/2025"]?.last).toMatchObject({ got: 9, of: 10 });
    expect(errors).toEqual([]);
    await page.context().close();
  });

  it("the announced mock, all prose, says Sat, mark it yourself after Submit", async () => {
    const { page } = await open("exam/midterm/announced");
    await page.getByRole("button", { name: "Practise" }).click();
    await page.locator(".answer-text").first().fill("Fourier's law gives the heat rate.");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    const label = await result(page).innerText();
    expect(label).toMatch(/^Sat, mark it yourself/);
    expect(label).not.toMatch(/\b0\s*\/\s*0\b/);
    expect(await page.getByRole("button", { name: "Save result" }).isDisabled()).toBe(true);
    expect(await page.locator("body").innerText()).not.toMatch(/\b0\s*\/\s*0\b/);
    await page.context().close();
  });

  it("raises the home page's readiness once a mock is fully marked", async () => {
    const { page } = await open("exam/midterm/mock-1");
    await page.getByRole("button", { name: "Practise" }).click();
    await answers(page).nth(0).fill("0.5");
    await answers(page).nth(1).fill("0.2");
    await page.locator(".answer-text").fill("Thin, but resistances add.");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await page.getByRole("checkbox").nth(0).click();
    await page.getByRole("checkbox").nth(1).click();
    await page.getByRole("button", { name: "Done marking" }).click();
    expect(await result(page).innerText()).toBe("10 / 10");
    await page.getByRole("button", { name: "Save result" }).click();

    // No Mastery yet, so readiness is the mean of 0 and the mock's 100%.
    await page.goto(`${site.url}/`);
    await page.waitForFunction(
      () => document.querySelector('.sitting-line[data-sitting="midterm"] [data-readiness]')?.textContent === "50",
    );
    expect(await page.locator('.sitting-line[data-sitting="final"] [data-readiness]').innerText()).toBe("0");
    await page.context().close();
  });

  it("fits a phone: nothing scrolls the page sideways, before and after Submit", async () => {
    const { page } = await open("exam/midterm/announced", 375);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: /Start timed/ }).tap();
    await page.getByRole("button", { name: "Submit", exact: true }).tap();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.context().close();
  });
});
