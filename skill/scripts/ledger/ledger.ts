// The Build ledger commands. Callers (the skill and its subagents) use only these, through the CLI;
// nothing else reads or writes the ledger file.
import { join } from "node:path";
import { hashTree } from "./hash.ts";
import { diffMaterials, kindOf, type MaterialsDiff } from "./materials.ts";
import {
  SCHEMA_VERSION,
  TEMPLATE_DIR,
  type Checkpoint,
  type Intake,
  type JobResult,
  type Ledger,
  type ModuleMap,
  type ModuleRow,
  type Ruling,
  type Wave,
  type WaveKind,
} from "./model.ts";
import { LedgerError, readLedger, updateLedger } from "./store.ts";

function now(): string {
  return new Date().toISOString();
}

function requireLedger(project: string): Ledger {
  const ledger = readLedger(project);
  if (ledger === null) throw new LedgerError("refused", `no Build ledger in ${project}: run intake first`);
  return ledger;
}

/** Applies `change` to the ledger for the session holding its lock; anyone else is refused. */
function mutate<T = void>(project: string, holder: string, change: (ledger: Ledger) => T): T {
  return updateLedger(project, (ledger) => {
    if (ledger === null) throw new LedgerError("refused", `no Build ledger in ${project}: run intake first`);
    if (ledger.lock?.holder !== holder) {
      const held =
        ledger.lock === null ? "nobody holds it" : `${ledger.lock.holder} holds it since ${ledger.lock.since}`;
      throw new LedgerError("refused", `${holder} doesn't hold the ledger lock: ${held}`);
    }
    return { ledger, result: change(ledger) };
  });
}

/** Every kind of row that can be superseded, with how its id is written on the command line. */
const TABLES = {
  material: { rows: (l: Ledger) => l.materials, id: (r: Ledger["materials"][number]) => r.path },
  module: { rows: (l: Ledger) => l.modules, id: (r: Ledger["modules"][number]) => r.id },
  wave: { rows: (l: Ledger) => l.waves, id: (r: Ledger["waves"][number]) => r.id },
  job: { rows: (l: Ledger) => l.jobs, id: (r: Ledger["jobs"][number]) => `${r.wave}/${r.job}` },
  checkpoint: { rows: (l: Ledger) => l.checkpoints, id: (r: Ledger["checkpoints"][number]) => r.key },
  override: { rows: (l: Ledger) => l.template.overrides, id: (r: Ledger["template"]["overrides"][number]) => r.path },
} as const;

export type RowKind = keyof typeof TABLES;
export const ROW_KINDS = Object.keys(TABLES) as RowKind[];

interface SupersededRow {
  row: RowKind;
  id: string;
  at: string;
  reason: string;
}

function supersededRows(ledger: Ledger): SupersededRow[] {
  return ROW_KINDS.flatMap((row) => {
    const table = TABLES[row] as {
      rows: (l: Ledger) => { superseded: { at: string; reason: string } | null }[];
      id: (r: never) => string;
    };
    return table
      .rows(ledger)
      .flatMap((r) => (r.superseded === null ? [] : [{ row, id: table.id(r as never), ...r.superseded }]));
  });
}

const current = <T extends { superseded: unknown }>(rows: T[]): T[] => rows.filter((row) => row.superseded === null);

export interface PlannedWave {
  kind: "module";
  target: string;
  reasons: ("planned" | "failed" | "materials-changed" | "materials-deleted")[];
}

export type NextAction =
  | { action: "intake" }
  | { action: "resume"; waves: Pick<Wave, "id" | "kind" | "target" | "branch" | "state">[] }
  | { action: "waves"; newMaterials: MaterialsDiff["new"]; waves: PlannedWave[] };

