// The STL gate, per job: every STL listing agrees with awlsim, the build oracle, bit for bit after
// every statement of every case (ACCU 1, ACCU 2, AR 1, the status word and every byte written, then
// all of memory after each scan), from the oracle log `npm run oracle -- write` keeps in the
// Course's build records. Every instruction the listing uses must be run by some case (the `*I`
// lesson of #37), the Worked example's sheet is checked three ways like any live sim's, and the
// interpreter's negative controls (`src/sims/stl/mutants.ts`) run on every listing at every build:
// each one whose defect the cases reach must be caught. A listing with an instruction the
// interpreter lacks ships as a step-through of awlsim's values, once it names its Gate gap.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { courseListings, requestOf, type Listing } from "../oracle/listings.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { AREAS, S7Memory } from "../src/sims/s7/core.ts";
import { instructionKey, unsupportedStatements, watchValues } from "../src/sims/stl/engine.ts";
import { runControls } from "../src/sims/stl/mutants.ts";
import { compareWithOracle, logShapeProblem, oracleLog, type OracleLog } from "../src/sims/stl/oracle.ts";
import { parseStl } from "../src/sims/stl/parse.ts";
import { isLive, type LiveSim } from "../src/sims/kinds.ts";
import { RECOMPUTE_LOG, threeWay } from "../src/sims/three-way.ts";
import { agreesAtPrint, printAt, readPrinted } from "../src/sims/precision.ts";
import { numbersIn } from "../src/provenance/values.ts";
import { parseCell } from "../src/worked/cells.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { problems, workedExample } from "./sims.ts";

/** Where Gate gaps are filed: learn-premium's own tracker. */
const GATE_GAP_REPO = "seifyounes/learn-premium";
/** How many disagreements a finding lists before it counts the rest. */
const SHOWN = 3;

/** A listing's oracle log, or why it can't be used. */
function readLog(listing: Listing, logEntry: string): OracleLog | string {
  if (!existsSync(listing.logPath))
    return `no oracle log at ${logEntry}: run \`npm run oracle -- write\` (awlsim, in the machine venv) so the listing can be checked`;
  let parsed;
  try {
    parsed = oracleLog.safeParse(JSON.parse(readFileSync(listing.logPath, "utf8")));
  } catch (error) {
    return `can't read the oracle log ${logEntry}: ${(error as Error).message}`;
  }
  if (!parsed.success) return `the oracle log ${logEntry} isn't one: ${problems(parsed.error)}`;
  if (parsed.data.request !== requestOf(listing).hash)
    return `the oracle log ${logEntry} was made from another listing or other cases: the listing changed since awlsim ran it, so run \`npm run oracle -- write\` again`;
  return parsed.data;
}

