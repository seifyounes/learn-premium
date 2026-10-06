// The Template release sequence through its command interface: CI green → the Fixture Course's
// Tool gallery deployed with its live gates green → the Owner's real-phone pass → tag. Real git
// (a throwaway repo and its bare origin) and an in-memory GitHub.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { run } from "../scripts/release/cli.ts";
import { RepoGit } from "../scripts/release/git.ts";
import {
  LIVE_CONTEXT,
  PHONE_PASS_CONTEXT,
  REQUIRED_WORKFLOWS,
  type CommitStatus,
  type Forge,
  type GateGapIssue,
  type WorkflowRun,
} from "../scripts/release/sequence.ts";
import { tempDir, writeFiles } from "./helpers.ts";

// Each case drives real git through a dozen commands, which Windows runs slowly under load.
vi.setConfig({ testTimeout: 60_000 });

const OWNER = "seifyounes";

function git(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout.trim();
}

/** GitHub as the release sequence sees it, in memory. */
class FakeForge implements Forge {
  runsBySha = new Map<string, WorkflowRun[]>();
  statusesBySha = new Map<string, CommitStatus[]>();
  gaps: GateGapIssue[] = [];
  releases: { tag: string; title: string; notes: string }[] = [];
  viewerLogin = OWNER;
  gallery: string | null = "https://fixture-abc123.example.app/tool-gallery/";
  clock = 0;

  async runs(sha: string) {
    return this.runsBySha.get(sha) ?? [];
  }
  async statuses(sha: string) {
    return this.statusesBySha.get(sha) ?? [];
  }
  async setStatus(
    sha: string,
    status: { state: string; context: string; description: string; targetUrl: string | null },
  ) {
    this.addStatus(sha, { ...status, creator: this.viewerLogin });
  }
  async owner() {
    return OWNER;
  }
  async viewer() {
    return this.viewerLogin;
  }
  async closedGateGaps() {
    return this.gaps;
  }
  async galleryUrl() {
    return this.gallery;
  }
  async createRelease(tag: string, title: string, notes: string) {
    this.releases.push({ tag, title, notes });
    return `https://github.example/releases/${tag}`;
  }

  addRun(sha: string, workflow: string, conclusion: string | null) {
    const list = this.runsBySha.get(sha) ?? [];
    list.push({
      workflow,
      status: conclusion === null ? "in_progress" : "completed",
      conclusion,
      createdAt: new Date(Date.UTC(2026, 9, 7, 0, 0, this.clock)).toISOString(),
      startedAt: new Date(Date.UTC(2026, 9, 7, 0, 0, this.clock++)).toISOString(),
      url: `https://github.example/runs/${this.clock}`,
    });
    this.runsBySha.set(sha, list);
  }
  /** Newest first, the way GitHub lists a commit's statuses. */
  addStatus(sha: string, status: Omit<CommitStatus, "createdAt">) {
    const createdAt = new Date(Date.UTC(2026, 9, 7, 1, 0, this.clock++)).toISOString();
    this.statusesBySha.set(sha, [{ ...status, createdAt }, ...(this.statusesBySha.get(sha) ?? [])]);
  }
  ciGreen(sha: string) {
    for (const workflow of REQUIRED_WORKFLOWS) this.addRun(sha, workflow, "success");
  }
  liveGreen(sha: string) {
    this.addStatus(sha, {
      context: LIVE_CONTEXT,
      state: "success",
      description: "live gates green",
      targetUrl: null,
      creator: "github-actions[bot]",
    });
  }
  ownerPass(sha: string, creator = OWNER) {
    this.addStatus(sha, {
      context: PHONE_PASS_CONTEXT,
      state: "success",
      description: "iPhone 13 Safari · Pyodide 14 s",
      targetUrl: this.gallery,
      creator,
    });
  }
}

