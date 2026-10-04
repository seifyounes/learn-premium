import { describe, expect, it } from "vitest";
import { GitHub, LIVE_CONTEXT } from "../deploy/github.ts";
import { ownerReport, rollBackFrom } from "../deploy/rollback.ts";
import { Vercel, VercelError, type Deployment } from "../deploy/vercel.ts";
import type { GateReport } from "../gates/runner.ts";

const dep = (n: number, overrides: Partial<Deployment> = {}): Deployment => ({
  uid: `dpl_${n}`,
  url: `fixture-${n}.vercel.app`,
  created: n * 1000,
  readyState: "READY",
  aliasAssigned: n * 1000 + 5,
  isRollbackCandidate: true,
  sha: `${n}`.repeat(40).slice(0, 40),
  ...overrides,
});

/** A fake Vercel holding `deployments`, recording what it was asked to roll back to. */
function fakeVercel(deployments: Deployment[], refuse?: string) {
  const rolledBackTo: string[] = [];
  return {
    rolledBackTo,
    productionDeployments: async () => [...deployments].sort((a, b) => b.created - a.created),
    rollBack: async (uid: string) => {
      if (refuse !== undefined) throw new VercelError(402, refuse);
      rolledBackTo.push(uid);
    },
  };
}

describe("rolling back a red live deploy", () => {
  const failing = dep(5);

  it("goes back to the newest earlier deployment that passed the live gates", async () => {
    const vercel = fakeVercel([dep(1), dep(2), dep(3), dep(4), failing]);
    const green = new Set([dep(2).sha, dep(3).sha]);
    const outcome = await rollBackFrom(failing.sha ?? "", "live gates red", {
      vercel,
      passedLiveGates: async (sha) => green.has(sha),
    });
    expect(outcome).toMatchObject({ kind: "rolled-back", target: { uid: "dpl_3" }, skipped: [{ uid: "dpl_4" }] });
    expect(vercel.rolledBackTo).toEqual(["dpl_3"]);
  });

  it("never picks the failing commit, a later deployment, one that isn't ready or one Vercel can't roll back to", async () => {
    const vercel = fakeVercel([
      dep(1),
      dep(2, { readyState: "ERROR" }),
      dep(3, { isRollbackCandidate: false }),
      dep(4, { sha: failing.sha }),
      failing,
      dep(6),
    ]);
    const outcome = await rollBackFrom(failing.sha ?? "", "live gates red", {
      vercel,
      passedLiveGates: async () => true,
    });
    expect(outcome).toMatchObject({ kind: "rolled-back", target: { uid: "dpl_1" } });
  });

  it("reports when nothing earlier is green, and touches nothing", async () => {
    const vercel = fakeVercel([dep(1), failing]);
    const outcome = await rollBackFrom(failing.sha ?? "", "red", { vercel, passedLiveGates: async () => false });
    expect(outcome).toMatchObject({ kind: "no-green", skipped: [{ uid: "dpl_1" }] });
    expect(vercel.rolledBackTo).toEqual([]);
  });

  it("reports Vercel's refusal (Hobby rolls back only one deployment)", async () => {
    const vercel = fakeVercel([dep(1), dep(2), failing], "Hobby teams can only roll back to the previous deployment");
    const outcome = await rollBackFrom(failing.sha ?? "", "red", {
      vercel,
      passedLiveGates: async (sha) => sha === dep(1).sha,
    });
    expect(outcome).toMatchObject({ kind: "refused", target: { uid: "dpl_1" }, error: expect.stringMatching(/Hobby/) });
  });
});

