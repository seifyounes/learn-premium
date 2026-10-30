// Throwaway release repos and Course projects for the Upgrade wave tests: a release repo tagged
// v1.0.0, v1.1.0 and v2.0.0 (annotated, their messages the release notes), and a Course project
// pinned to v1.0.0 whose content is a copy of the real Fixture Course. Nothing here touches the
// real repo, and no migration is ever added to it: the v2 migration lives only in the throwaway repo.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HOOKS_PATH } from "../scripts/intake/create.ts";
import { templateAt } from "../scripts/intake/release.ts";
import { renderNotes, type ClosedGateGap } from "../scripts/release/notes.ts";
import { must } from "./fake-notebooklm.ts";
import { makeLive } from "./fixture-courses.ts";
import { jsonInput, ledger, tempDir, writeFiles } from "./helpers.ts";

export const HOLDER = "session-a";

/** The Fixture Course in this repo: read, never written. */
export const FIXTURE_COURSE = resolve(import.meta.dirname, "..", "..", "fixture-course");

/** The template layer's real migration runner: a release carries it, so the Upgrade wave imports it. */
const RUNNER = readFileSync(resolve(import.meta.dirname, "..", "..", "template", "migrations", "runner.ts"), "utf8");

/** The override a Course keeps for the gate gap v2.0.0 closes. */
export const OVERRIDE = "src/components/HonestyCell.astro";
export const CLOSED_GAP = 12;

/** A migration that drops a field the v2 content contract no longer has (the harness test's own). */
const DROP_LEGACY_FIELD = [
  `import { readFileSync, writeFileSync } from "node:fs";`,
  `import { join } from "node:path";`,
  `export const describe = "course.yaml drops legacyTitle";`,
  `export function migrate(contentDir: string): void {`,
  `  const path = join(contentDir, "course.yaml");`,
  `  writeFileSync(path, readFileSync(path, "utf8").replace(/^legacyTitle:.*\\n/m, ""));`,
  `}`,
  ``,
].join("\n");

export function git(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout.trim();
}

export function identify(repo: string): void {
  git(repo, "config", "core.autocrlf", "false");
  git(repo, "config", "user.name", "Owner");
  git(repo, "config", "user.email", "owner@example.com");
}

export const V1_TEMPLATE: Record<string, string> = {
  "package.json": `{"type":"module"}\n`,
  ".gitignore": "node_modules/\ndist/\n",
  "src/components/HonestyCell.astro": "<td>v1 honesty</td>\n",
  "src/site/old.ts": "export const old = 1;\n",
  "migrations/runner.ts": RUNNER,
  [`${HOOKS_PATH.slice("template/".length)}/pre-commit`]: "#!/bin/sh\nexit 0\n",
};

/**
 * A release repo, tagged `v1.0.0`, `v1.1.0` (closes gate gap #1) and `v2.0.0` (closes #12, retires
 * `OVERRIDE`, ships a migration that drops `legacyTitle`, adds `src/site/new.ts`, deletes `old.ts`).
 */
export function releaseRepo(): string {
  const repo = tempDir("release");
  git(repo, "init", "-q", "-b", "main");
  identify(repo);
  addRelease(repo, "v1.0.0", V1_TEMPLATE, { kind: "major" });
  addRelease(
    repo,
    "v1.1.0",
    { "src/site/helper.ts": "export const helper = 1;\n" },
    {
      previous: "v1.0.0",
      kind: "minor",
      gateGaps: [{ number: 1, title: "A beat over the limit slips through", course: null, overrides: [] }],
    },
  );
  git(repo, "rm", "-q", "template/src/site/old.ts");
  addRelease(
    repo,
    "v2.0.0",
    {
      "migrations/v2.ts": DROP_LEGACY_FIELD,
      "src/site/new.ts": "export const next = 2;\n",
      "src/components/HonestyCell.astro": "<td>v2 honesty</td>\n",
    },
    {
      previous: "v1.1.0",
      kind: "major",
      gateGaps: [
        {
          number: CLOSED_GAP,
          title: "HonestyCell hides a hedged claim",
          course: "Fixture Course",
          overrides: [OVERRIDE],
        },
      ],
    },
  );
  return repo;
}

/**
 * Commits `files` (path under `template/` → content) on top of the repo's HEAD and tags the commit as
 * release `name`, its release notes the annotated tag's message; `lightweight` tags it plain instead.
 */
