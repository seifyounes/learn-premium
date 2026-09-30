import { describe, expect, it } from "vitest";
import { PAD_KEYS } from "../src/pads/catalogue.ts";
import { padStyle, resolvePad } from "../src/pads/pad.ts";
import { buildCourse, fixtureWith } from "./build-course";

const ROUTES = ["", "01-thermal-resistance"];

const withPad = (pad: string) => fixtureWith("course.yaml", (s) => s.replace(/^pad: .*$/m, `pad: "${pad}"`));
const htmlTag = (page: string) => /<html[^>]*>/.exec(page)?.[0] ?? "";

describe("every catalogue pad renders the Fixture Course", () => {
  it.each(PAD_KEYS)("%s, on every page", (key) => {
    const build = buildCourse(withPad(key));
    expect(build.ok, build.output).toBe(true);
    for (const route of ROUTES) {
      const html = htmlTag(build.page(route));
      expect(html).toContain(`data-pad="${key}"`);
      expect(html).toContain(`style="${padStyle(resolvePad(key).slots)}"`);
    }
    expect(build.output).toContain(`pad ${key} (${resolvePad(key).label}): meets every contrast requirement`);
    expect(build.css(), "the red pen is fixed on every pad").toContain("--color-red-pen:#c0341d");
  });
});

describe("a custom pad", () => {
  it("rebuilds the whole site in its auto-fixed colours and lists every change in the build log", () => {
    const pad = resolvePad("#D2691E");
    expect(pad.changes.length).toBeGreaterThan(0);
    const build = buildCourse(withPad("#D2691E"));
    expect(build.ok, build.output).toBe(true);
    for (const route of ROUTES) {
      const html = htmlTag(build.page(route));
      expect(html).toContain('data-pad="custom"');
      expect(html).toContain(`style="${padStyle(pad.slots)}"`);
    }
    for (const change of pad.changes) {
      expect(build.output).toContain(`${change.slot} ${change.from} → ${change.to}`);
    }
  });

  it("that isn't a colour fails the build, naming course.yaml", () => {
    const build = buildCourse(withPad("orange"));
    expect(build.ok).toBe(false);
    expect(build.output).toContain("course.yaml");
    expect(build.output).toMatch(/a catalogue pad \(green, .*\) or a colour written #RRGGBB/);
  });
});