export function nextAction(project: string): NextAction {
  const ledger = readLedger(project);
  if (ledger === null) return { action: "intake" };
  const running = current(ledger.waves).filter((wave) => wave.state === "running");
  if (running.length > 0) {
    return {
      action: "resume",
      waves: running.map(({ id, kind, target, branch, state }) => ({ id, kind, target, branch, state })),
    };
  }
  const diff = diffMaterials(ledger);
  const waves: PlannedWave[] = [];
  for (const module of current(ledger.modules)) {
    const reasons: PlannedWave["reasons"] = [];
    if (module.state === "planned" || module.state === "failed") reasons.push(module.state);
    if (diff.changed.some((file) => file.module === module.id)) reasons.push("materials-changed");
    if (diff.deleted.some((file) => file.module === module.id)) reasons.push("materials-deleted");
    if (reasons.length > 0) waves.push({ kind: "module", target: module.id, reasons });
  }
  // Module 1 runs alone first on a new Course: it writes the Course style sheet every other Module follows.
  const firstBuilt = ledger.modules.some((module) => module.state === "live");
  return { action: "waves", newMaterials: diff.new, waves: firstBuilt ? waves : waves.slice(0, 1) };
}

export function diff(project: string): MaterialsDiff {
  return diffMaterials(requireLedger(project));
}

/** Creates the ledger at intake: the Owner's answers, the pinned release and its template hashes. The caller holds the lock from here on. */
export function init(project: string, holder: string, release: string, intake: Intake): void {
  updateLedger(project, (existing) => {
    if (existing !== null) throw new LedgerError("refused", `${project} already has a Build ledger`);
    const ledger: Ledger = {
      schema: SCHEMA_VERSION,
      intake,
      template: { release, files: hashTree(join(project, TEMPLATE_DIR)), overrides: [] },
      materials: [],
      modules: [],
      waves: [],
      jobs: [],
      checkpoints: [],
      lock: { holder, since: now(), tookOverFrom: null },
    };
    return { ledger, result: undefined };
  });
}

/** Records the Owner-confirmed Module map (or an addition to it) and inventories the files it names. */
export function map(project: string, holder: string, moduleMap: ModuleMap): void {
  mutate(project, holder, (ledger) => {
    const onDisk = hashTree(ledger.intake.materialsPath);
    const inventoried = new Set(current(ledger.materials).map((m) => m.path));
    const at = now();
    const entries = [
      ...moduleMap.modules.flatMap((m) => m.materials.map((path) => ({ path, module: m.id as string | null }))),
      ...moduleMap.unmapped.map((path) => ({ path, module: null })),
    ];
    for (const { path, module } of entries) {
      const hash = onDisk[path];
      if (hash === undefined) throw new LedgerError("invalid", `${path} isn't in the Materials folder`);
      if (inventoried.has(path)) throw new LedgerError("invalid", `${path} is already in the Module map`);
      inventoried.add(path);
      ledger.materials.push({ path, hash, kind: kindOf(path), module, recordedAt: at, superseded: null });
    }
    for (const { id, slug, title } of moduleMap.modules) {
      const existing = current(ledger.modules).find((m) => m.id === id);
      if (existing === undefined)
        ledger.modules.push({ id, slug, title, state: "planned", recordedAt: at, superseded: null });
      else if (existing.slug !== slug || existing.title !== title) {
        throw new LedgerError("invalid", `Module ${id} is already mapped as ${existing.slug} "${existing.title}"`);
      }
    }
  });
}

/**
 * Claims the lock for `holder`. Refused while another session holds it, unless `takeOver` gives the
 * reason (a dead session, on the Owner's word). Claiming a lock you already hold keeps it.
 */
export function claimLock(project: string, holder: string, takeOver: string | null): void {
  updateLedger(project, (ledger) => {
    if (ledger === null) throw new LedgerError("refused", `no Build ledger in ${project}: run intake first`);
    const held = ledger.lock;
    if (held?.holder === holder) return { ledger, result: undefined };
    let tookOverFrom = null;
    if (held !== null) {
      if (takeOver === null) {
        throw new LedgerError("refused", `the ledger lock is held by ${held.holder} since ${held.since}`);
      }
      tookOverFrom = { holder: held.holder, since: held.since, reason: takeOver };
    }
    ledger.lock = { holder, since: now(), tookOverFrom };
    return { ledger, result: undefined };
  });
}

