// The host step, run only on the Owner's word: the Course project's private GitHub repo and its Vercel
// project (building the template layer from the Course's content), the first deploy of `main`, and a
// check that the live site answers with noindex. It makes nothing twice, so a failed run is re-run.
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { TEMPLATE_DIR } from "../ledger/model.ts";
import type { Hosting, LivePage } from "./hosting.ts";
import { CONTENT_DIR } from "./scaffold.ts";

function git(project: string, ...args: string[]): { ok: boolean; out: string } {
  const child = spawnSync("git", ["-C", project, ...args], { encoding: "utf8" });
  if (child.error !== undefined) throw child.error;
  return { ok: child.status === 0, out: child.stdout.trim() };
}

/** What the live home page lacks to be hidden from search engines: an empty list when it's noindex. */
export function noindexFindings(url: string, page: LivePage): string[] {
  if (page.status !== 200) return [`${url} answered ${page.status}`];
  const findings: string[] = [];
  if (!/\bnoindex\b/i.test(page.robotsHeader ?? ""))
    findings.push(`${url} answered without an X-Robots-Tag: noindex header`);
  const metas = page.html.match(/<meta\b[^>]*>/gi) ?? [];
  const robots = metas.some((tag) => /name=["']?robots["']?/i.test(tag) && /content=["'][^"']*\bnoindex\b/i.test(tag));
  if (!robots) findings.push(`${url} has no <meta name="robots" content="noindex…">`);
  return findings;
}

export async function host(projectPath: string, hosting: Hosting) {
  const project = resolve(projectPath);
  const ledger = requireLedger(project);
  const name = basename(project);
  if (git(project, "status", "--porcelain").out !== "") {
    throw new LedgerError(
      "refused",
      `${project} has uncommitted changes: commit them first, the live site is what main holds`,
    );
  }
  if (git(project, "branch", "--show-current").out !== "main") {
    throw new LedgerError("refused", `${project} isn't on main: the live site is built from main`);
  }

  // Everything is checked before anything is made.
  const repo = `${await hosting.githubOwner()}/${name}`;
  const remote = `https://github.com/${repo}.git`;
  const origin = git(project, "remote", "get-url", "origin");
  const visibility = await hosting.repoVisibility(repo);
  if (visibility !== null && (!origin.ok || origin.out !== remote)) {
    throw new LedgerError(
      "refused",
      `${repo} already exists on GitHub and isn't this Course project's origin; choose another slug`,
    );
  }
  if (visibility === "public") {
    throw new LedgerError(
      "refused",
      `${repo} is public; a Course project's repo stays private until its Go-public check`,
    );
  }
  if (visibility === null && origin.ok && origin.out !== remote) {
    throw new LedgerError("refused", `${project}'s origin is already ${origin.out}`);
  }
  const existing = await hosting.vercelProject(name);
  if (existing !== null && existing.repo !== repo) {
    throw new LedgerError(
      "refused",
      `the Vercel project ${name} is linked to ${existing.repo ?? "no repo"}, not ${repo}`,
    );
  }

  if (visibility === null) {
    await hosting.createPrivateRepo(repo, `Study site for ${ledger.intake.courseName} (learn-premium)`);
    if ((await hosting.repoVisibility(repo)) !== "private") {
      throw new LedgerError("refused", `GitHub didn't make ${repo} private; nothing was pushed`);
    }
    if (!origin.ok) git(project, "remote", "add", "origin", remote);
  }
  await hosting.pushMain(project, repo);
  const commit = git(project, "rev-parse", "HEAD").out;

  const vercel =
    existing ??
    (await hosting.createVercelProject({
      name,
      repo,
      rootDirectory: TEMPLATE_DIR,
      env: { CONTENT_DIR: `../${CONTENT_DIR}` },
    }));
  await hosting.ensureProductionDeployment({ id: vercel.id, name }, repo, commit);
  const { url } = await hosting.awaitProduction(vercel.id, commit);
  const findings = noindexFindings(url, await hosting.fetchPage(url));

  return {
    code: findings.length === 0 ? 0 : 1,
    repo,
    vercelProject: vercel.id,
    url,
    commit,
    created: { repo: visibility === null, vercelProject: existing === null },
    findings,
  };
}
