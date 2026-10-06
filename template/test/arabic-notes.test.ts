// Arabic notes (CONTEXT.md): with a Course's Arabic-notes toggle on, a Summary beat or a Worked
// example step can carry a note in Arabic, set right to left beside the English, with every number
// and formula in it kept left to right.
import { chromium, type Browser, type Locator } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { arabicProse } from "../src/arabic/notes.ts";
import { beat, course, worked } from "../src/content/contract.ts";
import { renderProse } from "../src/math/katex.ts";
import { untagged } from "../src/provenance/values.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";
import { serve } from "./serve";

const prose = (text: string) => renderProse(text, () => ({ file: "test", line: 1 }));

/** The runs `html` sets left to right: the number spans' text. */
const ltrRuns = (html: string) =>
  [...html.matchAll(/<span dir="ltr" class="ltr-number">([^<]*)<\/span>/g)].map((m) => m[1]);

describe("an Arabic note's prose", () => {
  it("keeps a signed decimal left to right, sign included", () => {
    const html = arabicProse("الوجه الخارجي عند −5 درجة، والفقد 16.2 واط");
    expect(ltrRuns(html)).toEqual(["−5", "16.2"]);
    // The Arabic around them stays as written, outside any left-to-right run.
    expect(html).toContain("الوجه الخارجي عند ");
  });

  it("keeps a phone number, a date, a range and grouped thousands each one run", () => {
    const html = arabicProse("اتصل على +20 100 123 4567 قبل 2026-11-10، للأسئلة 3-5، والمبلغ 1,234.5 جنيه أو 25%");
    expect(ltrRuns(html)).toEqual(["+20 100 123 4567", "2026-11-10", "3-5", "1,234.5", "25%"]);
  });

  it("doesn't take a dash glued to a word as a sign, nor a sentence's full stop", () => {
    expect(ltrRuns(arabicProse("صفحة-3 والسمك 1.5."))).toEqual(["3", "1.5"]);
  });

  it("sets paper math left to right, and escapes what isn't math", () => {
    const html = arabicProse("المقاومة $R = \\frac{L}{kA}$ لا <b>تتغير</b>");
    expect(html).toMatch(/<span dir="ltr"><span class="katex">[\s\S]*<\/span><\/span>/);
    expect(html).toContain('class="mfrac"');
    expect(html).toContain("&lt;b&gt;تتغير&lt;/b&gt;");
    // A number inside the formula is the formula's: it gets no run of its own.
    expect(ltrRuns(arabicProse("$T = 20$"))).toEqual([]);
  });

  it("leaves English prose as it was (negative control)", () => {
    expect(prose("The face at −5 °C loses 16.2 W")).not.toContain('dir="ltr"');
  });
});

describe("the content contract for Arabic notes", () => {
  const base = {
    name: "C",
    code: "C 1",
    pad: "green",
    owner: "O",
    credit: { professor: "P", course: "C", university: "U" },
  };

  it("has the Course's toggle off unless the Owner turned it on", () => {
    expect(course.parse(base).arabicNotes).toBe(false);
    expect(course.parse({ ...base, arabicNotes: true }).arabicNotes).toBe(true);
  });

  it("takes a note on a Summary beat and on a Worked example step", () => {
    expect(beat.safeParse({ title: "T", arabic: "ملاحظة قصيرة" }).success).toBe(true);
    const example = workedWith({ arabic: "الخطوة الأولى" });
    expect(worked.safeParse(example).error?.issues).toBeUndefined();
  });

  it("refuses a note with no Arabic in it", () => {
    const parsed = beat.safeParse({ title: "T", arabic: "An English note" });
    expect(parsed.error?.issues.map((i) => i.message)).toEqual(["an Arabic note is written in Arabic"]);
  });

  it("refuses Eastern Arabic digits: numbers are written as the English content and the exam write them", () => {
    const parsed = worked.safeParse(workedWith({ arabic: "الفقد ١٦٫٢ واط" }));
    expect(parsed.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["steps.0.arabic", "write numbers in an Arabic note with the digits 0–9, as the English content does"],
    ]);
  });
});

describe("the provenance of an Arabic note's numbers", () => {
  it("is checked like the English: a number no list tags is untagged", () => {
    expect(untagged("beats", { title: "T", arabic: "جدار سمكه 0.7 م", provenance: { assumed: ["0.2"] } })).toEqual([
      { written: "0.7", at: ["arabic"] },
    ]);
    const step = { title: "S", note: "N", arabic: "الفقد $\\dot{Q} = 16.2$ واط" };
    expect(untagged("worked", { ...workedWith(step), provenance: {} })).toContainEqual({
      written: "16.2",
      at: ["steps.0.arabic"],
    });
    expect(untagged("beats", { title: "T", arabic: "جدار سمكه 0.7 م", provenance: { assumed: ["0.7"] } })).toEqual([]);
  });
});

/** Every Arabic note block on a page. */
const notesOn = (page: string) => [
  ...page.matchAll(/<div class="arabic-note[^"]*" lang="ar" dir="rtl"[^>]*>([\s\S]*?)<\/div>/g),
];

