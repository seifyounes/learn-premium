import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { padGate, redHueRule } from "../gates/colour.ts";
import { runGates, type Gate, type GateInput } from "../gates/runner.ts";
import { resolvePad } from "../src/pads/pad.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

async function runOne(gate: Gate, input: GateInput) {
  const report = await runGates({ point: "module", commit: COMMIT, input, gates: [gate] });
  const result = report.gates[0];
  if (!result) throw new Error(`${gate.id} did not run`);
  return result;
}

/** A copy of one built page with `edit` applied, and the stylesheets, as a site of its own. */
function siteWith(distDir: string, edit: (page: string) => string, css?: (sheet: string) => string): string {
  const copy = mkdtempSync(join(tmpdir(), "lp-site-"));
  mkdirSync(join(copy, MODULE), { recursive: true });
  const page = readFileSync(join(distDir, MODULE, "index.html"), "utf8");
  writeFileSync(join(copy, MODULE, "index.html"), edit(page));
  cpSync(join(distDir, "_astro"), join(copy, "_astro"), {
    recursive: true,
    filter: (src) => !/\.\w+$/.test(src) || src.endsWith(".css"),
  });
  if (css) {
    for (const sheet of readdirSync(join(copy, "_astro")).filter((f) => f.endsWith(".css"))) {
      const path = join(copy, "_astro", sheet);
      writeFileSync(path, css(readFileSync(path, "utf8")));
    }
  }
  return copy;
}
const inMain = (html: string) => (page: string) => page.replace("</main>", `${html}</main>`);

