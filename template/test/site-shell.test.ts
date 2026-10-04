// The Study site shell around the Module pages: the routes, the fixed nav, the contents-sheet home,
// the Course hubs (Master Rules, Lab, Revision) and About, and what every page carries.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const ROUTES = [
  "",
  "01-thermal-resistance",
  "02-convection",
  "03-gradient-descent",
  "04-full-adder",
  "rules",
  "lab",
  "about",
  "revision/midterm",
  "tool-gallery",
];

/** The fixed nav's links on a page: label → href, and the one marked current. */
function nav(page: string) {
  const block = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
  const links = [
    ...block.matchAll(/<a href="([^"]+)" class="site-nav-link"( aria-current="page")?[^>]*>([^<]+)<\/a>/g),
  ];
  return {
    links: Object.fromEntries(links.map((m) => [m[3]?.trim(), m[1]])),
    current: links.find((m) => m[2])?.[3]?.trim(),
  };
}

/** The contents line of one Module on the home page. */
const contentsLine = (page: string, module: string) =>
  new RegExp(`<li class="contents-line"[^>]*data-module="${module}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";

describe("the Study site shell", () => {
  const build = buildCourse(FIXTURE_COURSE);

  it("builds every route: home, each Module, Master Rules, Lab, About and a complete sitting's Revision", () => {
    expect(build.ok, build.output).toBe(true);
    for (const route of ROUTES) expect(existsSync(join(build.outDir, route, "index.html")), route).toBe(true);
  });

  it("builds no Revision for a sitting that isn't complete, and no Exam room before #74", () => {
    expect(readdirSync(join(build.outDir, "revision"))).toEqual(["midterm"]);
    expect(existsSync(join(build.outDir, "exam"))).toBe(false);
  });

  it("puts the fixed nav on every page, marking where the student is", () => {
    const expected = {
      Modules: "/",
      "Master Rules": "/rules/",
      Lab: "/lab/",
      Revision: "/revision/midterm/",
      About: "/about/",
    };
    const current: Record<string, string> = {
      "": "Modules",
      "01-thermal-resistance": "Modules",
      "02-convection": "Modules",
      "03-gradient-descent": "Modules",
      "04-full-adder": "Modules",
      rules: "Master Rules",
      lab: "Lab",
      about: "About",
      "revision/midterm": "Revision",
      // The Tool gallery is the Lab's other page of tools.
      "tool-gallery": "Lab",
    };
    for (const route of ROUTES) {
      const { links, current: marked } = nav(build.page(route));
      expect(links, route).toEqual(expected);
      expect(marked, route).toBe(current[route]);
    }
  });

  it("carries the Credit line and noindex on every page", () => {
    for (const route of ROUTES) {
      const page = build.page(route);
      expect(page, route).toMatch(
        /<footer[^>]*>A\. N\. Example · Fixture Course \(FX 101\) · Example University<\/footer>/,
      );
      expect(page, route).toContain('<meta name="robots" content="noindex, nofollow">');
    }
  });

  describe("home, the contents sheet", () => {
    const home = () => build.page("");

    it("lists every Module in number order, each line linking to its page", () => {
      const lines = [...home().matchAll(/<li class="contents-line"[^>]*data-module="([^"]+)"/g)].map((m) => m[1]);
      expect(lines).toEqual(["01-thermal-resistance", "02-convection", "03-gradient-descent", "04-full-adder"]);
      expect(contentsLine(home(), "02-convection")).toContain('href="/02-convection/"');
    });

    it("rings a high-yield Module in red pen, and only that one", () => {
      expect(contentsLine(home(), "01-thermal-resistance")).toContain('class="high-yield-ring"');
      expect(contentsLine(home(), "02-convection")).not.toContain("high-yield-ring");
    });

    it("tags each Module with the Exam sittings that cover it", () => {
      const tags = (module: string) =>
        [...contentsLine(home(), module).matchAll(/<span class="sitting-tag">([^<]+)<\/span>/g)].map((m) => m[1]);
      expect(tags("01-thermal-resistance")).toEqual(["Midterm", "Final"]);
      expect(tags("02-convection")).toEqual(["Final"]);
    });

    it("gives each Module a Mastery count and each sitting a readiness meter, filled in the browser", () => {
      for (const module of ["01-thermal-resistance", "02-convection"]) {
        expect(contentsLine(home(), module)).toMatch(/data-mastery>0<\/span>/);
      }
      const sittings = [...home().matchAll(/<li class="sitting-line" data-sitting="([^"]+)"/g)].map((m) => m[1]);
      expect(sittings).toEqual(["midterm", "final"]);
      expect(home().match(/data-readiness-meter/g)).toHaveLength(2);
      // What the browser measures Mastery on: each Module's Worked examples and Practice items.
      const shapes = JSON.parse((/data-shapes="([^"]+)"/.exec(home())?.[1] ?? "{}").replace(/&quot;/g, '"')) as Record<
        string,
        unknown
      >;
      expect(shapes["01-thermal-resistance"]).toEqual({
        worked: [{ code: "W01.1", steps: 6 }],
        practice: ["1", "2", "3"],
      });
      expect(shapes["02-convection"]).toEqual({ worked: [], practice: ["1"] });
    });

    it("keeps a margin for the resume note, hidden until the browser knows where the student stopped", () => {
      expect(home()).toMatch(/<a class="resume-note"[^>]*hidden/);
    });
  });

  describe("Master Rules", () => {
    const rules = () => build.page("rules");

    it("lists each Module's rules, in Module order and then solving order", () => {
      const names = [...rules().matchAll(/<h3 class="rule-name"[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
      expect(names).toEqual([
        "Heat rate through a wall",
        "Resistance of a plane wall",
        "Layers in series",
        "Newton's law of cooling",
        "Convection as a resistance",
      ]);
    });

    it("sets every rule in paper math with stacked fractions", () => {
      expect(rules().match(/class="mfrac"/g)?.length).toBeGreaterThanOrEqual(3);
      expect(rules()).not.toContain("katex-error");
    });

    it("is reference only: no search, no test mode, nothing to run", () => {
      expect(rules()).not.toMatch(/<input|<form|<button|<astro-island|<script/);
    });
  });

  it("lists every tool on the Lab page under the Module that uses it", () => {
    const lab = build.page("lab");
    expect(lab).toContain('href="/03-gradient-descent/"');
    expect(lab).toContain('href="/04-full-adder/"');
    expect(lab.match(/class="sim-card"/g)).toHaveLength(3);
    expect(lab).not.toContain("No interactive tools are built for this Course yet.");
  });

  it("explains the project on the About page: Course, Professor, University and who built it", () => {
    const about = build.page("about");
    for (const text of ["Fixture Course", "A. N. Example", "Example University", "A. N. Owner"]) {
      expect(about).toContain(text);
    }
  });

  it("assembles a complete sitting's Revision from its Modules' Summaries and rules, and nothing else", () => {
    const revision = build.page("revision/midterm");
    expect(revision).toContain("A wall resists heat like a resistor resists current");
    expect(revision).toContain("Resistance of a plane wall");
    expect(revision).not.toContain("A surface hands heat to the fluid around it");
    expect(revision).not.toContain("Newton's law of cooling");
  });
});

describe("before a sitting is complete", () => {
  it("has no Revision page and no Revision in the nav (no stub)", () => {
    const course = fixtureWith("course.yaml", (s) => s.replace("complete: true", "complete: false"));
    const build = buildCourse(course);
    expect(build.ok, build.output).toBe(true);
    expect(existsSync(join(build.outDir, "revision"))).toBe(false);
    for (const route of ["", "01-thermal-resistance", "rules", "lab", "about"]) {
      expect(Object.keys(nav(build.page(route)).links), route).toEqual(["Modules", "Master Rules", "Lab", "About"]);
    }
  });
});

describe("a Course with no tools yet", () => {
  it("says so on the Lab page", () => {
    const course = fixtureWith("course.yaml", (s) => s);
    for (const module of ["03-gradient-descent", "04-full-adder"])
      rmSync(join(course, "modules", module), { recursive: true });
    const build = buildCourse(course);
    expect(build.ok, build.output).toBe(true);
    expect(build.page("lab")).toContain("No interactive tools are built for this Course yet.");
  });
});

describe("a sitting naming a Module the Course doesn't have", () => {
  it("fails the build, naming course.yaml and the Module", () => {
    const course = fixtureWith("course.yaml", (s) =>
      s.replace("modules: [01-thermal-resistance]", "modules: [09-nowhere]"),
    );
    const build = buildCourse(course);
    expect(build.ok).toBe(false);
    expect(build.output).toContain(
      'course.yaml: sitting "midterm" covers 09-nowhere, which the Course has no Module for',
    );
  });
});
