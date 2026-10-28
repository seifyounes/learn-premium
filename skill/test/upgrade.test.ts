// The Upgrade wave: a newer Template release re-copied into a Course project on its own branch,
// merged to `main` only when green. Proven on a Course project whose content is a copy of the real
// Fixture Course, pinned to v1.0.0 of a throwaway release repo tagged v1.0.0, v1.1.0 and v2.0.0, with
// a fake verifier and a fake tracker: no test ever reaches GitHub or runs the Course's real gates.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { run as runGateGap } from "../scripts/gate-gap/cli.ts";
import { hashTree } from "../scripts/ledger/hash.ts";
import { checkpoint, type MergePoint, type Verifier } from "../scripts/wave/wave.ts";
import { run as runUpgrade, type Deps } from "../scripts/upgrade/cli.ts";
import { EMPTY_INVENTORY } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { FakeTracker } from "./fake-tracker.ts";
import { ledger, writeFiles, type Result } from "./helpers.ts";
import {
  addRelease,
  git,
  HOLDER,
  OVERRIDE,
  releaseRepo,
  upgradeCourse,
  type UpgradeCourse,
} from "./upgrade-fixtures.ts";

// git here sees no global or system config, as on a CI runner: line endings and identity are the repos' own.
const isolated = mkdtempSync(join(tmpdir(), "lp-gitconfig-"));
beforeAll(() => {
  writeFileSync(join(isolated, "gitconfig"), "");
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: join(isolated, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" });
});
afterAll(() => rmSync(isolated, { recursive: true, force: true }));

const TODAY = "2026-10-10";

async function upgrade(deps: Partial<Deps>, ...args: string[]): Promise<Result> {
  const { code, stdout } = await runUpgrade(args, { today: TODAY, ...deps });
  return { code, out: JSON.parse(stdout) };
}

/** `offer --to <to>` on the Course project. */
function offer(c: UpgradeCourse, to: string, deps: Partial<Deps> = {}): Promise<Result> {
  return upgrade(deps, "offer", "--project", c.project, "--source", c.source, "--to", to);
}

describe("offer", { timeout: 60_000 }, () => {
  const SITTING = { id: "final", name: "Final", date: "2026-11-10" };

  test("names the gate gaps a release closes and the overrides it retires", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const { code, out } = await offer(c, "v2.0.0");
    expect(code).toBe(0);
    expect(out.held).toBeNull();
    expect(out.offer).toMatchObject({
      from: "v1.0.0",
      to: "v2.0.0",
      releases: ["v1.1.0", "v2.0.0"],
      gateGapsClosed: [
        { number: 1, title: "A beat over the limit slips through" },
        { number: 12, title: "HonestyCell hides a hedged claim" },
      ],
      overridesRetired: [{ path: "src/components/HonestyCell.astro", gateGap: 12 }],
      closesOwnGaps: [],
      freeze: null,
      held: false,
      lastFailed: null,
    });
  });

  test("retires nothing a release doesn't close", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const { out } = await offer(c, "v1.1.0");
    expect(out.offer).toMatchObject({ releases: ["v1.1.0"], overridesRetired: [] });
  });

  test("holds within 7 days of a sitting", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal", sittings: [SITTING] });
    // The sitting is 2026-11-10: held on each of the 7 days up to and including exam day.
    for (const today of ["2026-11-03", "2026-11-07", "2026-11-10"]) {
      const { code, out } = await offer(c, "v2.0.0", { today });
      expect(code, today).toBe(0);
      expect(out.offer, today).toBeNull();
      expect(out.held, today).toMatchObject({ to: "v2.0.0", sitting: "final", name: "Final", date: "2026-11-10" });
    }
    // Eight days out, and the day after the sitting, the Course is offered the release.
    for (const today of ["2026-11-02", "2026-11-11"]) {
      const { out } = await offer(c, "v2.0.0", { today });
      expect(out.offer, today).toMatchObject({ to: "v2.0.0", freeze: null, held: false });
      expect(out.held, today).toBeNull();
    }
  });

  test("a sitting with no date never freezes", async () => {
    const c = upgradeCourse(releaseRepo(), {
      content: "minimal",
      sittings: [{ id: "final", name: "Final", date: null }],
    });
    const { out } = await offer(c, "v2.0.0", { today: "2026-11-10" });
    expect(out.offer).toMatchObject({ freeze: null, held: false });
  });

  test("counts days by the calendar date, whatever the clock's time zone", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal", sittings: [SITTING] });
    // Across the daylight-saving change (2026-10-25 in Europe, 2026-11-01 in the US): still whole days.
    const { out } = await offer(c, "v2.0.0", { today: "2026-11-03" });
    expect(out.held).toMatchObject({ date: "2026-11-10" });
  });

  test("offers inside the freeze when a release closes this Course's own gate gap", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal", sittings: [SITTING] });
    await fileGateGap(c);
    // v1.1.0 closes gate gap #1, the one this Course filed.
    const { out } = await offer(c, "v1.1.0", { today: "2026-11-05" });
    expect(out.held).toBeNull();
    expect(out.offer).toMatchObject({
      freeze: { id: "final", name: "Final", date: "2026-11-10" },
      closesOwnGaps: [1],
      held: false,
    });
  });

  test("stays held in the freeze when the gate gaps a release closes are other Courses' (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal", sittings: [SITTING] });
    // This Course's gate gap is #7 on the tracker; v1.1.0 closes #1 and v2.0.0 closes #1 and #12.
    const tracker = new FakeTracker();
    for (let n = 1; n <= 6; n++) await tracker.create({ title: `other ${n}`, body: "", labels: ["gate-gap"] });
    await fileGateGap(c, tracker);
    const { out } = await offer(c, "v2.0.0", { today: "2026-11-05" });
    expect(out.offer).toBeNull();
    expect(out.held).toMatchObject({ sitting: "final" });
  });

  test("makes no offer when the target isn't newer than the pinned release", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    for (const to of ["v1.0.0", "v0.9.0"]) {
      const { code, out } = await offer(c, to);
      expect(code, to).toBe(0);
      expect(out.offer, to).toBeNull();
      expect(out.reason, to).toMatch(/not newer/);
    }
  });

  test("makes no offer for a target that isn't a release tag", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const { code, out } = await offer(c, "main");
    expect(code).toBe(0);
    expect(out.offer).toBeNull();
    expect(out.reason).toMatch(/not a release tag/);
  });

  test("is refused when a release in the way is a lightweight tag (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    addRelease(c.source, "v2.1.0", { "src/site/x.ts": "export const x = 1;\n" }, { lightweight: true });
    const { code, out } = await offer(c, "v2.1.0");
    expect(code).toBe(2);
    expect(out.error).toMatch(/v2\.1\.0.*annotated/);
  });

  test("is refused when a release's notes lack the gate gaps section (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    writeFiles(c.source, { "template/src/site/y.ts": "export const y = 1;\n" });
    git(c.source, "add", "-A");
    git(c.source, "commit", "-q", "-m", "release v2.2.0");
    git(c.source, "tag", "-a", "-m", "just a message", "v2.2.0");
    const { code, out } = await offer(c, "v2.2.0");
    expect(code).toBe(2);
    expect(out.error).toMatch(/Gate gaps closed/);
  });
});

