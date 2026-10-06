// The seam between the host step and the services it creates things in: GitHub (through the `gh`
// CLI, signed in as the Owner) and Vercel (its REST API, with the Owner's VERCEL_TOKEN). The tests
// pass a fake; `realHosting` is what a real run uses, and only on the Owner's word.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export interface VercelProjectInput {
  name: string;
  /** owner/name of the GitHub repo it deploys from. */
  repo: string;
  /** The folder Vercel builds: the template layer. */
  rootDirectory: string;
  /** Build environment variables, for production and previews alike. */
  env: Record<string, string>;
}

/** What the live site's home page answered. */
export interface LivePage {
  status: number;
  robotsHeader: string | null;
  html: string;
}

export interface Hosting {
  /** The GitHub account the Owner is signed in as. */
  githubOwner(): Promise<string>;
  /** The repo's visibility, or null when there is no such repo. */
  repoVisibility(repo: string): Promise<"private" | "public" | null>;
  createPrivateRepo(repo: string, description: string): Promise<void>;
  /** Pushes the project's `main` to its `origin` (`repo`). */
  pushMain(project: string, repo: string): Promise<void>;
  /** The Vercel project of that name and the repo it's linked to, or null when there is none. */
  vercelProject(name: string): Promise<{ id: string; repo: string | null } | null>;
  createVercelProject(input: VercelProjectInput): Promise<{ id: string }>;
  /**
   * Makes sure Vercel deploys `sha` of `repo`'s main to production: a push to a linked project does
   * that itself, but a project linked after the push needs its first deployment asked for. Returns
   * whether it had to ask.
   */
  ensureProductionDeployment(project: { id: string; name: string }, repo: string, sha: string): Promise<boolean>;
  /** Waits until production serves Vercel's deployment of `sha`, and returns its production address. */
  awaitProduction(projectId: string, sha: string): Promise<{ url: string }>;
  fetchPage(url: string): Promise<LivePage>;
}

export class HostingError extends Error {}

type Runner = (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };

const spawnRunner: Runner = (command, args) => {
  const child = spawnSync(command, args, { encoding: "utf8" });
  if (child.error !== undefined) throw new HostingError(`${command} couldn't run: ${child.error.message}`);
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
};

export interface RealHostingOptions {
  /** VERCEL_TOKEN: the Owner's Vercel token (Account Settings → Tokens). */
  vercelToken: string | undefined;
  /** VERCEL_TEAM_ID: only for a team-owned Vercel account. */
  vercelTeam?: string | undefined;
  run?: Runner;
  fetch?: typeof fetch;
  /** How long to wait for production to serve the first deployment, and how often to look. */
  timeoutMs?: number;
  pollMs?: number;
}

/** Every environment a Vercel project builds in. */
const TARGETS = ["production", "preview", "development"];

