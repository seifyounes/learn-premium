// The migration runner: a major Template release ships `migrations/v<major>.ts`, and an upgrade
// from an earlier release runs every newer major's migration, oldest first, on the Course's content.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migrations/runner.ts";

/** A migrations folder whose migrations each append their major to `log.txt` in the content. */
function migrationsFolder(majors: number[], extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-migrations-"));
  for (const major of majors) {
    writeFileSync(
      join(dir, `v${major}.ts`),
      [
        `import { appendFileSync } from "node:fs";`,
        `import { join } from "node:path";`,
        `export const describe = "step to v${major}";`,
        `export function migrate(contentDir: string): void {`,
        `  appendFileSync(join(contentDir, "log.txt"), "v${major}\\n");`,
        `}`,
      ].join("\n"),
    );
  }
  for (const [name, source] of Object.entries(extra)) writeFileSync(join(dir, name), source);
  return dir;
}

function course(): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-course-"));
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "log.txt"), "");
  return dir;
}

const log = (contentDir: string) => readFileSync(join(contentDir, "log.txt"), "utf8").split("\n").filter(Boolean);

describe("runMigrations", () => {
  it("runs every major newer than the content's release, oldest first", async () => {
    const dir = migrationsFolder([3, 1, 2, 5]);
    const content = course();
    const ran = await runMigrations({ contentDir: content, from: "v1.2.0", dir });
    expect(log(content)).toEqual(["v2", "v3", "v5"]);
    expect(ran).toEqual([
      { major: 2, describe: "step to v2" },
      { major: 3, describe: "step to v3" },
      { major: 5, describe: "step to v5" },
    ]);
  });

  it("stops at the target release's major", async () => {
    const content = course();
    await runMigrations({ contentDir: content, from: "v1.0.0", to: "v3.4.1", dir: migrationsFolder([2, 3, 4]) });
    expect(log(content)).toEqual(["v2", "v3"]);
  });

  it("runs nothing within one major (v1.2 to v1.5)", async () => {
    const content = course();
    const ran = await runMigrations({
      contentDir: content,
      from: "v1.2.0",
      to: "v1.5.0",
      dir: migrationsFolder([1, 2]),
    });
    expect(ran).toEqual([]);
    expect(log(content)).toEqual([]);
  });

  it("stops at the first migration that throws, naming it", async () => {
    const dir = migrationsFolder([2, 4], {
      "v3.ts": `export const describe = "broken";\nexport function migrate(): void { throw new Error("no sims folder"); }\n`,
    });
    const content = course();
    await expect(runMigrations({ contentDir: content, from: "v1.0.0", dir })).rejects.toThrow(
      "the v3 migration failed: no sims folder",
    );
    expect(log(content)).toEqual(["v2"]);
  });

  it("refuses a migration file that doesn't export describe and migrate", async () => {
    const dir = migrationsFolder([], { "v2.ts": `export const migrate = 1;\n` });
    await expect(runMigrations({ contentDir: course(), from: "v1.0.0", dir })).rejects.toThrow(
      /v2\.ts must export describe/,
    );
  });

  it("refuses anything but a release tag, and migrating down", async () => {
    const dir = migrationsFolder([2]);
    await expect(runMigrations({ contentDir: course(), from: "1.0.0", dir })).rejects.toThrow(
      /not a Template release tag/,
    );
    await expect(runMigrations({ contentDir: course(), from: "v3.0.0", to: "v2.0.0", dir })).rejects.toThrow(
      /can't migrate down/,
    );
  });
});
