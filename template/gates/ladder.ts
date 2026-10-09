// The ladder gate, per job: every ladder or FBD sim agrees with awlsim, the build oracle, bit for bit
// after every scan of every case (all of I, Q and M, every S5 timer's Q, running state and time
// left, every count, every TON's instance data), from the oracle log `npm run oracle -- write`
// keeps in the Course's build records; awlsim runs the networks compiled to STL at the scans' own
// times. Every rung segment must carry power and lose it in some case, every timer and counter must
// run out or count, the six broken engines (`src/sims/ladder/mutants.ts`) are each caught wherever
// the cases reach their defect, and the Worked example's sheet is checked three ways, exactly: the
// engine, awlsim and the sheet as printed.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { courseLadders, ladderRequestOf, type LadderListing } from "../oracle/ladder.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { isLive, type LiveSim } from "../src/sims/kinds.ts";
import { quantityName, runCase, watchValues, type ScanResult } from "../src/sims/ladder/engine.ts";
import { stlOperand } from "../src/sims/ladder/compile.ts";
import { driversOf, netOf, type LadderModel } from "../src/sims/ladder/model.ts";
import { runControls } from "../src/sims/ladder/mutants.ts";
import { asLogged, compareWithOracle, ladderLog, type LadderLog } from "../src/sims/ladder/oracle.ts";
import { AREAS, S7Memory } from "../src/sims/s7/core.ts";
import { RECOMPUTE_LOG, threeWay } from "../src/sims/three-way.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { problems, workedExample } from "./sims.ts";

/** How many disagreements a finding lists before it counts the rest. */
const SHOWN = 3;

/** A model's oracle log, or why it can't be used. */
function readLog(listing: LadderListing, logEntry: string): LadderLog | string {
  if (!existsSync(listing.logPath))
    return `no oracle log at ${logEntry}: run \`npm run oracle -- write\` (awlsim, in the machine venv) so the networks can be checked`;
  let parsed;
  try {
    parsed = ladderLog.safeParse(JSON.parse(readFileSync(listing.logPath, "utf8")));
  } catch (error) {
    return `can't read the oracle log ${logEntry}: ${(error as Error).message}`;
  }
  if (!parsed.success) return `the oracle log ${logEntry} isn't one: ${problems(parsed.error)}`;
  if (parsed.data.request !== ladderRequestOf(listing).hash)
    return `the oracle log ${logEntry} was made from other networks or other cases: the model changed since awlsim ran it, so run \`npm run oracle -- write\` again`;
  return parsed.data;
}

/** What no case exercises: a net that never carries power or never loses it, a timer that never runs out, a counter that never counts. */
export function unexercised(model: LadderModel, runs: readonly ScanResult[][]): string[] {
  const scans = runs.flat();
  const out: string[] = [];
  for (const net of model.nets) {
    const driven = driversOf(model, net);
    if (driven.length === 0) continue;
    // A net a rail drives is always powered: it has nothing to show.
    if (driven.some((pin) => model.parts.find((p) => `${p.id}.t` === pin)?.kind === "power-rail")) continue;
    const seen = new Set(scans.map((s) => s.levels[net.id]));
    if (!seen.has(1)) out.push(`net ${net.id} never carries power in any case`);
    if (!seen.has(0)) out.push(`net ${net.id} never loses power in any case`);
  }
  const numbers = new Set<string>();
  for (const s of scans) {
    for (const [n, t] of Object.entries(s.state.timers)) if (t.status === 1) numbers.add(`T ${n}`);
    for (const [n, t] of Object.entries(s.state.tons)) if (t.Q === 1) numbers.add(`DB ${n}`);
  }
  // A box whose Q nothing reads never settles its timer's Q bit (awlsim's neither): its Q line,
  // as the drawing shows it, says it ran out.
  for (const part of model.parts) {
    const net = netOf(model, `${part.id}.Q`);
    if (part.operand && net && scans.some((s) => s.levels[net.id] === 1)) numbers.add(stlOperand(part.operand));
  }
  // Every timer, TON and counter any scan touched (one may first run in a later scan).
  const touched = (key: "timers" | "tons" | "counters") => [
    ...new Set(scans.flatMap((s) => Object.keys(s.state[key]))),
  ];
  for (const n of touched("timers")) if (!numbers.has(`T ${n}`)) out.push(`timer T ${n} never sets its Q in any case`);
  for (const n of touched("tons"))
    if (!numbers.has(`DB ${n}`)) out.push(`the TON in DB ${n} never runs out in any case`);
  for (const n of touched("counters")) {
    const counts = new Set(scans.map((s) => s.state.counters[Number(n)]));
    if (counts.size < 2) out.push(`counter C ${n} never changes its count in any case`);
  }
  return out;
}