/** The release's template layer as git tagged it: path under `template/` → sha256, read straight from the objects. */
function releaseHashes(source: string, tag: string): Record<string, string> {
  const paths = git(source, "ls-tree", "-r", "--name-only", tag, "--", "template")
    .split("\n")
    .filter((p) => p !== "");
  return Object.fromEntries(
    paths.map((path) => {
      const child = spawnSync("git", ["-C", source, "show", `${tag}:${path}`], { maxBuffer: 1 << 26 });
      return [path.slice("template/".length), createHash("sha256").update(child.stdout).digest("hex")];
    }),
  );
}

/** The Course project's template layer as it is on disk, without installs (`node_modules/`). */
const templateOnDisk = (c: UpgradeCourse) => hashTree(join(c.project, "template"), ["node_modules", "dist"]);

interface StartOptions {
  to?: string;
  answer?: string | null;
  today?: string;
  holder?: string;
}

function start(c: UpgradeCourse, o: StartOptions = {}): Promise<Result> {
  const { to = "v2.0.0", answer = "yes, upgrade it", today, holder = HOLDER } = o;
  return upgrade(
    today === undefined ? {} : { today },
    ...["start", "--project", c.project, "--source", c.source, "--holder", holder, "--to", to],
    ...(answer === null ? [] : ["--answer", answer]),
  );
}

function apply(c: UpgradeCourse, source = c.source, holder = HOLDER): Promise<Result> {
  return upgrade({}, "apply", "--project", c.project, "--source", source, "--holder", holder);
}

const branchOf = (c: UpgradeCourse) => git(c.project, "symbolic-ref", "--short", "HEAD");
const rev = (c: UpgradeCourse, ref: string) => git(c.project, "rev-parse", ref);
const upgradesOf = (c: UpgradeCourse) => must(ledger("status", "--project", c.project)).upgrades;

