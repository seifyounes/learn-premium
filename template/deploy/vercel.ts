// The few Vercel REST calls the deploy tooling makes: list a project's production deployments, and
// roll production back to one of them (Instant Rollback). Authenticated with a Vercel token.

export interface Deployment {
  uid: string;
  url: string;
  created: number;
  /** BUILDING, READY, ERROR, CANCELED… */
  readyState: string;
  /** When Vercel pointed the production domains at it; null until then. */
  aliasAssigned: number | null;
  /** Whether Vercel would let production roll back to it. */
  isRollbackCandidate: boolean | null;
  /** The commit it was built from. */
  sha: string | undefined;
}

export interface VercelOptions {
  token: string;
  projectId: string;
  /** The team that owns the project; none for a personal (Hobby) account. */
  teamId?: string;
  fetch?: typeof fetch;
}

export class VercelError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class Vercel {
  readonly #options: VercelOptions;
  constructor(options: VercelOptions) {
    this.#options = options;
  }

  get projectId() {
    return this.#options.projectId;
  }

  async #call(method: "GET" | "POST", path: string, query: Record<string, string> = {}): Promise<unknown> {
    const { token, teamId, fetch: send = fetch } = this.#options;
    const params = new URLSearchParams({ ...query, ...(teamId === undefined ? {} : { teamId }) });
    const response = await send(`https://api.vercel.com${path}?${params}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    if (!response.ok) {
      const message = (() => {
        try {
          return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
        } catch {
          return text;
        }
      })();
      throw new VercelError(response.status, `Vercel ${method} ${path} answered ${response.status}: ${message}`);
    }
    return text === "" ? undefined : JSON.parse(text);
  }

  /** The project's production deployments, newest first; `sha` keeps those built from one commit. */
  async productionDeployments({ sha, limit = 20 }: { sha?: string; limit?: number } = {}): Promise<Deployment[]> {
    const body = (await this.#call("GET", "/v7/deployments", {
      projectId: this.#options.projectId,
      target: "production",
      limit: String(limit),
      ...(sha === undefined ? {} : { sha }),
    })) as { deployments: RawDeployment[] };
    return body.deployments.map(toDeployment).sort((a, b) => b.created - a.created);
  }

  /** Points production at `deploymentId` (Instant Rollback). Vercel then stops promoting new pushes. */
  async rollBack(deploymentId: string, description: string): Promise<void> {
    await this.#call("POST", `/v1/projects/${this.#options.projectId}/rollback/${deploymentId}`, { description });
  }
}

interface RawDeployment {
  uid: string;
  url: string;
  created: number;
  readyState?: string;
  state?: string;
  aliasAssigned?: number | boolean | null;
  isRollbackCandidate?: boolean | null;
  meta?: Record<string, unknown>;
}

function toDeployment(raw: RawDeployment): Deployment {
  const sha = raw.meta?.["githubCommitSha"];
  return {
    uid: raw.uid,
    url: raw.url,
    created: raw.created,
    readyState: raw.readyState ?? raw.state ?? "UNKNOWN",
    aliasAssigned: typeof raw.aliasAssigned === "number" ? raw.aliasAssigned : raw.aliasAssigned ? raw.created : null,
    isRollbackCandidate: raw.isRollbackCandidate ?? null,
    sha: typeof sha === "string" ? sha : undefined,
  };
}