/** The watch table as awlsim left it after the example's values: the recompute side of the sheet check. */
function awlsimWatch(listing: Listing, log: OracleLog): Record<string, number> {
  const scan = log.cases[0]?.scans[0];
  const mem = new S7Memory();
  for (const area of AREAS)
    for (const [offset, hex] of scan?.memory[area] ?? [])
      for (let i = 0; i < hex.length / 2; i++) mem.areas[area][offset + i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return watchValues(mem, listing.model);
}

export const stlGate: Gate = {
  id: "stl",
  checks:
    "every STL listing agrees with awlsim bit for bit after every statement of every case, runs every instruction it uses in some case, and catches each negative control its cases reach",
  points: ["job", "deploy"],
  async run(input) {
    const { listings, unreadable } = courseListings(input.contentDir, input.module);
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      listings: listings.length + unreadable.length,
      cases: 0,
      statements: 0,
      values: 0,
      leftByALibraryBlock: 0,
      instructions: 0,
      sheetValues: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
      stepThroughs: 0,
    };
    const findings: Finding[] = [];
    for (const u of unreadable)
      findings.push({ outcome: "block", at: u.entry, message: `can't check the listing: ${u.problem}` });
    for (const listing of listings) {
      const at = listing.entry;
      const block = (message: string) => findings.push({ outcome: "block", at, message });
      const s = listing.sim;
      if (!s) continue;
      const logEntry = listing.logEntry ?? listing.logPath;
      const program = parseStl(listing.model.source);
      const missing = unsupportedStatements(program);

      if (missing.length > 0) {
        if (s.gateGap === undefined) {
          for (const { statement, why } of missing)
            block(
              `line ${statement.line + 1}: ${why}. File a Gate gap on ${GATE_GAP_REPO} (this listing is its broken fixture) and give its issue number as gateGap: the listing then ships as a step-through of awlsim's values until a Template release adds the instruction`,
            );
          continue;
        }
        // The step-through plays awlsim's own trace: its log must be there and current.
        const log = readLog(listing, logEntry);
        const shape = typeof log === "string" ? log : logShapeProblem(listing.cases, log);
        if (shape || typeof log === "string") {
          block(shape ?? "no oracle log");
          continue;
        }
        coverage.stepThroughs += 1;
        // No engine runs it, so its sheet is checked two ways: awlsim against the sheet as printed.
        if (s.worked !== undefined && Object.keys(s.sheet).length > 0) {
          const example = workedExample(files, moduleOf(at) ?? "", s.worked);
          if (typeof example === "string") {
            block(example);
            continue;
          }
          const values = awlsimWatch(listing, log);
          const divergences = new Set(example.sheet.divergences.flatMap((d) => numbersIn(d).map((n) => n.value)));
          for (const [cell, quantity] of Object.entries(s.sheet)) {
            const { row, col } = parseCell(cell);
            const printed = readPrinted(example.sheet.rows[row]?.[col] ?? "");
            const value = values[quantity];
            if (typeof printed === "string" || value === undefined) {
              block(
                `sheet cell ${cell} (${quantity}) can't be compared: ${typeof printed === "string" ? printed : "the watch table has no such operand"}`,
              );
              continue;
            }
            coverage.sheetValues += 1;
            if (!agreesAtPrint(value, printed) && !divergences.has(Math.abs(printed.value)))
              findings.push({
                outcome: "checkpoint",
                at: example.entry,
                message: `sheet cell ${cell} prints ${printed.written}, but awlsim gives ${printAt(value, printed.decimals)} (${quantity}): rule it a Slip or a Divergence`,
              });
          }
        }
        continue;
      }
      if (s.gateGap !== undefined) {
        block(
          `the interpreter runs every instruction in this listing now: drop gateGap ${s.gateGap} so it ships live (and ${GATE_GAP_REPO}#${s.gateGap} can close)`,
        );
        continue;
      }

      const log = readLog(listing, logEntry);
      if (typeof log === "string") {
        block(log);
        continue;
      }
      const agreement = compareWithOracle(listing.model, listing.cases, log);
      coverage.cases += listing.cases.length;
      coverage.statements += agreement.statements;
      coverage.values += agreement.values;
      coverage.leftByALibraryBlock += agreement.leftBehind;
      if (agreement.mismatches.length > 0) {
        const more = agreement.mismatches.length - SHOWN;
        block(
          `the interpreter disagrees with awlsim: ${agreement.mismatches.slice(0, SHOWN).join("; ")}${more > 0 ? `; and ${more} more` : ""}`,
        );
      }

      // Every instruction the listing uses, run by some case.
      const used = new Map<string, number>();
      for (const statement of program.statements) {
        const key = instructionKey(statement);
        if (!used.has(key)) used.set(key, statement.line);
      }
      const ran = new Set(
        [...agreement.ran].map((i) => program.statements[i]).flatMap((st) => (st ? [instructionKey(st)] : [])),
      );
      coverage.instructions += used.size;
      for (const [key, line] of used)
        if (!ran.has(key))
          block(
            `line ${line + 1} (${key}): no gate case runs it, so nothing checks the interpreter's ${key.split(" ")[0]} against awlsim; add a case (or widen a tune range) that reaches it`,
          );

      // The interpreter's negative controls, each on this listing's cases.
      for (const control of runControls(listing.model, listing.cases, log)) {
        if (control.outcome === "caught") coverage.controlsCaught += 1;
        else if (control.outcome === "not-reached") coverage.controlsNotReached += 1;
        else if (control.outcome === "missed")
          block(`the gate is blind to a broken interpreter: ${control.defect}; ${control.detail ?? ""}`);
      }

      // The Worked example's sheet, three ways: the engine, awlsim and the sheet as printed.
      if (s.worked !== undefined && Object.keys(s.sheet).length > 0 && isLive(s)) {
        const module = moduleOf(at) ?? "";
        const example = workedExample(files, module, s.worked);
        if (typeof example === "string") {
          block(example);
          continue;
        }
        const recompute = {
          recompute: RECOMPUTE_LOG,
          by: `awlsim ${log.awlsim}, after the example's values`,
          inputs: { model: s.model, start: s.start },
          values: awlsimWatch(listing, log),
        } as const;
        const result = threeWay(s as LiveSim, recompute, example.sheet);
        coverage.sheetValues += result.sheetValues;
        for (const p of result.problems)
          findings.push({ outcome: p.outcome, at: p.on === "sheet" ? example.entry : at, message: p.message });
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "an oracle log that disagrees with the interpreter on one statement",
      plant: (good, scratch) =>
        plantInListing(good, scratch, ({ logPath }) => {
          const log = JSON.parse(readFileSync(logPath, "utf8")) as OracleLog;
          const step = log.cases[0]?.scans[0]?.steps[0];
          if (!step) throw new Error("the log has no statement to change");
          step[1] = (step[1] ^ 1) >>> 0;
          writeFileSync(logPath, JSON.stringify(log));
        }),
    },
    {
      defect: "a listing edited after awlsim ran it",
      plant: (good, scratch) =>
        plantInListing(good, scratch, ({ simPath, raw }) => {
          const model = raw.model as { source: string };
          writeStructuredSim(simPath, {
            ...raw,
            model: { ...model, source: model.source.replace("BEGIN", "BEGIN\nNETWORK\n      NOP   0") },
          });
        }),
    },
    {
      defect: "an STL listing with no oracle log",
      plant: (good, scratch) => plantInListing(good, scratch, ({ logPath }) => rmSync(logPath)),
    },
    {
      defect: "an instruction the listing uses that no gate case runs",
      plant: (good, scratch) =>
        plantInListing(good, scratch, ({ simPath, raw, logPath }) => {
          // An unreachable RLDA, jumped over: the jump and its target run (awlsim's rows for them
          // carry the registers unchanged), the RLDA never does.
          const model = raw.model as { source: string };
          const lines = model.source.replace(/\r/g, "").split("\n");
          const end = lines.findIndex((l) => /^\s*END_ORGANIZATION_BLOCK/i.test(l));
          lines.splice(end, 0, "      JU    XEND", "      RLDA", "XEND: NOP   0");
          const planted = { ...raw, model: { ...model, source: lines.join("\n") } };
          writeStructuredSim(simPath, planted);
          const log = JSON.parse(readFileSync(logPath, "utf8")) as OracleLog;
          for (const c of log.cases)
            for (const scan of c.scans) {
              const be = scan.steps.pop();
              const last = scan.steps.at(-1);
              if (!be || !last) throw new Error("a scan with no statements");
              scan.steps.push(
                [end + 1, last[1], last[2], last[3], last[4], []],
                [end + 3, last[1], last[2], last[3], last[4], []],
                be,
              );
            }
          const listing = courseListings(dirOf(simPath)).listings.find((l) => l.sim);
          if (!listing) throw new Error("the planted listing doesn't read");
          log.request = requestOf(listing).hash;
          writeFileSync(logPath, JSON.stringify(log));
        }),
    },
    {
      defect: "a listing with an instruction the interpreter lacks, and no Gate gap named",
      plant: (good, scratch) =>
        plantInListing(good, scratch, ({ simPath, raw }) => {
          const model = raw.model as { source: string };
          writeStructuredSim(simPath, {
            ...raw,
            model: {
              ...model,
              source: model.source.replace("BEGIN", "BEGIN\nNETWORK\n      L     DBW    0\n      POP"),
            },
          });
        }),
    },
    {
      defect: "a Gate gap named on a listing the interpreter runs in full",
      plant: (good, scratch) =>
        plantInListing(good, scratch, ({ simPath, raw }) => writeStructuredSim(simPath, { ...raw, gateGap: 999 })),
    },
    {
      defect: "a sheet value awlsim and the interpreter agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInListing(good, scratch, ({ contentDir, module, raw }) => {
          const path = join(contentDir, "modules", module, "worked", `${String(raw.worked)}.json`);
          const example = JSON.parse(readFileSync(path, "utf8")) as { artefact: { rows: string[][] } };
          const sheet = raw.sheet as Record<string, string>;
          const cell = Object.keys(sheet).find((c) => sheet[c]?.startsWith("MD"));
          if (!cell) throw new Error("the listing maps no REAL sheet cell");
          const row = Number(cell.slice(1)) - 1;
          const col = cell.charCodeAt(0) - 65;
          const cells = example.artefact.rows[row];
          if (!cells) throw new Error(`no row for ${cell}`);
          const printed = cells[col] ?? "0";
          const decimals = printed.split(".")[1]?.length ?? 0;
          cells[col] = (Number(printed) + 5 * 10 ** -decimals).toFixed(decimals);
          writeFileSync(path, JSON.stringify(example));
        }),
    },
  ],
};