export function addRelease(
  repo: string,
  name: string,
  files: Record<string, string>,
  options: {
    previous?: string | null;
    kind?: "major" | "minor";
    gateGaps?: ClosedGateGap[];
    lightweight?: boolean;
  } = {},
): void {
  writeFiles(repo, Object.fromEntries(Object.entries(files).map(([p, c]) => [`template/${p}`, c])));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", `release ${name}`);
  if (options.lightweight === true) {
    git(repo, "tag", name);
    return;
  }
  const notes = renderNotes({
    version: name,
    previous: options.previous ?? null,
    kind: options.kind ?? "minor",
    sha: git(repo, "rev-parse", "HEAD"),
    gateGaps: options.gateGaps ?? [],
    migrations: [],
    phonePass: null,
  });
  const child = spawnSync("git", ["-C", repo, "tag", "--annotate", "--cleanup=verbatim", "--file=-", name], {
    input: notes,
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(`git tag ${name}: ${child.stderr}`);
}

export interface UpgradeCourse {
  project: string;
  source: string;
  materials: string;
  /** The Module folders under content/modules/. */
  folders: string[];
}

/**
 * A Course project pinned to v1.0.0 of `source`, committed on `main`: the template layer from the
 * release's git objects, content (a copy of the Fixture Course without its Gate reports, plus a
 * `legacyTitle` line the v2 migration drops, or a single small Module), the Course override for
 * `CLOSED_GAP`, Materials `LNN.pdf` per Module, the Module map, and every Module live.
 */
export function upgradeCourse(
  source: string,
  options: { sittings?: { id: string; name: string; date: string | null }[]; content?: "fixture" | "minimal" } = {},
): UpgradeCourse {
  const { sittings = [], content = "fixture" } = options;
  const project = tempDir("project");
  for (const [path, bytes] of templateAt(source, "v1.0.0")) {
    const full = join(project, "template", path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  if (content === "fixture") {
    cpSync(FIXTURE_COURSE, join(project, "content"), {
      recursive: true,
      filter: (path) => !path.replace(/\\/g, "/").includes("build-records/gate-reports"),
    });
  } else {
    writeFiles(project, {
      "content/course.yaml": "name: Fixture Course\npad: green\n",
      "content/modules/01-thermal-resistance/module.yaml": "title: Thermal resistance\n",
    });
  }
  const courseYaml = join(project, "content", "course.yaml");
  writeFileSync(
    courseYaml,
    `${readFileSync(courseYaml, "utf8").replace(/\r?\n?$/, "\n")}legacyTitle: Fixture Course\n`,
  );
  writeFiles(project, {
    "overrides/.gitkeep": "",
    [`overrides/${OVERRIDE}`]: "<td>course honesty</td>\n",
    ".gitignore": "node_modules/\ndist/\n",
  });

  const folders = readdirSync(join(project, "content", "modules")).sort();
  const materials = tempDir("materials");
  writeFiles(materials, Object.fromEntries(folders.map((f) => [`L${f.slice(0, 2)}.pdf`, `lecture ${f}`])));
  must(
    ledger(
      "init",
      "--project",
      project,
      "--holder",
      HOLDER,
      "--release",
      "v1.0.0",
      "--intake",
      jsonInput({
        courseName: "Fixture Course",
        materialsPath: materials,
        disciplines: ["heat transfer"],
        pad: "green",
        arabicNotes: false,
        sittings,
      }),
    ),
  );
  const moduleMap = {
    modules: folders.map((f) => ({
      id: f.slice(0, 2),
      slug: f.slice(3),
      title: f.slice(3),
      materials: [`L${f.slice(0, 2)}.pdf`],
    })),
    unmapped: [],
  };
  must(ledger("map", "--project", project, "--holder", HOLDER, "--input", jsonInput(moduleMap)));
  for (const f of folders) makeLive(project, f.slice(0, 2));
  must(
    ledger(
      "record",
      "override",
      "--project",
      project,
      "--holder",
      HOLDER,
      "--path",
      OVERRIDE,
      "--gate-gap",
      String(CLOSED_GAP),
    ),
  );

  git(project, "init", "-q", "-b", "main");
  identify(project);
  git(project, "config", "core.hooksPath", HOOKS_PATH);
  const hook = join(project, HOOKS_PATH, "pre-commit");
  if (existsSync(hook)) chmodSync(hook, 0o755);
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "chore: the Course at v1.0.0");
  return { project, source, materials, folders };
}