describe("the Fixture Course with its Arabic-notes toggle on", () => {
  const build = buildCourse(FIXTURE_COURSE);

  it("builds, and sets each note right to left beside the English with its numbers left to right", () => {
    expect(build.ok, build.output).toBe(true);
    const page = build.page("01-thermal-resistance");
    const [beatNote, stepNote] = notesOn(page).map((m) => m[1] ?? "");
    // The Summary beat's note, below the beat's text: math and every number isolated.
    expect(beatNote).toContain("الجدار يقاوم سريان الحرارة");
    expect(beatNote).toMatch(/<span dir="ltr"><span class="katex">/);
    expect(ltrRuns(beatNote ?? "")).toEqual(["0.2", "20", "5"]);
    // The Worked example opens on step 1, whose note the island renders.
    expect(ltrRuns(stepNote ?? "")).toEqual(["20", "−5"]);
    // A complete sitting's Revision places the same beat, note and all.
    expect(notesOn(build.page("revision/midterm")).length).toBe(1);
  });

  describe("in a browser, left to right and mirrored right to left", () => {
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

    async function moduleOne(dir: "ltr" | "rtl") {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${site.url}/01-thermal-resistance/`);
      await page.evaluate((d) => {
        document.documentElement.dir = d;
      }, dir);
      // The island hydrates once it is on screen, and says so.
      await page.locator(".worked-sheet").first().scrollIntoViewIfNeeded();
      const sheet = page.locator('.worked-sheet[data-ready="true"]').first();
      await sheet.waitFor();
      return { page, sheet };
    }
    /** The step counter's step. */
    const step = async (sheet: Locator) =>
      Number((await sheet.locator(".worked-title-block .tabular-nums").innerText()).split("/")[0]);
    /**
     * Which way a printed arrow points on screen: its chevron's tip is drawn at (5, 8) of 16, and
     * the screen matrix (a CSS scale on the <svg> included) says which half of its box it lands in.
     */
    const pointsAt = (arrow: Locator) =>
      arrow.evaluate((svg) => {
        const path = svg.querySelector("path") as SVGPathElement;
        const tip = new DOMPoint(5, 8).matrixTransform(path.getScreenCTM() as DOMMatrix);
        const box = svg.getBoundingClientRect();
        return tip.x - box.left < box.width / 2 ? "left" : "right";
      });

    it("steps the Worked example with the arrow keys along the document's direction", async () => {
      for (const [dir, onward, back] of [
        ["ltr", "ArrowRight", "ArrowLeft"],
        ["rtl", "ArrowLeft", "ArrowRight"],
      ] as const) {
        const { page, sheet } = await moduleOne(dir);
        await sheet.locator(".step-link").first().focus();
        expect(await step(sheet), dir).toBe(1);
        await page.keyboard.press(onward);
        expect(await step(sheet), `${dir}: ${onward} steps on`).toBe(2);
        await page.keyboard.press(back);
        expect(await step(sheet), `${dir}: ${back} steps back`).toBe(1);
        await page.close();
      }
    });

    it("mirrors the back chevron and the step arrows right to left", async () => {
      const ltr = await moduleOne("ltr");
      const rtl = await moduleOne("rtl");
      for (const [{ page }, back, onward] of [
        [ltr, "left", "right"],
        [rtl, "right", "left"],
      ] as const) {
        const where = await page.evaluate(() => document.documentElement.dir);
        expect(await pointsAt(page.locator('a[href="/"] svg').first()), `${where}: Back`).toBe(back);
        const note = page.locator(".worked-note .note-controls").first();
        expect(await pointsAt(note.locator("button").first().locator("svg")), `${where}: Prev`).toBe(back);
        expect(await pointsAt(note.locator("button").last().locator("svg")), `${where}: Next`).toBe(onward);
        await page.close();
      }
    });

    it("lays each note out right to left, with its numbers left to right on screen", async () => {
      const { page } = await moduleOne("ltr");
      const note = page.locator(".beat .arabic-note").first();
      expect(await note.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
      // "−5" in the step's note: the sign is drawn left of the digit, as written (unisolated, a
      // right-to-left line draws it "5−").
      const [sign, digit] = await page.locator(".worked-note .arabic-note").evaluate((note) => {
        const walk = document.createTreeWalker(note, NodeFilter.SHOW_TEXT);
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          const i = (node.nodeValue ?? "").indexOf("−5");
          if (i === -1) continue;
          const left = (offset: number) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            return range.getBoundingClientRect().left;
          };
          return [left(i), left(i + 1)];
        }
        return [];
      });
      expect(sign, "the note has −5").toBeDefined();
      expect(sign).toBeLessThan(digit ?? 0);
      await page.close();
    });
  });
});

describe("the Fixture Course with its Arabic-notes toggle off", () => {
  const build = buildCourse(fixtureWith("course.yaml", (s) => s.replace("arabicNotes: true", "arabicNotes: false")));

  it("builds, and shows no Arabic note anywhere", () => {
    expect(build.ok, build.output).toBe(true);
    for (const route of ["01-thermal-resistance", "revision/midterm"]) {
      expect(build.page(route)).not.toContain('lang="ar"');
      expect(build.page(route)).not.toContain("الجدار");
      expect(build.page(route)).not.toContain("arabicHtml");
    }
  });
});

function workedWith(step: Record<string, unknown>) {
  return {
    code: "W1",
    title: "T",
    statement: "S",
    artefact: { kind: "table", caption: "C", columns: [{ label: "a" }, { label: "b" }], rows: [["1", "2"]] },
    fillOrder: "columns",
    steps: [{ title: "Step", note: "Note", ...step }],
    answer: "A",
  };
}
