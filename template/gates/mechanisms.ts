// The mechanism gates, per job. `kinematics` holds what the viewer draws, the kinematics engine's
// poses, to an independent recompute at 360 steps of one driver turn (each moving link within 0.1°,
// each pin within 0.1 mm), and the sheet's values three ways like `sim-numbers`. `gear-interference`
// holds a gear pair's teeth, on the true involutes, at 0.5° steps of the driver until each gear has
// turned once: they never overlap, and they always touch.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { isLive, type LiveSim } from "../src/sims/kinds.ts";
import {
  AssemblyError,
  linkPins,
  meshAt,
  MOVING_LINKS,
  pins,
  pose,
  trace,
  type GearPair,
  type LinkId,
  type Model,
  type Point,
  type Pose,
} from "../src/sims/mechanism/engine.ts";
import { mechanismLog, type MechanismLog } from "../src/sims/mechanism/log.ts";
import { printAt, readPrinted } from "../src/sims/precision.ts";
import { threeWay } from "../src/sims/three-way.ts";
import { parseCell } from "../src/worked/cells.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems, readSim, recomputeLogEntry, workedExample } from "./sims.ts";

export { mechanismLog, type MechanismLog };

/** What the viewer's motion may differ from the recompute by: the ticket's 0.1° and 0.1 mm. */
export const ANGLE_TOLERANCE_DEG = 0.1;
export const POINT_TOLERANCE_MM = 0.1;
/** The gear check's step on the driver, the overlap that blocks (float noise only) and the gap past which teeth don't touch. */
export const MESH_STEP_DEG = 0.5;
export const OVERLAP_MM = 1e-6;
export const CONTACT_GAP_MM = 0.05;

const ignoreMath = () => {};
const mm = (n: number) => String(Number(n.toFixed(3)));
/** An angle difference wrapped to (−180, 180], in degrees. */
const turnBetween = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** What a mechanism's recompute must trace: every moving link's angle, and every pin off the ground. */
function requiredKeys(model: Model): { angles: readonly string[]; points: readonly string[] } {
  if (model.type === "four-bar")
    return {
      angles: MOVING_LINKS["four-bar"],
      points: model.couplerPoint ? ["A", "B", "P"] : ["A", "B"],
    };
  return { angles: MOVING_LINKS["gear-pair"], points: ["H", "T"] };
}

/** The moving links that carry a pin, so the copies of it the gate compares. */
const copiesOf = (model: Model, pin: string): LinkId[] =>
  (Object.entries(linkPins(model)) as [LinkId, Record<string, Point>][])
    .filter(([link, local]) => link !== "ground" && pin in local)
    .map(([link]) => link);

/**
 * The trace check, as a function so a test can hand it a mutant pose: the posed mechanism at each of
 * the log's steps against the log's angles and points. Every finding, worst first: the worst angle
 * off (any moving link), then the worst point off (any link's copy of a pin), each with how many
 * steps were off. An assembly that won't close is the one finding.
 */
