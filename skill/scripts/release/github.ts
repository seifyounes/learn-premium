// GitHub for the release sequence, through the gh CLI and the Owner's own sign-in. gh fills in
// {owner}/{repo} from the clone it runs in.
import { spawnSync } from "node:child_process";
import type { CommitStatus, Forge, GateGapIssue, WorkflowRun } from "./sequence.ts";

export class GhError extends Error {}

export class GhForge implements Forge {
  readonly repo: string;

  constructor(repo: string) {
    this.repo = repo;
  }

  #gh(args: string[], input?: string): string {
    const child = spawnSync("gh", args, {
      cwd: this.repo,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      ...(input === undefined ? {} : { input }),
    });
    if (child.error) throw new GhError(`gh couldn't run: ${child.error.message}`);
    if (child.status !== 0) throw new GhError(child.stderr.trim() || `gh ${args[0]} exited ${child.status}`);
    return child.stdout;
  }

  #api<T>(path: string, ...flags: string[]): T {
    return JSON.parse(this.#gh(["api", path, ...flags])) as T;
  }

  /** Every page of a list endpoint, as one array (`--slurp` gives one array per page). */
  #pages<T>(path: string): T[] {
    return (JSON.parse(this.#gh(["api", "--paginate", "--slurp", path])) as T[][]).flat();
  }

  async runs(sha: string): Promise<WorkflowRun[]> {
    const pages = JSON.parse(
      this.#gh(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`]),
    ) as {
      workflow_runs: {
        path: string;
        status: string;
        conclusion: string | null;
        created_at: string;
        run_started_at: string | null;
        html_url: string;
      }[];
    }[];
    return pages.flatMap((page) =>
      page.workflow_runs.map((r) => ({
        // A dynamic run's path carries its ref after an @; a workflow file's never does.
        workflow: r.path.split("@")[0] ?? r.path,
        status: r.status,
        conclusion: r.conclusion,
        createdAt: r.created_at,
        startedAt: r.run_started_at ?? r.created_at,
        url: r.html_url,
      })),
    );
  }

  async statuses(sha: string): Promise<CommitStatus[]> {
    const list = this.#pages<{
      context: string;
      state: string;
      description: string | null;
      target_url: string | null;
      creator: { login: string } | null;
      created_at: string;
    }>(`repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`);
    return list
      .map((s) => ({
        context: s.context,
        state: s.state,
        description: s.description,
        targetUrl: s.target_url,
        creator: s.creator?.login ?? null,
        createdAt: s.created_at,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setStatus(
    sha: string,
    status: { state: "success"; context: string; description: string; targetUrl: string | null },
  ): Promise<void> {
    this.#gh(
      ["api", "--method", "POST", `repos/{owner}/{repo}/statuses/${sha}`, "--input", "-"],
      JSON.stringify({
        state: status.state,
        context: status.context,
        description: status.description,
        ...(status.targetUrl === null ? {} : { target_url: status.targetUrl }),
      }),
    );
  }

  async owner(): Promise<string> {
    return this.#api<{ owner: { login: string } }>("repos/{owner}/{repo}").owner.login;
  }

  async viewer(): Promise<string> {
    return this.#api<{ login: string }>("user").login;
  }

  async closedGateGaps(): Promise<GateGapIssue[]> {
    const issues = this.#pages<{
      number: number;
      title: string;
      body: string | null;
      state_reason: string | null;
      pull_request?: unknown;
    }>("repos/{owner}/{repo}/issues?labels=gate-gap&state=closed&per_page=100");
    return issues
      .filter((i) => i.pull_request === undefined)
      .map((i) => ({ number: i.number, title: i.title, body: i.body, stateReason: i.state_reason }));
  }

  /**
   * The Tool gallery on this commit's own Production deployment: a URL that serves only this
   * commit's build. Never the production URL, which moves on to newer commits.
   */
  async galleryUrl(sha: string): Promise<string | null> {
    const deployments = this.#api<{ id: number; environment: string }[]>(
      `repos/{owner}/{repo}/deployments?sha=${sha}&per_page=100`,
    ).filter((d) => d.environment.startsWith("Production"));
    for (const deployment of deployments) {
      const statuses = this.#api<{ state: string; environment_url?: string | null }[]>(
        `repos/{owner}/{repo}/deployments/${deployment.id}/statuses?per_page=100`,
      );
      const url = statuses.find((s) => s.state === "success" && s.environment_url)?.environment_url;
      if (url) return `${url.replace(/\/$/, "")}/tool-gallery/`;
    }
    return null;
  }

  async tagCreatedAt(tag: string): Promise<string | null> {
    const ref = this.#api<{ object: { type: string; sha: string } }>(`repos/{owner}/{repo}/git/ref/tags/${tag}`);
    // A lightweight tag has no tagger date; every release tag is annotated.
    if (ref.object.type !== "tag") return null;
    return (
      this.#api<{ tagger?: { date?: string } }>(`repos/{owner}/{repo}/git/tags/${ref.object.sha}`).tagger?.date ?? null
    );
  }

  async createRelease(tag: string, title: string, notes: string): Promise<string> {
    return this.#gh(["release", "create", tag, "--verify-tag", "--title", title, "--notes-file", "-"], notes).trim();
  }
}
