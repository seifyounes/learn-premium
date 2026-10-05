// The deploy tooling: `npm run deploy -- <command> …` from the template folder.
//
//   licences     [--dist DIR]
//                Refreshes the committed Licences file (public/licences.txt) from the build's.
//   await-live   --sha SHA [--timeout-s N]
//                Waits until production serves Vercel's deployment of SHA, so the live gates check
//                that build and not another. Writes `state`: `live` (and `deployment`), or
//                `superseded` when a newer deployment already took production over (its own run
//                checks it). On failure it writes `reason` for the Owner's issue.
//   verdict      --sha SHA --deployment ID --live-url URL [--report FILE] [--drill] [--out DIR] [--run-url URL]
//                Settles a live gate run, only while production still serves that deployment
//                (otherwise it's superseded and does nothing): green marks the commit green (the
//                rollback's "last green");
//                red marks it red, rolls Vercel back to the last green deployment and writes the
//                Owner's report to DIR (issue-title.txt, issue-body.md). A drill does the same but
//                leaves the commit's mark alone: the drill proves the rollback, not the commit.
//   performance  [--url URL] [--dist DIR] [--lighthouse] [--out FILE]
//                Reports initial JS, LCP and (with --lighthouse) Lighthouse per page. Never blocks.
//
// await-live and verdict read VERCEL_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID (none for a
// personal account); verdict also reads GITHUB_TOKEN and GITHUB_REPOSITORY.
// Exit codes: 0 done (a green verdict), 1 failed (a red verdict), 2 bad usage.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { baseUrl } from "../gates/live.ts";
import { serveLikeVercel } from "../gates/live/vercel-like.ts";
import { pagesOf } from "../gates/pages.ts";
import type { GateReport } from "../gates/runner.ts";
import { readVercelConfig } from "../gates/vercel-config.ts";
import { GitHub } from "./github.ts";
import { commitLicences } from "./licences.ts";
import { measure, performanceMarkdown } from "./performance.ts";
import { ownerReport, rollBackFrom } from "./rollback.ts";
import { Vercel } from "./vercel.ts";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

class UsageError extends Error {}

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new UsageError(`${name} is not set`);
  return value;
}

const vercel = () =>
  new Vercel({
    token: env("VERCEL_TOKEN"),
    projectId: env("VERCEL_PROJECT_ID"),
    ...(process.env["VERCEL_TEAM_ID"] ? { teamId: process.env["VERCEL_TEAM_ID"] } : {}),
  });