export function compareTrace(model: Model, posed: (theta: number) => Pose, log: MechanismLog["trace"]): string[] {
  const steps = log.theta.length;
  const angle = { off: 0, at: 0, link: "", count: 0 };
  const point = { off: 0, at: 0, label: "", count: 0 };
  for (let k = 0; k < steps; k++) {
    const theta = log.theta[k] ?? k;
    let p: Pose;
    try {
      p = posed(theta);
    } catch (error) {
      if (error instanceof AssemblyError) return [`the linkage can't close at θ = ${mm(theta)}°`];
      throw error;
    }
    let angleOff = false;
    for (const [link, logged] of Object.entries(log.angles)) {
      const engine = p.links[link as LinkId]?.angle;
      const recomputed = logged[k];
      if (engine === undefined || recomputed === undefined) continue;
      const off = Math.abs(turnBetween(engine, recomputed));
      if (off > ANGLE_TOLERANCE_DEG) {
        angleOff = true;
        if (off > angle.off) Object.assign(angle, { off, at: theta, link });
      }
    }
    if (angleOff) angle.count += 1;
    const placed = pins(model, p);
    let pointOff = false;
    for (const [pin, logged] of Object.entries(log.points)) {
      const at = logged[k];
      if (at === undefined) continue;
      for (const [link, local] of Object.entries(placed) as [LinkId, Record<string, Point>][]) {
        const engine = local[pin];
        if (!engine || link === "ground") continue;
        const off = Math.hypot(engine[0] - at[0], engine[1] - at[1]);
        if (off > POINT_TOLERANCE_MM) {
          pointOff = true;
          if (off > point.off) Object.assign(point, { off, at: theta, label: `pin ${pin} on the ${link}` });
        }
      }
    }
    if (pointOff) point.count += 1;
  }
  const found: { off: number; message: string }[] = [];
  if (angle.count > 0)
    found.push({
      off: angle.off / ANGLE_TOLERANCE_DEG,
      message: `${angle.link} is ${mm(angle.off)}° off the recompute at θ = ${mm(angle.at)}° (more than ${ANGLE_TOLERANCE_DEG}°; ${angle.count} of ${steps} steps off)`,
    });
  if (point.count > 0)
    found.push({
      off: point.off / POINT_TOLERANCE_MM,
      message: `${point.label} is ${mm(point.off)} mm off the recompute at θ = ${mm(point.at)}° (more than ${POINT_TOLERANCE_MM} mm; ${point.count} of ${steps} steps off)`,
    });
  return found.sort((a, b) => b.off - a.off).map((f) => f.message);
}

/** The mechanism sims in scope, and how many Modules were looked in. */
function mechanismsInScope(input: GateInput) {
  const files = courseFiles(input);
  const sims = files
    .filter((f) => f.collection === "sims")
    .map((file) => ({ file, read: readSim(file) }))
    .filter(({ read }) => read.raw?.kind === "mechanism");
  return { files, sims, modules: files.filter((f) => f.collection === "modules").length };
}

async function kinematicsRun(input: GateInput) {
  const { files, sims, modules } = mechanismsInScope(input);
  const coverage = {
    modules,
    mechanisms: sims.length,
    stepThroughs: 0,
    steps: 0,
    angles: 0,
    points: 0,
    sheetValues: 0,
    recomputedValues: 0,
  };
  const findings: Finding[] = [];
  for (const { file, read } of sims) {
    const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
    const { sim: s, problem } = read;
    if (!s) {
      block(problem);
      continue;
    }
    // A mechanism no recompute can check never ships live: the page shows its step-through.
    if (!isLive(s) || s.kind !== "mechanism") {
      coverage.stepThroughs += 1;
      continue;
    }
    const module = moduleOf(file.entry) ?? "";
    const logEntry = recomputeLogEntry(module, nameOf(file.entry));
    const logPath = join(input.contentDir, logEntry);
    if (!existsSync(logPath)) {
      block(
        `no recompute log at ${logEntry}: a mechanism ships live only when an independent recompute traces it; if its model can't be recomputed, mark it recompute: none`,
      );
      continue;
    }
    let log;
    try {
      log = mechanismLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
    } catch (error) {
      block(`can't read the recompute log ${logEntry}: ${(error as Error).message}`);
      continue;
    }
    if (!log.success) {
      block(`the recompute log ${logEntry} isn't one: ${problems(log.error)}`);
      continue;
    }
    const example = s.worked === undefined ? undefined : workedExample(files, module, s.worked);
    if (typeof example === "string") {
      block(example);
      continue;
    }
    // The sheet, three ways, with the trace left out of it.
    const { trace: logged, ...recompute } = log.data;
    const sheet = threeWay(s as LiveSim, recompute, example?.sheet);
    coverage.sheetValues += sheet.sheetValues;
    coverage.recomputedValues += sheet.recomputedValues;
    for (const p of sheet.problems)
      findings.push({
        outcome: p.outcome,
        at: p.on === "sheet" && example ? example.entry : file.entry,
        message: p.message,
      });

    // The motion: one driver turn at 1°, every moving link and every pin off the ground.
    if (logged.theta.some((theta, k) => theta !== k)) {
      block(`the recompute trace's steps aren't θ = 0, 1, … 359°: it traces one driver turn at 1°`);
      continue;
    }
    const need = requiredKeys(s.model);
    const missing = [
      ...need.angles.filter((key) => !(key in logged.angles)),
      ...need.points.filter((key) => !(key in logged.points)),
    ];
    for (const key of missing)
      block(`the recompute trace leaves out ${key}: it traces every moving link and every pin off the ground`);
    const unknown = [
      ...Object.keys(logged.angles).filter((key) => !(MOVING_LINKS[s.model.type] as readonly string[]).includes(key)),
      ...Object.keys(logged.points).filter((key) => copiesOf(s.model, key).length === 0),
    ];
    for (const key of unknown) block(`the recompute traces ${key}, which this mechanism doesn't have`);
    if (missing.length > 0 || unknown.length > 0) continue;
    const steps = logged.theta.length;
    coverage.steps += steps;
    coverage.angles += steps * Object.keys(logged.angles).length;
    coverage.points += steps * Object.keys(logged.points).reduce((n, key) => n + copiesOf(s.model, key).length, 0);
    for (const message of compareTrace(s.model, (theta) => pose(s.model, theta), logged)) block(message);
  }
  return { coverage, findings };
}

