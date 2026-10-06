// `intake create`: the Course project made the /newproject way, from the Site template at the
// pinned release, against synthetic Materials, a throwaway workspace and a throwaway release repo.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { FakeHosting } from "./fake-hosting.ts";
import { must } from "./fake-notebooklm.ts";
import { intake, jsonInput, ledger, tempDir, writeFiles, type Result } from "./helpers.ts";

// sha256 of the literal file contents, computed independently of the code under test.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

beforeAll(() => {
  // The Course project's first commit needs an identity; CI runners have none configured.
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "Owner",
    GIT_AUTHOR_EMAIL: "owner@example.com",
    GIT_COMMITTER_NAME: "Owner",
    GIT_COMMITTER_EMAIL: "owner@example.com",
  });
});

function git(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout.trim();
}

const TEMPLATE_FILES = {
  "template/package.json": "",
  "template/src/pages/index.astro": "abc",
  "template/.gitignore": "node_modules/\ndist/\n",
};

/** A release worktree's repo: the skill, the Site template and the Fixture Course, tagged `v2.1.0`. */
function releaseRepo(files: Record<string, string> = {}): string {
  const repo = tempDir("release");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  writeFiles(repo, { ...TEMPLATE_FILES, "skill/SKILL.md": "skill", "fixture-course/course.yaml": "fixture", ...files });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "release");
  git(repo, "tag", "v2.1.0");
  return repo;
}

const CATALOG = `# MEMORY.md — Key Facts

## Project catalog

| Project | Folder | Type | Status | Notes |
|---------|--------|------|--------|-------|
| Other | \`other\` | Website | Active | |

## Open actions

- none
`;

/** The Owner's workspace folder, with its MEMORY.md project catalog. */
function workspace(memory = CATALOG): string {
  const dir = tempDir("workspace");
  writeFileSync(join(dir, "MEMORY.md"), memory);
  return dir;
}

function materialsFolder(files: Record<string, string> = { "Lectures/L01 Conduction.pdf": "lecture one" }): string {
  const parent = tempDir("course");
  const materials = join(parent, "Heat Transfer");
  writeFiles(materials, files);
  return materials;
}

function answers(materials: string, overrides: Record<string, unknown> = {}) {
  return {
    courseName: "Heat Transfer",
    code: "MEP 321",
    slug: "heat-transfer",
    materialsPath: materials,
    disciplines: ["Heat transfer"],
    pad: "teal",
    arabicNotes: true,
    sittings: [{ id: "final", name: "Final", date: null }],
    expectedModules: 10,
    professor: "A. Professor",
    university: "Example University",
    owner: "A. N. Owner",
    ...overrides,
  };
}

interface Setup {
  materials: string;
  work: string;
  release: string;
  state: string;
  project: string;
}

function setup(options: { materials?: string; work?: string; release?: string } = {}): Setup {
  const materials = options.materials ?? materialsFolder();
  const work = options.work ?? workspace();
  return {
    materials,
    work,
    release: options.release ?? releaseRepo(),
    state: tempDir("state"),
    project: join(work, "heat-transfer"),
  };
}

function create(s: Setup, overrides: Record<string, unknown> = {}, release = "v2.1.0"): Promise<Result> {
  return intake(
    "create",
    "--answers",
    jsonInput(answers(s.materials, overrides)),
    "--workspace",
    s.work,
    "--source",
    s.release,
    "--release",
    release,
    "--holder",
    "run-1",
    "--state",
    s.state,
  );
}

/** Every file under `root`, '/'-separated, git internals left out. */
function filesUnder(root: string): string[] {
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(root.length + 1)
        .split("\\")
        .join("/"),
    )
    .filter((path) => !path.startsWith(".git/"))
    .sort();
}