const dirOf = (simPath: string) => simPath.replace(/[\\/]modules[\\/].*$/, "");

const writeStructuredSim = (path: string, sim: Record<string, unknown>) =>
  writeFileSync(path, path.endsWith(".json") ? JSON.stringify(sim) : stringify(sim));

interface PlantSite {
  contentDir: string;
  /** The listing's Module, by folder name. */
  module: string;
  simPath: string;
  logPath: string;
  /** The sim as written. */
  raw: Record<string, unknown>;
}

/** A scratch copy of the Course with `plant` run on its first live STL listing. Throws when there is none. */
function plantInListing(good: GateInput, scratch: string, plant: (site: PlantSite) => void): GateInput {
  const copy = courseCopy(good, scratch);
  const listing = courseListings(copy.contentDir, copy.module).listings.find(
    (l) => l.sim && l.sim.gateGap === undefined,
  );
  if (!listing) throw new Error(`no live STL listing in ${good.contentDir} to plant a negative control in`);
  const simPath = join(copy.contentDir, listing.entry);
  const raw = readStructured(readFileSync(simPath, "utf8"), listing.entry, () => {});
  plant({ contentDir: copy.contentDir, module: moduleOf(listing.entry) ?? "", simPath, logPath: listing.logPath, raw });
  return copy;
}
