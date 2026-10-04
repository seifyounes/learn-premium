// Which commits passed the live gates: each green live run marks its commit with a GitHub commit
// status (`LIVE_CONTEXT`), and the rollback reads them back to find the last green deployment.

export const LIVE_CONTEXT = "learn-premium/live-gates";

export interface GitHubOptions {
  token: string;
  /** owner/name */
  repository: string;
  fetch?: typeof fetch;
}

export class GitHub {
  readonly #options: GitHubOptions;
  constructor(options: GitHubOptions) {
    this.#options = options;
  }

  async #call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const { token, repository, fetch: send = fetch } = this.#options;
    const response = await send(`https://api.github.com/repos/${repository}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path} answered ${response.status}: ${await response.text()}`);
    return response.json();
  }

  /** Whether the live gates passed on `sha`: its newest `LIVE_CONTEXT` status is a success. */
  async passedLiveGates(sha: string): Promise<boolean> {
    const statuses = (await this.#call("GET", `/commits/${sha}/statuses?per_page=100`)) as {
      context: string;
      state: string;
    }[];
    // GitHub lists a commit's statuses newest first.
    return statuses.find((s) => s.context === LIVE_CONTEXT)?.state === "success";
  }

  /** Records the live gates' verdict on `sha`. */
  async markLiveGates(sha: string, state: "success" | "failure", description: string, targetUrl?: string) {
    await this.#call("POST", `/statuses/${sha}`, {
      state,
      context: LIVE_CONTEXT,
      description: description.slice(0, 140),
      ...(targetUrl === undefined ? {} : { target_url: targetUrl }),
    });
  }
}
