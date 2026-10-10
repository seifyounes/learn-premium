// Course overrides: the Fixture Course built with an overrides area, as a Course project's build
// reads `../overrides`. Each override is loaded in place of the template file it shadows, on the
// server render, in the client bundle and in the stylesheet; an override that shadows nothing, or
// would swap a gate or the config, fails the build.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");
const CLIENT_MARK = "course-override-client-7f3a";
// A Tailwind class no template file (this test included) spells out, so only the override can ask for it.
const OVERRIDE_ONLY_CLASS = ["tracking-[0.", "43em]"].join("");

function overridesArea(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-overrides-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const template = (path: string) => readFileSync(join(TEMPLATE_DIR, path), "utf8");

describe("the Fixture Course built with Course overrides", () => {
  const honesty = template("src/components/HonestyCell.astro").replace(
    "Synthetic Course: written to test the Site template",
    `<span class="${OVERRIDE_ONLY_CLASS}">Overridden honesty cell</span>`,
  );
  const nav = template("src/site/nav.ts").replace('label: "Master Rules"', 'label: "Master Rules (overridden)"');
  const check = template("src/practice/check.ts").replace(
    "const typed = readNumber(input);",
    `if (input === ${JSON.stringify(CLIENT_MARK)}) return "right";\n  const typed = readNumber(input);`,
  );
  const dir = overridesArea({
    ".gitkeep": "",
    "src/components/HonestyCell.astro": honesty,
    "src/site/nav.ts": nav,
    "src/practice/check.ts": check,
  });
  const build = buildCourse(FIXTURE_COURSE, { OVERRIDES_DIR: dir });

  it("the overrides really differ from the template files they shadow", () => {
    expect(honesty).not.toBe(template("src/components/HonestyCell.astro"));
    expect(nav).not.toBe(template("src/site/nav.ts"));
    expect(check).not.toBe(template("src/practice/check.ts"));
  });

  it("loads each override in place of its template file: page, module, client bundle and stylesheet", () => {
    expect(build.ok, build.output).toBe(true);
    const home = build.page("");
    expect(home).toContain("Overridden honesty cell");
    expect(home).not.toContain("Synthetic Course: written to test the Site template");
    expect(home).toContain("Master Rules (overridden)");
    const client = readdirSync(join(build.outDir, "_astro"))
      .filter((f) => f.endsWith(".js"))
      .some((f) => readFileSync(join(build.outDir, "_astro", f), "utf8").includes(CLIENT_MARK));
    expect(client, "the overridden check.ts in the Practice island's bundle").toBe(true);
    // A class only the override uses is still generated: Tailwind scans the overrides area.
    expect(build.css()).toMatch(/\.tracking-\\\[0\\\.4[3]em\\\]\{[^}]*letter-spacing:\.4[3]em/);
  });

  it("leaves the template layer itself untouched", () => {
    expect(template("src/components/HonestyCell.astro")).toContain(
      "Synthetic Course: written to test the Site template",
    );
  });
});

describe("an override that can't be one fails the build", () => {
  it("one that shadows no template file", () => {
    const build = buildCourse(FIXTURE_COURSE, {
      OVERRIDES_DIR: overridesArea({ "src/components/HonestyCel.astro": "<p>typo</p>" }),
    });

    expect(build.ok).toBe(false);
    expect(build.output).toContain("src/components/HonestyCel.astro shadows no template file");
  });

  it("one of a module the build config itself imports, which Node reads before any override applies", () => {
    const build = buildCourse(FIXTURE_COURSE, {
      OVERRIDES_DIR: overridesArea({
        "src/media/integration.ts": template("src/media/integration.ts"),
        "src/overrides/plugin.ts": template("src/overrides/plugin.ts"),
      }),
    });

    expect(build.ok).toBe(false);
    expect(build.output).toContain("src/media/integration.ts is read with the build config");
    expect(build.output).toContain("src/overrides/plugin.ts is read with the build config");
  });

  it("one that would swap a gate, a script or the config", () => {
    const build = buildCourse(FIXTURE_COURSE, {
      OVERRIDES_DIR: overridesArea({
        "gates/cli.ts": "process.exit(0);\n",
        "astro.config.mjs": "export default {};\n",
      }),
    });

    expect(build.ok).toBe(false);
    expect(build.output).toContain("gates/cli.ts: an override shadows site code or styles under src/");
    expect(build.output).toContain("astro.config.mjs: an override shadows site code or styles under src/");
  });
});