// Each test makes git repos; under a loaded machine or a slow CI runner they take seconds.
describe("create", { timeout: 30_000 }, () => {
  test("makes the Course project the /newproject way: README, CLAUDE.md, .gitignore, a first commit and a workspace catalog row", async () => {
    const s = setup();

    const { code, out } = await create(s);

    expect(code).toBe(0);
    expect(out.project).toBe(s.project);
    expect(readFileSync(join(s.project, "README.md"), "utf8")).toContain("# Heat Transfer");
    expect(readFileSync(join(s.project, "CLAUDE.md"), "utf8").split("\n")[2]).toBe(
      "Inherits the global standards in ../CLAUDE.md.",
    );
    const ignored = readFileSync(join(s.project, ".gitignore"), "utf8").split("\n");
    expect(ignored).toEqual(expect.arrayContaining([".env*", "node_modules/", "media-inbox/", ".vercel/"]));
    expect(git(s.project, "log", "--format=%s")).toBe("chore: create the Heat Transfer Course project");
    expect(git(s.project, "status", "--porcelain")).toBe("");
    expect(git(s.project, "branch", "--show-current")).toBe("main");
    expect(out.commit).toBe(git(s.project, "rev-parse", "HEAD"));
    const memory = readFileSync(join(s.work, "MEMORY.md"), "utf8");
    expect(memory).toContain(
      "| Other | `other` | Website | Active | |\n| Heat Transfer study site | `heat-transfer` | Study site (learn-premium) | Scaffolded |",
    );
    expect(memory).toContain("## Open actions");
  });

  test("writes the course config the Site template builds from: name, code, pad and the Credit line", async () => {
    const s = setup();

    must(await create(s, { courseName: 'Heat "Transfer"' }));

    const config = readFileSync(join(s.project, "content/course.yaml"), "utf8");
    expect(config).toContain('name: "Heat \\"Transfer\\""\n');
    expect(config).toContain('code: "MEP 321"\npad: "teal"\n');
    expect(config).toContain(
      'credit:\n  professor: "A. Professor"\n  course: "Heat \\"Transfer\\" (MEP 321)"\n  university: "Example University"\nowner: "A. N. Owner"\n',
    );
    expect(config).toContain("sittings: []\n");
    expect(existsSync(join(s.project, "content/modules"))).toBe(true);
  });

  test("copies the Site template's files at the pinned release, read-only, and the ledger pins the release and their hashes", async () => {
    const release = releaseRepo();
    // After the tag: neither a later commit nor a stray untracked file reaches the Course project.
    writeFiles(release, {
      "template/src/pages/index.astro": "changed after the tag",
      "template/node_modules/x/index.js": "x",
    });
    git(release, "commit", "-q", "-am", "after the release");
    const s = setup({ release });

    must(await create(s));

    expect(filesUnder(join(s.project, "template"))).toEqual([".gitignore", "package.json", "src/pages/index.astro"]);
    expect(readFileSync(join(s.project, "template/src/pages/index.astro"), "utf8")).toBe("abc");
    for (const file of filesUnder(join(s.project, "template"))) {
      expect(statSync(join(s.project, "template", file)).mode & 0o222, file).toBe(0);
    }
    const { out } = ledger("status", "--project", s.project);
    expect(out.template.release).toBe("v2.1.0");
    expect(out.template.files).toMatchObject({ "package.json": SHA256_EMPTY, "src/pages/index.astro": SHA256_ABC });
    expect(ledger("integrity", "--project", s.project).code).toBe(0);
  });

  test("a release tag the source doesn't have is refused, and nothing is made", async () => {
    const s = setup();

    const { code, out } = await create(s, {}, "v9.9.9");

    expect(code).toBe(2);
    expect(out.error).toMatch(/v9\.9\.9/);
    expect(existsSync(s.project)).toBe(false);
  });

  test("references the Materials by path, never copies them, and makes the Private folder beside them", async () => {
    const materials = materialsFolder({
      "Lectures/L01 Conduction.pdf": "lecture one",
      "Sheets/sheet 1.pdf": "sheet one",
    });
    const s = setup({ materials });

    const { out } = await create(s);

    expect(ledger("status", "--project", s.project).out.materialsPath).toBe(materials);
    const contents = filesUnder(s.project).map((f) => readFileSync(join(s.project, f), "utf8"));
    expect(contents).not.toContain("lecture one");
    expect(contents).not.toContain("sheet one");
    const priv = join(dirname(materials), "Heat Transfer (private)");
    expect(out.privateFolder).toBe(priv);
    expect(statSync(priv).isDirectory()).toBe(true);
  });

  test("a Materials file that would land in the Course project is refused, and nothing is made (negative control)", async () => {
    const materials = materialsFolder({ "Lectures/L01 Conduction.pdf": "a lecture the template happens to carry" });
    const s = setup({
      materials,
      release: releaseRepo({ "template/public/L01.pdf": "a lecture the template happens to carry" }),
    });

    const { code, out } = await create(s);

    expect(code).toBe(3);
    expect(out.error).toMatch(/Lectures\/L01 Conduction\.pdf/);
    expect(existsSync(s.project)).toBe(false);
    expect(readdirSync(s.work)).toEqual(["MEMORY.md"]);
  });

  test("a Course project inside the Materials folder is refused", async () => {
    const materials = materialsFolder();
    writeFileSync(join(materials, "MEMORY.md"), CATALOG);
    const s = setup({ materials, work: materials });

    const { code, out } = await create(s);

    expect(code).toBe(3);
    expect(out.error).toMatch(/inside the Materials folder/);
    expect(existsSync(s.project)).toBe(false);
  });

  test("an existing project folder is never overwritten", async () => {
    const s = setup();
    writeFiles(s.project, { "keep.txt": "mine" });

    const { code, out } = await create(s);

    expect(code).toBe(3);
    expect(out.error).toMatch(/already exists/);
    expect(filesUnder(s.project)).toEqual(["keep.txt"]);
  });

  test("a workspace MEMORY.md with no project catalog is refused before anything is made", async () => {
    const s = setup({ work: workspace("# MEMORY\n\nNo table here.\n") });

    const { code, out } = await create(s);

    expect(code).toBe(2);
    expect(out.error).toMatch(/Project catalog/);
    expect(existsSync(s.project)).toBe(false);
  });

  test("records the intake answers in the Build ledger, holding its lock, and adds the Course to the Course registry", async () => {
    const s = setup();

    must(await create(s));

    const { out } = ledger("status", "--project", s.project);
    expect(out.course).toBe("Heat Transfer");
    expect(out.lock).toMatchObject({ holder: "run-1" });
    expect(out.sittings).toEqual([{ id: "final", name: "Final", date: null, state: "open" }]);
    const registry = JSON.parse(readFileSync(join(s.state, "courses.json"), "utf8"));
    expect(registry.courses).toEqual([expect.objectContaining({ project: s.project, course: "Heat Transfer" })]);
  });

  test("the Owner-confirmed Module map is written to the ledger", async () => {
    const materials = materialsFolder({
      "Lectures/L01 Conduction.pdf": "1",
      "Lectures/L02 Convection.pdf": "2",
      "Sheets/s1.pdf": "s",
    });
    const s = setup({ materials });
    must(await create(s));
    const { proposal } = must(await intake("propose", "--materials", materials));
    // The Owner renames Module 2 before confirming.
    proposal.modules[1].title = "Forced convection";
    proposal.modules[1].slug = "forced-convection";

    must(ledger("map", "--project", s.project, "--holder", "run-1", "--input", jsonInput(proposal)));

    const { out } = ledger("status", "--project", s.project);
    expect(out.modules).toEqual([
      {
        id: "01",
        slug: "conduction",
        title: "Conduction",
        state: "planned",
        materials: ["Lectures/L01 Conduction.pdf"],
      },
      {
        id: "02",
        slug: "forced-convection",
        title: "Forced convection",
        state: "planned",
        materials: ["Lectures/L02 Convection.pdf"],
      },
    ]);
    expect(ledger("next", "--project", s.project).out).toMatchObject({ action: "waves", newMaterials: [] });
  });
});

