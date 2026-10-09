// A relaunched subagent. When a subagent dies mid-job, the one relaunched in its place first re-gates
// its predecessor's files and reviews them: each is kept (unchanged and clean), fixed (changed, and
// clean on a fresh re-gate) or discarded (deleted). Unchecked work is never counted as done, and the
// Build ledger records the outcome per file. A relaunched Blind reader is given only its own
// predecessor's reading: never the other reader's, nor anything reconcile made from both.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { privateFolderOf } from "../intake/create.ts";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { current, RELAUNCH_OUTCOMES, TEMPLATE_DIR, type Relaunch, type RelaunchOutcome } from "../ledger/model.ts";
import { closeRelaunch, openRelaunch, openRelaunchOf } from "../ledger/relaunch.ts";
import { arr, nonEmpty, obj, oneOf, SchemaError } from "../ledger/schema.ts";
import { readingSchema, waveFolder } from "./reading.ts";
import { moduleFolder } from "./wave.ts";

/** One blocking finding of the template's per-job gates: the gate, the place (`file:line`) and what. */
export interface JobGateFinding {
  gate: string;
  at?: string;
  message: string;
}

/** The Course project's per-job gates, as the re-gate runs them. A seam: faked in tests. */
export interface JobGates {
  run(project: string, folder: string): { ran: boolean; findings: JobGateFinding[]; error?: string };
}