describe("start", { timeout: 60_000 }, () => {
  test("records the wave, commits it on main and switches to the wave's branch", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const before = rev(c, "main");
    const { code, out } = await start(c);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(out).toMatchObject({ branch: "upgrade/v2.0.0-1", base: before });
    expect(branchOf(c)).toBe("upgrade/v2.0.0-1");
    // The start is one commit on main, and the branch begins at it.
    expect(rev(c, "main~1")).toBe(before);
    expect(rev(c, "HEAD")).toBe(rev(c, "main"));
    expect(git(c.project, "log", "-1", "--format=%s", "main")).toBe("chore: start the Upgrade wave to v2.0.0");
    expect(git(c.project, "status", "--porcelain")).toBe("");
    expect(upgradesOf(c)).toEqual([
      expect.objectContaining({
        id: "upgrade-v2.0.0-1",
        from: "v1.0.0",
        to: "v2.0.0",
        branch: "upgrade/v2.0.0-1",
        base: before,
        answer: "yes, upgrade it",
        state: "running",
        commit: null,
        files: releaseHashes(c.source, "v2.0.0"),
        retire: [{ path: OVERRIDE, gateGap: 12 }],
        kept: [],
        migrations: null,
        content: null,
        gateGap: null,
        superseded: null,
      }),
    ]);
    // A Windows checkout would rewrite line endings on every switch and break the pinned hashes.
    expect(git(c.project, "config", "--local", "core.autocrlf")).toBe("false");
  });

  test("refuses inside the exam freeze (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), {
      content: "minimal",
      sittings: [{ id: "final", name: "Final", date: "2026-11-10" }],
    });
    const before = rev(c, "main");
    const { code, out } = await start(c, { today: "2026-11-05" });
    expect(code).toBe(3);
    expect(out.error).toMatch(/Final.*2026-11-10/);
    expect(upgradesOf(c)).toEqual([]);
    expect(git(c.project, "branch", "--list")).toMatch(/^\* main$/);
    expect(rev(c, "main")).toBe(before);
  });

  test("refuses without the Owner's answer (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const { code } = await start(c, { answer: null });
    expect(code).toBe(2);
    expect(upgradesOf(c)).toEqual([]);
  });

  test("refuses a target that isn't newer", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const { code, out } = await start(c, { to: "v1.0.0" });
    expect(code).toBe(3);
    expect(out.error).toMatch(/not newer/);
  });

  test("refuses while a Module wave runs (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(
      ledger(
        ...["wave", "start", "--project", c.project, "--holder", HOLDER, "--kind", "module", "--target", "01"],
        ...["--branch", "module/01-again"],
      ),
    );
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: start a wave");
    const { code, out } = await start(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/wave.*running/);
  });

  test("refuses a tree with uncommitted changes (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    writeFiles(c.project, { "content/notes.md": "an edit" });
    const { code, out } = await start(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/uncommitted/);
  });

  test("refuses when it isn't on main (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    git(c.project, "switch", "-q", "-c", "scratch");
    const { code, out } = await start(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/main/);
  });

  test("refuses a template layer that isn't the pinned release's (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    writeFiles(c.project, { "template/src/site/old.ts": "export const old = 'edited';\n" });
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "an edit to the template layer");
    const { code, out } = await start(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/template layer.*src\/site\/old\.ts/);
  });

  test("refuses another session's run (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    const { code, out } = await start(c, { holder: "session-b" });
    expect(code).toBe(3);
    expect(out.error).toMatch(/lock/);
    expect(upgradesOf(c)).toEqual([]);
  });

  test("refuses when the wave's branch name is taken, and records nothing (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    git(c.project, "branch", "upgrade/v2.0.0-1");
    const before = rev(c, "main");
    const { code, out } = await start(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/upgrade\/v2\.0\.0-1/);
    expect(upgradesOf(c)).toEqual([]);
    expect(rev(c, "main")).toBe(before);
  });

  test("a Course that was done is no longer done while it upgrades", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(ledger("done", "--project", c.project, "--holder", HOLDER));
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: done");
    expect(must(ledger("status", "--project", c.project)).done).not.toBeNull();
    must(await start(c));
    expect(must(ledger("status", "--project", c.project)).done).toBeNull();
  });

  test("refuses a second wave while one runs", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    git(c.project, "switch", "-q", "main");
    const { code, out } = await start(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/Upgrade wave.*running/);
  });
});

describe("apply", { timeout: 60_000 }, () => {
  test("re-copies the template layer to the release's own files, and drops the retired override", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    writeFiles(c.project, { "template/node_modules/dep/index.js": "an install" });
    must(await start(c));
    const { code, out } = await apply(c);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(templateOnDisk(c)).toEqual(releaseHashes(c.source, "v2.0.0"));
    expect(out).toMatchObject({ written: 4, deleted: ["src/site/old.ts"], dropped: [OVERRIDE] });
    expect(existsSync(join(c.project, "template", "src/site/old.ts"))).toBe(false);
    expect(existsSync(join(c.project, "overrides", OVERRIDE))).toBe(false);
    // An install in the template layer is not part of the release and is left alone.
    expect(readFileSync(join(c.project, "template/node_modules/dep/index.js"), "utf8")).toBe("an install");
  });

  test("is safe to run again", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    const again = await apply(c);
    expect(again.code).toBe(0);
    expect(again.out).toMatchObject({ written: 0, deleted: [], dropped: [] });
  });

  test("refuses off the wave's branch (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    git(c.project, "switch", "-q", "main");
    const { code, out } = await apply(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/upgrade\/v2\.0\.0-1/);
    expect(templateOnDisk(c)).toEqual(releaseHashes(c.source, "v1.0.0"));
  });

  test("refuses a release repo whose tag isn't the release the wave started from (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    const other = releaseRepo();
    addRelease(other, "v9.9.9", { "src/site/new.ts": "export const next = 'another';\n" });
    git(other, "tag", "-f", "v2.0.0", "v9.9.9");
    const { code, out } = await apply(c, other);
    expect(code).toBe(3);
    expect(out.error).toMatch(/v2\.0\.0/);
    expect(templateOnDisk(c)).toEqual(releaseHashes(c.source, "v1.0.0"));
  });

  test("refuses another session's run (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    expect((await apply(c, c.source, "session-b")).code).toBe(3);
  });
});

