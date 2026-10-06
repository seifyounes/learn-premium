// A fake GitHub and Vercel for the host step's tests (seam 2): it keeps its own repos, Vercel projects
// and deployments, deploys a project's linked repo on every push to main the way Vercel's Git
// integration does, and serves each production deployment with the headers it's told to.
import { spawnSync } from "node:child_process";
import type { Hosting, LivePage, VercelProjectInput } from "../scripts/intake/hosting.ts";

export class FakeHosting implements Hosting {
  readonly owner = "owner";
  readonly repos = new Map<string, { visibility: "private" | "public"; pushed: string | null }>();
  readonly projects = new Map<string, VercelProjectInput & { id: string }>();
  readonly deployments: { project: string; sha: string; url: string }[] = [];
  /** What the live site answers: noindex everywhere unless a test says otherwise. */
  page: LivePage = {
    status: 200,
    robotsHeader: "noindex, nofollow",
    html: '<html><head><meta name="robots" content="noindex, nofollow"></head></html>',
  };
  readonly calls: string[] = [];

  async githubOwner(): Promise<string> {
    return this.owner;
  }

  async repoVisibility(repo: string): Promise<"private" | "public" | null> {
    return this.repos.get(repo)?.visibility ?? null;
  }

  async createPrivateRepo(repo: string): Promise<void> {
    this.calls.push(`create repo ${repo}`);
    if (this.repos.has(repo)) throw new Error(`${repo} exists`);
    this.repos.set(repo, { visibility: "private", pushed: null });
  }

  async pushMain(project: string, repo: string): Promise<void> {
    const sha = spawnSync("git", ["-C", project, "rev-parse", "main"], { encoding: "utf8" }).stdout.trim();
    const remote = spawnSync("git", ["-C", project, "remote", "get-url", "origin"], { encoding: "utf8" }).stdout.trim();
    if (remote !== `https://github.com/${repo}.git`) throw new Error(`origin is ${remote}, not ${repo}`);
    const target = this.repos.get(repo);
    if (target === undefined) throw new Error(`no repo ${repo}`);
    if (target.pushed === sha) return;
    this.calls.push(`push ${repo} ${sha}`);
    target.pushed = sha;
    // Vercel's Git integration deploys every push to a linked project.
    for (const project of this.projects.values()) {
      if (project.repo === repo) this.deployments.push({ project: project.id, sha, url: `${project.name}.vercel.app` });
    }
  }

  async vercelProject(name: string): Promise<{ id: string; repo: string | null } | null> {
    const project = this.projects.get(name);
    return project === undefined ? null : { id: project.id, repo: project.repo };
  }

  async createVercelProject(input: VercelProjectInput): Promise<{ id: string }> {
    this.calls.push(`create vercel ${input.name}`);
    const id = `prj_${input.name}`;
    this.projects.set(input.name, { ...input, id });
    return { id };
  }

  async ensureProductionDeployment(project: { id: string; name: string }, repo: string, sha: string): Promise<boolean> {
    if (this.deployments.some((d) => d.project === project.id && d.sha === sha)) return false;
    if (this.repos.get(repo)?.pushed !== sha) throw new Error(`${sha} isn't on ${repo}'s main`);
    this.calls.push(`deploy ${project.id} ${sha}`);
    this.deployments.push({ project: project.id, sha, url: `${project.name}.vercel.app` });
    return true;
  }

  async awaitProduction(projectId: string, sha: string): Promise<{ url: string }> {
    const deployment = this.deployments.findLast((d) => d.project === projectId && d.sha === sha);
    if (deployment === undefined) throw new Error(`Vercel never deployed ${sha}`);
    return { url: `https://${deployment.url}` };
  }

  async fetchPage(url: string): Promise<LivePage> {
    this.calls.push(`fetch ${url}`);
    return this.page;
  }
}
