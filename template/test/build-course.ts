import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");
export const FIXTURE_COURSE = resolve(TEMPLATE_DIR, "../fixture-course");

export interface BuildResult {
  ok: boolean;
  output: string;
  outDir: string;
  page(route: string): string;
  /** Every stylesheet the build emitted, joined. */
  css(): string;
}

/** Builds a Course's content with the Site template, the way `npm run build` does. */
export function buildCourse(contentDir: string): BuildResult {
  // Astro moves its output with rename(), so the output must sit on the template's own drive.
  mkdirSync(join(TEMPLATE_DIR, ".test-out"), { recursive: true });
  const outDir = mkdtempSync(join(TEMPLATE_DIR, ".test-out", "dist-"));
  const run = spawnSync(process.execPath, ["node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], {
    cwd: TEMPLATE_DIR,
    env: { ...process.env, CONTENT_DIR: contentDir, FORCE_COLOR: "0", NO_COLOR: "1" },
    encoding: "utf8",
  });
  return {
    ok: run.status === 0,
    output: `${run.stdout}\n${run.stderr}`,
    outDir,
    page: (route) => readFileSync(join(outDir, route, "index.html"), "utf8"),
    css: () =>
      readdirSync(join(outDir, "_astro"))
        .filter((f) => f.endsWith(".css"))
        .map((f) => readFileSync(join(outDir, "_astro", f), "utf8"))
        .join("\n"),
  };
}

/**
 * A throwaway copy of a Course (the Fixture Course by default) with one file edited, or added when
 * it isn't there (`edit` then gets ""), for negative controls.
 */
export function fixtureWith(file: string, edit: (source: string) => string, from = FIXTURE_COURSE): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-course-"));
  cpSync(from, dir, { recursive: true });
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, edit(existsSync(path) ? readFileSync(path, "utf8") : ""));
  return dir;
}
