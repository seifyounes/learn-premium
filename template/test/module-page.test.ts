import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const MEDIA = `modules/${MODULE}/media.yaml`;

/** The rail's links, in order: where each jumps and its name. */
const rail = (page: string) =>
  [...page.matchAll(/<a href="#(\w+)" class="rail-link"[^>]*>[\s\S]*?<span class="rail-long">([^<]+)<\/span>/g)].map(
    (m) => `${m[1]}:${m[2]}`,
  );
/** The page's sections, in order. */
const sections = (page: string) => [...page.matchAll(/<section id="(\w+)" class="module-section"/g)].map((m) => m[1]);
/** Every island of a component, with its props decoded. */
function islands(page: string, component: string): Record<string, unknown>[] {
  const pattern = new RegExp(`<astro-island[^>]*component-url="/_astro/${component}\\.[^"]+"[^>]*props="([^"]*)"`, "g");
  const decode = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  // Astro serialises each prop as [type, value]; 0 is a plain value, 1 an array of them.
  const plain = (v: unknown): unknown =>
    Array.isArray(v) && typeof v[0] === "number"
      ? v[0] === 1
        ? (v[1] as unknown[]).map(plain)
        : v[0] === 0 && v[1] && typeof v[1] === "object"
          ? Object.fromEntries(Object.entries(v[1] as object).map(([k, x]) => [k, plain(x)]))
          : v[1]
      : v;
  return [...page.matchAll(pattern)].map((m) => {
    const props = JSON.parse(decode(m[1] ?? "{}")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, plain(v)]));
  });
}

describe("the Module page on the Fixture Course", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const page = build.ok ? build.page(MODULE) : "";

  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("runs Watch → Summary → Worked examples → Practice, with a rail that jumps to each", () => {
    expect(sections(page)).toEqual(["watch", "summary", "worked", "practice"]);
    expect(rail(page)).toEqual(["watch:Watch", "summary:Summary", "worked:Worked examples", "practice:Practice"]);
    // The rail marks done sections from what this page holds.
    expect(page).toMatch(
      /data-module-page data-module="01-thermal-resistance" data-shape="\{&quot;worked&quot;:\[&quot;W01\.1&quot;,&quot;W01\.2&quot;\],&quot;practice&quot;:\[&quot;1&quot;,&quot;2&quot;,&quot;3&quot;\]\}"/,
    );
  });

  it("fills Watch with the video, then the audio, published beside the page", () => {
    const watch = page.slice(page.indexOf('id="watch"'), page.indexOf('id="summary"'));
    expect(watch.indexOf("Explainer video")).toBeLessThan(watch.indexOf("Deep Dive audio"));
    expect(watch).toContain(
      `<video class="media-video" controls playsinline preload="metadata" src="/${MODULE}/media/explainer.mp4">`,
    );
    expect(watch).toContain(`<track kind="captions" src="/${MODULE}/media/explainer.vtt"`);
    expect(watch).toContain(`<audio class="media-audio" controls preload="none" src="/${MODULE}/media/deep-dive.mp3">`);
    for (const file of ["explainer.mp4", "explainer.vtt", "deep-dive.mp3", "infographic.png"]) {
      expect(existsSync(join(build.outDir, MODULE, "media", file)), file).toBe(true);
    }
  });

  it("opens Summary on the infographic, sized from the file, then each beat beside its figure", () => {
    const summary = page.slice(page.indexOf('id="summary"'), page.indexOf('id="worked"'));
    expect(summary).toMatch(
      new RegExp(`<a href="/${MODULE}/media/infographic.png" class="infographic-link" data-zoom-open>`),
    );
    expect(summary).toMatch(
      /<img src="[^"]+infographic\.png" alt="Thermal resistance on one page[^"]*" width="900" height="1200"/,
    );
    expect(summary.indexOf("infographic")).toBeLessThan(summary.indexOf('class="beat"'));
    expect(summary).toMatch(/<article class="beat" data-has-figure="true">[\s\S]*<div class="beat-figure">[\s\S]*<svg/);
  });

  it("labels assumed and scaled values where they are shown", () => {
    const summary = page.slice(page.indexOf('id="summary"'), page.indexOf('id="worked"'));
    expect(summary).toMatch(
      /<dt class="field-label">Assumed<\/dt><dd><span class="provenance-gloss">supplied here, not in the Materials:/,
    );
    const practice = page.slice(page.indexOf('id="practice"'));
    expect(practice).toMatch(
      /<dt class="field-label">Scaled<\/dt><dd><span class="provenance-gloss">measured off a drawing:/,
    );
  });

  it("holds a Worked example's Slip for its answer, showing both values", () => {
    const [sheet] = islands(page, "WorkedSheet");
    const outputs = String(sheet?.outputsHtml);
    expect(outputs).toContain('<dt class="field-label">Slip</dt>');
    expect(outputs).toMatch(/The sheet gives <s class="pen-strike">.*1\.45.*<\/s>; the right value is .*1\.54/);
    expect(sheet?.module).toBe(MODULE);
  });

  it("checks numeric Practice within the item's tolerance and has prose marked against what earns the mark", () => {
    const items = islands(page, "PracticeItem");
    expect(items.map((i) => [i.kind, i.item])).toEqual([
      ["numeric", "1"],
      ["numeric", "2"],
      ["prose", "3"],
    ]);
    expect(items[0]?.answer).toEqual({ value: 9.6, tolerance: 0.05 });
    expect(String(items[0]?.outputsHtml)).toMatch(
      /<dt class="field-label">Divergence<\/dt><dd>The exam answer is .*9\.6.*, the Professor's\. /,
    );
    expect(String(items[1]?.outputsHtml)).toMatch(
      /<dt class="field-label">Derived<\/dt><dd><span class="provenance-gloss">worked out here, no official key:/,
    );
    expect(items[2]?.earnsHtml).toHaveLength(3);
    // The model answer waits in the island's props: never in the page's own markup, before a try.
    expect(page.slice(page.indexOf('id="practice"')).includes("Model answer")).toBe(false);
  });
});

