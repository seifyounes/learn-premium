// The Module wave's batched Checkpoint and its merge gate. The Checkpoint gathers every open item
// of one Module (the gates' Checkpoint items from its Gate reports, each linked to its spot on the
// Vercel preview, and the settled reading's unreadable regions and Materials conflicts) minus what
// the Owner already answered in the Build ledger. `ready` is the merge gate: a Module wave merges to
// `main` only when every job ran, its Gate reports are green for the branch's commit, every
// Checkpoint item is answered (a sheet-vs-recompute one with a Slip or Divergence ruling the content
// carries), the Course style sheet exists and the pre-commit gate guards the repo.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOOKS_PATH, privateFolderOf } from "../intake/create.ts";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { assignmentOf } from "../ledger/assignments.ts";
import { sameDiscipline, unprovenDisciplines } from "../ledger/disciplines.ts";
import { LedgerError } from "../ledger/file.ts";
import { hashTree } from "../ledger/hash.ts";
import { requireLedger, verifyIntegrity } from "../ledger/ledger.ts";
import { current, TEMPLATE_DIR, type Ledger, type ModuleRow } from "../ledger/model.ts";
import { staleProblems } from "./fresh.ts";
import { itemKey, readingCheckpointItems, settledReadingProblem, waveFolder } from "./reading.ts";
import { toolInventorySchema, toolProblems, workedLabel, type ToolInventory } from "./assign.ts";
import { relaunchProblems } from "./relaunch.ts";
import { sittingReadyProblems, type SittingDumper } from "./sitting.ts";
import { REVIEW_JOB, reviewReadyProblems } from "./review.ts";
import { inventoryProblems, moduleTree, treeProblems, waveTree } from "./tree.ts";
import { videoReadyProblems, type ListedCard, type ProbeAnswer, type VideoTemplate } from "./videos.ts";

/** The gate points a Module merges on: per job and per Module scoped to it, per deploy on the whole Course. */
export const MERGE_POINTS = ["job", "module", "deploy"] as const;
export type MergePoint = (typeof MERGE_POINTS)[number];

/** A Slip or Divergence the content ships, by the signed values of the sheet's value it rules on. */
export interface ContentRuling {
  entry: string;
  /** A Worked example's Slip: the sheet cell it corrects. */
  cell?: string;
  kind: "slip" | "divergence";
  printed: number[];
}

/**
 * The Course project's own template layer, as the merge gate uses it. A seam: faked in tests.
 * `verify` re-derives a Gate report's verdict for the repo's HEAD; `rulings` lists the Slips and
 * Divergences the Module's content ships (or says why it can't).
 */
export interface Verifier {
  /** `module` is the Module's folder; at the `sitting` point it is the sitting's id. */
  verify(
    project: string,
    point: MergePoint | "sitting",
    module: string | undefined,
  ): { green: boolean; problems: string[] };
  rulings(project: string, module: string): ContentRuling[] | string;
  /** The Module's Worked examples and tools as the content has them (`gates/cli.ts tools`), or why it can't say. */
  inventory(project: string, folder: string): ToolInventory | string;
}

