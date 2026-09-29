import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/** A throwaway copy of the Fixture Course with one file replaced, for negative controls. */
export function fixtureWith(file: string, edit: (source: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-course-"));
  cpSync(FIXTURE_COURSE, dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  return dir;
}
