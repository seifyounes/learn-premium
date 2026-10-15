// A sim builder's hand-back: the report a builder leaves in the Private folder when it finishes
// (`<Private>/waves/<NN>/builders/<name>.json`). `handback` checks it and, when it is clean, keeps
// only its counts on the tool's row in the Build ledger: the hand-back itself names the figure and
// quotes the Professor, so the ledger and the build report never carry its text. A builder reports no
// time (the main agent measures it with `record job --started-at`), and a hand-back with unreadable
// regions, a failed self-check or counts that disagree with the content goes back to be settled.
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { privateFolderOf } from "../intake/create.ts";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { assignmentOf, updateTool } from "../ledger/assignments.ts";
import { LedgerError } from "../ledger/file.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { BUILD_RECORDS_DIR, count, current, moduleId } from "../ledger/model.ts";
import { arr, bool, fail, nonEmpty, nullable, obj, type Infer } from "../ledger/schema.ts";
import { box, pageNumber, readJsonFile, waveFolder } from "./reading.ts";
import { moduleFolder, type Verifier } from "./wave.ts";

export const HANDBACK = "learn-premium sim builder v1";

/** Where a Module's builders leave their hand-backs, in the Private folder. */
export const buildersFolder = (privateFolder: string, module: string) =>
  join(waveFolder(privateFolder, module), "builders");

const handbackSchema = obj({
  handback: (v, p) => (v === HANDBACK ? HANDBACK : fail(p, JSON.stringify(HANDBACK), v)),
  module: moduleId,
  name: nonEmpty,
  /** The tool it built: the Toolkit tool it was assigned, or what it fell back to. */
  tool: nonEmpty,
  /** The Professor's figure it read the sim from. */
  figure: obj({ file: nonEmpty, page: nullable(pageNumber), box: nullable(box), label: nullable(nonEmpty) }),
  /** Every file it wrote, relative to the Course project. */
  files: arr(nonEmpty),
  counts: obj({ parts: count, nets: count }),
  assumptions: arr(obj({ value: nonEmpty, why: nonEmpty })),
  /** A region of the figure it couldn't read: settled on its crop before the hand-back is accepted. */
  unreadables: arr(obj({ where: nonEmpty, what: nonEmpty })),
  selfCheck: obj({ ran: arr(nonEmpty), passed: bool, notes: nullable(nonEmpty) }),
});
export type Handback = Infer<typeof handbackSchema>;

/** A key that names a time: a builder reports none, because the main agent measures it. */
const TIME_KEY = /time|minute|second|duration|elapsed|took|started|finished/i;

function timeKey(value: unknown, path = "handback"): string | null {
  if (typeof value !== "object" || value === null) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (TIME_KEY.test(key)) return `${path}.${key}`;
    const found = timeKey(inner, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

/** A file a builder may report: under its Module's content folder or the build records, never outside the Course project. */
function reportable(file: string, folder: string): boolean {
  const path = normalize(file).replaceAll("\\", "/");
  if (isAbsolute(file) || path.startsWith("..")) return false;
  return (
    path.startsWith(`${CONTENT_DIR}/modules/${folder}/`) || path.startsWith(`${CONTENT_DIR}/${BUILD_RECORDS_DIR}/`)
  );
}

/**
 * `handback`: checks the builder's hand-back for tool `name` and, when it is clean, stores its
 * counts. Exit 2 for a hand-back that is malformed, reports a time, names a file outside the Module
 * or lacks the tool's own file; exit 1, nothing stored, for one that has to go back to the builder
 * or the main agent first.
 */
export function handback(project: string, holder: string, waveId: string, name: string, verifier: Verifier) {
  const ledger = requireLedger(project);
  const wave = current(ledger.waves).find((w) => w.id === waveId);
  if (wave === undefined || wave.state !== "running") throw new LedgerError("invalid", `no running wave ${waveId}`);
  if (wave.kind !== "module") throw new LedgerError("invalid", `${waveId} is a ${wave.kind} wave, not a Module wave`);
  const row = assignmentOf(ledger, waveId)?.tools.find((t) => t.name === name);
  if (row === undefined) throw new LedgerError("invalid", `wave ${waveId}'s tool assignment has no tool ${name}`);
  const module = wave.target;
  const moduleFolderName = moduleFolder(ledger, module).folder;

  const path = join(buildersFolder(privateFolderOf(ledger.intake.materialsPath), module), `${name}.json`);
  const raw = readJsonFile<unknown>(path, (v) => v, `hand-back of ${name}`);
  const timed = timeKey(raw);
  if (timed !== null)
    throw new LedgerError(
      "invalid",
      `${path}: ${timed} is a time: the hand-back carries no time, the main agent measures it (record job --started-at)`,
    );
  const given = readJsonFile(path, handbackSchema, `hand-back of ${name}`);
  if (given.module !== module || given.name !== name)
    throw new LedgerError(
      "invalid",
      `${path} is the hand-back of ${given.name} in Module ${given.module}, not ${name} in Module ${module}`,
    );

  const outside = given.files.filter((f) => !reportable(f, moduleFolderName));
  if (outside.length > 0)
    throw new LedgerError(
      "invalid",
      `the hand-back names files outside content/modules/${moduleFolderName}/ and content/${BUILD_RECORDS_DIR}/: ${outside.join(", ")}`,
    );
  const missing = given.files.filter((f) => !existsSync(join(project, f)));
  if (missing.length > 0)
    throw new LedgerError("invalid", `the hand-back names files that aren't there: ${missing.join(", ")}`);
  const own = new RegExp(`^${CONTENT_DIR}/modules/${moduleFolderName}/(sims|python|parts)/${name}\\.[a-z]+$`);
  if (!given.files.some((f) => own.test(normalize(f).replaceAll("\\", "/"))))
    throw new LedgerError(
      "invalid",
      `the hand-back's files don't include the tool's own file (sims/, python/ or parts/ ${name}.*)`,
    );

  const problems: string[] = [];
  if (!given.selfCheck.passed)
    problems.push(
      `its self-check didn't pass${given.selfCheck.notes === null ? "" : ` (${given.selfCheck.notes})`}: the builder fixes it, then hands back again`,
    );
  if (given.unreadables.length > 0)
    problems.push(
      `${given.unreadables.length} unreadable region${given.unreadables.length === 1 ? "" : "s"} (${given.unreadables.map((u) => u.where).join("; ")}): settle each on its crop, then hand back again, or record the job --result checkpoint`,
    );
  const inventory = verifier.inventory(project, moduleFolderName);
  if (typeof inventory === "string")
    problems.push(`the content's tools can't be read to check the counts: ${inventory}`);
  else {
    const counts = inventory.tools.find((t) => t.name === name)?.counts ?? null;
    if (counts !== null && (counts.parts !== given.counts.parts || counts.nets !== given.counts.nets))
      problems.push(
        `it counts ${given.counts.parts} parts and ${given.counts.nets} nets, but the sim's model has ${counts.parts} parts and ${counts.nets} nets`,
      );
  }
  if (problems.length > 0) return { code: 1, problems, next: "settle these, then run handback again" };

  updateTool(project, holder, waveId, name, (tool) => {
    tool.handback = {
      at: new Date().toISOString(),
      files: given.files.length,
      parts: given.counts.parts,
      nets: given.counts.nets,
      assumptions: given.assumptions.length,
    };
  });
  return { problems, files: given.files.length, ...given.counts, assumptions: given.assumptions.length };
}