/** Runs `node template/gates/cli.ts <args…>` in the Course project, from its template folder. */
export function gateCli(given: string, args: string[]) {
  // Absolute before the child runs from the template folder, so --content names the project's content.
  const project = resolve(given);
  if (!existsSync(join(project, TEMPLATE_DIR, "gates", "cli.ts")))
    return { ok: false, out: "", said: [`the template layer has no gate runner (${TEMPLATE_DIR}/gates/cli.ts)`] };
  const child = spawnSync(
    process.execPath,
    [join("gates", "cli.ts"), ...args, "--content", join(project, CONTENT_DIR)],
    { cwd: join(project, TEMPLATE_DIR), encoding: "utf8" },
  );
  if (child.error !== undefined) return { ok: false, out: "", said: [child.error.message] };
  const said = `${child.stdout ?? ""}\n${child.stderr ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: child.status === 0, out: child.stdout ?? "", said };
}

/** Runs the Course project's own template layer: `node template/gates/cli.ts verify|rulings|tools …`. */
export const templateVerifier: Verifier = {
  verify(project, point, module) {
    const scope = point === "sitting" ? "--sitting" : "--module";
    const run = gateCli(project, ["verify", "--point", point, ...(module === undefined ? [] : [scope, module])]);
    return { green: run.ok, problems: run.ok ? [] : run.said };
  },
  rulings(project, module) {
    const run = gateCli(project, ["rulings", "--module", module]);
    if (!run.ok) return `the template can't list the content's rulings: ${run.said.join("; ")}`;
    try {
      return (JSON.parse(run.out) as { rulings: ContentRuling[] }).rulings;
    } catch (error) {
      return `the template's rulings aren't JSON: ${(error as Error).message}`;
    }
  },
  inventory(project, folder) {
    const run = gateCli(project, ["tools", "--module", folder]);
    if (!run.ok) return `the template can't list the Module's tools: ${run.said.join("; ")}`;
    try {
      return toolInventorySchema(JSON.parse(run.out), "tool inventory");
    } catch (error) {
      return `the template's tool inventory isn't the shape the skill reads: ${(error as Error).message}`;
    }
  },
};

/** Runs the Course project's own template layer for the YouTube cards: `videos list|probe|hide`. */
export const templateVideos: VideoTemplate = {
  cards(dir, folder) {
    const run = gateCli(dir, ["videos", "list", "--module", folder]);
    if (!run.ok) return run.said.join("; ");
    try {
      return (JSON.parse(run.out) as { cards: ListedCard[] }).cards;
    } catch (error) {
      return `the template's video list isn't JSON: ${(error as Error).message}`;
    }
  },
  probe(project, ids) {
    const run = gateCli(project, ["videos", "probe", `--ids=${ids.join(",")}`]);
    if (!run.ok) return run.said.join("; ");
    try {
      return (JSON.parse(run.out) as { probes: ProbeAnswer[] }).probes;
    } catch (error) {
      return `the template's probe answer isn't JSON: ${(error as Error).message}`;
    }
  },
  hide(project, report) {
    const run = gateCli(project, ["videos", "hide", "--report", resolve(report)]);
    if (!run.ok) return run.said.join("; ");
    try {
      return (JSON.parse(run.out) as { hidden: { module: string; id: string; title: string }[] }).hidden;
    } catch (error) {
      return `the template's hide answer isn't JSON: ${(error as Error).message}`;
    }
  },
};

/** The gates whose Checkpoint items are sheet-vs-recompute: the Owner rules each a Slip or a Divergence. */
/**
 * Whether a gate's Checkpoint item asks the Owner for a Slip or Divergence ruling. A key-less past
 * paper's confirmation of the build's own answers is an ordinary item: no ruling can answer it.
 */
export const isSheetItem = (item: { gate: string; message: string }) =>
  SHEET_GATES.has(item.gate) && !(item.gate === "past-papers" && item.message.startsWith("no Professor key;"));

export const SHEET_GATES = new Set([
  "sim-numbers",
  "truth-table",
  "worked-numbers",
  "stl",
  "past-papers",
  "kinematics",
]);

/** The jobs every Module wave records before it merges; the first Module's wave also writes the style sheet. */
export const WAVE_JOBS = [
  "blind-reader-a",
  "blind-reader-b",
  "reconcile",
  "writer",
  "recompute",
  "job-gates",
  "consistency",
  "module-gates",
  REVIEW_JOB,
  "deploy-gates",
] as const;
export const STYLE_SHEET_JOB = "style-sheet";
export const STYLE_SHEET_FILE = "style-sheet.yaml";

export interface CheckpointItem {
  key: string;
  kind: "gate" | "unreadable" | "conflict" | "job" | "unproven";
  question: string;
  /** For a gate's item: the gate, and whether it is a sheet-vs-recompute item needing a ruling. */
  gate?: string;
  sheet: boolean;
  /** Where to judge it: its spot on the preview, or the crop of an unreadable region. */
  link?: string;
  crop?: string;
}

export interface ReportItem {
  gate: string;
  message: string;
  at?: string;
  spot?: string;
}

/** The Module's folder in the content (`01-linear-regression`), from the Module map. */
export function moduleFolder(ledger: Ledger, id: string): { row: ModuleRow; folder: string } {
  const row = current(ledger.modules).find((m) => m.id === id);
  if (row === undefined) throw new LedgerError("invalid", `Module ${id} isn't in the Module map`);
  return { row, folder: `${row.id}-${row.slug}` };
}

