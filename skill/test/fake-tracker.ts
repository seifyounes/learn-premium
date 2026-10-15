// A fake learn-premium tracker for the gate-gap tests: it keeps the issues it's asked to open, and
// can drop the connection right after opening one, the way a network failure mid-filing would.
import { TrackerError, type Tracker, type TrackerIssue } from "../scripts/gate-gap/tracker.ts";

export class FakeTracker implements Tracker {
  readonly issues: (TrackerIssue & { title: string; labels: string[] })[] = [];
  /** Throws after opening the next issue, as if the answer never came back. */
  dropAfterCreate = false;
  /** The issues an Upgrade wave reopened, with the comment it left. */
  readonly reopened: { number: number; comment: string }[] = [];
  /** Throws on the next reopen, as if GitHub refused. */
  failReopen = false;

  async reopen(issue: number, comment: string): Promise<void> {
    if (this.failReopen) {
      this.failReopen = false;
      throw new TrackerError("GitHub refused to reopen the issue");
    }
    this.reopened.push({ number: issue, comment });
  }

  async labelled(label: string): Promise<TrackerIssue[]> {
    return this.issues.filter((issue) => issue.labels.includes(label));
  }

  async create(issue: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }> {
    const number = this.issues.length + 1;
    const url = `https://github.com/seifyounes/learn-premium/issues/${number}`;
    this.issues.push({ ...issue, number, url });
    if (this.dropAfterCreate) {
      this.dropAfterCreate = false;
      throw new TrackerError("the connection dropped before GitHub answered");
    }
    return { number, url };
  }
}