describe("a running Upgrade wave", { timeout: 60_000 }, () => {
  test("is what the next run resumes, and nothing else starts or finishes meanwhile", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    const next = must(ledger("next", "--project", c.project));
    expect(next).toMatchObject({
      action: "resume-upgrade",
      upgrade: { id: "upgrade-v2.0.0-1", from: "v1.0.0", to: "v2.0.0", branch: "upgrade/v2.0.0-1" },
    });
    const wave = ledger(
      ...["wave", "start", "--project", c.project, "--holder", HOLDER, "--kind", "module", "--target", "01"],
      ...["--branch", "module/01-again"],
    );
    expect(wave.code).toBe(3);
    expect(wave.out.error).toMatch(/Upgrade wave/);
    const done = ledger("done", "--project", c.project, "--holder", HOLDER);
    expect(done.code).toBe(3);
    expect(done.out.error).toMatch(/Upgrade wave/);
  });
});

function migrate(c: UpgradeCourse, holder = HOLDER): Promise<Result> {
  return upgrade({}, "migrate", "--project", c.project, "--source", c.source, "--holder", holder);
}

/** Starts, applies and commits the wave to `to`, leaving the Course project on its branch, ready to migrate. */
async function applied(c: UpgradeCourse, to = "v2.0.0"): Promise<void> {
  must(await start(c, { to }));
  must(await apply(c));
  git(c.project, "add", "-A");
  git(c.project, "commit", "-q", "-m", `chore: the template layer at ${to}`);
}

/** The Course's content files with their hashes, without its Gate reports. */
const contentOf = (c: UpgradeCourse) =>
  Object.fromEntries(
    Object.entries(hashTree(join(c.project, "content"))).filter(([p]) => !p.startsWith("build-records/gate-reports/")),
  );

describe("migrate", { timeout: 120_000 }, () => {
  test("only the migration touches content: across a major, course.yaml drops the field and nothing else changes", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "fixture" });
    const before = contentOf(c);
    const yamlBefore = readFileSync(join(c.project, "content/course.yaml"), "utf8");
    expect(yamlBefore).toContain("legacyTitle: Fixture Course\n");
    await applied(c);
    const { code, out } = await migrate(c);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(out.migrations).toEqual([{ major: 2, describe: "course.yaml drops legacyTitle" }]);
    const after = contentOf(c);
    const changed = Object.keys({ ...before, ...after }).filter((p) => before[p] !== after[p]);
    expect(changed).toEqual(["course.yaml"]);
    expect(readFileSync(join(c.project, "content/course.yaml"), "utf8")).toBe(
      yamlBefore.replace("legacyTitle: Fixture Course\n", ""),
    );
    // The ledger holds what the migrations ran and the content as they left it.
    const [row] = upgradesOf(c);
    expect(row.migrations).toEqual([{ major: 2, describe: "course.yaml drops legacyTitle" }]);
    expect(row.content).toEqual(after);
  });

  test("a release with no migration leaves content exactly as it was", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "fixture" });
    const before = contentOf(c);
    await applied(c, "v1.1.0");
    const { code, out } = await migrate(c);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(out.migrations).toEqual([]);
    expect(contentOf(c)).toEqual(before);
    expect(upgradesOf(c)[0].content).toEqual(before);
  });

  test("refuses content edited before it runs (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    writeFiles(c.project, { "content/modules/01-thermal-resistance/module.yaml": "title: edited by hand\n" });
    const { code, out } = await migrate(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/content.*module\.yaml/);
    expect(readFileSync(join(c.project, "content/course.yaml"), "utf8")).toContain("legacyTitle");
    expect(upgradesOf(c)[0].migrations).toBeNull();
  });

  test("refuses a new file in the content before it runs (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    writeFiles(c.project, { "content/modules/01-thermal-resistance/new.yaml": "extra: 1\n" });
    const { code, out } = await migrate(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/new\.yaml/);
  });

  test("refuses content committed on the branch before it runs (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    writeFiles(c.project, { "content/modules/01-thermal-resistance/module.yaml": "title: edited by hand\n" });
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "an edit to the content");
    expect((await migrate(c)).code).toBe(3);
  });

  test("refuses before the template layer is the release's (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    const { code, out } = await migrate(c);
    expect(code).toBe(3);
    expect(out.error).toMatch(/apply/);
  });

  test("runs once: a second run is refused", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    must(await migrate(c));
    const again = await migrate(c);
    expect(again.code).toBe(3);
    expect(again.out.error).toMatch(/already ran/);
  });

  test("is red when a migration throws, and records nothing (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    addRelease(
      c.source,
      "v3.0.0",
      {
        "migrations/v3.ts": `export const describe = "x";\nexport function migrate(): void { throw new Error("boom"); }\n`,
      },
      { previous: "v2.0.0", kind: "major" },
    );
    await applied(c, "v3.0.0");
    const { code, out } = await migrate(c);
    expect(code).toBe(1);
    expect(out.problem).toMatch(/v3 migration failed: boom/);
    expect(upgradesOf(c)[0].migrations).toBeNull();
  });

  test("refuses another session's run (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    expect((await migrate(c, "session-b")).code).toBe(3);
  });
});