/** Writes `name=value` for a later GitHub Actions step, when running in one. */
function output(name: string, value: string) {
  const file = process.env["GITHUB_OUTPUT"];
  if (file) appendFileSync(file, `${name}=${value}\n`);
  console.log(`${name}=${value}`);
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dist: { type: "string" },
      sha: { type: "string" },
      deployment: { type: "string" },
      "timeout-s": { type: "string" },
      "live-url": { type: "string" },
      report: { type: "string" },
      drill: { type: "boolean" },
      out: { type: "string" },
      "run-url": { type: "string" },
      url: { type: "string" },
      lighthouse: { type: "boolean" },
    },
  });
  const [command] = positionals;
  const distDir = resolve(values.dist ?? join(TEMPLATE_DIR, "dist"));
  const sha = () => {
    if (values.sha === undefined) throw new UsageError("--sha is required");
    return values.sha;
  };

  switch (command) {
    case "licences": {
      const { path, changed } = commitLicences(distDir, TEMPLATE_DIR);
      console.log(changed ? `updated ${path}: commit it` : `${path} is already the build's`);
      return 0;
    }

    case "await-live": {
      const commit = sha();
      const timeout = Number(values["timeout-s"] ?? 900);
      if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError("--timeout-s must be a number of seconds");
      const deadline = Date.now() + timeout * 1000;
      const api = vercel();
      const fail = (reason: string) => {
        output("reason", reason);
        return 1;
      };
      for (;;) {
        const [deployment] = await api.productionDeployments({ sha: commit, limit: 5 });
        if (deployment?.readyState === "READY") {
          const { current } = await api.production();
          if (current === deployment.uid) {
            output("state", "live");
            output("deployment", deployment.uid);
            return 0;
          }
          const serving = (await api.productionDeployments({ limit: 20 })).find((d) => d.uid === current);
          if (serving !== undefined && serving.created > deployment.created) {
            console.log(`a newer deployment (${serving.uid}) serves production; its own run checks it`);
            output("state", "superseded");
            return 0;
          }
        }
        if (deployment !== undefined && ["ERROR", "CANCELED"].includes(deployment.readyState))
          return fail(`the production deployment of ${commit} ended ${deployment.readyState}`);
        if (Date.now() > deadline) {
          return fail(
            deployment?.readyState === "READY"
              ? `the production deployment of ${commit} is ready but production never moved to it: Vercel stops promoting new pushes after a rollback, so undo the rollback (Undo Rollback, or vercel promote ${deployment.uid})`
              : `no production deployment of ${commit} went live within ${timeout}s`,
          );
        }
        await sleep(15_000);
      }
    }

    case "verdict": {
      const commit = sha();
      const liveUrl = values["live-url"];
      if (liveUrl === undefined) throw new UsageError("--live-url is required");
      const deployment = values.deployment;
      if (deployment === undefined) throw new UsageError("--deployment is required");
      const api = vercel();
      // The gates checked the live URL: their verdict is this deployment's only while it serves it.
      const { current } = await api.production();
      if (current !== deployment) {
        console.log(`superseded: production now serves ${current ?? "another deployment"}, not ${deployment}`);
        output("state", "superseded");
        return 0;
      }
      const report =
        values.report !== undefined && existsSync(values.report)
          ? (JSON.parse(readFileSync(values.report, "utf8")) as GateReport)
          : undefined;
      const drill = values.drill === true;
      const github = new GitHub({ token: env("GITHUB_TOKEN"), repository: env("GITHUB_REPOSITORY") });
      const runUrl = values["run-url"];
      /** The commit's mark is what later rollbacks read; failing to set it never blocks a rollback. */
      const mark = async (state: "success" | "failure", description: string) => {
        try {
          await github.markLiveGates(commit, state, description, runUrl);
          return undefined;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`::warning::couldn't mark ${commit} ${state}: ${message}`);
          return message;
        }
      };
      const green = report !== undefined && report.green && report.commit === commit && !drill;
      if (green) {
        await mark("success", `live gates green on ${liveUrl}`);
        console.log(`green: ${commit} passed the live gates on ${liveUrl}`);
        return 0;
      }
      const unmarked = drill ? undefined : await mark("failure", `live gates red on ${liveUrl}`);
      const outcome = await rollBackFrom(
        commit,
        drill ? "learn-premium rollback drill" : "learn-premium live gates red",
        { vercel: api, passedLiveGates: (s) => github.passedLiveGates(s) },
      );
      const issue = ownerReport({ sha: commit, liveUrl, report, outcome, drill, ...(runUrl ? { runUrl } : {}) });
      const body =
        unmarked === undefined
          ? issue.body
          : `${issue.body}\nThe commit's live-gates status couldn't be set: ${unmarked}\n`;
      const out = resolve(values.out ?? ".");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "issue-title.txt"), `${issue.title}\n`);
      writeFileSync(join(out, "issue-body.md"), body);
      console.log(`red: ${issue.title}\n\n${body}`);
      return 1;
    }

    case "performance": {
      const routes = pagesOf(distDir).map((p) => p.route);
      const site =
        values.url === undefined
          ? await serveLikeVercel(distDir, readVercelConfig(TEMPLATE_DIR))
          : { url: baseUrl(values.url), close: async () => {} };
      try {
        const report = await measure(site.url, routes, {
          lighthouseRoutes: values.lighthouse ? routes.filter((r) => r === "/" || r === "/tool-gallery/") : [],
        });
        const markdown = performanceMarkdown(report);
        console.log(markdown);
        const summary = process.env["GITHUB_STEP_SUMMARY"];
        if (summary) appendFileSync(summary, `${markdown}\n`);
        if (values.out !== undefined) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
      } finally {
        await site.close();
      }
      return 0;
    }

    default:
      throw new UsageError(`unknown command "${command ?? ""}"; use licences, await-live, verdict or performance`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
