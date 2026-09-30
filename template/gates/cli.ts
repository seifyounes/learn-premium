// The one entry for every gate point: `npm run gates -- <command> …` from the template folder.
//
//   run      --point job|module|deploy [--module NN-slug] [--content DIR] [--dist DIR] [--report FILE]
//            Runs the point's gates and writes the Gate report, bound to the Course's HEAD commit.
//   verify   --point job|module|deploy [--module NN-slug] [--content DIR] [--report FILE] [--commit SHA]
//            Accepts the report only if it is green for that commit (HEAD by default).
//   controls [--content DIR] [--dist DIR]
//            Runs every gate on its positive fixture and on each of its negative controls.
//
// Exit codes: 0 green, 1 red, 2 bad usage.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GATES } from "./index.ts";
import {
  GATE_POINTS,
  runControls,
  runGates,
  verifyReport,
  type GateInput,
  type GatePoint,
  type GateReport,
} from "./runner.ts";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      point: { type: "string" },
      module: { type: "string" },
      content: { type: "string" },
      dist: { type: "string" },
      report: { type: "string" },
      commit: { type: "string" },
    },
  });
  const [command] = positionals;
  const contentDir = resolve(values.content ?? process.env.CONTENT_DIR ?? join(TEMPLATE_DIR, "../fixture-course"));
  const scope = values.module === undefined ? {} : { module: values.module };
  const input: GateInput = { contentDir, distDir: resolve(values.dist ?? join(TEMPLATE_DIR, "dist")), ...scope };

  const point = (): GatePoint => {
    const given = GATE_POINTS.find((p) => p === values.point);
    if (!given) throw new UsageError(`--point must be one of ${GATE_POINTS.join(", ")}`);
    return given;
  };
  // Reports sit in the Course's build records (committed, never deployed), one per point and Module.
  const reportPath = (p: GatePoint) =>
    resolve(
      values.report ??
        join(contentDir, "build-records", "gate-reports", `${[p, values.module].filter(Boolean).join("-")}.json`),
    );

  switch (command) {
    case "run": {
      const p = point();
      const { commit, dirty } = gitState(contentDir);
      const report = await runGates({ point: p, commit, dirty, input, gates: GATES });
      const path = reportPath(p);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
      printReport(report, path);
      return report.green ? 0 : 1;
    }
    case "verify": {
      const p = point();
      const path = reportPath(p);
      if (!existsSync(path)) {
        console.log(`red: no Gate report at ${path}; a gate that didn't run counts as failed`);
        return 1;
      }
      const commit = values.commit ?? gitState(contentDir).commit;
      const verdict = verifyReport(JSON.parse(readFileSync(path, "utf8")), {
        commit,
        point: p,
        gates: GATES,
        ...scope,
      });
      console.log(
        verdict.green ? `green: ${path} proves ${commit}` : `red: ${path}\n  ${verdict.problems.join("\n  ")}`,
      );
      return verdict.green ? 0 : 1;
    }
    case "controls": {
      const result = await runControls({ input, gates: GATES });
      for (const gate of result.gates) {
        console.log(`${gate.id}: positive fixture ${gate.positive}`);
        if (gate.controls.length === 0) console.log("  no negative control");
        for (const c of gate.controls) {
          console.log(`  ${c.caught ? "caught" : "MISSED"}  ${c.defect} (${c.status}${c.error ? `: ${c.error}` : ""})`);
        }
      }
      console.log(result.ok ? "negative controls: all caught" : "negative controls: FAILED");
      return result.ok ? 0 : 1;
    }
    default:
      throw new UsageError(`unknown command "${command ?? ""}"; use run, verify or controls`);
  }
}

/**
 * The commit the Course sits at, and whether its repo has changes outside the build records. A
 * report taken on changes is bound to no commit, so it is never green.
 */
function gitState(contentDir: string): { commit: string; dirty: boolean } {
  const git = (...args: string[]) => spawnSync("git", ["-C", contentDir, ...args], { encoding: "utf8" });
  const head = git("rev-parse", "HEAD");
  if (head.status !== 0) throw new Error(`${contentDir} is not in a git repository: ${head.stderr.trim()}`);
  const status = git("status", "--porcelain", "--", ":(top)", ":(top,exclude,glob)**/build-records/**");
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr.trim()}`);
  return { commit: head.stdout.trim(), dirty: status.stdout.trim() !== "" };
}

function printReport(report: GateReport, path: string) {
  const scope = report.module ?? "the whole Course";
  console.log(`${report.point} gates on ${scope} at ${report.commit}${report.dirty ? " (uncommitted changes)" : ""}`);
  if (report.gates.length === 0) console.log("  no gate runs at this point");
  for (const gate of report.gates) {
    const covered = Object.entries(gate.coverage)
      .map(([kind, n]) => `${n} ${kind}`)
      .join(", ");
    const error = gate.error ? `: ${gate.error}` : "";
    console.log(`  ${gate.status.padEnd(10)} ${gate.id}${covered ? ` (${covered})` : ""}${error}`);
    for (const f of gate.findings) console.log(`    ${f.outcome}: ${f.at ? `${f.at} ` : ""}${f.message}`);
  }
  console.log(`${report.green ? "green" : "red"}: report written to ${path}`);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
