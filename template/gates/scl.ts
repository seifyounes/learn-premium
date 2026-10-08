// The SCL gate, per job: every SCL listing runs on the engine and on the blind interpreter (written
// from the S7-SCL manual alone, `oracle/scl-blind.ts`) through every gate case, and the two must
// agree on every variable after every scan. Where they part, the manual decides: a disagreement
// blocks, unless the builder found the manual silent on it and listed it under `silent`; there, and
// wherever the blind interpreter stops because the manual leaves the result undefined, it is a
// Checkpoint item until the Owner's ruling is recorded. Every construct the listing uses must run
// in some case, every Divergence line must be reached, the engine's negative controls
// (`src/sims/scl/mutants.ts`) must each be caught where the cases reach them, and the Worked
// example's sheet is checked three ways: the engine, the blind interpreter and the sheet.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { runBlind } from "../oracle/scl-blind.ts";
import { sim as simSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { engineQuantities, isLive, type LiveSim } from "../src/sims/kinds.ts";
import { constructsIn, type Leaf } from "../src/sims/scl/engine.ts";
import { runControls } from "../src/sims/scl/mutants.ts";
import { compareWithBlind, gateCases, type BlindScan, type SilentPoint } from "../src/sims/scl/oracle.ts";
import { parseScl } from "../src/sims/scl/parse.ts";
import { RECOMPUTE_LOG, threeWay } from "../src/sims/three-way.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { problems, workedExample } from "./sims.ts";

/** Where a Gate gap is filed: learn-premium's own tracker. */
const GATE_GAP_REPO = "seifyounes/learn-premium";
/** How many disagreements a finding lists before it counts the rest. */
const SHOWN = 3;

const read = (file: CourseFile) => readStructured(readFileSync(file.path, "utf8"), file.entry, () => {});

type SclSim = Extract<LiveSim, { kind: "scl" }>;

/** Each case run on the blind interpreter, or why it couldn't run the listing. */
function blindRuns(s: SclSim, cases: ReturnType<typeof gateCases>): (BlindScan[] | Error)[] {
  return cases.map((c) => {
    try {
      return runBlind({
        source: s.model.source,
        block: s.model.block,
        scans: c.scans.map((x) => ({ ...x })),
      }) as BlindScan[];
    } catch (error) {
      return error as Error;
    }
  });
}

export const sclGate: Gate = {
  id: "scl",
  checks:
    "every SCL listing agrees with the blind interpreter on every variable after every scan of every case, runs every construct it uses, reaches its Divergence lines and catches each negative control its cases reach; where the manual is silent, the Owner rules",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      listings: 0,
      cases: 0,
      scans: 0,
      values: 0,
      constructs: 0,
      silentPoints: 0,
      ruled: 0,
      sheetValues: 0,
      controlsCaught: 0,
      controlsNotReached: 0,
    };
    const findings: Finding[] = [];
    for (const file of files.filter((f) => f.collection === "sims")) {
      const at = file.entry;
      const block = (message: string) => findings.push({ outcome: "block", at, message });
      let raw: Record<string, unknown>;
      try {
        raw = read(file);
      } catch (error) {
        if (!/\bkind:\s*scl\b|"kind":\s*"scl"/.test(readFileSync(file.path, "utf8"))) continue;
        block(`can't check the listing: ${(error as Error).message}`);
        continue;
      }
      if (raw.kind !== "scl") continue;
      const parsed = simSchema.safeParse(raw);
      if (!parsed.success) {
        block(`can't check the listing: the content contract reports ${problems(parsed.error)}`);
        continue;
      }
      const s = parsed.data;
      if (s.kind !== "scl" || !isLive(s)) continue;
      coverage.listings += 1;
      const cases = gateCases(s.start, s.tune, s.cases);
      const blind = blindRuns(s, cases);
      const agreement = compareWithBlind(s.model, cases, blind);
      coverage.cases += cases.length;
      coverage.scans += agreement.scans;
      coverage.values += agreement.values;

      if (agreement.mismatches.length > 0) {
        const more = agreement.mismatches.length - SHOWN;
        block(
          `the interpreters part where no ruling can settle it: ${agreement.mismatches.slice(0, SHOWN).join("; ")}${more > 0 ? `; and ${more} more` : ""}. The side the manual contradicts is a template defect: file a Gate gap on ${GATE_GAP_REPO}`,
        );
      }

      // Disagreements: the manual decides, unless it is silent; silent points are the Owner's.
      const listed = new Map(s.silent.map((entry) => [entry.at, entry]));
      const used = new Set<string>();
      const raised = new Set<string>();
      const owners = (point: SilentPoint, why: string) => {
        const entry = listed.get(point.at);
        if (entry) used.add(point.at);
        if (entry?.ruling !== undefined) {
          if (!raised.has(point.at)) coverage.ruled += 1;
          raised.add(point.at);
          return;
        }
        if (raised.has(point.at)) return;
        raised.add(point.at);
        coverage.silentPoints += 1;
        findings.push({
          outcome: "checkpoint",
          at,
          message: `${point.where}: ${point.detail}. ${why}: the Owner rules it at the Checkpoint, and the ruling is recorded under silent (at: "${point.at}")`,
        });
      };
      for (const point of agreement.stopped) owners(point, "The SCL manual leaves this result undefined");
      const parted = agreement.parted.filter((p) => {
        if (!listed.has(p.at)) return true;
        owners(p, `${listed.get(p.at)?.point ?? "The manual is silent here"}`);
        return false;
      });
      if (parted.length > 0) {
        const more = parted.length - SHOWN;
        block(
          `the interpreters disagree: ${parted
            .slice(0, SHOWN)
            .map((p) => `${p.where}: ${p.detail}`)
            .join(
              "; ",
            )}${more > 0 ? `; and ${more} more` : ""}. The S7-SCL manual decides: the side it contradicts is a template defect (file a Gate gap on ${GATE_GAP_REPO}); if the manual is silent, list the variable under silent so the Owner rules it`,
        );
      }
      for (const entry of s.silent)
        if (!used.has(entry.at)) block(`silent lists "${entry.at}", where the interpreters no longer part: drop it`);

      // Every construct the listing uses, run by some case.
      const constructs = constructsIn(parseScl(s.model.source));
      coverage.constructs += constructs.size;
      for (const [construct, line] of constructs)
        if (!agreement.constructs.has(construct))
          block(
            `line ${line + 1} (${construct}): no gate case runs it, so nothing checks the engine's ${construct} against the blind interpreter; add a case (or widen a tune range) that reaches it`,
          );

      // A Divergence marks a line students reach.
      for (const d of s.divergences)
        if (!agreement.ran.has(d.line - 1))
          block(`the Divergence on line ${d.line} sits on a line no gate case runs, so no student reaches it either`);

      // The engine's negative controls, each on this listing's cases.
      for (const control of runControls(s.model, cases, blind)) {
        if (control.outcome === "caught") coverage.controlsCaught += 1;
        else if (control.outcome === "not-reached") coverage.controlsNotReached += 1;
        else block(`the gate is blind to a broken interpreter: ${control.defect}; ${control.detail ?? ""}`);
      }

      // The Worked example's sheet, three ways: the engine, the blind interpreter and the sheet as printed.
      if (s.worked !== undefined && Object.keys(s.sheet).length > 0) {
        const example = workedExample(files, moduleOf(at) ?? "", s.worked);
        if (typeof example === "string") {
          block(example);
          continue;
        }
        const runs = blind[0];
        const first = runs instanceof Error ? undefined : runs?.[0];
        let values: Record<string, number>;
        let by = "the blind SCL interpreter (oracle/scl-blind.ts), one scan of the example's values";
        if (first && "values" in first) {
          // Only what the sheet prints: every other value was compared scan by scan above.
          const blindValues: Record<string, Leaf> = first.values;
          values = { ...s.start };
          // A quantity the Owner ruled where the manual is silent takes the engine's value, as ruled.
          const engine = engineQuantities(s);
          for (const quantity of Object.values(s.sheet)) {
            const leaf = blindValues[quantity];
            if (listed.get(quantity)?.ruling !== undefined && engine[quantity] !== undefined)
              values[quantity] = engine[quantity];
            else if (leaf) values[quantity] = leaf.value;
          }
        } else if (first && "stopped" in first && listed.get(`line ${first.stopped.line}`)?.ruling !== undefined) {
          // The Owner ruled the engine's way where the manual is silent: the engine is the recompute.
          values = engineQuantities(s);
          by = "the engine, as the Owner ruled where the SCL manual is silent";
        } else {
          // The blind interpreter stopped (a Checkpoint item, raised above) or couldn't run (blocked above).
          continue;
        }
        const recompute = { recompute: RECOMPUTE_LOG, by, inputs: { model: s.model, start: s.start }, values } as const;
        const result = threeWay(s, recompute, example.sheet);
        coverage.sheetValues += result.sheetValues;
        for (const p of result.problems)
          findings.push({ outcome: p.outcome, at: p.on === "sheet" ? example.entry : at, message: p.message });
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a listing whose result the SCL manual leaves undefined (a VAR_TEMP read before it is written)",
      expect: "checkpoint",
      plant: (good, scratch) => plantInListing(good, scratch, (source) => readsTempFirst(source)),
    },
    {
      defect: "a value the interpreters give differently, not referred to the Owner",
      plant: (good, scratch) => plantInListing(good, scratch, (source) => foldedConstants(source)),
    },
    {
      defect: "a silent point listed where the interpreters agree",
      plant: (good, scratch) =>
        plantInListing(good, scratch, (source) => source, {
          silent: [{ at: "valve", point: "planted: nothing parts here" }],
        }),
    },
    {
      defect: "a construct the listing uses that no gate case runs",
      plant: (good, scratch) =>
        plantInListing(good, scratch, (source) =>
          atBlockStart(source, "IF FALSE THEN #valve := #valve MOD 2; END_IF;"),
        ),
    },
    {
      defect: "a Divergence on a line no gate case reaches",
      plant: (good, scratch) =>
        plantInListing(
          good,
          scratch,
          (source) => source,
          (raw) => {
            const lines = (raw.model as { source: string }).source.split("\n");
            const end = lines.findIndex((l) => /^\s*END_FUNCTION_BLOCK/i.test(l));
            lines.splice(end, 0, "IF FALSE THEN", "    #valve := 0;", "END_IF;");
            return {
              model: { ...(raw.model as object), source: lines.join("\n") },
              divergences: [{ line: end + 2, exam: "planted", note: "planted" }],
            };
          },
        ),
    },
    {
      defect: "a sheet value the engine and the blind interpreter agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInListing(
          good,
          scratch,
          (source) => source,
          {},
          ({ contentDir, module, raw }) => {
            const path = join(contentDir, "modules", module, "worked", `${String(raw.worked)}.json`);
            const example = JSON.parse(readFileSync(path, "utf8")) as { artefact: { rows: string[][] } };
            const sheet = raw.sheet as Record<string, string>;
            const cell = Object.keys(sheet)[0];
            if (!cell) throw new Error("the listing maps no sheet cell");
            const row = Number(cell.slice(1)) - 1;
            const col = cell.charCodeAt(0) - 65;
            const cells = example.artefact.rows[row];
            if (!cells) throw new Error(`no row for ${cell}`);
            const printed = cells[col] ?? "0";
            const decimals = printed.split(".")[1]?.length ?? 0;
            cells[col] = (Number(printed) + 7 * 10 ** -decimals).toFixed(decimals);
            writeFileSync(path, JSON.stringify(example));
          },
        ),
    },
  ],
};