/** A scratch copy of the Course with `plant` run on the first live mechanism of `type`. Throws when there is none. */
function plantInMechanism(
  good: GateInput,
  scratch: string,
  type: Model["type"],
  plant: (site: MechanismSite) => void,
): GateInput {
  const copy = courseCopy(good, scratch);
  const { files, sims } = mechanismsInScope(copy);
  for (const { file, read } of sims) {
    const { sim } = read;
    if (!sim || !isLive(sim) || sim.kind !== "mechanism" || sim.model.type !== type) continue;
    const module = moduleOf(file.entry) ?? "";
    const example = sim.worked && workedExample(files, module, sim.worked);
    plant({
      contentDir: copy.contentDir,
      simEntry: file.entry,
      logEntry: recomputeLogEntry(module, nameOf(file.entry)),
      ...(example && typeof example !== "string" ? { workedEntry: example.entry } : {}),
      sim: sim as LiveSim & { kind: "mechanism" },
      file,
    });
    return copy;
  }
  throw new Error(`no live ${type} mechanism in ${good.contentDir} to plant a negative control in`);
}

interface MechanismSite {
  contentDir: string;
  simEntry: string;
  logEntry: string;
  workedEntry?: string;
  sim: LiveSim & { kind: "mechanism" };
  file: CourseFile;
}

const readLog = (site: MechanismSite) =>
  JSON.parse(readFileSync(join(site.contentDir, site.logEntry), "utf8")) as MechanismLog;
const writeLog = (site: MechanismSite, log: unknown) =>
  writeFileSync(join(site.contentDir, site.logEntry), JSON.stringify(log));