const reportsDir = (project: string) => join(project, CONTENT_DIR, "build-records", "gate-reports");
const reportFile = (point: MergePoint | "sitting", folder: string) =>
  point === "deploy" ? "deploy.json" : `${point}-${folder}.json`;

/** A Gate report in the Course project's build records: `deploy` is the whole Course's; the others are one Module's or sitting's. */
export function readReport(
  project: string,
  point: MergePoint | "sitting",
  folder: string,
): Record<string, unknown> | null {
  const path = join(reportsDir(project), reportFile(point, folder));
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * A gate's Checkpoint item's key: the Module it sits in (`course` for the whole Course's, such as a
 * licence), the gate and a hash of where and what, stable while the content is.
 */
export const gateItemKey = (item: ReportItem) =>
  `${/^modules\/(\d{2})-/.exec(item.at ?? "")?.[1] ?? /^sittings\/([^/]+)\//.exec(item.at ?? "")?.[1] ?? "course"}/${item.gate}/${createHash(
    "sha256",
  )
    .update(`${item.at ?? ""}\n${item.message}`)
    .digest("hex")
    .slice(0, 10)}`;

/** The preview the Module's gates ran on: where its links point. */
function previewOf(project: string, folder: string, given: string | undefined): string | null {
  const url = given ?? readReport(project, "module", folder)?.["url"];
  return typeof url === "string" ? url.replace(/\/+$/, "") : null;
}

/** Every Checkpoint item the Module's Gate reports and settled reading raise, each once. */
export function raisedItems(project: string, id: string, preview?: string) {
  const ledger = requireLedger(project);
  const { folder } = moduleFolder(ledger, id);
  // The Gate reports sit in the Module wave's own checkout while it runs.
  const where = moduleTree(project, ledger, id);
  const base = previewOf(where, folder, preview);
  const items = new Map<string, CheckpointItem>();
  for (const point of MERGE_POINTS) {
    const report = readReport(where, point, folder);
    const raised = Array.isArray(report?.["checkpointItems"]) ? (report["checkpointItems"] as ReportItem[]) : [];
    // The deploy point checks the whole Course: its items (a licence, another Module's) are asked
    // once under their own key, so one answered in an earlier wave stays answered.
    for (const item of raised) {
      const key = gateItemKey(item);
      items.set(key, {
        key,
        kind: "gate",
        question: item.at === undefined ? item.message : `${item.at}: ${item.message}`,
        gate: item.gate,
        sheet: isSheetItem(item),
        ...(base !== null && item.spot !== undefined ? { link: `${base}${item.spot}` } : {}),
      });
    }
  }
  for (const item of readingCheckpointItems(privateFolderOf(ledger.intake.materialsPath), id)) {
    items.set(item.key, { ...item, sheet: false });
  }
  // A job of the Module's running wave that escalated (`record job --result checkpoint`) waits for the Owner too.
  const running = current(ledger.waves).filter((w) => w.kind === "module" && w.target === id && w.state === "running");
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
  // Each tool of a Discipline this Course added at intake and hasn't proven yet is the Owner's to review.
  const unproven = unprovenDisciplines(ledger);
  for (const w of running) {
    for (const tool of assignmentOf(ledger, w.id)?.tools ?? []) {
      const canonical = unproven.find((name) => sameDiscipline(name, tool.discipline));
      if (canonical === undefined) continue;
      const where = tool.worked === null ? "Lab" : workedLabel(id, tool.worked);
      // The Lab's anchor follows what ships (a Pyodide tool that fell back to a part is a part), a step-through is a sim.
      const prefix = tool.ships === "pyodide" ? "python" : tool.ships === "part" ? "part" : "sim";
      // The wave is in the key: a Module rebuilt after a failed wave is a new build, reviewed again.
      const key = itemKey(id, "unproven", tool.name, [canonical, tool.tool, tool.ships, w.id]);
      items.set(key, {
        key,
        kind: "unproven",
        question: `${where}: tool ${tool.name} is built for ${canonical}, a Discipline this Course added at intake and hasn't proven yet: check on the preview that it works and reads as the Materials do, then answer`,
        sheet: false,
        ...(base !== null ? { link: `${base}/lab/#${prefix}-${folder}-${tool.name}` } : {}),
      });
    }
  }
  return { ledger, folder, preview: base, items: [...items.values()] };
}

export interface CheckpointState {
  module: string;
  preview: string | null;
  /** Still to ask the Owner. */
  open: CheckpointItem[];
  /** Ruled a Slip or Divergence, but the gate still raises it: the content doesn't carry the ruling yet. */
  unapplied: (CheckpointItem & { ruling: string })[];
  answered: number;
  markdown: string;
}

/** The Module's batched Checkpoint: what is still open, ready to post in chat, and what the Owner already answered. */
export function checkpoint(project: string, id: string, preview?: string): CheckpointState {
  const { ledger, preview: base, items } = raisedItems(project, id, preview);
  const { open, unapplied, answered } = classifyItems(ledger, items);
  return { module: id, preview: base, open, unapplied, answered, markdown: markdownOf(`Module ${id}`, open, base) };
}

/** Each raised item against the Owner's stored answers: still open, ruled but not yet in the content, or answered. */
export function classifyItems(ledger: Ledger, items: CheckpointItem[]) {
  const answers = new Map(current(ledger.checkpoints).map((c) => [c.key, c]));
  const open: CheckpointItem[] = [];
  const unapplied: CheckpointState["unapplied"] = [];
  let answered = 0;
  for (const item of items) {
    const answer = answers.get(item.key);
    if (answer === undefined || (item.sheet && answer.ruling === null)) open.push(item);
    else if (item.sheet && answer.ruling !== null) unapplied.push({ ...item, ruling: answer.ruling });
    else answered += 1;
  }
  return { open, unapplied, answered };
}

/** The batch to post in chat; `label` names what it is the Checkpoint of (`Module 01`, `sitting midterm`). */
export function markdownOf(label: string, open: CheckpointItem[], preview: string | null): string {
  if (open.length === 0) return `**Checkpoint, ${label}**: nothing open.`;
  const lines = [
    `**Checkpoint, ${label}**: ${open.length} item${open.length === 1 ? "" : "s"}${preview === null ? "" : ` (preview: ${preview})`}. Answer each by its number.`,
    "",
  ];
  open.forEach((item, i) => {
    const ask = item.sheet
      ? ". (**Slip**: the site ships the corrected value and shows both. **Divergence**: it ships the Professor's value as the exam answer, with a note.)"
      : "";
    const where =
      item.link !== undefined
        ? ` [See it on the preview](${item.link}).`
        : item.crop !== undefined
          ? ` Crop: \`${item.crop}\``
          : "";
    lines.push(`${i + 1}. \`${item.key}\` ${item.question}${ask}${where}`);
  });
  return lines.join("\n");
}

/**
 * A sheet-vs-recompute item's question as the Checkpoint gives it: the content file it sits in and
 * the sheet value it asks about (`modules/01-x/worked/1.json: sheet cell D4 prints 1.45, but …`).
 */
const SHEET_QUESTION =
  /^((?:modules|sittings)\/\S+?): .*?\bprints\s+(.+?)(?: and the answer matches it)?, (?:but|which)\b/;

/** A printed value, sign included: `1.45`, `−1,250.5` or `5.0 \times 10^{-2}`; null when it isn't one. */
function signedValue(written: string): number | null {
  const match =
    /^([-−]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*(?:\\times|\\cdot|×)\s*10\s*\^\s*\{?\s*([-−]?\d+)\s*\}?)?$/.exec(
      written.trim(),
    );
  if (!match) return null;
  const [, sign = "", digits = "", power] = match;
  const magnitude = Number(`${digits.replace(/,/g, "")}e${(power ?? "0").replace("−", "-")}`);
  return sign === "" ? magnitude : -magnitude;
}

/**
 * Every Slip or Divergence the Module's content ships without the Owner's matching answer: a
 * sheet-vs-recompute item of this Module, answered with that ruling, about that sheet value. Only
 * the Owner rules on the Professor's numbers; a ruling the gates no longer raise must still be his.
 */
export function unruled(ledger: Ledger, id: string, rulings: ContentRuling[] | string): string[] {
  if (typeof rulings === "string") return [rulings];
  const answered = current(ledger.checkpoints).flatMap((c) => {
    // A gate's sheet item, or a ruling no gate raised (a Practice answer, a Summary value), recorded
    // under `NN/ruling/<name>`: either way, its question names the content file and the sheet value.
    const [module, kind] = c.key.split("/");
    const [, entry, written] = SHEET_QUESTION.exec(c.question) ?? [];
    const printed = written === undefined ? null : signedValue(written);
    const ruledItem = kind !== undefined && (SHEET_GATES.has(kind) || kind === "ruling");
    if (module !== id || !ruledItem || c.ruling === null || printed === null) return [];
    const cell = /\bsheet cell ([A-Z][1-9]\d*)\b/.exec(c.question)?.[1];
    return [{ ruling: c.ruling, entry, printed, cell }];
  });
  // Bound to the item: the same kind of ruling, in the same content file, and every sheet value the
  // ruling names answered by the Owner (each value suppresses a gate finding on its own).
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a));
  // Each answer authorizes one occurrence: two cells ruled on the same value need two answers.
  const unused = [...answered];
  const takeAnswer = (r: ContentRuling, n: number) => {
    // A ruling naming its cell needs the Owner's answer on that cell (when the answer names one).
    const sameCell = (a: { cell: string | undefined }) =>
      r.cell === undefined || a.cell === undefined || a.cell === r.cell;
    const at = unused.findIndex(
      (a) => a.ruling === r.kind && a.entry === r.entry && sameCell(a) && close(n, a.printed),
    );
    if (at === -1) return false;
    unused.splice(at, 1);
    return true;
  };
  return rulings
    .filter((r) => r.printed.length === 0 || !r.printed.map((n) => takeAnswer(r, n)).every(Boolean))
    .map(
      (r) =>
        `${r.entry} ships a ${r.kind} on ${r.printed.join(", ") || "no number"}${r.cell === undefined ? "" : ` (cell ${r.cell})`} that no Owner answer rules: record his ${r.kind} ruling on the item that raised it, with its question as the Checkpoint gives it, or, where no gate raised it, under ${id}/ruling/<name> with the question "${r.entry}: … prints <value>, but …"`,
    );
}