describe("the Owner's report", () => {
  const report: GateReport = {
    report: "learn-premium gate report v1",
    commit: "f".repeat(40),
    dirty: false,
    point: "live",
    url: "https://fixture.vercel.app",
    ranAt: "2026-10-04T00:00:00.000Z",
    green: false,
    gates: [
      { id: "live-routes", checks: "", status: "pass", coverage: { routes: 10 }, findings: [] },
      {
        id: "live-private-paths",
        checks: "",
        status: "block",
        coverage: { probes: 50 },
        findings: [{ outcome: "block", at: "/course.yaml", message: "answers 200; it must 404" }],
      },
    ],
    checkpointItems: [],
  };

  it("names what failed and where production now is", () => {
    const { title, body } = ownerReport({
      sha: "f".repeat(40),
      liveUrl: "https://fixture.vercel.app",
      report,
      outcome: { kind: "rolled-back", failed: dep(5), target: dep(3), skipped: [dep(4)] },
      drill: false,
      runUrl: "https://github.com/o/r/actions/runs/1",
    });
    expect(title).toBe("live deploy of fffffff failed, rolled back to 3333333");
    expect(body).toContain("- `live-private-paths` at `/course.yaml`: answers 200; it must 404");
    expect(body).toContain("Production now serves 3333333 (`dpl_3`, https://fixture-3.vercel.app)");
    expect(body).toContain("Undo Rollback");
    expect(body).toContain("Skipped, not green: 4444444.");
    expect(body).not.toContain("live-routes");
  });

  it("says a drill is a drill, and what to do when Vercel refused", () => {
    const { title, body } = ownerReport({
      sha: "f".repeat(40),
      liveUrl: "https://fixture.vercel.app",
      report: undefined,
      outcome: { kind: "refused", failed: dep(5), target: dep(1), skipped: [], error: "402" },
      drill: true,
    });
    expect(title).toBe("Drill: live deploy of fffffff failed, NOT rolled back");
    expect(body).toContain("forced failure");
    expect(body).toContain("Hobby plan");
  });
});

describe("the API clients", () => {
  it("list production deployments newest first with their commit, and roll back by id", async () => {
    const calls: string[] = [];
    const vercel = new Vercel({
      token: "t",
      projectId: "prj_1",
      teamId: "team_1",
      fetch: async (url, init) => {
        calls.push(`${init?.method} ${String(url)}`);
        if (init?.method === "POST") return new Response("{}");
        return Response.json({
          deployments: [
            { uid: "dpl_a", url: "a.vercel.app", created: 1, readyState: "READY", meta: { githubCommitSha: "aaa" } },
            { uid: "dpl_b", url: "b.vercel.app", created: 2, readyState: "READY", aliasAssigned: 3 },
          ],
          pagination: {},
        });
      },
    });
    const deployments = await vercel.productionDeployments({ sha: "aaa" });
    expect(deployments.map((d) => [d.uid, d.sha, d.aliasAssigned])).toEqual([
      ["dpl_b", undefined, 3],
      ["dpl_a", "aaa", null],
    ]);
    await vercel.rollBack("dpl_a", "live gates red");
    expect(calls).toEqual([
      "GET https://api.vercel.com/v7/deployments?projectId=prj_1&target=production&limit=20&sha=aaa&teamId=team_1",
      "POST https://api.vercel.com/v1/projects/prj_1/rollback/dpl_a?description=live+gates+red&teamId=team_1",
    ]);
  });

  it("surface Vercel's error message and status", async () => {
    const vercel = new Vercel({
      token: "t",
      projectId: "p",
      fetch: async () => Response.json({ error: { message: "not allowed on Hobby" } }, { status: 402 }),
    });
    await expect(vercel.rollBack("d", "x")).rejects.toMatchObject({ status: 402, message: /not allowed on Hobby/ });
  });

  it("read a commit's live-gates status, newest first", async () => {
    const github = new GitHub({
      token: "t",
      repository: "o/r",
      fetch: async () =>
        Response.json([
          { context: "other", state: "failure" },
          { context: LIVE_CONTEXT, state: "success" },
          { context: LIVE_CONTEXT, state: "failure" },
        ]),
    });
    expect(await github.passedLiveGates("abc")).toBe(true);
  });
});
