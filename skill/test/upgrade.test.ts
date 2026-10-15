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
import { run as runUpgrade, type Deps } from "../scripts/upgrade/cli.ts";
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