/** The Course's own template layer, faked: records which gates it was asked about, red where told to be. */
class FakeVerifier implements Verifier {
  readonly calls: string[] = [];
  readonly red = new Set<string>();

  verify(_project: string, point: MergePoint, module: string | undefined) {
    const key = module === undefined ? point : `${point}:${module}`;
    this.calls.push(key);
    const green = !this.red.has(key);
    return { green, problems: green ? [] : [`${key} is red`] };
  }

  rulings() {
    return [];
  }

  inventory() {
    return EMPTY_INVENTORY;
  }
}

const PREVIEW = "https://fixture-course-git-upgrade.vercel.app";

/** Writes each Module's module-point Gate report (what the gates leave on the preview) and commits it. */
function reportPreviews(c: UpgradeCourse, url = PREVIEW): void {
  writeFiles(
    c.project,
    Object.fromEntries(
      c.folders.map((f) => [`content/build-records/gate-reports/module-${f}.json`, JSON.stringify({ url })]),
    ),
  );
  git(c.project, "add", "-A");
  git(c.project, "commit", "-q", "-m", "chore: Gate reports");
}

/** A wave carried to its merge gate: started, applied, migrated, with the preview's reports committed. */
async function readyWave(c: UpgradeCourse, to = "v2.0.0"): Promise<void> {
  await applied(c, to);
  must(await migrate(c));
  reportPreviews(c);
}

function ready(c: UpgradeCourse, verifier = new FakeVerifier()): Promise<Result> {
  return upgrade({ verifier }, "ready", "--project", c.project);
}

function merge(c: UpgradeCourse, verifier = new FakeVerifier(), holder = HOLDER): Promise<Result> {
  return upgrade({ verifier }, "merge", "--project", c.project, "--holder", holder);
}

describe("ready", { timeout: 120_000 }, () => {
  test("is green when everything holds", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    const verifier = new FakeVerifier();
    const { code, out } = await ready(c, verifier);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(out).toMatchObject({ ready: true, problems: [] });
    expect(verifier.calls.sort()).toEqual(["deploy", "job:01-thermal-resistance", "module:01-thermal-resistance"]);
  });

  test("lists a gate that is red for HEAD (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    const verifier = new FakeVerifier();
    verifier.red.add("job:01-thermal-resistance");
    const { code, out } = await ready(c, verifier);
    expect(code).toBe(1);
    expect(out.problems).toEqual([expect.stringMatching(/job:01-thermal-resistance is red/)]);
  });

  test("flags a template file edited on the branch, though the gates are green (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    writeFiles(c.project, { "template/src/site/new.ts": "export const next = 'edited';\n" });
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "an edit to the template layer");
    const verifier = new FakeVerifier();
    const { code, out } = await ready(c, verifier);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/template layer.*modified src\/site\/new\.ts/);
    // The edited layer's own gates can verify anything, so they aren't asked.
    expect(verifier.calls).toEqual([]);
  });

  test("flags a retired override restored by hand (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    writeFiles(c.project, { [`overrides/${OVERRIDE}`]: "<td>course honesty</td>\n" });
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "restore the override");
    const { code, out } = await ready(c);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toContain(`overrides/${OVERRIDE}`);
  });

  test("flags content edited after the migrations ran (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    writeFiles(c.project, { "content/modules/01-thermal-resistance/module.yaml": "title: edited later\n" });
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "an edit to the content");
    const { code, out } = await ready(c);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/content.*modules\/01-thermal-resistance\/module\.yaml/);
  });

  test("flags a wave whose migrations haven't run (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    reportPreviews(c);
    const { code, out } = await ready(c);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/migrate/);
  });

  test("flags gates that didn't run on the Vercel preview (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    reportPreviews(c, "http://localhost:4321");
    const { code, out } = await ready(c);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/01-thermal-resistance.*Vercel preview/);
  });

  test("flags uncommitted changes and a checkout off the wave's branch (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    writeFiles(c.project, { "content/notes.md": "uncommitted" });
    const dirty = await ready(c);
    expect(dirty.out.problems.join("\n")).toMatch(/uncommitted/);
    rmSync(join(c.project, "content/notes.md"));
    git(c.project, "switch", "-q", "main");
    const off = await ready(c);
    expect(off.out.problems.join("\n")).toMatch(/upgrade\/v2\.0\.0-1/);
  });

  test("holds a Checkpoint item an upgraded gate raised until the Owner answers it (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    // The v2 gates raise an item no earlier wave answered: a green gate report that still needs the Owner.
    writeFiles(c.project, {
      "content/build-records/gate-reports/job-01-thermal-resistance.json": JSON.stringify({
        checkpointItems: [
          {
            gate: "licence",
            message: "a new notice needs the Owner",
            at: "modules/01-thermal-resistance/module.yaml",
          },
        ],
      }),
    });
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: Gate reports");
    const open = await ready(c);
    expect(open.code).toBe(1);
    expect(open.out.problems).toEqual([expect.stringMatching(/Checkpoint item 01\/licence\/\w+ is unanswered/)]);
    // The Owner's answer goes in the ledger under the Upgrade wave, and the wave can go on.
    const [item] = checkpoint(c.project, "01").open;
    expect(item).toBeDefined();
    must(
      ledger(
        ...["record", "checkpoint", "--project", c.project, "--holder", HOLDER],
        ...["--wave", "upgrade-v2.0.0-1", "--key", item?.key ?? "", "--question", item?.question ?? ""],
        ...["--answer", "fine, keep the notice"],
      ),
    );
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: the Owner's answer");
    const answered = await ready(c);
    expect(answered.out, JSON.stringify(answered.out)).toMatchObject({ ready: true, problems: [] });
  });

  test("is refused when no wave runs", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    expect((await ready(c)).code).toBe(3);
  });
});

