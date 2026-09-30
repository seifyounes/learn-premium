import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/** A copy of one built page with `edit` applied, as a site of its own. */
function siteWith(distDir: string, edit: (page: string) => string): string {
  const copy = mkdtempSync(join(tmpdir(), "lp-site-"));
  mkdirSync(join(copy, MODULE), { recursive: true });
  const page = readFileSync(join(distDir, MODULE, "index.html"), "utf8");
  writeFileSync(join(copy, MODULE, "index.html"), edit(page));
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
    expect(pad.coverage).toEqual({ pads: 1, requirements: 15, pages: 2 });
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
    expect(hue.coverage).toEqual({ pages: 2, svgs: 2, islands: 1, colours: 0 });
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
    expect(hue.coverage.colours).toBe(5);
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