/** The watched values after every scan of the example's timeline, as awlsim left them: the recompute side of the sheet check. */
function awlsimValues(listing: LadderListing, log: LadderLog): Record<string, number> {
  const out: Record<string, number> = {};
  for (const scan of log.cases[0]?.scans ?? []) {
    const mem = new S7Memory();
    for (const area of AREAS)
      for (const [offset, hex] of scan.memory[area] ?? [])
        for (let i = 0; i < hex.length / 2; i++)
          mem.areas[area][offset + i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    for (const [operand, value] of Object.entries(watchValues(mem, listing.model)))
      out[quantityName(operand, scan.at)] = value;
  }
  return out;
}

export const ladderGate: Gate = {
  id: "ladder",
  checks:
    "every ladder or FBD sim agrees with awlsim bit for bit after every scan of every case, carries power and loses it on every rung segment, runs out every timer and counts every counter, catches each broken engine its cases reach, and its sheet agrees three ways",
  points: ["job", "deploy"],
  async run(input) {
    const { listings, unreadable } = courseLadders(input.contentDir, input.module);
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      sims: listings.length + unreadable.length,
      cases: 0,
      scans: 0,
      values: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
      sheetValues: 0,
    };
    const findings: Finding[] = [];
    for (const u of unreadable)
      findings.push({ outcome: "block", at: u.entry, message: `can't check the networks: ${u.problem}` });
    for (const listing of listings) {
      const at = listing.entry;
      const block = (message: string) => findings.push({ outcome: "block", at, message });
      const s = listing.sim;
      if (!s) continue;
      const log = readLog(listing, listing.logEntry ?? listing.logPath);
      if (typeof log === "string") {
        block(log);
        continue;
      }
      const agreement = compareWithOracle(listing.model, listing.cases, log);
      coverage.cases += listing.cases.length;
      coverage.scans += agreement.scans;
      coverage.values += agreement.values;
      if (agreement.mismatches.length > 0) {
        const more = agreement.mismatches.length - SHOWN;
        block(
          `the engine disagrees with awlsim: ${agreement.mismatches.slice(0, SHOWN).join("; ")}${more > 0 ? `; and ${more} more` : ""}`,
        );
        continue;
      }
      for (const gap of unexercised(listing.model, agreement.runs))
        block(
          `${gap}, so nothing checks that part of the engine against awlsim; add a case (a timeline) that reaches it`,
        );

      for (const control of runControls(listing.model, listing.cases, log)) {
        if (control.outcome === "caught") coverage.controlsCaught += 1;
        else if (control.outcome === "not-reached") coverage.controlsNotReached += 1;
        else block(`the gate is blind to a broken engine: ${control.defect}; ${control.detail ?? ""}`);
      }

      if (s.worked !== undefined && Object.keys(s.sheet).length > 0 && isLive(s)) {
        const example = workedExample(files, moduleOf(at) ?? "", s.worked);
        if (typeof example === "string") {
          block(example);
          continue;
        }
        const recompute = {
          recompute: RECOMPUTE_LOG,
          by: `awlsim ${log.awlsim}, on the example's timeline`,
          inputs: { model: s.model, start: s.start },
          values: awlsimValues(listing, log),
        } as const;
        const result = threeWay(s as LiveSim, recompute, example.sheet, { exact: true });
        coverage.sheetValues += result.sheetValues;
        for (const p of result.problems)
          findings.push({ outcome: p.outcome, at: p.on === "sheet" ? example.entry : at, message: p.message });
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "an oracle log that disagrees with the engine on one scan",
      plant: (good, scratch) =>
        plantInLadder(good, scratch, ({ logPath }) => {
          const log = JSON.parse(readFileSync(logPath, "utf8")) as LadderLog;
          const scan = log.cases[0]?.scans.at(-1);
          if (!scan) throw new Error("the log has no scan to change");
          scan.memory.M = [...(scan.memory.M ?? []), [500, "01"]];
          writeFileSync(logPath, JSON.stringify(log));
        }),
    },
    {
      defect: "networks edited after awlsim ran them",
      plant: (good, scratch) =>
        plantInLadder(good, scratch, ({ simPath, raw }) => {
          const model = raw.model as { parts: { kind: string }[] };
          const parts = model.parts.map((p) => (p.kind === "no" ? { ...p, kind: "nc" } : p));
          writeSim(simPath, { ...raw, model: { ...model, parts } });
        }),
    },
    {
      defect: "a ladder sim with no oracle log",
      plant: (good, scratch) => plantInLadder(good, scratch, ({ logPath }) => rmSync(logPath)),
    },
    {
      defect: "a rung no case ever powers",
      plant: (good, scratch) =>
        plantInLadder(good, scratch, ({ simPath, raw, logPath, contentDir }) => {
          // A network the timelines never reach: a contact on an input no case sets. Its log is the
          // engine's own (the engine agrees with awlsim), so only the coverage check can see it.
          const model = raw.model as { parts: object[]; nets: object[] };
          const layout = raw.layout as { parts: Record<string, object> };
          const planted = {
            ...raw,
            model: {
              ...model,
              parts: [
                ...model.parts,
                { id: "PlantRail", kind: "power-rail", network: 99 },
                { id: "PlantContact", kind: "no", network: 99, operand: "M 99.0" },
                { id: "PlantCoil", kind: "coil", network: 99, operand: "M 99.1" },
              ],
              nets: [
                ...model.nets,
                { id: "plantRail", pins: ["PlantRail.t", "PlantContact.in"] },
                { id: "plantRung", pins: ["PlantContact.out", "PlantCoil.in"] },
              ],
            },
            layout: {
              ...layout,
              parts: {
                ...layout.parts,
                PlantRail: { at: [0, 9] },
                PlantContact: { at: [1, 9] },
                PlantCoil: { at: [3, 9] },
              },
            },
          };
          writeSim(simPath, planted);
          const listing = courseLadders(contentDir).listings.find((l) => join(contentDir, l.entry) === simPath);
          if (!listing) throw new Error("the planted sim doesn't read");
          const log = JSON.parse(readFileSync(logPath, "utf8")) as LadderLog;
          log.request = ladderRequestOf(listing).hash;
          log.cases = listing.cases.map((c) => ({
            name: c.name,
            scans: runCase(listing.model, c).map((r) => asLogged(listing.model, r)),
          }));
          writeFileSync(logPath, JSON.stringify(log));
        }),
    },
    {
      defect: "a sheet value awlsim and the engine agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInLadder(good, scratch, ({ contentDir, module, raw }) => {
          const path = join(contentDir, "modules", module, "worked", `${String(raw.worked)}.json`);
          const example = JSON.parse(readFileSync(path, "utf8")) as { artefact: { rows: string[][] } };
          const sheet = raw.sheet as Record<string, string>;
          const cell = Object.keys(sheet).find((c) => sheet[c]?.startsWith("MD"));
          if (!cell) throw new Error("the sim maps no ET sheet cell");
          const row = Number(cell.slice(1)) - 1;
          const col = cell.charCodeAt(0) - 65;
          const cells = example.artefact.rows[row];
          if (!cells) throw new Error(`no row for ${cell}`);
          cells[col] = String(Number(cells[col] ?? "0") + 100);
          writeFileSync(path, JSON.stringify(example));
        }),
    },
  ],
};

const writeSim = (path: string, sim: Record<string, unknown>) =>
  writeFileSync(path, path.endsWith(".json") ? JSON.stringify(sim) : stringify(sim));

interface PlantSite {
  contentDir: string;
  module: string;
  simPath: string;
  logPath: string;
  raw: Record<string, unknown>;
}

/** A scratch copy of the Course with `plant` run on its first ladder sim. Throws when there is none. */
function plantInLadder(good: GateInput, scratch: string, plant: (site: PlantSite) => void): GateInput {
  const copy = courseCopy(good, scratch);
  const listing = courseLadders(copy.contentDir, copy.module).listings.find((l) => l.sim);
  if (!listing) throw new Error(`no ladder sim in ${good.contentDir} to plant a negative control in`);
  const simPath = join(copy.contentDir, listing.entry);
  const raw = readStructured(readFileSync(simPath, "utf8"), listing.entry, () => {});
  plant({ contentDir: copy.contentDir, module: moduleOf(listing.entry) ?? "", simPath, logPath: listing.logPath, raw });
  return copy;
}