describe("merge", { timeout: 120_000 }, () => {
  test("a red wave never merges: main stays on the pinned release", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    const startCommit = rev(c, "main");
    const verifier = new FakeVerifier();
    verifier.red.add("deploy");
    const { code, out } = await merge(c, verifier);
    expect(code).toBe(1);
    expect(out).toMatchObject({ merged: false });
    expect(out.problems).toEqual([expect.stringMatching(/deploy is red/)]);
    expect(rev(c, "refs/heads/main")).toBe(startCommit);
    expect(branchOf(c)).toBe("upgrade/v2.0.0-1");
    const status = must(ledger("status", "--project", c.project));
    expect(status.template.release).toBe("v1.0.0");
    expect(status.upgrades[0].state).toBe("running");
  });

  test("merges a green wave: main fast-forwards to the branch and the ledger moves to the release", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    const tip = rev(c, "HEAD");
    const { code, out } = await merge(c);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(out).toMatchObject({ merged: true, commit: tip });
    expect(rev(c, "refs/heads/main")).toBe(tip);
    expect(branchOf(c)).toBe("main");
    const status = must(ledger("status", "--project", c.project));
    expect(status.template.release).toBe("v2.0.0");
    expect(status.template.files).toEqual(releaseHashes(c.source, "v2.0.0"));
    expect(status.template.overrides).toEqual([]);
    expect(status.upgrades).toEqual([expect.objectContaining({ state: "merged", commit: tip })]);
    // The retired override's row is history, with its reason.
    expect(status.superseded).toContainEqual(
      expect.objectContaining({ row: "override", id: OVERRIDE, reason: "retired by v2.0.0: gate gap #12 closed" }),
    );
    // Committed, the Course is whole on the new release.
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: merge the Upgrade wave");
    expect(ledger("integrity", "--project", c.project).code).toBe(0);
  });

  test("refuses a wave that isn't ready, whatever the verifier says (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await applied(c);
    const startCommit = rev(c, "main");
    const { code, out } = await merge(c);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/migrate/);
    expect(rev(c, "refs/heads/main")).toBe(startCommit);
  });

  test("refuses when main moved on since the wave started (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    // A commit on main that the wave's branch doesn't have.
    const stray = git(c.project, "commit-tree", "main^{tree}", "-p", "main", "-m", "stray");
    git(c.project, "update-ref", "refs/heads/main", stray);
    const { code, out } = await merge(c);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/main/);
  });

  test("refuses another session's run (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    const { code } = await merge(c, new FakeVerifier(), "session-b");
    expect(code).toBe(3);
    expect(rev(c, "refs/heads/main")).not.toBe(rev(c, "HEAD"));
  });
});

