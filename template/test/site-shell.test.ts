// The Study site shell around the Module pages: the routes, the fixed nav, the contents-sheet home,
// the Course hubs (Master Rules, Lab, Revision) and About, and what every page carries.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const ROUTES = [
  "",
  "01-thermal-resistance",
  "02-convection",
  "03-gradient-descent",
  "04-full-adder",
  "05-derivatives",
  "06-tank-level",
  "07-flanged-hub",
  "08-root-locus",
  "09-silo-blender",
  "rules",
  "lab",
  "about",
  "revision/midterm",
  "exam/midterm",
  "exam/midterm/2025",
  "exam/midterm/mock-1",
  "exam/midterm/announced",
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

  it("builds the Exam room and one page per variant for midterm", () => {
    expect(readdirSync(join(build.outDir, "exam"))).toEqual(["midterm"]);
    expect(readdirSync(join(build.outDir, "exam", "midterm")).sort()).toEqual([
      "2025",
      "announced",
      "index.html",
      "mock-1",
    ]);
  });

  it("builds no Revision or Exam room for a sitting that isn't complete", () => {
    expect(readdirSync(join(build.outDir, "revision"))).toEqual(["midterm"]);
    expect(existsSync(join(build.outDir, "exam", "final"))).toBe(false);
  });

  it("puts the fixed nav on every page, marking where the student is", () => {
    const expected = {
      Modules: "/",
      "Master Rules": "/rules/",
      Lab: "/lab/",
      "Exam room": "/exam/midterm/",
      Revision: "/revision/midterm/",
      About: "/about/",
    };
    const current: Record<string, string> = {
      "": "Modules",
      "01-thermal-resistance": "Modules",
      "02-convection": "Modules",
      "03-gradient-descent": "Modules",
      "04-full-adder": "Modules",
      "05-derivatives": "Modules",
      "06-tank-level": "Modules",
      "07-flanged-hub": "Modules",
      "08-root-locus": "Modules",
      "09-silo-blender": "Modules",
      rules: "Master Rules",
      lab: "Lab",
      about: "About",
      "revision/midterm": "Revision",
      "exam/midterm": "Exam room",
      "exam/midterm/2025": "Exam room",
      "exam/midterm/mock-1": "Exam room",
      "exam/midterm/announced": "Exam room",
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
      expect(lines).toEqual([
        "01-thermal-resistance",
        "02-convection",
        "03-gradient-descent",
        "04-full-adder",
        "05-derivatives",
        "06-tank-level",
        "07-flanged-hub",
        "08-root-locus",
        "09-silo-blender",
        "10-two-conveyors",
        "11-mechanisms",
        "12-cascade",
        "14-state-machines",
      ]);
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
        worked: [
          { code: "W01.1", steps: 6 },
          { code: "W01.2", steps: 5 },
        ],
        practice: ["1", "2", "3"],
      });
      expect(shapes["02-convection"]).toEqual({ worked: [], practice: ["1"] });
    });

    it("the midterm sitting line lists its mocks for readiness, and the final's has none", () => {
      const line = (id: string) =>
        new RegExp(`<li class="sitting-line"[^>]*data-sitting="${id}"[^>]*>`).exec(home())?.[0] ?? "";
      expect(line("midterm")).toContain('data-mocks="[&quot;midterm/mock-1&quot;,&quot;midterm/announced&quot;]"');
      expect(line("final")).not.toContain("data-mocks");
    });

    it("puts an Exam room button beside Revision on a complete sitting that has one", () => {
      const midterm = /<li class="sitting-line"[^>]*data-sitting="midterm"[\s\S]*?<\/li>/.exec(home())?.[0] ?? "";
      expect(midterm).toContain('href="/exam/midterm/"');
      expect(midterm).toContain('href="/revision/midterm/"');
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
    expect(lab).toContain('href="/05-derivatives/"');
    expect(lab).toContain('href="/07-flanged-hub/"');
    expect(lab).toContain('href="/08-root-locus/"');
    // The fourteen sims (the cascade is the tenth, the detector and the drill the eleventh and twelfth, the four-bar and the gear pair the others) and the Pyodide tool, then the machine part.
    expect(lab.match(/class="sim-card"/g)).toHaveLength(15);
    expect(lab.match(/class="sim-card part-card"/g)).toHaveLength(1);
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

describe("the Exam room's pages", () => {
  const build = buildCourse(FIXTURE_COURSE);

  it("lists the vault, the mocks and the announced format, and the question bank by Module and type", () => {
    expect(build.ok, build.output).toBe(true);
    const hub = build.page("exam/midterm");
    const lines = [...hub.matchAll(/<li class="exam-line" data-paper="([^"]+)"/g)].map((m) => m[1]);
    expect(lines).toEqual(["2025", "mock-1", "announced"]);
    expect(hub).toContain('href="/exam/midterm/2025/"');
    expect(hub).toContain("Announced format");
    // 3 past-paper questions, 3 of mock-1 and 2 of the announced mock, by type under Module 01.
    const bank = hub.slice(hub.indexOf('aria-label="Question bank"'));
    expect(bank).toContain('aria-label="Module 01"');
    expect([...bank.matchAll(/<div class="bank-type" data-type="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "calculation",
      "explain",
    ]);
    expect(bank.match(/class="bank-question"/g)).toHaveLength(8);
  });

  it("prints the questions on a paper's page, with the island's controls off until it hydrates", () => {
    const page = build.page("exam/midterm/2025");
    expect(page).toContain("Find its thermal resistance");
    expect(page).toMatch(/component-url="\/_astro\/PaperSheet\.[^"]+\.js"[^>]*client="visible"/);
    const island = page.slice(page.indexOf("<astro-island"), page.indexOf("</astro-island>"));
    for (const control of island.match(/<(?:button|input|textarea)\b[^>]*>/g) ?? [])
      expect(control, control).toContain("disabled");
    expect(page).not.toMatch(/\b0\s*\/\s*0\b/);
  });

  it("orders Revision by exam weight: a Module with more marks over the past papers comes first", () => {
    const withTwoModules = fixtureWith("course.yaml", (c) =>
      c.replace(
        "modules: [01-thermal-resistance]\n    complete: true",
        "modules: [01-thermal-resistance, 02-convection]\n    complete: true",
      ),
    );
    const course = fixtureWith(
      "sittings/midterm/papers/2025.yaml",
      (s) => s.replaceAll("module: 01-thermal-resistance", "module: 02-convection"),
      withTwoModules,
    );
    const weighted = buildCourse(course);
    expect(weighted.ok, weighted.output).toBe(true);
    const revision = weighted.page("revision/midterm");
    const sections = [...revision.matchAll(/<section class="hub-module" aria-label="Module (\d+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(["02", "01"]);
    expect(revision).toMatch(/Exam weight: <span dir="ltr">10<\/span> marks/);
  });

  it("keeps Revision's one Module in Module order for the Fixture's midterm", () => {
    const revision = build.page("revision/midterm");
    expect([...revision.matchAll(/<section class="hub-module" aria-label="Module (\d+)"/g)].map((m) => m[1])).toEqual([
      "01",
    ]);
  });
});

describe("a complete sitting without past papers", () => {
  it("has Revision and no Exam room or nav entry", () => {
    const course = fixtureWith("sittings/midterm/papers/2025.yaml", (s) => s);
    rmSync(join(course, "sittings"), { recursive: true });
    const build = buildCourse(course);
    expect(build.ok, build.output).toBe(true);
    expect(existsSync(join(build.outDir, "exam"))).toBe(false);
    expect(existsSync(join(build.outDir, "revision", "midterm", "index.html"))).toBe(true);
    for (const route of ["", "revision/midterm"])
      expect(Object.keys(nav(build.page(route)).links), route).toEqual([
        "Modules",
        "Master Rules",
        "Lab",
        "Revision",
        "About",
      ]);
    expect(build.page("revision/midterm")).not.toContain("Exam weight");
    expect(build.page("")).not.toContain("data-mocks");
  });
});

describe("Exam room content that doesn't fit the sitting", () => {
  it("fails the build for a sitting folder the Course has no sitting for", () => {
    const build = buildCourse(fixtureWith("sittings/orphan/papers/x.yaml", () => "title: x\n"));
    expect(build.ok).toBe(false);
    expect(build.output).toContain("sittings/orphan/");
  });

  it("fails the build for a question examining a Module the sitting doesn't cover", () => {
    const build = buildCourse(
      fixtureWith("sittings/midterm/mocks/mock-1.yaml", (s) =>
        s.replace("module: 01-thermal-resistance", "module: 02-convection"),
      ),
    );
    expect(build.ok).toBe(false);
    expect(build.output).toContain('question 1 examines 02-convection, which sitting "midterm" doesn\'t cover');
  });

  it("fails the build for a name used by a paper and a mock", () => {
    const mock = readFileSync(join(FIXTURE_COURSE, "sittings/midterm/mocks/mock-1.yaml"), "utf8");
    const build = buildCourse(fixtureWith("sittings/midterm/mocks/2025.yaml", () => mock));
    expect(build.ok).toBe(false);
    expect(build.output).toContain('the name "2025" is already used');
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
    for (const sims of [
      "01-thermal-resistance/sims",
      "03-gradient-descent",
      "04-full-adder",
      "05-derivatives/sims",
      "06-tank-level/sims",
      "07-flanged-hub/parts",
      "08-root-locus/sims",
      "09-silo-blender/sims",
      "10-two-conveyors/sims",
      "11-mechanisms/sims",
      "12-cascade/sims",
      "14-state-machines/sims",
    ])
      rmSync(join(course, "modules", sims), { recursive: true });
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