/** A learn-premium-shaped repo with a bare origin, `main` pushed. */
function repo() {
  const origin = tempDir("origin");
  git(origin, "init", "-q", "--bare", "-b", "main");
  const work = tempDir("work");
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "owner@example.com");
  git(work, "config", "user.name", "Owner");
  git(work, "config", "core.autocrlf", "false");
  git(work, "remote", "add", "origin", origin);
  const forge = new FakeForge();
  let answer = true;
  const commit = (message: string, files: Record<string, string> = {}) => {
    writeFiles(work, { "README.md": `${message}\n`, ...files });
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", message);
    git(work, "push", "-q", "origin", "HEAD:main");
    return git(work, "rev-parse", "HEAD");
  };
  const release = async (...args: string[]) => {
    const asked: string[] = [];
    const result = await run(args, {
      git: new RepoGit(work),
      forge,
      confirm: async (question) => {
        asked.push(question);
        return answer;
      },
    });
    return { ...result, asked };
  };
  const originTags = () => git(origin, "tag", "--list");
  return {
    work,
    origin,
    forge,
    commit,
    release,
    originTags,
    answer: (value: boolean) => {
      answer = value;
    },
  };
}

/** A candidate with CI green and its Tool gallery live and green: everything but the phone pass. */
function readyButForThePass(r: ReturnType<typeof repo>, message = "the template") {
  const sha = r.commit(message);
  r.forge.ciGreen(sha);
  r.forge.liveGreen(sha);
  return sha;
}

describe("status", () => {
  test("walks the sequence in order and names what's missing on the candidate", async () => {
    const r = repo();
    const sha = r.commit("the template");
    r.forge.addRun(sha, REQUIRED_WORKFLOWS[0] ?? "", "success");
    const { code, stdout } = await r.release("status");
    expect(code).toBe(1);
    expect(stdout).toContain(`Candidate ${sha} (origin/main)`);
    expect(stdout).toMatch(/1\. CI green: no/);
    expect(stdout).toContain("gh workflow run skill-ci.yml --ref main");
    expect(stdout).toContain("gh workflow run migration-harness.yml --ref main");
    expect(stdout).toMatch(/2\. Tool gallery deployed, live gates green: no/);
    expect(stdout).toMatch(/3\. Real-phone pass: no/);
    expect(stdout).toMatch(/not ready to tag/);
  });

  test("counts only the newest run of each workflow: a re-run that failed is red", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.forge.addRun(sha, REQUIRED_WORKFLOWS[1] ?? "", "failure");
    const { stdout } = await r.release("status");
    expect(stdout).toMatch(/1\. CI green: no/);
    expect(stdout).toMatch(/skill-ci\.yml: failure/);
  });

  test("counts a re-run's latest attempt, though the run was created before a newer green one", async () => {
    const r = repo();
    const sha = r.commit("the template");
    r.forge.addRun(sha, REQUIRED_WORKFLOWS[0] ?? "", "success");
    r.forge.ciGreen(sha);
    r.forge.liveGreen(sha);
    r.forge.ownerPass(sha);
    // The first Template CI run is re-run after the second one went green, and its new attempt fails.
    const first = r.forge.runsBySha.get(sha)?.[0];
    if (first === undefined) throw new Error("no run");
    Object.assign(first, { conclusion: "failure", startedAt: "2026-10-08T00:00:00.000Z" });
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code).toBe(1);
    expect(stdout).toMatch(/template-ci\.yml: failure/);
    expect(r.originTags()).toBe("");
  });

  test("points the Owner at the Tool gallery and the command that records the pass once 1 and 2 are green", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    const { code, stdout } = await r.release("status");
    expect(code).toBe(1);
    expect(stdout).toMatch(/1\. CI green: yes/);
    expect(stdout).toMatch(/2\. Tool gallery deployed, live gates green: yes/);
    expect(stdout).toContain("https://fixture-abc123.example.app/tool-gallery/");
    expect(stdout).toContain(`record-phone-pass --sha ${sha}`);
  });
});