describe("find", { timeout: 30_000 }, () => {
  test("finds the Course project whose Build ledger reads these Materials, through the Course registry", async () => {
    const s = setup();
    must(await create(s));

    const found = await intake("find", "--materials", s.materials, "--state", s.state);
    const other = await intake("find", "--materials", materialsFolder(), "--state", s.state);

    expect(found.out).toEqual({ ok: true, project: s.project, course: "Heat Transfer", skipped: [] });
    expect(other.out).toEqual({ ok: true, project: null, course: null, skipped: [] });
  });

  test("once registered, the Course isn't counted against itself when its budget is checked again", async () => {
    const s = setup();
    must(await create(s));

    const { out } = await intake("budget", "--answers", jsonInput(answers(s.materials)), "--state", s.state);

    expect(out.others).toEqual([]);
  });
});

describe("host", { timeout: 30_000 }, () => {
  async function created(): Promise<Setup> {
    const s = setup();
    must(await create(s));
    return s;
  }

  test("makes a private GitHub repo and a Vercel project building template/ from content/, pushes main and checks the live site is noindex", async () => {
    const s = await created();
    const hosting = new FakeHosting();

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(0);
    const head = git(s.project, "rev-parse", "HEAD");
    expect(out).toEqual({
      ok: true,
      repo: "owner/heat-transfer",
      vercelProject: "prj_heat-transfer",
      url: "https://heat-transfer.vercel.app",
      commit: head,
      created: { repo: true, vercelProject: true },
      findings: [],
    });
    expect(hosting.repos.get("owner/heat-transfer")).toEqual({ visibility: "private", pushed: head });
    expect(hosting.projects.get("heat-transfer")).toMatchObject({
      repo: "owner/heat-transfer",
      rootDirectory: "template",
      env: { CONTENT_DIR: "../content" },
    });
    // main is pushed before the Vercel project links the repo, so its first deployment is asked for.
    expect(hosting.calls.slice(0, 4)).toEqual([
      "create repo owner/heat-transfer",
      `push owner/heat-transfer ${head}`,
      "create vercel heat-transfer",
      `deploy prj_heat-transfer ${head}`,
    ]);
  });

  test("a live site that drops noindex fails the step, naming what's missing (negative control)", async () => {
    const s = await created();
    const hosting = new FakeHosting();
    hosting.page = { status: 200, robotsHeader: null, html: "<html><head></head></html>" };

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(1);
    expect(out.findings).toEqual([
      "https://heat-transfer.vercel.app answered without an X-Robots-Tag: noindex header",
      'https://heat-transfer.vercel.app has no <meta name="robots" content="noindex…">',
    ]);
  });

  test("a site that doesn't answer 200 fails the step", async () => {
    const s = await created();
    const hosting = new FakeHosting();
    hosting.page = { ...hosting.page, status: 404 };

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(1);
    expect(out.findings).toEqual(["https://heat-transfer.vercel.app answered 404"]);
  });

  test("run again, it makes nothing twice: the repo and Vercel project it made are reused", async () => {
    const s = await created();
    const hosting = new FakeHosting();
    must(await intake("host", "--project", s.project, { hosting }));

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(0);
    expect(out.created).toEqual({ repo: false, vercelProject: false });
    expect(hosting.calls.filter((c) => c.startsWith("create") || c.startsWith("deploy"))).toHaveLength(3);
  });

  test("a GitHub repo of that name that isn't this Course project's is refused, and nothing is pushed", async () => {
    const s = await created();
    const hosting = new FakeHosting();
    hosting.repos.set("owner/heat-transfer", { visibility: "private", pushed: "someone else's" });

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(3);
    expect(out.error).toMatch(/owner\/heat-transfer already exists/);
    expect(hosting.calls).toEqual([]);
  });

  test("a public repo is never pushed to", async () => {
    const s = await created();
    const hosting = new FakeHosting();
    must(await intake("host", "--project", s.project, { hosting }));
    hosting.repos.set("owner/heat-transfer", { visibility: "public", pushed: git(s.project, "rev-parse", "HEAD") });
    hosting.calls.length = 0;

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(3);
    expect(out.error).toMatch(/public/);
    expect(hosting.calls).toEqual([]);
  });

  test("a Vercel project of that name linked to another repo is refused", async () => {
    const s = await created();
    const hosting = new FakeHosting();
    hosting.projects.set("heat-transfer", {
      id: "prj_other",
      name: "heat-transfer",
      repo: "owner/other",
      rootDirectory: "template",
      env: {},
    });

    const { code, out } = await intake("host", "--project", s.project, { hosting });

    expect(code).toBe(3);
    expect(out.error).toMatch(/linked to owner\/other/);
    expect(hosting.calls.some((c) => c.startsWith("push"))).toBe(false);
  });

  test("uncommitted changes are refused: the live site is what main holds", async () => {
    const s = await created();
    writeFileSync(join(s.project, "notes.md"), "draft");

    const { code, out } = await intake("host", "--project", s.project, { hosting: new FakeHosting() });

    expect(code).toBe(3);
    expect(out.error).toMatch(/uncommitted/);
  });
});
