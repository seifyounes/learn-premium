// The Sitting wave's merge gate and batched Checkpoint. A Sitting wave builds one Exam sitting's
// Exam room (its past-paper vault, mocks, question bank) and Revision, on the Owner's word that the
// sitting is complete. `ready` holds it to what that word named: the Modules it covers are live, the
// past papers in the content are exactly the ones he named and match the settled reading of the
// Materials (text, order, marks, key), the sitting and deploy Gate reports are green for HEAD on a
// preview, every Checkpoint item is answered (the build's own solution of a key-less paper, the
// announced format, a Slip or Divergence on the Professor's key), and nothing else in the Course changed.
// The papers' text is read here from the template's dump of the content, never from the Materials.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { HOOKS_PATH, privateFolderOf } from "../intake/create.ts";
import { LedgerError } from "../ledger/file.ts";
import { hashTree } from "../ledger/hash.ts";
import { completeRow, requireLedger, verifyIntegrity } from "../ledger/ledger.ts";
import { current, type SittingComplete, type Wave } from "../ledger/model.ts";
import { arr, bool, fail, nonEmpty, nullable, obj, record, SchemaError, type Schema } from "../ledger/schema.ts";
import {
  itemKey,
  same,
  settledSittingReading,
  settledSittingProblem,
  sittingCheckpointItems,
  sittingFolder,
  type ReadItem,
} from "./reading.ts";
import { inventoryProblems, sittingTree, treeProblems, waveTree } from "./tree.ts";
import {
  checkedOutBranch,
  classifyItems,
  gateCli,
  gateItemKey,
  hookInstalled,
  integrityProblem,
  markdownOf,
  moduleFolder,
  readReport,
  SHEET_GATES,
  unruled,
  type CheckpointItem,
  type CheckpointState,
  type ContentRuling,
  type ReportItem,
  type Verifier,
} from "./wave.ts";

// What the template's `gates sitting` command prints (gates/sittings.ts `sittingDump`): the content
// as written, so the skill can hold the past papers to their settled reading without a YAML parser.
const text: Schema<string> = (v, p) => (typeof v === "string" ? v : fail(p, "a string", v));
const number: Schema<number> = (v, p) => (typeof v === "number" && Number.isFinite(v) ? v : fail(p, "a number", v));
const anything: Schema<unknown> = (v) => v;

const dumpQuestion = obj({
  n: number,
  module: text,
  type: text,
  reverse: bool,
  marks: number,
  question: text,
  kind: text,
  key: nullable(text),
});

const dumpPaper = obj({
  name: nonEmpty,
  key: anything,
  marks: anything,
  minutes: anything,
  questions: arr(dumpQuestion),
});

const ruling: Schema<ContentRuling> = (v, p) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(p, "an object", v);
  const { cell, ...rest } = v as Record<string, unknown>;
  const parsed = obj({
    entry: nonEmpty,
    kind: (x, q) => (x === "slip" || x === "divergence" ? x : fail(q, "slip or divergence", x)),
    printed: arr(number),
  })(rest, p);
  return cell === undefined ? parsed : { ...parsed, cell: nonEmpty(cell, `${p}.cell`) };
};

const dumpSchema = obj({
  course: record(anything),
  sitting: nullable(record(anything)),
  papers: arr(dumpPaper),
  mocks: arr(obj({ name: nonEmpty, pattern: anything })),
  format: nullable(record(anything)),
  rulings: arr(ruling),
});

export type SittingDump = ReturnType<typeof dumpSchema>;
export type DumpPaper = SittingDump["papers"][number];
/** Reads a sitting's content as written, in a checkout of the Course project (a seam: faked in tests). */
export type SittingDumper = (dir: string, id: string) => SittingDump | string;

/** Runs the Course project's own template layer: `node template/gates/cli.ts sitting --sitting ID`. */
export const templateDump: SittingDumper = (dir, id) => {
  const run = gateCli(dir, ["sitting", "--sitting", id]);
  if (!run.ok) return `the template can't read sitting ${id}'s content: ${run.said.join("; ")}`;
  try {
    return dumpSchema(JSON.parse(run.out), "the sitting dump");
  } catch (error) {
    if (error instanceof SchemaError || error instanceof SyntaxError)
      return `the template's sitting dump isn't one: ${error.message}`;
    throw error;
  }
};