describe("empty media slots", () => {
  it("leave no dead tab or placeholder", () => {
    const course = fixtureWith(MEDIA, () =>
      [
        "audio: { file: deep-dive.mp3, duration: '0:04' }",
        "youtube:",
        "  - id: abcdefghijk",
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
    expect(build.ok, build.output).toBe(true);
    const page = build.page(MODULE);
    expect(page).not.toContain("<video");
    expect(page).not.toContain("Explainer video");
    expect(page).not.toContain("infographic");
    // Audio first, then the card; the card is a link until played, and its moment jumps in.
    const watch = page.slice(page.indexOf('id="watch"'), page.indexOf('id="summary"'));
    expect(watch.indexOf("Deep Dive audio")).toBeLessThan(watch.indexOf("data-video-card"));
    expect(watch).toContain('href="https://www.youtube.com/watch?v=abcdefghijk"');
    expect(watch).toContain('href="https://www.youtube.com/watch?v=abcdefghijk&amp;t=195s"');
    expect(watch).not.toContain("<iframe");
    // Only what the media names is published.
    expect(existsSync(join(build.outDir, MODULE, "media", "deep-dive.mp3"))).toBe(true);
    expect(existsSync(join(build.outDir, MODULE, "media", "explainer.mp4"))).toBe(false);

    // With no media at all, there is no Watch: no section, no rail tab.
    const bare = fixtureWith(MEDIA, () => "");
    rmSync(join(bare, MEDIA));
    const none = buildCourse(bare);
    expect(none.ok, none.output).toBe(true);
    expect(sections(none.page(MODULE))).toEqual(["summary", "worked", "practice"]);
    expect(rail(none.page(MODULE))).toEqual(["summary:Summary", "worked:Worked examples", "practice:Practice"]);
    expect(existsSync(join(none.outDir, MODULE, "media"))).toBe(false);
  });

  it("fail the build when media.yaml names a file that isn't there", () => {
    const course = fixtureWith(MEDIA, (s) => s.replace("file: infographic.png", "file: poster.png"));
    const build = buildCourse(course);
    expect(build.ok).toBe(false);
    expect(build.output).toContain(
      `modules/${MODULE}/media.yaml names media/poster.png, which isn't in the Module's media/ folder`,
    );
  });
});
