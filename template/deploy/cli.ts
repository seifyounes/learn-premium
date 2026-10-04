// The deploy tooling: `npm run deploy -- <command> …` from the template folder.
//
//   licences     [--dist DIR]
//                Refreshes the committed Licences file (public/licences.txt) from the build's.
//   await-live   --sha SHA [--timeout-s N]
//                Waits until Vercel's production deployment of SHA is ready and holds the production
//                domains, so the live gates check that build and not the one before it.
//   verdict      --sha SHA --live-url URL [--report FILE] [--drill] [--out DIR] [--run-url URL]
//                Settles a live gate run: green marks the commit green (the rollback's "last green");
//                red (or a drill) marks it red, rolls Vercel back to the last green deployment and
//                writes the Owner's report to DIR (issue-title.txt, issue-body.md).
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
import { serveLikeVercel } from "../gates/live/vercel-like.ts";
import { sitePages } from "../gates/pages.ts";
import { readVercelConfig } from "../gates/private-files.ts";
import type { GateReport } from "../gates/runner.ts";
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
      const deadline = Date.now() + Number(values["timeout-s"] ?? 900) * 1000;
      const api = vercel();
      for (;;) {
        const [deployment] = await api.productionDeployments({ sha: commit, limit: 5 });
        if (deployment?.readyState === "READY" && deployment.aliasAssigned !== null) {
          output("deployment", deployment.uid);
          return 0;
        }
        if (deployment !== undefined && ["ERROR", "CANCELED"].includes(deployment.readyState)) {
          console.log(`the production deployment of ${commit} ended ${deployment.readyState}`);
          return 1;
        }
        if (Date.now() > deadline) {
          console.log(`no production deployment of ${commit} went live in time`);
          return 1;
        }
        await sleep(15_000);
      }
    }

    case "verdict": {
      const commit = sha();
      const liveUrl = values["live-url"];
      if (liveUrl === undefined) throw new UsageError("--live-url is required");
      const report =
        values.report !== undefined && existsSync(values.report)
          ? (JSON.parse(readFileSync(values.report, "utf8")) as GateReport)
          : undefined;
      const drill = values.drill === true;
      const github = new GitHub({ token: env("GITHUB_TOKEN"), repository: env("GITHUB_REPOSITORY") });
      const runUrl = values["run-url"];
      const green = report !== undefined && report.green && report.commit === commit && !drill;
      if (green) {
        await github.markLiveGates(commit, "success", `live gates green on ${liveUrl}`, runUrl);
        console.log(`green: ${commit} passed the live gates on ${liveUrl}`);
        return 0;
      }
      await github.markLiveGates(commit, "failure", drill ? "rollback drill" : `live gates red on ${liveUrl}`, runUrl);
      const outcome = await rollBackFrom(
        commit,
        drill ? "learn-premium rollback drill" : "learn-premium live gates red",
        {
          vercel: vercel(),
          passedLiveGates: (s) => github.passedLiveGates(s),
        },
      );
      const issue = ownerReport({ sha: commit, liveUrl, report, outcome, drill, ...(runUrl ? { runUrl } : {}) });
      const out = resolve(values.out ?? ".");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "issue-title.txt"), `${issue.title}\n`);
      writeFileSync(join(out, "issue-body.md"), issue.body);
      console.log(`red: ${issue.title}\n\n${issue.body}`);
      return 1;
    }

    case "performance": {
      const routes = sitePages({ contentDir: TEMPLATE_DIR, distDir }).map((p) => p.route);
      const site =
        values.url === undefined
          ? await serveLikeVercel(distDir, readVercelConfig({ contentDir: TEMPLATE_DIR }))
          : { url: values.url.replace(/\/+$/, ""), close: async () => {} };
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