export function realHosting(options: RealHostingOptions): Hosting {
  const { vercelTeam, run = spawnRunner, fetch: send = fetch, timeoutMs = 20 * 60_000, pollMs = 10_000 } = options;

  function gh(args: string[]): string {
    const out = run("gh", args);
    if (out.status !== 0) throw new HostingError(`gh ${args.join(" ")} failed: ${out.stderr.trim()}`);
    return out.stdout.trim();
  }

  async function vercel(method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {}) {
    if (options.vercelToken === undefined || options.vercelToken === "") {
      throw new HostingError("VERCEL_TOKEN is not set: create a token under Vercel's Account Settings → Tokens");
    }
    const params = new URLSearchParams({ ...query, ...(vercelTeam ? { teamId: vercelTeam } : {}) });
    const response = await send(`https://api.vercel.com${path}?${params}`, {
      method,
      headers: {
        authorization: `Bearer ${options.vercelToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json = text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>);
    return { status: response.status, ok: response.ok, json, text };
  }

  async function vercelOk(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>) {
    const answer = await vercel(method, path, body, query);
    if (!answer.ok) {
      const message = (answer.json?.["error"] as { message?: string } | undefined)?.message ?? answer.text;
      throw new HostingError(`Vercel ${method} ${path} answered ${answer.status}: ${message}`);
    }
    return answer.json ?? {};
  }

  return {
    async githubOwner() {
      return gh(["api", "user", "--jq", ".login"]);
    },

    async repoVisibility(repo) {
      const out = run("gh", ["repo", "view", repo, "--json", "visibility", "--jq", ".visibility"]);
      if (out.status !== 0) {
        if (/Could not resolve to a Repository/i.test(out.stderr)) return null;
        throw new HostingError(`gh repo view ${repo} failed: ${out.stderr.trim()}`);
      }
      return out.stdout.trim().toUpperCase() === "PRIVATE" ? "private" : "public";
    },

    async createPrivateRepo(repo, description) {
      gh(["repo", "create", repo, "--private", "--description", description]);
    },

    async pushMain(project) {
      const out = run("git", ["-C", project, "push", "-u", "origin", "main"]);
      if (out.status !== 0) throw new HostingError(`git push failed: ${out.stderr.trim()}`);
    },

    async vercelProject(name) {
      const answer = await vercel("GET", `/v9/projects/${encodeURIComponent(name)}`);
      if (answer.status === 404) return null;
      if (!answer.ok)
        throw new HostingError(`Vercel GET /v9/projects/${name} answered ${answer.status}: ${answer.text}`);
      const link = answer.json?.["link"] as { type?: string; org?: string; repo?: string } | undefined;
      return {
        id: String(answer.json?.["id"]),
        repo: link?.type === "github" && link.org && link.repo ? `${link.org}/${link.repo}` : null,
      };
    },

    async createVercelProject({ name, repo, rootDirectory, env }) {
      const created = await vercelOk("POST", "/v11/projects", {
        name,
        framework: "astro",
        rootDirectory,
        gitRepository: { type: "github", repo },
        environmentVariables: Object.entries(env).map(([key, value]) => ({
          key,
          value,
          type: "plain",
          target: TARGETS,
        })),
      });
      return { id: String(created["id"]) };
    },

    async ensureProductionDeployment({ id, name }, repo, sha) {
      const { deployments = [] } = (await vercelOk("GET", "/v7/deployments", undefined, {
        projectId: id,
        target: "production",
        sha,
        limit: "1",
      })) as { deployments?: unknown[] };
      if (deployments.length > 0) return false;
      const repoId = Number(gh(["api", `repos/${repo}`, "--jq", ".id"]));
      await vercelOk("POST", "/v13/deployments", {
        name,
        project: id,
        target: "production",
        gitSource: { type: "github", repoId, ref: "main", sha },
      });
      return true;
    },

    async awaitProduction(projectId, sha) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { deployments = [] } = (await vercelOk("GET", "/v7/deployments", undefined, {
          projectId,
          target: "production",
          sha,
          limit: "5",
        })) as {
          deployments?: {
            uid: string;
            readyState?: string;
            state?: string;
            aliasAssigned?: unknown;
            errorMessage?: string;
          }[];
        };
        const deployment = deployments[0];
        const state = deployment?.readyState ?? deployment?.state;
        if (deployment !== undefined && (state === "ERROR" || state === "CANCELED")) {
          throw new HostingError(
            `Vercel's deployment of ${sha} ended ${state}: ${deployment.errorMessage ?? "see its build log"}`,
          );
        }
        if (deployment !== undefined && state === "READY" && deployment.aliasAssigned) {
          const { aliases = [] } = (await vercelOk("GET", `/v2/deployments/${deployment.uid}/aliases`)) as {
            aliases?: { alias: string }[];
          };
          const domain = aliases
            .map((a) => a.alias)
            .filter((a) => a.endsWith(".vercel.app"))
            .sort((a, b) => a.length - b.length)[0];
          if (domain !== undefined) return { url: `https://${domain}` };
        }
        if (Date.now() > deadline) {
          throw new HostingError(
            `production didn't serve Vercel's deployment of ${sha} within ${timeoutMs / 60_000} minutes`,
          );
        }
        await sleep(pollMs);
      }
    },

    async fetchPage(url) {
      const response = await send(url, { redirect: "follow" });
      return {
        status: response.status,
        robotsHeader: response.headers.get("x-robots-tag"),
        html: await response.text(),
      };
    },
  };
}
