// The STL build oracle: runs every STL listing in awlsim and keeps what it did, statement by
// statement, as the listing's oracle log. `npm run oracle -- <command>` from the template folder.
//
//   write [--content DIR] [--module NN-slug] [--corpus]
//          Runs the Course's STL sims (and, with --corpus, the template's own corpus) in awlsim and
//          writes each oracle log: a Course's into its build records, the corpus's into test/stl/oracle/.
//   check  [--content DIR] [--corpus]
//          Runs them again and fails if any committed log differs from what awlsim gives now: the
//          logs the stl gate trusts are awlsim's own, for the listing as it stands.
//   setup  Makes the venv this folder's oracle runs from (.oracle-venv), with awlsim at the version
//          the machine venv pins (skill/uv.lock). A Course build uses the machine venv instead.
//
// Each command runs the ladder and FBD sims too (and, with --corpus, test/ladder/): compiled to STL,
// scan by scan at the scans' own times.
//
// Exit codes: 0 done (or current), 1 a log is stale or awlsim failed, 2 bad usage.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { courseLadders, ladderCorpus, runAwlsimLadder, serialiseLadder } from "./ladder.ts";
import { corpusListings, courseListings, runAwlsim, serialise, type Listing } from "./listings.ts";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");

/** The awlsim version the machine venv pins, read from the repo's lock file. */
export function pinnedAwlsim(lock = join(TEMPLATE_DIR, "..", "skill", "uv.lock")): string {
  const text = readFileSync(lock, "utf8");
  const version = /\[\[package\]\]\s*\nname = "awlsim"\s*\nversion = "([^"]+)"/.exec(text)?.[1];
  if (!version) throw new Error(`${lock} pins no awlsim`);
  return version;
}

function setup(): number {
  const venv = join(TEMPLATE_DIR, ".oracle-venv");
  const version = pinnedAwlsim();
  const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
  const steps: [string, string[]][] =
    uv.status === 0
      ? [
          ["uv", ["venv", "--allow-existing", "--python", "3.13", venv]],
          ["uv", ["pip", "install", "--python", venv, `awlsim==${version}`]],
        ]
      : [
          [process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv]],
          [
            join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
            ["-m", "pip", "install", `awlsim==${version}`],
          ],
        ];
  for (const [command, args] of steps) {
    const ran = spawnSync(command, args, { stdio: "inherit" });
    if (ran.status !== 0) {
      console.error(`${command} ${args.join(" ")} failed`);
      return 1;
    }
  }
  console.log(`awlsim ${version} is in ${venv}`);
  return 0;
}

function listings(values: { content?: string; module?: string; corpus?: boolean }): Listing[] {
  const contentDir = resolve(values.content ?? process.env.CONTENT_DIR ?? join(TEMPLATE_DIR, "../fixture-course"));
  const { listings: course, unreadable } = courseListings(contentDir, values.module);
  if (unreadable.length > 0) throw new Error(unreadable.map((u) => `${u.entry} can't be run: ${u.problem}`).join("\n"));
  return [...(values.corpus ? [...corpusListings(), ...corpusListings({ stepThroughs: true })] : []), ...course];
}

function ladders(values: { content?: string; module?: string; corpus?: boolean }) {
  const contentDir = resolve(values.content ?? process.env.CONTENT_DIR ?? join(TEMPLATE_DIR, "../fixture-course"));
  const { listings: course, unreadable } = courseLadders(contentDir, values.module);
  if (unreadable.length > 0) throw new Error(unreadable.map((u) => `${u.entry} can't be run: ${u.problem}`).join("\n"));
  return [...(values.corpus ? ladderCorpus() : []), ...course];
}

function main(argv: string[]): number {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { content: { type: "string" }, module: { type: "string" }, corpus: { type: "boolean" } },
  });
  const [command] = positionals;
  if (command === "setup") return setup();
  if (command !== "write" && command !== "check") {
    console.error("usage: npm run oracle -- write|check [--content DIR] [--module NN-slug] [--corpus] | setup");
    return 2;
  }
  // Each listing (STL) and each ladder or FBD model, with the log awlsim gives for it now.
  const runs: { entry: string; logPath: string; cases: number; text: () => string }[] = [
    ...listings(values).map((l) => ({ ...l, cases: l.cases.length, text: () => serialise(runAwlsim(l)) })),
    ...ladders(values).map((l) => ({ ...l, cases: l.cases.length, text: () => serialiseLadder(runAwlsimLadder(l)) })),
  ];
  let stale = 0;
  for (const listing of runs) {
    const text = listing.text();
    const steps = text.split("\n").length;
    if (command === "write") {
      mkdirSync(dirname(listing.logPath), { recursive: true });
      writeFileSync(listing.logPath, text);
      console.log(`wrote ${listing.logPath} (${listing.cases} cases, ${steps} lines)`);
    } else if (!existsSync(listing.logPath) || readFileSync(listing.logPath, "utf8") !== text) {
      stale += 1;
      console.error(
        `${listing.entry}: its oracle log ${existsSync(listing.logPath) ? "isn't what awlsim gives now" : "is missing"} (${listing.logPath}); run \`npm run oracle -- write\``,
      );
    } else console.log(`${listing.entry}: current`);
  }
  return stale > 0 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
