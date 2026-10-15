// learn-premium's own issue tracker, where gate gaps are filed: GitHub issues on the repo, through
// the gh CLI and the Owner's sign-in. A seam: tests pass a fake, so no test ever files a real issue.
import { spawnSync } from "node:child_process";
import { GATE_GAP_REPO } from "../ledger/model.ts";

export class TrackerError extends Error {}

export interface TrackerIssue {
  number: number;
  url: string;
  body: string;
}

export interface Tracker {
  /** Every issue carrying `label`, open or closed. */
  labelled(label: string): Promise<TrackerIssue[]>;
  /** Opens an issue; returns its number and URL. */
  create(issue: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
  /** Reopens a closed issue and says why, in a comment: an Upgrade wave whose release didn't close the gate gap for its Course. */
  reopen(issue: number, comment: string): Promise<void>;
}

export function ghTracker(repo: string = GATE_GAP_REPO): Tracker {
  const gh = (args: string[], input?: string): string => {
    const child = spawnSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      ...(input === undefined ? {} : { input }),
    });
    if (child.error) throw new TrackerError(`gh couldn't run: ${child.error.message}`);
    if (child.status !== 0) throw new TrackerError(child.stderr.trim() || `gh ${args[0]} exited ${child.status}`);
    return child.stdout;
  };
  return {
    async labelled(label) {
      const pages = JSON.parse(
        gh([
          "api",
          "--paginate",
          "--slurp",
          `repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`,
        ]),
      ) as { number: number; html_url: string; body: string | null; pull_request?: unknown }[][];
      return pages
        .flat()
        .filter((issue) => issue.pull_request === undefined)
        .map((issue) => ({ number: issue.number, url: issue.html_url, body: issue.body ?? "" }));
    },
    async create({ title, body, labels }) {
      const created = JSON.parse(
        gh(
          ["api", "--method", "POST", `repos/${repo}/issues`, "--input", "-"],
          JSON.stringify({ title, body, labels }),
        ),
      ) as { number: number; html_url: string };
      return { number: created.number, url: created.html_url };
    },
    async reopen(issue, comment) {
      gh(
        ["api", "--method", "PATCH", `repos/${repo}/issues/${issue}`, "--input", "-"],
        JSON.stringify({ state: "open" }),
      );
      gh(
        ["api", "--method", "POST", `repos/${repo}/issues/${issue}/comments`, "--input", "-"],
        JSON.stringify({ body: comment }),
      );
    },
  };
}
