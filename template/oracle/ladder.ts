// The ladder and FBD models awlsim runs at build, and where each one's oracle log lives: a Course's
// ladder sims (their log in its build records, beside the recompute logs), and the template's own
// corpus (`test/ladder/`, which runs every S5 timer and counter, the TON and every FBD box). Shared
// by `oracle/cli.ts`, which writes the logs, and the `ladder` gate, which reads them.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { ladderListing, sim as simSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import type { Sim } from "../src/sims/kinds.ts";
import { gateCases, scansOf, type GateCase } from "../src/sims/ladder/engine.ts";
import type { LadderModel } from "../src/sims/ladder/model.ts";
import { LADDER_LOG, ladderRequest, type LadderLog } from "../src/sims/ladder/oracle.ts";
import { courseFiles, filesIn } from "../gates/course-files.ts";
import { oraclePython, type Unreadable } from "./listings.ts";

const ORACLE_DIR = import.meta.dirname;
/** The template's own ladder corpus: one model a file, with its oracle log under `oracle/`. */
export const LADDER_CORPUS_DIR = join(resolve(ORACLE_DIR, ".."), "test", "ladder");

/** Where the oracle log of a Course's ladder sim lives: in its build records, by Module and name. */
export const ladderLogEntry = (module: string, name: string) => `build-records/oracle/${module}/${name}.json`;

export type LadderSim = Extract<Sim, { kind: "ladder" }>;

/** One ladder or FBD model awlsim runs: its model, its cases, and where its log is kept. */
export interface LadderListing {
  entry: string;
  logPath: string;
  model: LadderModel;
  cases: GateCase[];
  sim?: LadderSim;
  logEntry?: string;
}

const ignoreMath = () => {};
const nameOf = (entry: string) => basename(entry, extname(entry));

/** The Course's ladder sims (in one Module, if the scope names one), each with its cases and log path. */
export function courseLadders(
  contentDir: string,
  module?: string,
): { listings: LadderListing[]; unreadable: Unreadable[] } {
  const listings: LadderListing[] = [];
  const unreadable: Unreadable[] = [];
  const files = courseFiles({ contentDir, ...(module === undefined ? {} : { module }) }).filter(
    (f) => f.collection === "sims",
  );
  for (const file of files) {
    let raw: Record<string, unknown>;
    try {
      raw = readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
    } catch {
      continue; // a file that doesn't parse is the content contract gate's to report
    }
    if (raw.kind !== "ladder") continue;
    const parsed = simSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== "ladder") {
      unreadable.push({
        entry: file.entry,
        problem: parsed.success
          ? "not a ladder sim"
          : parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; "),
      });
      continue;
    }
    const s = parsed.data;
    const logEntry = ladderLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry));
    listings.push({
      entry: file.entry,
      logPath: join(contentDir, logEntry),
      logEntry,
      model: s.model,
      cases: gateCases(s.start, s.tune, s.scenario, s.cases, s.cycle),
      sim: s,
    });
  }
  return { listings, unreadable };
}

/** The template's own ladder corpus: `test/ladder/*.yaml`, every one run by the engine too. */
export function ladderCorpus(): LadderListing[] {
  return filesIn(LADDER_CORPUS_DIR, "*.yaml", () => true).map((file) => {
    const parsed = ladderListing.safeParse(readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath));
    if (!parsed.success)
      throw new Error(
        `${file.entry}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    const l = parsed.data;
    return {
      entry: `test/ladder/${file.entry}`,
      logPath: join(LADDER_CORPUS_DIR, "oracle", `${nameOf(file.entry)}.json`),
      model: l.model,
      cases: l.cases.map((c) => ({ name: c.name, scans: scansOf(l.start, c, l.cycle) })),
    };
  });
}

/** The request awlsim runs for a listing, and its hash: a log made from another request is stale. */
export function ladderRequestOf(listing: Pick<LadderListing, "model" | "cases">) {
  const request = ladderRequest(listing.model, listing.cases);
  return { request, hash: createHash("sha256").update(JSON.stringify(request)).digest("hex") };
}

/** Runs the request in awlsim and returns the log to keep. */
export function runAwlsimLadder(listing: LadderListing, python = oraclePython()): LadderLog {
  const { request, hash } = ladderRequestOf(listing);
  const ran = spawnSync(python, [join(ORACLE_DIR, "awlsim_ladder.py")], {
    input: JSON.stringify(request),
    maxBuffer: 1 << 28,
    encoding: "utf8",
  });
  if (ran.error) throw ran.error;
  if (ran.status !== 0) throw new Error(`awlsim failed on ${listing.entry}:\n${ran.stderr}`);
  const [, json] = ran.stdout.split("@@JSON@@");
  if (json === undefined) throw new Error(`awlsim printed no result for ${listing.entry}:\n${ran.stdout}${ran.stderr}`);
  const result = JSON.parse(json) as { awlsim: string; cases: LadderLog["cases"] };
  return { oracle: LADDER_LOG, awlsim: result.awlsim, request: hash, cases: result.cases };
}

/** A log as it is written: one scan a line, so a diff shows which scan changed. */
export function serialiseLadder(log: LadderLog): string {
  const { cases, ...head } = log;
  const blocks = cases.map(
    (c) =>
      `    {\n      "name": ${JSON.stringify(c.name)},\n      "scans": [\n${c.scans.map((s) => `        ${JSON.stringify(s)}`).join(",\n")}\n      ]\n    }`,
  );
  return `${JSON.stringify(head, null, 2).replace(/\n}$/, "")},\n  "cases": [\n${blocks.join(",\n")}\n  ]\n}\n`;
}