describe("tag", () => {
  test("refuses to tag without a recorded real-phone pass, and creates no tag", async () => {
    const r = repo();
    readyButForThePass(r);
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code).toBe(1);
    expect(stdout).toMatch(/refused/);
    expect(stdout).toMatch(/3\. Real-phone pass: no/);
    expect(r.originTags()).toBe("");
    expect(git(r.work, "tag", "--list")).toBe("");
    expect(r.forge.releases).toEqual([]);
  });

  test("refuses when CI or the live gates aren't green, even with a pass recorded", async () => {
    const r = repo();
    const sha = r.commit("the template");
    r.forge.ciGreen(sha);
    r.forge.ownerPass(sha);
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code).toBe(1);
    expect(stdout).toMatch(/2\. Tool gallery deployed, live gates green: no/);
    expect(r.originTags()).toBe("");
  });

  test("counts a pass only on the exact commit it was recorded on", async () => {
    const r = repo();
    const passed = readyButForThePass(r, "the tested template");
    r.forge.ownerPass(passed);
    readyButForThePass(r, "a later merge");
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code).toBe(1);
    expect(stdout).toMatch(/3\. Real-phone pass: no/);
    expect(r.originTags()).toBe("");
  });

  test("counts a pass only when the Owner recorded it", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.forge.ownerPass(sha, "github-actions[bot]");
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code).toBe(1);
    expect(stdout).toMatch(/recorded by @github-actions\[bot\], not the Owner/);
  });

  test("cuts the first release, v0.1.0, as an annotated tag on origin with its notes, and a GitHub Release", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.forge.ownerPass(sha);
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code, stdout).toBe(0);
    expect(r.originTags()).toBe("v0.1.0");
    expect(git(r.origin, "rev-parse", "v0.1.0^{commit}")).toBe(sha);
    expect(git(r.origin, "cat-file", "-t", "v0.1.0")).toBe("tag");
    const message = git(r.origin, "tag", "-l", "--format=%(contents)", "v0.1.0");
    expect(message).toContain("# Template release v0.1.0");
    expect(message).toContain("## Gate gaps closed");
    expect(message).toContain("## Course overrides retired");
    expect(message).toContain("iPhone 13 Safari · Pyodide 14 s");
    expect(r.forge.releases).toMatchObject([{ tag: "v0.1.0", title: "learn-premium v0.1.0" }]);
    expect(stdout).toContain("tagged v0.1.0");
  });

  test("--dry-run checks everything and prints the notes, but tags nothing", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.forge.ownerPass(sha);
    const { code, stdout } = await r.release("tag", "--bump", "minor", "--dry-run");
    expect(code).toBe(0);
    expect(stdout).toContain("# Template release v0.1.0");
    expect(stdout).toContain("dry run: v0.1.0 not tagged");
    expect(r.originTags()).toBe("");
    expect(r.forge.releases).toEqual([]);
  });

  test("bumps from origin's latest release, and refuses a tag origin already has", async () => {
    const r = repo();
    const first = readyButForThePass(r);
    r.forge.ownerPass(first);
    expect((await r.release("tag", "--bump", "minor")).code).toBe(0);
    const second = readyButForThePass(r, "a patch");
    r.forge.ownerPass(second);
    const dup = await r.release("tag", "--version", "v0.1.0");
    expect(dup.code).toBe(1);
    expect(dup.stdout).toMatch(/v0\.1\.0 is not newer than the latest release v0\.1\.0/);
    const { code } = await r.release("tag", "--bump", "patch");
    expect(code).toBe(0);
    expect(r.originTags().split("\n")).toEqual(["v0.1.0", "v0.1.1"]);
  });

  test("refuses a candidate that isn't on origin's main", async () => {
    const r = repo();
    readyButForThePass(r);
    git(r.work, "switch", "-q", "-c", "side");
    writeFileSync(join(r.work, "side.txt"), "side\n");
    git(r.work, "add", "-A");
    git(r.work, "commit", "-q", "-m", "side");
    git(r.work, "push", "-q", "origin", "side");
    const side = git(r.work, "rev-parse", "HEAD");
    r.forge.ciGreen(side);
    r.forge.liveGreen(side);
    r.forge.ownerPass(side);
    const { code, stdout } = await r.release("tag", "--bump", "minor", "--sha", side);
    expect(code).toBe(1);
    expect(stdout).toMatch(/not on origin\/main/);
  });
});