export function releaseLock(project: string, holder: string): void {
  mutate(project, holder, (ledger) => {
    ledger.lock = null;
  });
}

/** Starts a wave on a Module or Exam sitting, at the ledger's pinned release. Returns the wave's id. */
export function startWave(project: string, holder: string, kind: WaveKind, target: string, branch: string): string {
  return mutate(project, holder, (ledger) => {
    if (kind === "module" && !current(ledger.modules).some((m) => m.id === target)) {
      throw new LedgerError("invalid", `Module ${target} isn't in the Module map`);
    }
    if (kind === "sitting" && !ledger.intake.sittings.some((s) => s.id === target)) {
      throw new LedgerError("invalid", `no Exam sitting "${target}" in the intake answers`);
    }
    const running = current(ledger.waves).find((w) => w.kind === kind && w.target === target && w.state === "running");
    if (running !== undefined)
      throw new LedgerError("refused", `wave ${running.id} is already running on ${kind} ${target}`);
    const id = `${kind}-${target}-${ledger.waves.filter((w) => w.kind === kind && w.target === target).length + 1}`;
    ledger.waves.push({
      id,
      kind,
      target,
      branch,
      release: ledger.template.release,
      state: "running",
      startedAt: now(),
      endedAt: null,
      commit: null,
      superseded: null,
    });
    if (kind === "module") {
      setModuleState(ledger, target, "building");
      takeInMaterials(ledger, target);
    }
    return id;
  });
}

/** Ends a running wave: merged (with the commit that merged it) or failed. */
export function endWave(
  project: string,
  holder: string,
  id: string,
  result: "merged" | "failed",
  commit: string | null,
): void {
  mutate(project, holder, (ledger) => {
    const wave = current(ledger.waves).find((w) => w.id === id);
    if (wave === undefined) throw new LedgerError("invalid", `no current wave ${id}`);
    if (wave.state !== "running") throw new LedgerError("refused", `wave ${id} already ended ${wave.state}`);
    if (result === "merged" && commit === null) throw new LedgerError("invalid", "a merged wave needs --commit");
    wave.state = result;
    wave.endedAt = now();
    wave.commit = commit;
    if (wave.kind === "module") setModuleState(ledger, wave.target, result === "merged" ? "live" : "failed");
  });
}

/** A Module wave builds from its Materials as they are now: changed files get a fresh row, deleted ones leave. */
function takeInMaterials(ledger: Ledger, module: string): void {
  const onDisk = hashTree(ledger.intake.materialsPath);
  const at = now();
  for (const row of current(ledger.materials).filter((m) => m.module === module)) {
    const hash = onDisk[row.path];
    if (hash === row.hash) continue;
    row.superseded = { at, reason: hash === undefined ? "deleted from the Materials" : "changed on disk" };
    if (hash !== undefined) ledger.materials.push({ ...row, hash, recordedAt: at, superseded: null });
  }
}