describe("the colour gates on the Fixture Course", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const input = { contentDir: FIXTURE_COURSE, distDir: build.outDir };

  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("the pad gate passes a catalogue pad that every page wears, with nothing to fix", async () => {
    const pad = await runOne(padGate, input);
    expect(pad.status).toBe("pass");
    expect(pad.coverage).toEqual({ pads: 1, requirements: 18, pages: 16 });
    expect(pad.fixes).toEqual([]);
  });

  it("the pad gate blocks a page still wearing another pad, naming the page and the slot", async () => {
    const teal = resolvePad("teal").slots;
    const stale = siteWith(build.outDir, (page) =>
      page.replace(/--pad-print: #[0-9A-F]{6}/, `--pad-print: ${teal.print}`),
    );
    const pad = await runOne(padGate, { contentDir: FIXTURE_COURSE, distDir: stale });
    expect(pad.status).toBe("block");
    expect(pad.findings).toEqual([
      {
        outcome: "block",
        at: `/${MODULE}/`,
        message: `the page wears --pad-print: ${teal.print}; the Course's pad green has #2E5A38`,
      },
    ]);
  });

  it("the Red Hue Rule passes the Fixture Course, reporting what it looked at", async () => {
    const hue = await runOne(redHueRule, input);
    expect(hue.status).toBe("pass");
    expect(hue.coverage).toMatchObject({ pages: 16, islands: 46, stylesheets: 1 });
    expect(hue.coverage.svgs).toBeGreaterThan(8);
    // The stylesheet's inks: the red pen, graphite and pencil, and the black a hover mixes in.
    expect(hue.coverage.colours).toBeGreaterThan(0);
  });

  it("the Red Hue Rule blocks a sheet figure within 60° of the red pen, naming the page and the colour", async () => {
    const site = siteWith(build.outDir, inMain('<svg viewBox="0 0 10 10"><path d="M0 0H10" stroke="#D9622B"/></svg>'));
    const hue = await runOne(redHueRule, { ...input, distDir: site });
    expect(hue.status).toBe("block");
    expect(hue.findings).toEqual([
      {
        outcome: "block",
        at: `/${MODULE}/`,
        message: expect.stringMatching(
          /^#D9622B \(stroke on <path>\) sits \d+° from the red pen's hue; the Red Hue Rule needs 60° or a grey$/,
        ),
      },
    ]);
  });

  it("the Red Hue Rule finds red however the figure writes it", async () => {
    const figures = [
      '<svg><circle r="2" fill="red"/></svg>',
      '<svg><circle r="2" style="fill: rgb(200 80 40); stroke-width: 2"/></svg>',
      '<svg><style>.load { stroke: hsl(20 70% 45%) }</style><path class="load" d="M0 0H1"/></svg>',
      '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#b5451b"/></linearGradient></defs></svg>',
      '<svg style="--figure-ink: oklch(55% 0.15 40)"><path d="M0 0H1" stroke="var(--figure-ink)"/></svg>',
    ];
    for (const figure of figures) {
      const hue = await runOne(redHueRule, { ...input, distDir: siteWith(build.outDir, inMain(figure)) });
      expect(hue.status, figure).toBe("block");
    }
  });

  it("the Red Hue Rule lets the red pen, greys, cool colours and framed tools through", async () => {
    const allowed = [
      '<svg><path d="M0 0H1" stroke="#C0341D"/><path d="M0 0H1" stroke="rgb(192, 52, 29)"/></svg>',
      '<svg><path d="M0 0H1" stroke="var(--color-red-pen)" fill="currentColor"/></svg>',
      '<svg><path d="M0 0H1" stroke="#555" fill="#3D433C"/><path d="M0 0H1" fill="url(#red-arrow)"/></svg>',
      '<svg><path d="M0 0H1" stroke="#1F4B73" fill="none"/></svg>',
      '<div data-framed-tool="circuit"><svg><path d="M0 0H1" stroke="#E0301E"/></svg></div>',
    ];
    const site = siteWith(build.outDir, inMain(allowed.join("")));
    const hue = await runOne(redHueRule, { ...input, distDir: site });
    expect(hue.findings).toEqual([]);
    // The five planted colours, over what the page already paints with.
    const baseline = (await runOne(redHueRule, input)).coverage.colours ?? 0;
    expect((hue.coverage.colours ?? 0) - baseline).toBe(5);
  });

  it("the Red Hue Rule reads the page's stylesheets, naming the one a red comes through", async () => {
    const site = siteWith(
      build.outDir,
      (page) => page,
      (sheet) => `${sheet}
.plot-line{stroke:#D9622B}`,
    );
    const hue = await runOne(redHueRule, { ...input, distDir: site });
    expect(hue.status).toBe("block");
    expect(hue.findings).toEqual([
      {
        outcome: "block",
        at: expect.stringMatching(/^\/_astro\/.+\.css$/),
        message: expect.stringMatching(
          /^#D9622B \(stroke in stylesheet \/_astro\/.+\.css\) sits \d+° from the red pen's hue/,
        ),
      },
    ]);
  });

  it("the Red Hue Rule reads a <style> in the head, and leaves a framed tool's own rules alone", async () => {
    const head = (css: string) => (page: string) => page.replace("</head>", `<style>${css}</style></head>`);
    const red = await runOne(redHueRule, { ...input, distDir: siteWith(build.outDir, head(".load{fill:#b5451b}")) });
    expect(red.status).toBe("block");
    const framed = siteWith(build.outDir, head("[data-framed-tool] .wire-hot{stroke:#E0301E}"));
    expect((await runOne(redHueRule, { ...input, distDir: framed })).findings).toEqual([]);
    // A sheet selector listed beside a framed one still paints the sheet.
    const listed = siteWith(build.outDir, head("[data-framed-tool] .wire-hot, .plot-line{stroke:#E0301E}"));
    expect((await runOne(redHueRule, { ...input, distDir: listed })).status).toBe("block");
  });

  it("the Red Hue Rule blocks a page whose stylesheet it can't read", async () => {
    const site = siteWith(build.outDir, (page) =>
      page.replace("</head>", '<link rel="stylesheet" href="/_astro/gone.css"></head>'),
    );
    const hue = await runOne(redHueRule, { ...input, distDir: site });
    expect(hue.findings).toEqual([
      {
        outcome: "block",
        at: `/${MODULE}/`,
        message:
          "the page links the stylesheet /_astro/gone.css, which the built site doesn't hold, so its colours can't be read",
      },
    ]);
  });

  it("the Red Hue Rule reads a figure an island renders", async () => {
    const site = siteWith(build.outDir, (page) =>
      page.replace(
        /(<astro-island[^>]*props="\{)/,
        "$1&quot;figure&quot;:[0,&quot;&lt;svg&gt;&lt;path stroke=\\&quot;#D9622B\\&quot;/&gt;&lt;/svg&gt;&quot;],",
      ),
    );
    const hue = await runOne(redHueRule, { ...input, distDir: site });
    expect(hue.status).toBe("block");
  });
});

describe("the pad gate on a custom pad", () => {
  it("passes once the auto-fix has run, and lists every change in the Gate report", async () => {
    const course = fixtureWith("course.yaml", (s) => s.replace(/^pad: .*$/m, 'pad: "#D2691E"'));
    const build = buildCourse(course);
    expect(build.ok, build.output).toBe(true);
    const pad = resolvePad("#D2691E");
    const result = await runOne(padGate, { contentDir: course, distDir: build.outDir });
    expect(result.status).toBe("pass");
    expect(result.fixes).toEqual(
      pad.changes.map((c) => expect.stringContaining(`course.yaml pad #D2691E: ${c.slot} ${c.from} → ${c.to}`)),
    );
  });
});