/** The jobs every Sitting wave records before it merges: with past papers all of these, without them only the last two. */
export const SITTING_JOBS_WITH_PAPERS = [
  "blind-reader-a",
  "blind-reader-b",
  "reconcile",
  "vault-writer",
  "mock-writer",
  "recompute",
  "sitting-gates",
  "deploy-gates",
] as const;
export const SITTING_JOBS_WITHOUT_PAPERS = ["sitting-gates", "deploy-gates"] as const;
/** Written only for a past paper the Professor printed no key for: the build solves it. */
export const SOLVER_JOB = "solver";

const quoted = (list: readonly string[]) => list.map((s) => `"${s}"`).join(", ");

/**
 * How the content's past papers differ from the settled reading of the Materials: a paper the
 * reading or the content lacks, a question count, order, text (whitespace aside), marks, key (a key
 * item exists exactly when the Professor's paper prints one, and then reads the same), a paper's total
 * and its minutes. A value the readers couldn't read (null) is the Owner's Checkpoint item, not a
 * mismatch. Question n of the content is the n-th question the reading names, in the order it first
 * names them, which is the paper's own order.
 */
export function faithfulProblems(papers: readonly DumpPaper[], settled: readonly ReadItem[]): string[] {
  const problems: string[] = [];
  const bySlug = new Map<string, ReadItem[]>();
  for (const item of settled) {
    const slug = item.key.split("/")[0] ?? "";
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), item]);
  }
  for (const slug of bySlug.keys())
    if (!papers.some((p) => p.name === slug))
      problems.push(`the settled reading has a past paper "${slug}" that the content doesn't have`);
  for (const paper of papers) {
    const items = bySlug.get(paper.name);
    if (items === undefined) {
      problems.push(`the content has a past paper "${paper.name}" that no Blind reader read: a paper is never made up`);
      continue;
    }
    const find = (rest: string) => items.find((i) => i.key === `${paper.name}/${rest}`);
    const labels = [...new Set(items.flatMap((i) => /^[^/]+\/q([^/]+)\//.exec(i.key)?.[1] ?? []))];
    if (labels.length !== paper.questions.length)
      problems.push(
        `past paper "${paper.name}" has ${labels.length} question${labels.length === 1 ? "" : "s"} in the settled reading and ${paper.questions.length} in the content`,
      );
    paper.questions.forEach((q, i) => {
      const label = labels[i];
      if (label === undefined) return;
      const at = `past paper "${paper.name}" question ${q.n}`;
      const words = find(`q${label}/text`);
      if (words === undefined) problems.push(`${at}: the settled reading has no text for question ${label}`);
      else if (words.value !== null && !same(words.value, q.question))
        problems.push(
          `${at}: the content's question text isn't the paper's (the settled reading of question ${label} differs)`,
        );
      const marks = find(`q${label}/marks`);
      if (marks === undefined) problems.push(`${at}: the settled reading has no marks for question ${label}`);
      else if (marks.value !== null && Number(marks.value) !== q.marks)
        problems.push(`${at}: the content gives ${q.marks} marks, the paper ${marks.value}`);
      const key = find(`q${label}/key`);
      const printsKey = paper.key === "professor" && q.key !== null;
      if (key !== undefined && !printsKey)
        problems.push(`${at}: the Professor's paper prints a key, which the content doesn't carry`);
      else if (key === undefined && printsKey)
        problems.push(`${at}: the content carries a key (${q.key}) that the Professor's paper doesn't print`);
      else if (key?.value != null && q.key !== null && !same(key.value, q.key))
        problems.push(`${at}: the content's key ${q.key} isn't the Professor's printed ${key.value}`);
    });
    for (const [rest, label, given] of [
      ["total", "total marks", paper.marks],
      ["minutes", "minutes", paper.minutes],
    ] as const) {
      const item = find(rest);
      if (item === undefined) problems.push(`past paper "${paper.name}": the settled reading has no ${label}`);
      else if (item.value !== null && Number(item.value) !== Number(given))
        problems.push(
          `past paper "${paper.name}": the content gives ${String(given)} ${label}, the paper ${item.value}`,
        );
    }
  }
  return problems;
}

/** The Gate report's `url`, when it is an `https://` preview. */
const previewUrl = (report: Record<string, unknown> | null) => {
  const url = report?.["url"];
  return typeof url === "string" && /^https:\/\//.test(url) ? url.replace(/\/+$/, "") : null;
};

/** The sitting's course.yaml with its own entry taken out: what the wave may not change. */
function withoutSitting(course: Record<string, unknown>, id: string): Record<string, unknown> {
  const sittings = Array.isArray(course["sittings"]) ? course["sittings"] : [];
  return {
    ...course,
    sittings: sittings.filter((s) => (s as { id?: unknown } | null)?.id !== id),
  };
}

const sorted = (list: readonly string[]) => [...list].sort();

/**
 * Every reason the Sitting wave `wave` may not merge yet; none means it may. `dump` reads the
 * sitting's content in a checkout (the template's, unless a test fakes it).
 */
export function sittingReadyProblems(
  project: string,
  wave: Wave,
  verifier: Verifier,
  dump: SittingDumper = templateDump,
): string[] {
  const ledger = requireLedger(project);
  if (wave.kind !== "sitting")
    throw new LedgerError("invalid", `${wave.id} is a ${wave.kind} wave, not a Sitting wave`);
  if (wave.state !== "running") throw new LedgerError("refused", `wave ${wave.id} already ended ${wave.state}`);
  const id = wave.target;
  const row = completeRow(ledger, id);
  if (row === null)
    return [
      `the Owner hasn't said sitting ${id} is complete: only his word (sitting complete) starts or merges its wave`,
    ];
  const problems: string[] = [];

  // 1. Every check reads the wave's own checkout and its HEAD.
  const tree = waveTree(project, wave.branch);
  const dir = tree.path;
  const branch = checkedOutBranch(dir);
  if (branch !== wave.branch)
    problems.push(
      `the Course project is checked out on ${branch ?? "no branch"}, not the wave's branch ${wave.branch}: add its worktree (git worktree add) or check it out, and run ready again`,
    );
  problems.push(...treeProblems(project, wave, tree), ...inventoryProblems(ledger, tree));
  const status = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" });
  const changed = status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : null;
  if (changed === null) problems.push("can't read the Course project's git status");
  else if (changed.length > 0)
    problems.push(
      `the Course project has uncommitted changes (${changed.map((l) => l.slice(3)).join(", ")}): commit them (and re-run the gates if content changed), then run ready again`,
    );
  const integrity = verifyIntegrity(project, dir);
  if (!integrity.intact) problems.push(integrityProblem(integrity));
  if (!hookInstalled(dir))
    problems.push(`the pre-commit gate isn't the repo's hook: git config core.hooksPath ${HOOKS_PATH}`);

  // 2. Every Module the Owner named is live: Revision is assembled from what they ship.
  const folders: string[] = [];
  for (const module of row.modules) {
    try {
      const { row: moduleRow, folder } = moduleFolder(ledger, module);
      folders.push(folder);
      if (moduleRow.state !== "live")
        problems.push(`Module ${module} is ${moduleRow.state}, not live: Revision holds only what its Modules ship`);
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      problems.push(error.message);
    }
  }

  // 3-4. HEAD's content is what the Owner named, and course.yaml changed only by this sitting.
  const head = dump(dir, id);
  let content: SittingDump | null = null;
  if (typeof head === "string") problems.push(head);
  else {
    content = head;
    problems.push(...contentProblems(project, dir, id, row, head, folders, dump));
  }
  const withPapers = row.papers.length > 0;

  // 5. The past papers are the Materials' papers: a settled reading of them, and the content faithful to it.
  const privateFolder = privateFolderOf(ledger.intake.materialsPath);
  if (withPapers) {
    const readings = sittingFolder(privateFolder, id);
    for (const file of ["reading-a.json", "reading-b.json"]) {
      if (!existsSync(`${readings}/${file}`))
        problems.push(
          `no ${file} in the Private folder (${readings}): both Blind readers read the past papers, then reconcile settles`,
        );
    }
    const stale = settledSittingProblem(privateFolder, id);
    if (stale !== null) problems.push(stale);
    else if (content !== null) {
      try {
        problems.push(...faithfulProblems(content.papers, settledSittingReading(privateFolder, id)));
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
        problems.push(error.message);
      }
    }
  }

  // 6. Every job of the wave ran, and none is left blocked.
  const solved = content?.papers.some((p) => p.key === "solved") ?? false;
  const needed: readonly string[] = withPapers
    ? [...SITTING_JOBS_WITH_PAPERS, ...(solved ? [SOLVER_JOB] : [])]
    : SITTING_JOBS_WITHOUT_PAPERS;
  const jobs = new Map(
    current(ledger.jobs)
      .filter((j) => j.wave === wave.id)
      .map((j) => [j.job, j]),
  );
  for (const name of needed) {
    const job = jobs.get(name);
    if (job === undefined) problems.push(`job ${name} hasn't been recorded for ${wave.id}`);
    else if (job.result === "blocked") problems.push(`job ${name} is blocked: its job fixes it, or it falls back`);
  }
  for (const job of jobs.values())
    if (!needed.includes(job.job) && job.result === "blocked")
      problems.push(`job ${job.job} is blocked: its job fixes it, or it falls back`);
  if (solved && !jobs.has(SOLVER_JOB))
    problems.push(`a past paper has no Professor key, so the solver must solve and recompute it (job ${SOLVER_JOB})`);

  // 7. The template layer's own gates verify HEAD: the sitting point on its preview, and the deploy point.
  if (integrity.intact) {
    for (const point of ["sitting", "deploy"] as const) {
      const verdict = verifier.verify(dir, point, point === "deploy" ? undefined : id);
      if (!verdict.green)
        problems.push(`the ${point} Gate report isn't green for HEAD: ${verdict.problems.join("; ") || "red"}`);
    }
  }
  if (previewUrl(readReport(dir, "sitting", id)) === null)
    problems.push(
      "the sitting's gates didn't run on its Vercel preview: run the sitting point with --url <preview URL>",
    );

  // 8. Every Checkpoint item is answered, and every ruling the content ships is the Owner's.
  const state = sittingCheckpoint(project, id, content);
  for (const item of state.open)
    problems.push(
      `Checkpoint item ${item.key} is unanswered${item.sheet ? " (it needs a Slip or Divergence ruling)" : ""}`,
    );
  for (const item of state.unapplied)
    problems.push(
      `Checkpoint item ${item.key} was ruled a ${item.ruling}, but the content doesn't carry the ruling yet (provenance ${item.ruling === "slip" ? "slips" : "divergences"})`,
    );
  if (integrity.intact && content !== null) problems.push(...unruled(ledger, id, content.rulings));

  // 9. The past papers are the files the Owner named, as the wave took them in.
  const onDisk = hashTree(ledger.intake.materialsPath);
  for (const paper of row.papers) {
    const held = current(ledger.materials).find((m) => m.path === paper.path);
    if (held === undefined || onDisk[paper.path] !== held.hash)
      problems.push(
        `${paper.path} changed since the Owner named it${onDisk[paper.path] === undefined ? " (it was deleted)" : ""}: end the wave failed and start a fresh one`,
      );
  }
  return problems;
}

/** Checks 3 and 4: what HEAD's content says against the Owner's word and against `main`. */
function contentProblems(
  project: string,
  dir: string,
  id: string,
  row: SittingComplete,
  head: SittingDump,
  folders: string[],
  dump: SittingDumper,
): string[] {
  const problems: string[] = [];
  const entry = head.sitting;
  if (entry === null) problems.push(`content/course.yaml has no sitting "${id}"`);
  else {
    if (entry["complete"] !== true)
      problems.push(`content/course.yaml doesn't mark sitting ${id} complete: the wave sets complete: true on it`);
    const listed = Array.isArray(entry["modules"]) ? (entry["modules"] as string[]) : [];
    if (!isDeepStrictEqual(sorted(listed), sorted(folders)))
      problems.push(
        `sitting ${id} covers ${listed.join(", ") || "no Module"} in content/course.yaml; the Owner named ${folders.join(", ")}`,
      );
  }
  // main's Course config, but for this sitting's entry, is what the wave must leave.
  const main = dir === project ? head : dump(project, id);
  if (typeof main === "string") problems.push(main);
  else if (!isDeepStrictEqual(withoutSitting(head.course, id), withoutSitting(main.course, id)))
    problems.push(
      `the wave changes content/course.yaml beyond sitting ${id}'s entry: every Module follows it, so a change goes in the Course project's main checkout`,
    );

  const named = row.papers.map((p) => p.slug);
  const made = head.papers.map((p) => p.name);
  const extra = made.filter((n) => !named.includes(n));
  const missing = named.filter((n) => !made.includes(n));
  if (extra.length > 0)
    problems.push(`the content has past papers the Owner didn't name (${quoted(extra)}): a paper is never made up`);
  if (missing.length > 0)
    problems.push(`the Owner named past papers the content lacks (${quoted(missing)}): the vault holds each one`);
  if (head.papers.length === 0 && (head.mocks.length > 0 || head.format !== null))
    problems.push("the sitting has no past papers (Revision only), but the content has mocks or an announced format");
  if ((row.announced !== null) !== (head.format !== null))
    problems.push(
      row.announced !== null
        ? `the Owner said the Professor announced a format (${row.announced}), but the content has no format.yaml`
        : "the content has a format.yaml, but the Owner named no announced format",
    );
  return problems;
}

/**
 * The sitting's batched Checkpoint: the sitting and deploy Gate reports' items (the build's own
 * solution of a key-less paper, a key the answer and recompute disagree with, anything the deploy
 * point raises), the settled reading's, any job of the running wave that escalated, and the
 * announced format when the Owner named one. What the Build ledger already answers is never asked again.
 */
export function sittingCheckpoint(
  project: string,
  id: string,
  content: SittingDump | null,
  preview?: string,
): Omit<CheckpointState, "module"> & { sitting: string } {
  const ledger = requireLedger(project);
  const where = sittingTree(project, ledger, id);
  const base = preview?.replace(/\/+$/, "") ?? previewUrl(readReport(where, "sitting", id));
  const items = new Map<string, CheckpointItem>();
  for (const [point, folder] of [
    ["sitting", id],
    ["deploy", id],
  ] as const) {
    const report = readReport(where, point, folder);
    const raised = Array.isArray(report?.["checkpointItems"]) ? (report["checkpointItems"] as ReportItem[]) : [];
    for (const item of raised) {
      const key = gateItemKey(item);
      items.set(key, {
        key,
        kind: "gate",
        question: item.at === undefined ? item.message : `${item.at}: ${item.message}`,
        gate: item.gate,
        sheet: SHEET_GATES.has(item.gate),
        ...(base !== null && item.spot !== undefined ? { link: `${base}${item.spot}` } : {}),
      });
    }
  }
  for (const item of sittingCheckpointItems(privateFolderOf(ledger.intake.materialsPath), id)) {
    items.set(item.key, { ...item, sheet: false });
  }
  const running = current(ledger.waves).filter((w) => w.kind === "sitting" && w.target === id && w.state === "running");
  for (const job of current(ledger.jobs).filter(
    (j) => j.result === "checkpoint" && running.some((w) => w.id === j.wave),
  )) {
    const key = itemKey(id, "job", job.job, [job.detail ?? ""]);
    items.set(key, {
      key,
      kind: "job",
      question: `The ${job.job} job needs the Owner: ${job.detail ?? "(it recorded no detail; ask the job what it needs)"}`,
      sheet: false,
    });
  }
  const row = completeRow(ledger, id);
  if (row?.announced != null && content?.format != null) {
    const hash = createHash("sha256").update(JSON.stringify(content.format)).digest("hex").slice(0, 10);
    const key = `${id}/announced/${hash}`;
    items.set(key, {
      key,
      kind: "job",
      question: `You said the Professor announced a format (${row.announced}). The announced-format mock follows ${JSON.stringify(content.format)}: confirm it is that format.`,
      sheet: false,
    });
  }
  const { open, unapplied, answered } = classifyItems(ledger, [...items.values()]);
  return { sitting: id, preview: base, open, unapplied, answered, markdown: markdownOf(`sitting ${id}`, open, base) };
}