/** Whether the Course project's commits go through the template's pre-commit gate. */
export function hookInstalled(project: string): boolean {
  const child = spawnSync("git", ["-C", project, "config", "core.hooksPath"], { encoding: "utf8" });
  if (child.status !== 0 || child.stdout.trim() !== HOOKS_PATH) return false;
  const hook = join(project, HOOKS_PATH, "pre-commit");
  if (!existsSync(hook) || !statSync(hook).isFile()) return false;
  // git runs only an executable hook, and ignores any other; Windows has no executable bit.
  return process.platform === "win32" || (statSync(hook).mode & 0o111) !== 0;
}

/** The branch checked out in the Course project, or null when HEAD is detached or it isn't a repo. */
export function checkedOutBranch(project: string): string | null {
  const child = spawnSync("git", ["-C", project, "symbolic-ref", "--short", "-q", "HEAD"], { encoding: "utf8" });
  return child.status === 0 ? child.stdout.trim() : null;
}

/** Why the template layer can't verify a wave: what differs from the pinned release's files. */
export function integrityProblem(integrity: ReturnType<typeof verifyIntegrity>): string {
  const changes = [
    ...integrity.modified.map((p) => `modified ${p}`),
    ...integrity.added.map((p) => `added ${p}`),
    ...integrity.missing.map((p) => `missing ${p}`),
    ...integrity.unrecordedOverrides.map((p) => `unrecorded override ${p}`),
    ...integrity.missingOverrides.map((p) => `recorded override ${p} missing from the overrides area`),
  ];
  return `the template layer isn't the pinned release's: ${changes.join(", ")}; its gates can't verify this wave (a fix goes in as a Course override)`;
}