export const kinematicsGate: Gate = {
  id: "kinematics",
  checks:
    "every live mechanism's motion, as the viewer draws it, against the independent recompute at 360 steps of one driver turn (each moving link within 0.1°, each pin within 0.1 mm), and its sheet values three ways",
  points: ["job", "deploy"],
  run: kinematicsRun,
  controls: [
    {
      defect: "a recompute trace 0.2° off the engine on the rocker at one step",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => {
          const log = readLog(site);
          const rocker = log.trace.angles["rocker"] as number[];
          rocker[137] = (rocker[137] as number) + 0.2;
          writeLog(site, log);
        }),
    },
    {
      defect: "a recompute trace whose coupler point is 0.2 mm off at one step",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => {
          const log = readLog(site);
          const at = (log.trace.points["P"] as [number, number][])[211] as [number, number];
          at[0] += 0.2;
          writeLog(site, log);
        }),
    },
    {
      defect: "a recompute trace of the crossed assembly, its inputs still open",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => {
          const log = readLog(site);
          const open = site.sim.model;
          if (open.type !== "four-bar") throw new Error("not a four-bar");
          writeLog(site, { ...log, trace: JSON.parse(JSON.stringify(trace({ ...open, assembly: "crossed" }))) });
        }),
    },
    {
      defect: "a gear pair's recompute that turns the driven gear the same way as the driver",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "gear-pair", (site) => {
          const log = readLog(site);
          const model = site.sim.model as GearPair;
          const [n1, n2] = model.teeth;
          const r2 = (model.module * n2) / 2;
          const a = model.centreDistance ?? (model.module * (n1 + n2)) / 2;
          const driven = log.trace.theta.map((k) => (((180 + 180 / n2 + (k * n1) / n2) % 360) + 360) % 360);
          log.trace.angles["driven"] = driven;
          log.trace.points["T"] = driven.map((angle) => [
            a + (r2 + model.module) * Math.cos((angle * Math.PI) / 180),
            (r2 + model.module) * Math.sin((angle * Math.PI) / 180),
          ]);
          writeLog(site, log);
        }),
    },
    {
      defect: "a recompute log one step short",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => {
          const log = readLog(site);
          log.trace.theta.pop();
          for (const angles of Object.values(log.trace.angles)) angles.pop();
          for (const points of Object.values(log.trace.points)) points.pop();
          writeLog(site, log);
        }),
    },
    {
      defect: "a live mechanism with no recompute log",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => rmSync(join(site.contentDir, site.logEntry))),
    },
    {
      defect: "a recompute log that disagrees with the engine on a sheet value",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => {
          const log = readLog(site);
          log.values["theta3"] = (log.values["theta3"] ?? 0) + 5;
          writeLog(site, log);
        }),
    },
    {
      defect: "a sheet value the engine and the recompute agree against, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "four-bar", (site) => {
          if (!site.workedEntry)
            throw new Error("the live mechanism names no Worked example to plant a sheet value in");
          const path = join(site.contentDir, site.workedEntry);
          const example = readStructured(readFileSync(path, "utf8"), site.workedEntry, ignoreMath) as {
            artefact: { rows: string[][] };
          };
          const [cell] = Object.keys(site.sim.sheet);
          if (!cell) throw new Error("the live mechanism maps no sheet cell");
          const { row, col } = parseCell(cell);
          const printed = readPrinted(example.artefact.rows[row]?.[col] ?? "");
          if (typeof printed === "string") throw new Error(`sheet cell ${cell}: ${printed}`);
          // Five in the last printed digit: past the ±1 a hand may round by.
          const off = printed.value + 5 * 10 ** -printed.decimals;
          (example.artefact.rows[row] as string[])[col] = printAt(off, printed.decimals).replace("−", "-");
          writeFileSync(path, extname(path) === ".json" ? JSON.stringify(example) : "");
        }),
    },
  ],
};