/** Runs `node template/gates/cli.ts run --point job --module <folder>` into a scratch report, never the Module's own. */
export const templateJobGates: JobGates = {
  run(given, folder) {
    const project = resolve(given);
    const cli = join(project, TEMPLATE_DIR, "gates", "cli.ts");
    if (!existsSync(cli))
      return {
        ran: false,
        findings: [],
        error: `the template layer has no gate runner (${TEMPLATE_DIR}/gates/cli.ts)`,
      };
    const scratch = mkdtempSync(join(tmpdir(), "lp-regate-"));
    const report = join(scratch, "job.json");
    try {
      const child = spawnSync(
        process.execPath,
        [
          join("gates", "cli.ts"),
          "run",
          "--point",
          "job",
          "--module",
          folder,
          "--content",
          join(project, CONTENT_DIR),
          "--report",
          report,
        ],
        { cwd: join(project, TEMPLATE_DIR), encoding: "utf8" },
      );
      if (!existsSync(report))
        return {
          ran: false,
          findings: [],
          error: (child.stderr ?? "").trim() || child.error?.message || "no Gate report",
        };
      const gates = (
        JSON.parse(readFileSync(report, "utf8")) as {
          gates: { id: string; error?: string; findings: { outcome: string; at?: string; message: string }[] }[];
        }
      ).gates;
      return {
        ran: true,
        findings: gates.flatMap((g) => [
          ...(g.error === undefined ? [] : [{ gate: g.id, message: `didn't run: ${g.error}` }]),
          ...g.findings
            .filter((f) => f.outcome === "block")
            .map((f) => ({ gate: g.id, message: f.message, ...(f.at === undefined ? {} : { at: f.at }) })),
        ]),
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

const PRIVATE = "private:";
const BLIND_READER = /^blind-reader-([ab])$/;

/** A predecessor file as the ledger names it, and where it is on disk. */
interface Located {
  path: string;
  full: string;
}

function sha256(full: string): string {
  return createHash("sha256").update(readFileSync(full)).digest("hex");
}

/** Every file a `--files` entry names: a file, or each file under a folder; refused outside the project and the Private folder. */
function locate(project: string, privateFolder: string, given: string): Located[] {
  const inPrivate = given.startsWith(PRIVATE);
  const root = inPrivate ? privateFolder : project;
  const full = join(root, inPrivate ? given.slice(PRIVATE.length) : given);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel))
    throw new LedgerError("invalid", `${given} isn't in the Course project or (as private:<path>) the Private folder`);
  if (!existsSync(full)) throw new LedgerError("invalid", `${given} isn't there: name the files the predecessor left`);
  const name = (r: string) => `${inPrivate ? PRIVATE : ""}${r.split(sep).join("/")}`;
  if (statSync(full).isFile()) return [{ path: name(rel), full }];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .sort()
    .map((f) => ({ path: name(relative(root, f)), full: f }));
}

interface Regated {
  path: string;
  covered: boolean;
  findings: string[];
}

/** Re-gates the files: a Blind reader's reading on its shape, content files through the per-job gates. */
function regate(
  project: string,
  module: string,
  folder: string,
  job: string,
  files: Located[],
  gates: JobGates,
): Regated[] {
  const reader = BLIND_READER.exec(job)?.[1];
  const contentFiles = files.filter((f) => f.path.startsWith(`${CONTENT_DIR}/`));
  const ran = contentFiles.length > 0 && reader === undefined ? gates.run(project, folder) : null;
  return files.map((f) => {
    if (reader !== undefined) return { path: f.path, covered: true, findings: readingFindings(f.full, reader, module) };
    if (!contentFiles.includes(f)) return { path: f.path, covered: false, findings: [] };
    const at = f.path.slice(CONTENT_DIR.length + 1);
    if (ran === null || !ran.ran)
      return { path: f.path, covered: true, findings: [`the job gates didn't run: ${ran?.error ?? "unknown"}`] };
    const findings = ran.findings
      .filter((g) => g.at === undefined || g.at === at || g.at.startsWith(`${at}:`))
      .map((g) => `${g.gate}: ${g.message}`);
    return { path: f.path, covered: true, findings };
  });
}

/** What's wrong with a Blind reader's reading as a file: unreadable, the wrong shape, reader or Module. */
function readingFindings(full: string, reader: string, module: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    return [`it isn't JSON: ${(error as Error).message}`];
  }
  try {
    const reading = readingSchema(data, "reading");
    if (reading.reader !== reader) return [`it is reader ${reading.reader}'s reading, not reader ${reader}'s`];
    if (reading.module !== module) return [`it reads Module ${reading.module}, not ${module}`];
    return [];
  } catch (error) {
    if (error instanceof SchemaError) return [error.message];
    throw error;
  }
}

/** The running wave a relaunch belongs to, its Module and its Private folder. */
function waveContext(project: string, waveId: string) {
  const ledger = requireLedger(project);
  const wave = current(ledger.waves).find((w) => w.id === waveId);
  if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${waveId}`);
  if (wave.kind !== "module") throw new LedgerError("invalid", `${waveId} is a ${wave.kind} wave, not a Module wave`);
  const { folder } = moduleFolder(ledger, wave.target);
  return { ledger, module: wave.target, folder, privateFolder: privateFolderOf(ledger.intake.materialsPath) };
}

/** `relaunch open`: re-gates the dead predecessor's files and records the relaunch as open in the ledger. */
export function relaunchOpen(
  project: string,
  holder: string,
  waveId: string,
  job: string,
  given: string[],
  gates: JobGates,
) {
  const { module, folder, privateFolder } = waveContext(project, waveId);
  const reader = BLIND_READER.exec(job)?.[1];
  let files: Located[];
  if (reader !== undefined) {
    // A relaunched Blind reader never sees the other reader's output, nor anything reconcile made from both.
    const own = `${PRIVATE}waves/${module}/reading-${reader}.json`;
    const others = given.filter((g) => g !== own);
    if (others.length > 0)
      throw new LedgerError(
        "invalid",
        `a relaunched Blind reader is given only its own predecessor's reading (${own}), never ${others.join(", ")}`,
      );
    files = locate(project, privateFolder, own);
  } else {
    if (given.length === 0) throw new LedgerError("invalid", "--files is required: the files the predecessor left");
    files = given.flatMap((g) => locate(project, privateFolder, g));
  }
  const unique = [...new Map(files.map((f) => [f.path, f])).values()];
  const regated = regate(project, module, folder, job, unique, gates);
  openRelaunch(project, holder, {
    wave: waveId,
    job,
    files: unique.map((f, i) => ({
      path: f.path,
      before: sha256(f.full),
      covered: regated[i]?.covered ?? false,
      findings: regated[i]?.findings.length ?? 0,
    })),
  });
  const next =
    reader !== undefined
      ? `relaunch the reader with only its brief, the Module's Materials and its own predecessor's reading (${waveFolder(privateFolder, module)}${sep}reading-${reader}.json): never the other reader's reading, reading.json, resolutions.json, the crops or the disputes. It reviews the reading first, then the outcomes go to relaunch close`
      : "give the relaunched subagent these files and findings first: it must review each file and leave it kept, fixed or discarded before building on it; then record the outcomes with relaunch close";
  return { files: regated, next };
}