describe("end", { timeout: 120_000 }, () => {
  /** The Course after a red wave: the branch committed, main checked out again. */
  async function redWave(): Promise<UpgradeCourse> {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    git(c.project, "switch", "-q", "main");
    return c;
  }

  const end = (c: UpgradeCourse, ...flags: string[]) =>
    upgrade({}, "end", "--project", c.project, "--holder", HOLDER, "--result", "failed", ...flags);

  test("a red wave ends only with a gate gap this wave filed", async () => {
    const c = await redWave();
    // No gate gap named.
    expect((await end(c)).code).toBe(2);
    // A gate gap that isn't in the ledger.
    expect((await end(c, "--gate-gap", "beat-limit")).code).toBe(2);
    // One recorded but never filed on the tracker.
    writeFiles(c.project, { "build-records/gate-gaps/beat-limit/case.json": '{ "beat": "a long beat" }\n' });
    must(
      ledger(
        ...["record", "gate-gap", "--project", c.project, "--holder", HOLDER, "--id", "beat-limit"],
        ...["--title", "A beat over the limit slips through", "--defect", "A 140 word beat shipped."],
      ),
    );
    const unfiled = await end(c, "--gate-gap", "beat-limit");
    expect(unfiled.code).toBe(3);
    expect(unfiled.out.error).toMatch(/unfiled|isn't filed/);
    // Filed on the (fake) tracker.
    const { code, stdout } = await runGateGap(
      ["file", "--project", c.project, "--holder", HOLDER, "--id", "beat-limit"],
      { tracker: new FakeTracker() },
    );
    expect(code, stdout).toBe(0);
    const done = await end(c, "--gate-gap", "beat-limit");
    expect(done.code, JSON.stringify(done.out)).toBe(0);
    const status = must(ledger("status", "--project", c.project));
    // Not a running wave any more: the next run offers it again, and says it failed.
    expect(status.upgrades).toEqual([expect.objectContaining({ state: "failed", gateGap: "beat-limit" })]);
    expect(status.template.release).toBe("v1.0.0");
    expect(ledger("integrity", "--project", c.project).code).toBe(0);
    const again = await offer(c, "v2.0.0");
    expect(again.out.offer.lastFailed).toEqual({ id: "upgrade-v2.0.0-1", gateGap: "beat-limit" });
  });

  test("a gate gap recorded before the wave started isn't the wave's (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await fileGateGap(c);
    await readyWave(c);
    git(c.project, "switch", "-q", "main");
    const { code, out } = await end(c, "--gate-gap", "beat-limit");
    expect(code).toBe(3);
    expect(out.error).toMatch(/before/);
  });

  test("refuses while a template file is left changed on main (negative control)", async () => {
    const c = await redWave();
    writeFiles(c.project, { "template/src/site/old.ts": "export const old = 'edited';\n" });
    const { code, out } = await end(c, "--gate-gap", "beat-limit");
    expect(code).toBe(3);
    expect(out.error).toMatch(/template/);
  });

  test("refuses off main (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    await readyWave(c);
    const { code, out } = await end(c, "--gate-gap", "beat-limit");
    expect(code).toBe(3);
    expect(out.error).toMatch(/main/);
  });

  test("only ends a wave as failed", async () => {
    const c = await redWave();
    const { code } = await upgrade(
      {},
      "end",
      "--project",
      c.project,
      "--holder",
      HOLDER,
      "--result",
      "merged",
      "--gate-gap",
      "x",
    );
    expect(code).toBe(2);
  });
});

describe("keep", { timeout: 120_000 }, () => {
  const REASON = "the cell still fails the honesty gate on the new release";

  function keep(c: UpgradeCourse, tracker: FakeTracker, o: { path?: string; holder?: string } = {}): Promise<Result> {
    const { path = OVERRIDE, holder = HOLDER } = o;
    return upgrade(
      { tracker },
      ...["keep", "--project", c.project, "--holder", holder, "--path", path, "--reason", REASON],
    );
  }

  const baseOverride = (c: UpgradeCourse) =>
    spawnSync("git", ["-C", c.project, "show", `main~1:overrides/${OVERRIDE}`]).stdout;

  test("a dropped override whose gates fail is kept and its gate gap reopened", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    expect(existsSync(join(c.project, "overrides", OVERRIDE))).toBe(false);
    const tracker = new FakeTracker();
    const { code, out } = await keep(c, tracker);
    expect(code, JSON.stringify(out)).toBe(0);
    expect(out).toMatchObject({ path: OVERRIDE, gateGap: 12, reopened: 12 });
    // The Course's own override is back, byte for byte.
    expect(readFileSync(join(c.project, "overrides", OVERRIDE)).equals(baseOverride(c))).toBe(true);
    expect(tracker.reopened).toHaveLength(1);
    expect(tracker.reopened[0]).toMatchObject({ number: 12 });
    expect(tracker.reopened[0]?.comment).toContain("Fixture Course");
    expect(tracker.reopened[0]?.comment).toContain("v2.0.0");
    expect(tracker.reopened[0]?.comment).toContain(OVERRIDE);
    expect(tracker.reopened[0]?.comment).toContain(REASON);
    expect(upgradesOf(c)[0].kept).toEqual([expect.objectContaining({ path: OVERRIDE, gateGap: 12, reason: REASON })]);

    // The wave goes on to merge with the override kept: its ledger row stays current.
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: the template layer at v2.0.0, one override kept");
    must(await migrate(c));
    reportPreviews(c);
    const merged = await merge(c);
    expect(merged.code, JSON.stringify(merged.out)).toBe(0);
    const status = must(ledger("status", "--project", c.project));
    expect(status.template.overrides).toEqual([expect.objectContaining({ path: OVERRIDE, gateGap: 12 })]);
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: merge the Upgrade wave");
    expect(ledger("integrity", "--project", c.project).code).toBe(0);
  });

  test("a later apply doesn't drop a kept override", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    must(await keep(c, new FakeTracker()));
    const again = await apply(c);
    expect(again.out).toMatchObject({ dropped: [] });
    expect(existsSync(join(c.project, "overrides", OVERRIDE))).toBe(true);
  });

  test("refuses a path the release doesn't retire (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    const tracker = new FakeTracker();
    const { code, out } = await keep(c, tracker, { path: "src/site/helper.ts" });
    expect(code).toBe(3);
    expect(out.error).toMatch(/retire/);
    expect(tracker.reopened).toEqual([]);
  });

  test("refuses to keep an override twice (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    must(await keep(c, new FakeTracker()));
    const tracker = new FakeTracker();
    expect((await keep(c, tracker)).code).toBe(3);
    expect(tracker.reopened).toEqual([]);
  });

  test("refuses an override whose file the release dropped, so the wave is red (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    // A Course override of src/site/old.ts, which v1.1.0 retires and v2.0.0 deletes.
    writeFiles(c.project, { "overrides/src/site/old.ts": "export const old = 'course';\n" });
    must(
      ledger(
        ...["record", "override", "--project", c.project, "--holder", HOLDER],
        ...["--path", "src/site/old.ts", "--gate-gap", "1"],
      ),
    );
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: another override");
    must(await start(c));
    must(await apply(c));
    const tracker = new FakeTracker();
    const { code, out } = await keep(c, tracker, { path: "src/site/old.ts" });
    expect(code).toBe(3);
    expect(out.error).toMatch(/v2\.0\.0 no longer has/);
    expect(tracker.reopened).toEqual([]);
    expect(existsSync(join(c.project, "overrides/src/site/old.ts"))).toBe(false);
  });

  test("changes nothing when GitHub refuses to reopen the gate gap (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    const tracker = new FakeTracker();
    tracker.failReopen = true;
    const { code, out } = await keep(c, tracker);
    expect(code).toBe(3);
    expect(out.error).toMatch(/GitHub/);
    expect(existsSync(join(c.project, "overrides", OVERRIDE))).toBe(false);
    expect(upgradesOf(c)[0].kept).toEqual([]);
  });

  test("refuses off the wave's branch, and another session's run (negative control)", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "minimal" });
    must(await start(c));
    must(await apply(c));
    expect((await keep(c, new FakeTracker(), { holder: "session-b" })).code).toBe(3);
    git(c.project, "switch", "-q", "main");
    const off = await keep(c, new FakeTracker());
    expect(off.code).toBe(3);
    expect(off.out.error).toMatch(/upgrade\/v2\.0\.0-1/);
  });
});

