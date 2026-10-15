// The Upgrade wave: a newer Template release re-copied into a Course project on its own branch,
// merged to `main` only when green. Proven on a Course project whose content is a copy of the real
// Fixture Course, pinned to v1.0.0 of a throwaway release repo tagged v1.0.0, v1.1.0 and v2.0.0, with
// a fake verifier and a fake tracker: no test ever reaches GitHub or runs the Course's real gates.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { run as runGateGap } from "../scripts/gate-gap/cli.ts";
import { run as runUpgrade, type Deps } from "../scripts/upgrade/cli.ts";
import { must } from "./fake-notebooklm.ts";
import { FakeTracker } from "./fake-tracker.ts";
import { ledger, writeFiles, type Result } from "./helpers.ts";
import { addRelease, git, HOLDER, releaseRepo, upgradeCourse, type UpgradeCourse } from "./upgrade-fixtures.ts";

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