/**
 * Every reason the wave `waveId` may not merge yet; none means it may. A Sitting wave is judged by
 * `sitting.ts`. `videos` is the template's YouTube card list, for a Module wave's cards.
 */
export function readyProblems(
  project: string,
  waveId: string,
  verifier: Verifier,
  dump?: SittingDumper,
  videos: VideoTemplate = templateVideos,
): string[] {
  const ledger = requireLedger(project);
  const wave = current(ledger.waves).find((w) => w.id === waveId);
  if (wave === undefined) throw new LedgerError("invalid", `no current wave ${waveId}`);
  if (wave.kind === "sitting") return sittingReadyProblems(project, wave, verifier, dump);
  if (wave.state !== "running") throw new LedgerError("refused", `wave ${waveId} already ended ${wave.state}`);
  const id = wave.target;
  const { folder } = moduleFolder(ledger, id);
  const problems: string[] = [];

  // Every check below reads the wave's own checkout and its HEAD: the worktree git lists for its branch
  // (the project itself, in the single-checkout mode).
  const tree = waveTree(project, wave.branch);
  const dir = tree.path;
  const branch = checkedOutBranch(dir);
  if (branch !== wave.branch)
    problems.push(
      `the Course project is checked out on ${branch ?? "no branch"}, not the wave's branch ${wave.branch}: add its worktree (git worktree add) or check it out, and run ready again`,
    );
  problems.push(...treeProblems(project, wave, tree), ...inventoryProblems(ledger, tree));
  // The Gate reports prove HEAD, and HEAD is what merges: the ledger rows, records and content this
  // check reads must be HEAD's too.
  const status = spawnSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" });
  const changed = status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : null;
  if (changed === null) problems.push("can't read the Course project's git status");
  else if (changed.length > 0)
    problems.push(
      `the Course project has uncommitted changes (${changed.map((l) => l.slice(3)).join(", ")}): commit them (and re-run the gates if content changed), then run ready again`,
    );

  // Every job of the wave ran, and none is left blocked.
  const firstWave = !ledger.waves.some((w) => w.kind === "module" && w.state === "merged");
  const jobs = new Map(
    current(ledger.jobs)
      .filter((j) => j.wave === waveId)
      .map((j) => [j.job, j]),
  );
  for (const name of [...WAVE_JOBS, ...(firstWave ? [STYLE_SHEET_JOB] : [])]) {
    const job = jobs.get(name);
    if (job === undefined) problems.push(`job ${name} hasn't been recorded for ${waveId}`);
    else if (job.result === "blocked") problems.push(`job ${name} is blocked: its job fixes it, or it falls back`);
  }
  // The wave's other jobs (a sim builder, a tool, a media item) can't leave it red either.
  const required = new Set<string>([...WAVE_JOBS, STYLE_SHEET_JOB]);
  for (const job of jobs.values())
    if (!required.has(job.job) && job.result === "blocked")
      problems.push(`job ${job.job} is blocked: its job fixes it, or it falls back`);

  if (!existsSync(join(dir, CONTENT_DIR, STYLE_SHEET_FILE)))
    problems.push(
      `no Course style sheet at ${CONTENT_DIR}/${STYLE_SHEET_FILE}: Module 1's wave writes it before any other Module`,
    );
  if (!existsSync(join(dir, CONTENT_DIR, "modules", folder, "module.yaml")))
    problems.push(`no Module page content at ${CONTENT_DIR}/modules/${folder}/`);

  const privateFolder = privateFolderOf(ledger.intake.materialsPath);
  const readings = waveFolder(privateFolder, id);
  for (const file of ["reading-a.json", "reading-b.json"]) {
    if (!existsSync(join(readings, file)))
      problems.push(`no ${file} in the Private folder (${readings}): both Blind readers read, then reconcile settles`);
  }
  const settledProblem = settledReadingProblem(privateFolder, id);
  if (settledProblem !== null) problems.push(settledProblem);
  // A re-run wave can't merge on readings or a review older than the Materials it took in.
  problems.push(...staleProblems(ledger, privateFolder, id));
  // A relaunched subagent's predecessor files, re-gated and each settled before the wave counts them.
  problems.push(...relaunchProblems(ledger, waveId));
  // The fresh reviewer's eyes loop and adversarial read, of HEAD's Module content, re-verified.
  problems.push(...reviewReadyProblems(dir, privateFolder, id, folder));
  // The tools the content ships are the tool assignment's, built by timed builders that handed back.
  problems.push(...toolProblems(ledger, waveId, folder, verifier.inventory(dir, folder)));
  // The YouTube cards the Module ships, each re-verified by the main agent.
  problems.push(...videoReadyProblems(dir, privateFolder, id, folder, videos));

  // The template layer's own gates verify the branch: an edited layer could verify anything.
  const integrity = verifyIntegrity(project, dir);
  if (!integrity.intact) {
    problems.push(integrityProblem(integrity));
  } else {
    for (const point of MERGE_POINTS) {
      const verdict = verifier.verify(dir, point, point === "deploy" ? undefined : folder);
      if (!verdict.green)
        problems.push(`the ${point} Gate report isn't green for HEAD: ${verdict.problems.join("; ") || "red"}`);
    }
  }
  const preview = readReport(dir, "module", folder)?.["url"];
  if (typeof preview !== "string" || !/^https:\/\//.test(preview))
    problems.push("the Module's gates didn't run on its Vercel preview: run the module point with --url <preview URL>");

  const state = checkpoint(project, id);
  for (const item of state.open)
    problems.push(
      `Checkpoint item ${item.key} is unanswered${item.sheet ? " (it needs a Slip or Divergence ruling)" : ""}`,
    );
  for (const item of state.unapplied)
    problems.push(
      `Checkpoint item ${item.key} was ruled a ${item.ruling}, but the content doesn't carry the ruling yet (provenance ${item.ruling === "slip" ? "slips" : "divergences"})`,
    );

  if (integrity.intact) problems.push(...unruled(ledger, id, verifier.rulings(dir, folder)));

  // The Owner's answers reach the content through the writer and the consistency pass: one recorded
  // before the latest answer can't have applied it.
  const consistency = jobs.get("consistency");
  const latest = current(ledger.checkpoints)
    .filter((c) => c.wave === waveId)
    .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
    .at(-1);
  if (consistency !== undefined && latest !== undefined && latest.answeredAt > consistency.recordedAt)
    problems.push(
      `the Owner answered ${latest.key} after the consistency pass: apply the answers, then record consistency again`,
    );

  // The Materials as the wave took them in: an edit since leaves the readings and recompute stale.
  const onDisk = hashTree(ledger.intake.materialsPath);
  for (const material of current(ledger.materials).filter((m) => m.module === id)) {
    if (onDisk[material.path] !== material.hash)
      problems.push(
        `${material.path} changed since wave ${waveId} started${onDisk[material.path] === undefined ? " (it was deleted)" : ""}: end the wave failed and start a fresh one`,
      );
  }

  if (!hookInstalled(dir))
    problems.push(`the pre-commit gate isn't the repo's hook: git config core.hooksPath ${HOOKS_PATH}`);
  return problems;
}