const outcomesSchema = obj({ files: arr(obj({ path: nonEmpty, outcome: oneOf(...RELAUNCH_OUTCOMES) })) });

/** `relaunch close`: checks each outcome against the files as they are now, then settles the relaunch in the ledger. */
export function relaunchClose(
  project: string,
  holder: string,
  waveId: string,
  job: string,
  input: unknown,
  gates: JobGates,
) {
  const { ledger, module, folder, privateFolder } = waveContext(project, waveId);
  const row = openRelaunchOf(ledger.relaunches, waveId, job);
  if (row === undefined) throw new LedgerError("refused", `no open relaunch of ${job} in ${waveId}`);
  const given = new Map(outcomesSchema(input, "outcomes").files.map((f) => [f.path, f.outcome]));
  const where = (path: string) =>
    path.startsWith(PRIVATE) ? join(privateFolder, path.slice(PRIVATE.length)) : join(project, path);

  const problems: string[] = [];
  for (const path of given.keys())
    if (!row.files.some((f) => f.path === path)) problems.push(`${path} wasn't one of the predecessor's files`);
  const fixed = row.files.filter((f) => given.get(f.path) === "fixed" && existsSync(where(f.path)));
  const regated = new Map(
    regate(
      project,
      module,
      folder,
      job,
      fixed.map((f) => ({ path: f.path, full: where(f.path) })),
      gates,
    ).map((r) => [r.path, r]),
  );
  const settled = new Map<string, { outcome: RelaunchOutcome; after: string | null }>();
  for (const file of row.files) {
    const outcome = given.get(file.path);
    const full = where(file.path);
    const there = existsSync(full);
    const hash = there ? sha256(full) : null;
    const problem = outcomeProblem(file, outcome, there, hash, regated.get(file.path)?.findings ?? []);
    if (problem !== null) problems.push(problem);
    else if (outcome !== undefined) settled.set(file.path, { outcome, after: outcome === "discarded" ? null : hash });
  }
  if (problems.length > 0) return { code: 1, problems };
  closeRelaunch(project, holder, waveId, job, settled);
  return { problems, files: [...settled].map(([path, s]) => ({ path, outcome: s.outcome })) };
}

function outcomeProblem(
  file: Relaunch["files"][number],
  outcome: RelaunchOutcome | undefined,
  there: boolean,
  hash: string | null,
  findingsNow: string[],
): string | null {
  const path = file.path;
  switch (outcome) {
    case undefined:
      return `no outcome for ${path}`;
    case "kept":
      if (!there) return `${path} is marked kept but isn't there`;
      if (hash !== file.before) return `${path} is marked kept but changed since the re-gate: mark it fixed`;
      return file.findings > 0
        ? `${path} had ${file.findings} re-gate finding${file.findings === 1 ? "" : "s"}: fix it or discard it, it can't be kept`
        : null;
    case "fixed":
      if (!there) return `${path} is marked fixed but isn't there`;
      if (hash === file.before) return `${path} is marked fixed but is unchanged since the re-gate: keep it or fix it`;
      return findingsNow.length > 0
        ? `${path} is marked fixed but the job gates still find: ${findingsNow.join("; ")}`
        : null;
    case "discarded":
      return there ? `${path} is marked discarded but is still there: delete it` : null;
  }
}

/** Why the wave can't merge on its relaunches: one whose predecessor's files aren't settled. */
export function relaunchProblems(relaunches: Relaunch[], waveId: string): string[] {
  return current(relaunches)
    .filter((r) => r.wave === waveId && r.closedAt === null)
    .map((r) => `job ${r.job} was relaunched but its predecessor's files aren't settled: wave.ts relaunch close`);
}