/** Code put on the FUNCTION_BLOCK's BEGIN line, so every line after keeps its number (a Divergence's too). */
function atBlockStart(source: string, code: string): string {
  const planted = source.replace(/\nBEGIN\n(?![\s\S]*\nBEGIN\n)/, `\nBEGIN ${code}\n`);
  if (planted === source) throw new Error("the listing's FUNCTION_BLOCK has no BEGIN line to plant in");
  return planted;
}

/** A first statement that reads a VAR_TEMP before anything writes it: the manual leaves its value undefined. */
function readsTempFirst(source: string): string {
  const temp = /VAR_TEMP\s+#?(\w+)\s*:\s*INT\s*;/i.exec(source)?.[1];
  const target = /VAR_OUTPUT[\s\S]*?\n\s*#?(\w+)\s*:\s*INT\s*;/i.exec(source)?.[1];
  if (!temp || !target) throw new Error("the listing has no INT VAR_TEMP and INT output to plant a read in");
  return atBlockStart(source, `#${target} := #${temp};`);
}

/** Two INT constants added: the engine adds them as INTs and wraps, the blind interpreter folds them exactly. */
function foldedConstants(source: string): string {
  const withStatic = source.replace(/\n(\s*)VAR\n(?![\s\S]*\n\s*VAR\n)/, "\n$1VAR planted_sum : DINT;\n");
  if (withStatic === source) throw new Error("the listing's FB has no VAR section to plant a static in");
  return atBlockStart(withStatic, "#planted_sum := 30000 + 30000;");
}

interface PlantSite {
  contentDir: string;
  module: string;
  raw: Record<string, unknown>;
}

/**
 * A scratch copy of the Course with the first live SCL listing's source rewritten by `source`, its
 * sim given `extra` fields (or fields worked out from it), and `after` run on the copy. Throws when
 * there is no listing, so a control can't silently check nothing.
 */
function plantInListing(
  good: GateInput,
  scratch: string,
  source: (text: string) => string,
  extra: Record<string, unknown> | ((raw: Record<string, unknown>) => Record<string, unknown>) = {},
  after?: (site: PlantSite) => void,
): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "sims")) {
    const raw = read(file);
    if (raw.kind !== "scl") continue;
    const model = raw.model as { source: string };
    const planted = { ...raw, model: { ...model, source: source(model.source) } };
    const more = typeof extra === "function" ? extra(planted) : extra;
    const sim = { ...planted, ...more };
    writeFileSync(file.path, file.path.endsWith(".json") ? JSON.stringify(sim) : stringify(sim));
    after?.({ contentDir: copy.contentDir, module: moduleOf(file.entry) ?? "", raw: sim });
    return copy;
  }
  throw new Error(`no SCL listing in ${good.contentDir} to plant a negative control in`);
}