async function gearRun(input: GateInput) {
  const { sims, modules } = mechanismsInScope(input);
  const coverage = { modules, gearPairs: 0, steps: 0 };
  const findings: Finding[] = [];
  for (const { file, read } of sims) {
    const { sim: s } = read;
    // A step-through draws no gears from the engine, and a sim the contract refuses is the kinematics gate's.
    if (!s || !isLive(s) || s.kind !== "mechanism" || s.model.type !== "gear-pair") continue;
    const model = s.model;
    const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
    const [n1, n2] = model.teeth;
    const standard = (model.module * (n1 + n2)) / 2;
    const centre = model.centreDistance ?? standard;
    const steps = (360 / MESH_STEP_DEG) * Math.max(1, Math.ceil(n2 / n1));
    coverage.gearPairs += 1;
    coverage.steps += steps;
    const worst = { overlap: 0, at: 0, by: undefined as 0 | 1 | undefined, count: 0 };
    const apart = { gap: 0, at: 0, count: 0 };
    try {
      for (let k = 0; k < steps; k++) {
        const found = meshAt(model, k * MESH_STEP_DEG);
        if (found.overlap > OVERLAP_MM) {
          worst.count += 1;
          if (found.overlap > worst.overlap)
            Object.assign(worst, { overlap: found.overlap, at: k * MESH_STEP_DEG, by: found.by });
        }
        if (found.gap > CONTACT_GAP_MM) {
          apart.count += 1;
          if (found.gap > apart.gap) Object.assign(apart, { gap: found.gap, at: k * MESH_STEP_DEG });
        }
      }
    } catch (error) {
      block(`can't check the teeth: ${(error as Error).message}`);
      continue;
    }
    if (worst.count > 0) {
      const why =
        centre < standard - 1e-9
          ? `the centre distance ${mm(centre)} mm is under m(N1 + N2)/2 = ${mm(standard)} mm`
          : worst.by === 0
            ? "the driver's tips reach below the driven gear's base circle (interference): give it fewer teeth, or the driven gear more"
            : "the driven gear's tips reach below the driver's base circle (interference): give it fewer teeth, or the driver more";
      block(
        `the teeth overlap by ${mm(worst.overlap)} mm at θ = ${mm(worst.at)}° (${worst.count} of ${steps} steps): ${why}`,
      );
    }
    if (apart.count > 0)
      block(
        `the teeth don't touch at θ = ${mm(apart.at)}°, ${Number.isFinite(apart.gap) ? mm(apart.gap) : "out of reach"} mm apart at their closest: the centre distance ${mm(centre)} mm is over m(N1 + N2)/2 = ${mm(standard)} mm`,
      );
  }
  return { coverage, findings };
}

export const gearInterferenceGate: Gate = {
  id: "gear-interference",
  checks:
    "every gear pair's teeth at 0.5° steps of the driver until each gear has turned once: they never overlap, and they always touch",
  points: ["job", "deploy"],
  run: gearRun,
  controls: [
    {
      defect: "a gear pair 0.5 mm closer than m(N1 + N2)/2",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "gear-pair", (site) => {
          writeSim(site, (model) => (model["centreDistance"] = closer(site, -0.5)));
        }),
    },
    {
      defect: "a 12-tooth pinion on a 48-tooth wheel at 20°, whose tips cut below its base circle",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "gear-pair", (site) => {
          writeSim(site, (model) => {
            model["teeth"] = [12, 48];
            model["pressureAngle"] = 20;
            delete model["centreDistance"];
          });
        }),
    },
    {
      defect: "a gear pair 0.5 mm further apart than m(N1 + N2)/2, its teeth never touching",
      plant: (good, scratch) =>
        plantInMechanism(good, scratch, "gear-pair", (site) => {
          writeSim(site, (model) => (model["centreDistance"] = closer(site, 0.5)));
        }),
    },
  ],
};

/** The pair's standard centre distance moved by `by` mm. */
function closer(site: MechanismSite, by: number): number {
  const model = site.sim.model as GearPair;
  return (model.module * (model.teeth[0] + model.teeth[1])) / 2 + by;
}

/** Writes the planted sim back: its file as written, with its model edited. */
function writeSim(site: MechanismSite, edit: (model: Record<string, unknown>) => unknown): void {
  const path = join(site.contentDir, site.simEntry);
  if (extname(path) !== ".json")
    throw new Error(`${site.simEntry} isn't JSON: the control writes the sim back as JSON`);
  const raw = readStructured(readFileSync(path, "utf8"), site.simEntry, ignoreMath) as Record<string, unknown>;
  edit(raw["model"] as Record<string, unknown>);
  writeFileSync(path, JSON.stringify(raw));
}
