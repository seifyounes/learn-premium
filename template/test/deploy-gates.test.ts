import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GATES } from "../gates/index.ts";
import { pagesOf } from "../gates/pages.ts";
import { runControls, runGates, type GateInput, type GatePoint } from "../gates/runner.ts";
import { readLicences } from "../src/licences/file.ts";
import { HAND_WRITTEN_NOTICES } from "../src/licences/hand-written.ts";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

const DEPLOY_ONLY = ["no-materials", "no-build-evidence", "noindex", "licences", "licences-file"];
const LIVE = ["live-routes", "live-headers", "live-private-paths"];
const gatesNamed = (ids: string[]) => GATES.filter((g) => ids.includes(g.id));
const run = (point: GatePoint, input: GateInput, ids: string[]) =>
  runGates({ point, commit: COMMIT, input, gates: gatesNamed(ids) });

describe("the deploy and live gates on the Fixture Course's production build", () => {
  // What Vercel's production deploy builds: no Trap page.
  const build = buildCourse(FIXTURE_COURSE, { VERCEL_ENV: "production" });
  const input: GateInput = { contentDir: FIXTURE_COURSE, distDir: build.outDir };
  /** Every page the production build made: the gates must cover each one. */
  const pageCount = () => pagesOf(build.outDir).length;

  it("builds, with the Licences file at /licences.txt", () => {
    expect(build.ok, build.output).toBe(true);
    expect(build.output).toMatch(/Licences file: 15 shipped packages and 7 hand-written notices/);
  });

  it("lists exactly the packages the bundle ships, never the ones that only build the site", () => {
    const file = readLicences(readFileSync(join(build.outDir, "licences.txt"), "utf8"));
    expect(file.packages.map((p) => p.name)).toEqual([
      "@astrojs/react",
      "@fontsource-variable/archivo",
      "@fontsource/atkinson-hyperlegible-mono",
      "@fontsource/atkinson-hyperlegible-next",
      "astro",
      "framer-motion",
      "jsxgraph",
      "katex",
      "motion",
      "motion-dom",
      "motion-utils",
      "plotly.js-cartesian-dist-min",
      "react",
      "react-dom",
      "scheduler",
    ]);
    expect(file.packages.find((p) => p.name === "react")).toEqual({
      name: "react",
      version: "19.3.0",
      licence: "MIT",
      hasText: true,
    });
    expect(file.packages.filter((p) => !p.hasText)).toEqual([]);
    expect(file.notices.map((n) => `${n.id} ${n.licence}`)).toEqual([
      "mhchem Apache-2.0",
      "katex-fonts OFL-1.1",
      "pyodide MPL-2.0",
      "rdkit BSD-3-Clause",
      "freetype FTL",
      "coolprop MIT",
      "elkjs EPL-2.0",
    ]);
    const text = readFileSync(join(build.outDir, "licences.txt"), "utf8");
    // The source lines EPL-2.0 and MPL-2.0 ask for, and each notice's own licence text.
    expect(text).toContain("The source code of elkjs is available at https://github.com/kieler/elkjs");
    expect(text).toContain("The source code of Pyodide, including the files this site serves, is available at");
    expect(text).toContain("Eclipse Public License - v 2.0");
    expect(text).toContain("The FreeType Project LICENSE");
    expect(HAND_WRITTEN_NOTICES).toHaveLength(7);
  });

  it("commits the build's Licences file at public/licences.txt", () => {
    expect(readFileSync(join(TEMPLATE_DIR, "public", "licences.txt"), "utf8")).toBe(
      readFileSync(join(build.outDir, "licences.txt"), "utf8"),
    );
  });

  it("pass before merge, each reporting what it covered", async () => {
    const report = await run("deploy", input, DEPLOY_ONLY);
    expect(report.green, JSON.stringify(report.gates, null, 2)).toBe(true);
    expect(report.gates.map((g) => g.id)).toEqual(DEPLOY_ONLY);
    const coverage = Object.fromEntries(report.gates.map((g) => [g.id, g.coverage]));
    expect(pageCount()).toBeGreaterThanOrEqual(9);
    expect(coverage["noindex"]).toEqual({ pages: pageCount(), configs: 1 });
    expect(coverage["licences"]).toEqual({ packages: 15 });
    expect(coverage["no-build-evidence"]?.["buildRecords"]).toBeGreaterThan(0);
  });

  it("pass on the build served the way Vercel serves it under vercel.json", async () => {
    const report = await run("live", input, LIVE);
    expect(report.green, JSON.stringify(report.gates, null, 2)).toBe(true);
    expect(report.gates.map((g) => g.id)).toEqual(LIVE);
    const coverage = Object.fromEntries(report.gates.map((g) => [g.id, g.coverage]));
    // Every page, and the Licences file.
    expect(coverage["live-routes"]).toEqual({ routes: pageCount() + 1, hubs: 5 });
    expect(coverage["live-private-paths"]?.["probes"]).toBeGreaterThan(40);
  });

  it("run at their own points only", () => {
    const at = (point: GatePoint) => GATES.filter((g) => g.points.includes(point)).map((g) => g.id);
    for (const id of DEPLOY_ONLY) expect(at("deploy")).toContain(id);
    expect(at("live")).toEqual(LIVE);
  });

  it("catch every negative control: a planted GPL-3.0 package raises a Checkpoint item, the rest block", async () => {
    const result = await runControls({ input, gates: gatesNamed([...DEPLOY_ONLY, ...LIVE]) });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    const licences = result.gates.find((g) => g.id === "licences");
    expect(licences?.controls).toContainEqual(
      expect.objectContaining({ defect: expect.stringMatching(/GPL-3\.0/), expected: "checkpoint", caught: true }),
    );
    const materials = result.gates.find((g) => g.id === "no-materials");
    expect(materials?.controls.every((c) => c.status === "block")).toBe(true);
  });

  it("name the planted GPL-3.0 package and send it to the Owner", async () => {
    const gate = gatesNamed(["licences"])[0];
    const control = gate?.controls.find((c) => /GPL/.test(c.defect));
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const planted = control?.plant(input, mkdtempSync(join(tmpdir(), "lp-gpl-")));
    const report = await run("deploy", planted ?? input, ["licences"]);
    expect(report.green).toBe(true);
    expect(report.checkpointItems).toEqual([
      {
        gate: "licences",
        outcome: "checkpoint",
        at: "planted-gpl-package@1.0.0",
        message:
          "planted-gpl-package ships in the site and GPL-3.0 is not on the allow-list: the Owner decides whether it ships",
      },
    ]);
  });
});
