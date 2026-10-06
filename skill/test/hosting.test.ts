// The real hosting adapter, against a recorded `gh` and a fake Vercel API: what it asks GitHub and
// Vercel for, since a test run never creates a real repo or Vercel project.
import { describe, expect, test } from "vitest";
import { HostingError, realHosting } from "../scripts/intake/hosting.ts";

interface Call {
  method: string;
  url: URL;
  auth: string | null;
  body: unknown;
}

/** A fake Vercel API: each request is recorded and answered by `answer`, by method and path. */
function fakeVercel(answer: (method: string, path: string, url: URL) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url,
      auth: headers.get("authorization"),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const { status = 200, json = {} } = answer(method, url.pathname, url);
    return new Response(JSON.stringify(json), { status });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function ghRunner(answers: Record<string, { status: number; stdout?: string; stderr?: string }>) {
  const calls: string[] = [];
  const run = (command: string, args: string[]) => {
    const line = `${command} ${args.join(" ")}`;
    calls.push(line);
    const found = Object.entries(answers).find(([prefix]) => line.startsWith(prefix))?.[1];
    return { status: found?.status ?? 0, stdout: found?.stdout ?? "", stderr: found?.stderr ?? "" };
  };
  return { calls, run };
}

describe("the real hosting adapter", () => {
  test("asks Vercel for a project that builds template/ with CONTENT_DIR, linked to the GitHub repo, with the Owner's token", async () => {
    const vercel = fakeVercel(() => ({ json: { id: "prj_1" } }));
    const hosting = realHosting({ vercelToken: "tok", vercelTeam: "team_1", fetch: vercel.fetch });

    const project = await hosting.createVercelProject({
      name: "heat-transfer",
      repo: "owner/heat-transfer",
      rootDirectory: "template",
      env: { CONTENT_DIR: "../content" },
    });

    expect(project).toEqual({ id: "prj_1" });
    const [call] = vercel.calls;
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/v11/projects");
    expect(call?.url.searchParams.get("teamId")).toBe("team_1");
    expect(call?.auth).toBe("Bearer tok");
    expect(call?.body).toEqual({
      name: "heat-transfer",
      framework: "astro",
      rootDirectory: "template",
      gitRepository: { type: "github", repo: "owner/heat-transfer" },
      environmentVariables: [
        { key: "CONTENT_DIR", value: "../content", type: "plain", target: ["production", "preview", "development"] },
      ],
    });
  });

  test("reads a Vercel project's GitHub link, and a missing one as none", async () => {
    const vercel = fakeVercel((_, path) =>
      path.endsWith("/heat-transfer")
        ? { json: { id: "prj_1", link: { type: "github", org: "owner", repo: "heat-transfer" } } }
        : { status: 404, json: { error: { message: "not found" } } },
    );
    const hosting = realHosting({ vercelToken: "tok", fetch: vercel.fetch });

    expect(await hosting.vercelProject("heat-transfer")).toEqual({ id: "prj_1", repo: "owner/heat-transfer" });
    expect(await hosting.vercelProject("other")).toBeNull();
    expect(vercel.calls[0]?.url.searchParams.has("teamId")).toBe(false);
  });

  test("asks for the first production deployment of main only when Vercel has none for that commit", async () => {
    let deployed = false;
    const vercel = fakeVercel((method) => {
      if (method === "POST") deployed = true;
      return { json: { deployments: deployed ? [{ uid: "dpl_1" }] : [] } };
    });
    const gh = ghRunner({ "gh api repos/owner/heat-transfer": { status: 0, stdout: "123456\n" } });
    const hosting = realHosting({ vercelToken: "tok", fetch: vercel.fetch, run: gh.run });
    const project = { id: "prj_1", name: "heat-transfer" };

    expect(await hosting.ensureProductionDeployment(project, "owner/heat-transfer", "abc123")).toBe(true);
    expect(await hosting.ensureProductionDeployment(project, "owner/heat-transfer", "abc123")).toBe(false);

    const posts = vercel.calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => [c.url.pathname, c.body])).toEqual([
      [
        "/v13/deployments",
        {
          name: "heat-transfer",
          project: "prj_1",
          target: "production",
          gitSource: { type: "github", repoId: 123456, ref: "main", sha: "abc123" },
        },
      ],
    ]);
    expect(vercel.calls[0]?.url.searchParams.get("sha")).toBe("abc123");
  });

  test("waits until production serves the commit's deployment, then gives its vercel.app address", async () => {
    let polls = 0;
    const vercel = fakeVercel((_, path) => {
      if (path.startsWith("/v2/deployments/dpl_1/aliases")) {
        return {
          json: { aliases: [{ alias: "heat-transfer-owner.vercel.app" }, { alias: "heat-transfer.vercel.app" }] },
        };
      }
      polls++;
      return {
        json: {
          deployments: [
            polls < 3
              ? { uid: "dpl_1", readyState: "BUILDING" }
              : { uid: "dpl_1", readyState: "READY", aliasAssigned: 1 },
          ],
        },
      };
    });
    const hosting = realHosting({ vercelToken: "tok", fetch: vercel.fetch, pollMs: 0 });

    expect(await hosting.awaitProduction("prj_1", "abc123")).toEqual({ url: "https://heat-transfer.vercel.app" });
    expect(polls).toBe(3);
  });

  test("a failed build ends the wait with Vercel's reason", async () => {
    const vercel = fakeVercel(() => ({
      json: {
        deployments: [{ uid: "dpl_1", readyState: "ERROR", errorMessage: "Command npm run build exited with 1" }],
      },
    }));
    const hosting = realHosting({ vercelToken: "tok", fetch: vercel.fetch, pollMs: 0 });

    await expect(hosting.awaitProduction("prj_1", "abc123")).rejects.toThrow(
      /ERROR: Command npm run build exited with 1/,
    );
  });

  test("with no Vercel token it says how to make one, and asks Vercel nothing", async () => {
    const vercel = fakeVercel(() => ({}));
    const hosting = realHosting({ vercelToken: undefined, fetch: vercel.fetch });

    await expect(hosting.vercelProject("heat-transfer")).rejects.toThrow(HostingError);
    await expect(hosting.vercelProject("heat-transfer")).rejects.toThrow(/VERCEL_TOKEN/);
    expect(vercel.calls).toEqual([]);
  });

  test("makes the GitHub repo private, and reads a repo GitHub doesn't know as none", async () => {
    const gh = ghRunner({
      "gh repo view owner/missing": {
        status: 1,
        stderr: "GraphQL: Could not resolve to a Repository with the name 'owner/missing'.",
      },
      "gh repo view owner/heat-transfer": { status: 0, stdout: "PRIVATE\n" },
    });
    const hosting = realHosting({ vercelToken: "tok", run: gh.run });

    expect(await hosting.repoVisibility("owner/missing")).toBeNull();
    expect(await hosting.repoVisibility("owner/heat-transfer")).toBe("private");
    await hosting.createPrivateRepo("owner/heat-transfer", "Study site");
    expect(gh.calls.at(-1)).toBe("gh repo create owner/heat-transfer --private --description Study site");
  });

  test("a gh failure other than a missing repo is reported, not taken for a missing repo", async () => {
    const gh = ghRunner({ "gh repo view": { status: 1, stderr: "HTTP 401: Bad credentials" } });
    const hosting = realHosting({ vercelToken: "tok", run: gh.run });

    await expect(hosting.repoVisibility("owner/heat-transfer")).rejects.toThrow(/Bad credentials/);
  });
});