describe("majors and migrations", () => {
  /** v0.1.0 released, then a candidate with `files`, green up to and including its pass. */
  async function afterFirstRelease(files: Record<string, string>) {
    const r = repo();
    const first = readyButForThePass(r);
    r.forge.ownerPass(first);
    expect((await r.release("tag", "--bump", "minor")).code).toBe(0);
    const sha = r.commit("the next release", files);
    r.forge.ciGreen(sha);
    r.forge.liveGreen(sha);
    r.forge.ownerPass(sha);
    return r;
  }

  const MIGRATION = `export const describe = "sims gain a units block";\nexport function migrate(): void {}\n`;

  test("a major release needs the migration for its major", async () => {
    const r = await afterFirstRelease({});
    const { code, stdout } = await r.release("tag", "--bump", "major");
    expect(code).toBe(1);
    expect(stdout).toMatch(/v1\.0\.0 is a major release but ships no template\/migrations\/v1\.ts/);
  });

  test("a release that ships a migration must be a major", async () => {
    const r = await afterFirstRelease({ "template/migrations/v1.ts": MIGRATION });
    const { code, stdout } = await r.release("tag", "--bump", "minor");
    expect(code).toBe(1);
    expect(stdout).toMatch(/ships template\/migrations\/v1\.ts, so it must be a major release/);
  });

  test("a major with its migration tags, and its notes list the migration", async () => {
    const r = await afterFirstRelease({ "template/migrations/v1.ts": MIGRATION });
    const { code, stdout } = await r.release("tag", "--bump", "major");
    expect(code, stdout).toBe(0);
    const message = git(r.origin, "tag", "-l", "--format=%(contents)", "v1.0.0");
    expect(message).toContain("## Migrations\n\n- v1: sims gain a units block");
  });
});

