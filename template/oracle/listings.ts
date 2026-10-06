// The STL listings awlsim runs at build, and where each one's oracle log lives: a Course's STL sims
// (their log in its build records, beside the recompute logs), and the template's own awlsim corpus
// (`test/stl/`, which runs every instruction the interpreter has). Shared by `oracle/cli.ts`, which
// writes the logs, and the `stl` gate, which reads them.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { sim as simSchema, stlListing } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { gateCases, type GateCase, type StlModel } from "../src/sims/stl/engine.ts";
import { ORACLE_LOG, oracleRequest, type OracleLog, type OracleRequest } from "../src/sims/stl/oracle.ts";
import { courseFiles, filesIn } from "../gates/course-files.ts";

const ORACLE_DIR = import.meta.dirname;
const TEMPLATE_DIR = resolve(ORACLE_DIR, "..");
/** The template's own corpus: one STL listing a file, with its oracle log under `oracle/`. */
export const CORPUS_DIR = join(TEMPLATE_DIR, "test", "stl");

/** Where the oracle log of a Course's STL sim lives: in its build records, by Module and name. */
export const oracleLogEntry = (module: string, name: string) => `build-records/oracle/${module}/${name}.json`;

/** One STL listing awlsim runs: its model, the cases it runs on, and where its log is kept. */
export interface Listing {
  /** How findings name it: the sim's content file, or the corpus file. */
  entry: string;
  logPath: string;
  model: StlModel;
  cases: GateCase[];
}

const ignoreMath = () => {};
const nameOf = (entry: string) => basename(entry, extname(entry));

/** A listing that can't be read as one, with why. */
export interface Unreadable {
  entry: string;
  problem: string;
}

/** The Course's STL sims (in one Module, if the scope names one), each with its cases and log path. */
export function courseListings(contentDir: string, module?: string): { listings: Listing[]; unreadable: Unreadable[] } {
  const listings: Listing[] = [];
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
    if (raw.kind !== "stl") continue;
    const parsed = simSchema.safeParse(raw);
    if (!parsed.success) {
      unreadable.push({
        entry: file.entry,
        problem: parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; "),
      });
      continue;
    }
    const s = parsed.data;
    if (s.kind !== "stl") continue;
    listings.push({
      entry: file.entry,
      logPath: join(contentDir, oracleLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry))),
      model: s.model,
      cases: gateCases(s.start, s.tune, s.cases),
    });
  }
  return { listings, unreadable };
}

/** The template's own awlsim corpus. */
export function corpusListings(): Listing[] {
  return filesIn(CORPUS_DIR, "*.yaml", () => true).map((file) => {
    const parsed = stlListing.safeParse(readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath));
    if (!parsed.success)
      throw new Error(
        `${file.entry}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    const l = parsed.data;
    return {
      entry: `test/stl/${file.entry}`,
      logPath: join(CORPUS_DIR, "oracle", `${nameOf(file.entry)}.json`),
      model: l.model,
      cases: gateCases(l.start, l.tune, l.cases),
    };
  });
}

/** The library blocks' STL the oracle runs in place of Siemens' binaries, by FC number. */
export function libraries(): Record<number, string> {
  return {
    105: readFileSync(join(ORACLE_DIR, "fc105.awl"), "utf8"),
    106: readFileSync(join(ORACLE_DIR, "fc106.awl"), "utf8"),
  };
}

/** The request awlsim runs for a listing, and its hash: a log made from another request is stale. */
export function requestOf(listing: Listing): { request: OracleRequest; hash: string } {
  const request = oracleRequest(listing.model, listing.cases, libraries());
  return { request, hash: createHash("sha256").update(JSON.stringify(request)).digest("hex") };
}

/**
 * The Python that has awlsim: `LEARN_PREMIUM_PYTHON`, else the venv `npm run oracle -- setup` makes
 * here, else the machine venv the installer syncs.
 */
export function oraclePython(): string {
  if (process.env.LEARN_PREMIUM_PYTHON) return process.env.LEARN_PREMIUM_PYTHON;
  const candidates = [join(TEMPLATE_DIR, ".oracle-venv"), join(homedir(), ".claude", "learn-premium", "venv")].flatMap(
    (venv) => [join(venv, "Scripts", "python.exe"), join(venv, "bin", "python")],
  );
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      "no Python with awlsim: run `npm run oracle -- setup` (or the installer, for the machine venv), or set LEARN_PREMIUM_PYTHON",
    );
  return found;
}

/** Runs the request in awlsim and returns the log to keep. */
export function runAwlsim(listing: Listing, python = oraclePython()): OracleLog {
  const { request, hash } = requestOf(listing);
  const ran = spawnSync(python, [join(ORACLE_DIR, "awlsim_run.py")], {
    input: JSON.stringify(request),
    maxBuffer: 1 << 28,
    encoding: "utf8",
  });
  if (ran.error) throw ran.error;
  if (ran.status !== 0) throw new Error(`awlsim failed on ${listing.entry}:\n${ran.stderr}`);
  const [, json] = ran.stdout.split("@@JSON@@");
  if (json === undefined) throw new Error(`awlsim printed no result for ${listing.entry}:\n${ran.stdout}${ran.stderr}`);
  const result = JSON.parse(json) as {
    awlsim: string;
    cases: { name: string; scans: OracleLog["cases"][number]["scans"] }[];
  };
  return {
    oracle: ORACLE_LOG,
    awlsim: result.awlsim,
    request: hash,
    cases: result.cases.map((c, i) => ({
      name: c.name,
      inputs: listing.cases[i]?.scans.map((s) => ({ ...s })) ?? [],
      scans: c.scans,
    })),
  };
}

/** A log as it is written: one case a line, so a diff shows which case changed. */
export function serialise(log: OracleLog): string {
  const { cases, ...head } = log;
  const lines = cases.map((c) => `    ${JSON.stringify(c)}`);
  return `${JSON.stringify(head, null, 2).replace(/\n}$/, "")},\n  "cases": [\n${lines.join(",\n")}\n  ]\n}\n`;
}