/** Records a job's result in a running wave. A job already recorded in that wave is superseded as a re-run. */
export function recordJob(
  project: string,
  holder: string,
  job: { wave: string; job: string; result: JobResult; startedAt: string | null; detail: string | null },
): void {
  mutate(project, holder, (ledger) => {
    const wave = current(ledger.waves).find((w) => w.id === job.wave);
    if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${job.wave}`);
    const at = now();
    for (const row of current(ledger.jobs)) {
      if (row.wave === job.wave && row.job === job.job) row.superseded = { at, reason: "re-run" };
    }
    ledger.jobs.push({ ...job, recordedAt: at, superseded: null });
  });
}

/** Stores the Owner's answer to a Checkpoint item raised in a running wave. A new answer supersedes the old. */
export function recordCheckpoint(
  project: string,
  holder: string,
  item: { wave: string; key: string; question: string; answer: string; ruling: Ruling | null },
): void {
  mutate(project, holder, (ledger) => {
    const wave = current(ledger.waves).find((w) => w.id === item.wave);
    if (wave === undefined || wave.state !== "running")
      throw new LedgerError("invalid", `no running wave ${item.wave}`);
    const at = now();
    for (const row of current(ledger.checkpoints)) {
      if (row.key === item.key) row.superseded = { at, reason: "answered again" };
    }
    ledger.checkpoints.push({ ...item, answeredAt: at, superseded: null });
  });
}

/** The Owner's current answer to a Checkpoint item, or null if it was never asked. */
export function checkpointAnswer(project: string, key: string): Checkpoint | null {
  return current(requireLedger(project).checkpoints).find((row) => row.key === key) ?? null;
}

/** The template layer against the hashes pinned for its release: any edit outside the overrides area shows. */
export function verifyIntegrity(project: string) {
  const ledger = requireLedger(project);
  const pinned = ledger.template.files;
  const onDisk = hashTree(join(project, TEMPLATE_DIR));
  const modified = Object.keys(pinned).filter((path) => path in onDisk && onDisk[path] !== pinned[path]);
  const added = Object.keys(onDisk).filter((path) => !(path in pinned));
  const missing = Object.keys(pinned).filter((path) => !(path in onDisk));
  return {
    intact: modified.length + added.length + missing.length === 0,
    release: ledger.template.release,
    modified,
    added,
    missing,
  };
}

/** Records a Course override of a template-layer file and the gate gap it works around. A new record for the same file supersedes the old. */
export function recordOverride(project: string, holder: string, path: string, gateGap: number): void {
  mutate(project, holder, (ledger) => {
    if (!(path in ledger.template.files)) throw new LedgerError("invalid", `${path} isn't a template-layer file`);
    const at = now();
    for (const row of current(ledger.template.overrides)) {
      if (row.path === path) row.superseded = { at, reason: "re-recorded" };
    }
    ledger.template.overrides.push({ path, gateGap, recordedAt: at, superseded: null });
  });
}

/**
 * Marks a row superseded: it stays in the ledger as history but stops counting. A superseded Module's
 * Materials come back as new, to be mapped again. A running wave is ended, not superseded.
 */
export function supersede(project: string, holder: string, row: RowKind, id: string, reason: string): void {
  mutate(project, holder, (ledger) => {
    const table = TABLES[row] as { rows: (l: Ledger) => { superseded: unknown }[]; id: (r: never) => string };
    const target = current(table.rows(ledger)).find((r) => table.id(r as never) === id);
    if (target === undefined) throw new LedgerError("invalid", `no current ${row} ${id}`);
    if (row === "wave" && (target as Wave).state === "running") {
      throw new LedgerError("refused", `wave ${id} is still running: end it first`);
    }
    const at = now();
    target.superseded = { at, reason };
    if (row === "module") {
      for (const material of current(ledger.materials).filter((m) => m.module === id)) {
        material.superseded = { at, reason: "its Module was superseded" };
      }
    }
  });
}

function setModuleState(ledger: Ledger, id: string, state: ModuleRow["state"]): void {
  const module = current(ledger.modules).find((m) => m.id === id);
  if (module === undefined) throw new LedgerError("invalid", `Module ${id} isn't in the Module map`);
  module.state = state;
  module.recordedAt = now();
}

export function status(project: string) {
  const ledger = requireLedger(project);
  const materials = current(ledger.materials);
  return {
    course: ledger.intake.courseName,
    materialsPath: ledger.intake.materialsPath,
    template: {
      release: ledger.template.release,
      files: ledger.template.files,
      overrides: current(ledger.template.overrides).map(({ path, gateGap, recordedAt }) => ({
        path,
        gateGap,
        recordedAt,
      })),
    },
    lock: ledger.lock,
    modules: current(ledger.modules).map(({ id, slug, title, state }) => ({
      id,
      slug,
      title,
      state,
      materials: materials.filter((m) => m.module === id).map((m) => m.path),
    })),
    waves: current(ledger.waves),
    jobs: current(ledger.jobs),
    checkpoints: current(ledger.checkpoints),
    superseded: supersededRows(ledger),
  };
}