describe("notes", () => {
  test("list the gate gaps closed since the previous release, with the overrides they retire", async () => {
    const r = repo();
    const first = r.commit("feat: a gate for #3 (ticket #3)");
    r.forge.ciGreen(first);
    r.forge.liveGreen(first);
    r.forge.ownerPass(first);
    expect((await r.release("tag", "--bump", "minor")).code).toBe(0);
    r.commit("fix: the overflow gate (ticket #12)");
    r.commit("fix: STL *I gated, closing gate gap #15");
    r.commit("docs: mention #40, which isn't a gate gap");
    r.forge.gaps = [
      { number: 3, title: "Already released", body: null, stateReason: "completed" },
      {
        number: 12,
        title: "Summary beat figure overflows at 320 px",
        body: "Course: Machine Learning\nCourse override: `src/components/Beat.astro`\n",
        stateReason: "completed",
      },
      { number: 15, title: "STL *I not gated", body: "No override.", stateReason: "completed" },
      { number: 16, title: "Won't fix", body: null, stateReason: "not_planned" },
      { number: 17, title: "Closed but no commit names it", body: null, stateReason: "completed" },
    ];
    const { code, stdout } = await r.release("notes", "--bump", "minor");
    expect(code).toBe(0);
    expect(stdout).toContain(
      "## Gate gaps closed\n\n- #12 Summary beat figure overflows at 320 px\n- #15 STL *I not gated\n",
    );
    expect(stdout).toContain("- `src/components/Beat.astro` (Machine Learning), gate gap #12");
    expect(stdout).toContain("- Gate gap #15: no Course override recorded on the issue");
    expect(stdout).not.toMatch(/#3 Already released|#16|#40 /);
    expect(stdout).toMatch(/check: gate gap #17 is closed but no commit up to .* names it/);
  });

  test("an Owner-edited notes file is used as written, and must keep both sections", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.forge.ownerPass(sha);
    const file = join(tempDir("notes"), "notes.md");
    const out = await r.release("notes", "--bump", "minor", "--out", file);
    expect(out.code).toBe(0);
    writeFileSync(file, readFileSync(file, "utf8").replace("## Gate gaps closed", "## Fixed"));
    const broken = await r.release("tag", "--bump", "minor", "--notes", file);
    expect(broken.code).toBe(1);
    expect(broken.stdout).toMatch(/no "## Gate gaps closed" section/);
    expect(r.originTags()).toBe("");
    writeFileSync(file, readFileSync(file, "utf8").replace("## Fixed", "## Gate gaps closed\n\nNone, said the Owner."));
    expect((await r.release("tag", "--bump", "minor", "--notes", file)).code).toBe(0);
    expect(git(r.origin, "tag", "-l", "--format=%(contents)", "v0.1.0")).toContain("None, said the Owner.");
  });

  test("a draft made before the phone pass is tagged with the pass as recorded", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    const file = join(tempDir("notes"), "notes.md");
    expect((await r.release("notes", "--bump", "minor", "--out", file)).code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("Not recorded yet.");
    r.forge.ownerPass(sha);
    expect((await r.release("tag", "--bump", "minor", "--notes", file)).code).toBe(0);
    const message = git(r.origin, "tag", "-l", "--format=%(contents)", "v0.1.0");
    expect(message).toContain("## Real-phone pass\n\niPhone 13 Safari · Pyodide 14 s\n\nRecorded by @seifyounes");
    expect(message).not.toContain("Not recorded yet.");
  });

  test("a notes file written for another version or commit is refused", async () => {
    const r = repo();
    const drafted = readyButForThePass(r, "the drafted candidate");
    const file = join(tempDir("notes"), "notes.md");
    expect((await r.release("notes", "--bump", "minor", "--out", file)).code).toBe(0);
    const later = readyButForThePass(r, "a later merge");
    r.forge.ownerPass(later);
    const stale = await r.release("tag", "--bump", "minor", "--notes", file);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain(`is written for commit ${drafted}, not ${later}`);
    const otherVersion = await r.release("tag", "--bump", "major", "--notes", file);
    expect(otherVersion.code).toBe(1);
    expect(otherVersion.stdout).toMatch(/is written for v0\.1\.0, not v1\.0\.0/);
    expect(r.originTags()).toBe("");
  });
});

describe("record-phone-pass", () => {
  test("refuses before CI is green and the Tool gallery is live and green on that commit", async () => {
    const r = repo();
    const sha = r.commit("the template");
    r.forge.ciGreen(sha);
    const { code, stdout } = await r.release(
      "record-phone-pass",
      "--sha",
      sha,
      "--devices",
      "iPhone 13 Safari",
      "--pyodide-seconds",
      "14",
    );
    expect(code).toBe(1);
    expect(stdout).toMatch(/2\. Tool gallery deployed, live gates green: no/);
    expect(r.forge.statusesBySha.get(sha)?.some((s) => s.context === PHONE_PASS_CONTEXT) ?? false).toBe(false);
  });

  test("records nothing unless the Owner confirms, in a terminal, that the phone pass happened", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.answer(false);
    const { code, stdout, asked } = await r.release(
      "record-phone-pass",
      "--sha",
      sha,
      "--devices",
      "iPhone 13 Safari",
      "--pyodide-seconds",
      "14",
    );
    expect(code).toBe(1);
    expect(asked[0]).toContain("https://fixture-abc123.example.app/tool-gallery/");
    expect(stdout).toMatch(/not recorded/);
    expect(r.forge.statusesBySha.get(sha)?.some((s) => s.context === PHONE_PASS_CONTEXT)).toBe(false);
  });

  test("is the Owner's alone: another account can't record it", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    r.forge.viewerLogin = "a-collaborator";
    const { code, stdout } = await r.release(
      "record-phone-pass",
      "--sha",
      sha,
      "--devices",
      "iPhone 13 Safari",
      "--pyodide-seconds",
      "14",
    );
    expect(code).toBe(1);
    expect(stdout).toMatch(/only the Owner \(@seifyounes\)/);
  });

  test("records the devices and the Pyodide timing on the commit, and then tag goes through", async () => {
    const r = repo();
    const sha = readyButForThePass(r);
    const { code } = await r.release(
      "record-phone-pass",
      "--sha",
      sha,
      "--devices",
      "iPhone 13 Safari, Pixel 7 Chrome",
      "--pyodide-seconds",
      "14",
    );
    expect(code).toBe(0);
    expect(r.forge.statusesBySha.get(sha)?.[0]).toMatchObject({
      context: PHONE_PASS_CONTEXT,
      state: "success",
      description: "iPhone 13 Safari, Pixel 7 Chrome · Pyodide 14 s",
      targetUrl: "https://fixture-abc123.example.app/tool-gallery/",
      creator: OWNER,
    });
    const tagged = await r.release("tag", "--bump", "minor");
    expect(tagged.code, tagged.stdout).toBe(0);
    expect(git(r.origin, "tag", "-l", "--format=%(contents)", "v0.1.0")).toContain(
      "iPhone 13 Safari, Pixel 7 Chrome · Pyodide 14 s",
    );
  });

  test("takes its commit, devices and timing explicitly", async () => {
    const r = repo();
    readyButForThePass(r);
    const { code, stdout } = await r.release("record-phone-pass", "--devices", "iPhone 13 Safari");
    expect(code).toBe(2);
    expect(stdout).toMatch(/--sha/);
  });
});