describe("the Fixture Course", { timeout: 300_000 }, () => {
  test("upgrades from v1.0.0 to v2.0.0 across a major release", async () => {
    const c = upgradeCourse(releaseRepo(), { content: "fixture" });
    // The Fixture Course's Module folders: ten, and the pneumatic cascade (12) is the eleventh.
    expect(c.folders).toHaveLength(11);
    const before = contentOf(c);
    const verifier = new FakeVerifier();

    const offered = await offer(c, "v2.0.0");
    expect(offered.out.offer).toMatchObject({ from: "v1.0.0", to: "v2.0.0", held: false });
    must(await start(c));
    must(await apply(c));
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: the template layer at v2.0.0");
    const migrated = must(await migrate(c));
    expect(migrated.migrations).toEqual([{ major: 2, describe: "course.yaml drops legacyTitle" }]);
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: migrate the content");
    reportPreviews(c);

    const readiness = await ready(c);
    expect(readiness.out, JSON.stringify(readiness.out)).toMatchObject({ ready: true, problems: [] });
    const merged = await merge(c, verifier);
    expect(merged.code, JSON.stringify(merged.out)).toBe(0);

    // Every Module's per-job and per-Module gates ran, and the per-deploy gate once.
    for (const f of c.folders) expect(verifier.calls).toContain(`job:${f}`);
    for (const f of c.folders) expect(verifier.calls).toContain(`module:${f}`);
    expect(verifier.calls.filter((call) => call === "deploy")).toHaveLength(1);
    // The template layer is v2.0.0's, file for file; the retired override is gone; the ledger is on v2.0.0.
    expect(templateOnDisk(c)).toEqual(releaseHashes(c.source, "v2.0.0"));
    expect(existsSync(join(c.project, "overrides", OVERRIDE))).toBe(false);
    const status = must(ledger("status", "--project", c.project));
    expect(status.template.release).toBe("v2.0.0");
    expect(status.upgrades[0]).toMatchObject({ state: "merged", from: "v1.0.0", to: "v2.0.0" });
    // The content changed only where the migration changed it.
    const after = contentOf(c);
    expect(Object.keys({ ...before, ...after }).filter((p) => before[p] !== after[p])).toEqual(["course.yaml"]);
    git(c.project, "add", "-A");
    git(c.project, "commit", "-q", "-m", "chore: merge the Upgrade wave");
    expect(ledger("integrity", "--project", c.project).code).toBe(0);
  });
});

/** Records the gate gap the Course filed (#1 on the fake tracker) with its fixture, then commits it. */
async function fileGateGap(c: UpgradeCourse, tracker = new FakeTracker()): Promise<FakeTracker> {
  writeFiles(c.project, { "build-records/gate-gaps/beat-limit/case.json": '{ "beat": "a long beat" }\n' });
  must(
    ledger(
      ...["record", "gate-gap", "--project", c.project, "--holder", HOLDER, "--id", "beat-limit"],
      ...["--title", "A beat over the limit slips through", "--defect", "A 140 word beat shipped."],
    ),
  );
  const { code, stdout } = await runGateGap(
    ["file", "--project", c.project, "--holder", HOLDER, "--id", "beat-limit"],
    { tracker },
  );
  expect(code, stdout).toBe(0);
  git(c.project, "add", "-A");
  git(c.project, "commit", "-q", "-m", "chore: file a gate gap");
  return tracker;
}
