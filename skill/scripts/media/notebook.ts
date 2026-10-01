// NotebookLM's side of the Media pass: the Course notebook record, the Notebook recipe for one media
// item (what the Chrome driver does, or what the Owner does by hand when Chrome fails), and the media
// inbox, where both paths leave the downloaded file for `ingest` to move into the state machine.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashFile } from "../ledger/hash.ts";
import { current, type Ledger, type Material } from "../ledger/model.ts";
import { LedgerError } from "../ledger/file.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { advance, iso, requireMediaFile, start } from "./media.ts";
import {
  INBOX_DIR,
  notebookUrl,
  type CourseNotebook,
  type MediaFile,
  type MediaItem,
  type MediaKind,
} from "./model.ts";
import { customStyle } from "./pads.ts";
import { readUsage, updateMediaFile } from "./store.ts";
import { writeMediaPage } from "./render.ts";

/** Claude in Chrome uploads at most this much at once; a larger Material goes through Google Drive. */
export const UPLOAD_LIMIT_BYTES = 10_000_000;

/** What NotebookLM's downloads are saved as, per kind; the first is what it gives. */
export const EXTENSIONS: Record<MediaKind, string[]> = {
  video: [".mp4"],
  audio: [".mp3", ".m4a", ".wav"],
  infographic: [".png"],
  "sitting-audio": [".mp3", ".m4a", ".wav"],
};

/** Material kinds NotebookLM can't take as a source. */
const NOT_A_SOURCE: Partial<Record<Material["kind"], string>> = {
  video: "NotebookLM can't take a video file as a source",
  other: "NotebookLM can't take this kind of file as a source",
};

/** Changes the media file under its mutex, regenerating the media page. */
function changeMediaFile<T>(stateDir: string, project: string, change: (file: MediaFile) => T): T {
  return updateMediaFile(project, change, (file) => writeMediaPage(project, file, readUsage(stateDir), Date.now()));
}

/**
 * The Course notebook as recorded, or (with `url`) records where it is, without the account or fragment a
 * copied address carries. A different notebook starts with no sources.
 */
export function courseNotebook(
  stateDir: string,
  project: string,
  url: string | null,
): { notebook: CourseNotebook | null } {
  const path = resolve(project);
  if (url === null) return { notebook: requireMediaFile(path).notebook };
  const checked = notebookUrl(url.replace(/[?#].*$/, ""), "--url");
  return changeMediaFile(stateDir, path, (file) => {
    if (file.notebook?.url !== checked) file.notebook = { url: checked, sources: [] };
    return { notebook: file.notebook };
  });
}

/** A Material's ledger row, refused when the file on disk is no longer what its Module was built from. */
function builtMaterial(ledger: Ledger, material: string): Material & { full: string } {
  const row = current(ledger.materials).find((m) => m.path === material);
  if (row === undefined) throw new LedgerError("invalid", `${material} isn't one of the Course's current Materials`);
  const full = join(ledger.intake.materialsPath, row.path);
  if (!existsSync(full) || hashFile(full) !== row.hash) {
    const built = row.module === null ? "the ledger recorded it" : `Module ${row.module} was built from it`;
    throw new LedgerError("refused", `${material} changed since ${built}: rebuild the Module first`);
  }
  return { ...row, full };
}

/** Records a Material uploaded to the Course notebook, under the title NotebookLM shows. */
export function addSource(
  stateDir: string,
  project: string,
  material: string,
  title: string,
): { source: CourseNotebook["sources"][number] } {
  const path = resolve(project);
  const row = builtMaterial(requireLedger(path), material);
  return changeMediaFile(stateDir, path, (file) => {
    if (file.notebook === null) {
      throw new LedgerError("refused", "record the Course notebook first (`notebook --url`)");
    }
    const source = { material, hash: row.hash, title, addedAt: iso(Date.now()) };
    file.notebook.sources = [...file.notebook.sources.filter((s) => s.material !== material), source];
    return { source };
  });
}

export interface RecipeSource {
  material: string;
  path: string;
  /** What NotebookLM calls it once added: the recorded title, or the file name for one still to add. */
  title: string;
  bytes: number;
  /** add it; select it (already in the notebook); or replace the older upload titled `replaces`. */
  action: "add" | "select" | "replace";
  replaces: string | null;
  /** Over Claude in Chrome's upload limit: upload it to Google Drive and add it from there. */
  viaDrive: boolean;
}

export interface Recipe {
  item: string;
  kind: MediaKind;
  course: string;
  module: { id: string; title: string };
  notebook: { title: string; url: string | null };
  sources: RecipeSource[];
  skipped: { material: string; reason: string }[];
  output: {
    studio: string;
    settings: Record<string, string>;
    style: string | null;
    language: "English";
    prompt: string;
  };
  save: { folder: string; name: string; extensions: string[] };
  steps: string[];
}

const OUTPUTS: Record<Exclude<MediaKind, "sitting-audio">, { studio: string; settings: Record<string, string> }> = {
  video: { studio: "Video Overview", settings: { format: "Explainer", visualStyle: "Custom" } },
  audio: { studio: "Audio Overview", settings: { format: "Deep Dive", length: "Default" } },
  infographic: { studio: "Infographic", settings: { orientation: "Landscape", detail: "Standard" } },
};

/** The Notebook recipe for one Module's media item: what to add, select, set and generate, and where to save it. */
export function recipe(project: string, id: string): Recipe {
  const path = resolve(project);
  const ledger = requireLedger(path);
  const file = requireMediaFile(path);
  const item = file.items.find((i) => i.id === id);
  if (item === undefined) throw new LedgerError("invalid", `no media item ${id} in ${file.course}`);
  if (item.kind === "sitting-audio" || item.module === null) {
    throw new LedgerError(
      "refused",
      `${id} is a sitting audio: the Build ledger doesn't record which Modules a sitting covers yet`,
    );
  }
  const module = current(ledger.modules).find((m) => m.id === item.module);
  if (module === undefined) throw new LedgerError("invalid", `Module ${item.module} isn't in the Module map`);
  const { sources, skipped } = sourcesFor(ledger, file.notebook, module.id);
  if (sources.length === 0) {
    throw new LedgerError("refused", `Module ${module.id} has no source NotebookLM can take: nothing to select`);
  }
  const kind = item.kind;
  const output = {
    ...OUTPUTS[kind],
    style: kind === "audio" ? null : customStyle(ledger.intake.pad),
    language: "English" as const,
    prompt:
      `Cover only Module ${module.id}, "${module.title}", from the selected sources, for an engineering student ` +
      `preparing for the exam. Follow the Professor's method, notation and units exactly as the sources write ` +
      `them, and add nothing the sources don't say. English only.`,
  };
  const save = { folder: ensureInbox(path), name: id, extensions: EXTENSIONS[kind] };
  const course = ledger.intake.courseName;
  const notebookRef = { title: course, url: file.notebook?.url ?? null };
  return {
    item: id,
    kind,
    course,
    module: { id: module.id, title: module.title },
    notebook: notebookRef,
    sources,
    skipped,
    output,
    save,
    steps: steps(notebookRef, sources, output, save),
  };
}

function sourcesFor(
  ledger: Ledger,
  notebook: CourseNotebook | null,
  module: string,
): { sources: RecipeSource[]; skipped: Recipe["skipped"] } {
  const rows = current(ledger.materials)
    .filter((m) => m.module === module)
    .sort((a, b) => a.path.localeCompare(b.path));
  const sources: RecipeSource[] = [];
  const skipped: Recipe["skipped"] = [];
  for (const row of rows) {
    const reason = NOT_A_SOURCE[row.kind];
    if (reason !== undefined) {
      skipped.push({ material: row.path, reason });
      continue;
    }
    const { full } = builtMaterial(ledger, row.path);
    const recorded = notebook?.sources.find((s) => s.material === row.path);
    const same = recorded !== undefined && recorded.hash === row.hash;
    const bytes = statSync(full).size;
    sources.push({
      material: row.path,
      path: full,
      title: same ? recorded.title : basename(row.path),
      bytes,
      action: recorded === undefined ? "add" : same ? "select" : "replace",
      replaces: recorded !== undefined && !same ? recorded.title : null,
      viaDrive: bytes > UPLOAD_LIMIT_BYTES,
    });
  }
  return { sources, skipped };
}

/** The steps as the Owner follows them by hand (and the Chrome driver in the same order). */
function steps(
  notebook: Recipe["notebook"],
  sources: RecipeSource[],
  output: Recipe["output"],
  save: Recipe["save"],
): string[] {
  const upload = (s: RecipeSource) =>
    s.viaDrive
      ? `upload ${s.path} to Google Drive (it is over Claude in Chrome's ${UPLOAD_LIMIT_BYTES / 1_000_000} MB upload limit), then add it to the notebook from Drive`
      : `add ${s.path} as a source (upload)`;
  const settings = Object.entries(output.settings).map(([k, v]) => `${k}: ${v}`);
  if (output.style !== null) settings.push(`Custom style: "${output.style}"`);
  return [
    "Open NotebookLM (https://notebook.google.com) in the dedicated Chrome profile, signed in to the AI Pro account. In Settings, check Output language is English.",
    notebook.url === null
      ? `Create a notebook named "${notebook.title}" and keep its address: it is the Course notebook from now on.`
      : `Open the Course notebook "${notebook.title}": ${notebook.url}`,
    ...sources.flatMap((s) =>
      s.action === "add"
        ? [`Source: ${upload(s)}.`]
        : s.action === "replace"
          ? [`Source: delete the older "${s.replaces}", then ${upload(s)}.`]
          : [],
    ),
    `In the sources list, tick only: ${sources.map((s) => `"${s.title}"`).join(", ")}. Untick every other source.`,
    `In Studio, make a ${output.studio} (${settings.join("; ")}) in English, with this prompt: "${output.prompt}"`,
    "Wait until it is ready (a video can take over 30 minutes), then download it.",
    `Save it as ${join(save.folder, `${save.name}${save.extensions[0]}`)}` +
      (save.extensions.length > 1 ? ` (or with ${save.extensions.slice(1).join(" or ")}).` : "."),
  ];
}

/** The Course project's media inbox, made on first use with a .gitignore that ignores everything in it. */
function ensureInbox(project: string): string {
  const folder = join(project, INBOX_DIR);
  mkdirSync(folder, { recursive: true });
  const ignore = join(folder, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return folder;
}

export interface IngestResult {
  ingested: { item: string; attempt: number; master: string }[];
  /** Inbox copies of masters already taken, removed. */
  cleared: string[];
  /** Files left in the inbox, with why. */
  ignored: { file: string; reason: string }[];
}

/**
 * Takes each file in the media inbox named `<item><ext>` into the state machine: its master is kept in the
 * Private folder as `media/masters/<item>-<attempt><ext>`, and the item moves to downloaded. A queued item
 * the Owner made by hand is counted as started first, whatever the limits say: it was made already.
 */
export function ingest(stateDir: string, project: string, privateFolder: string): IngestResult {
  const root = resolve(project);
  const priv = resolve(privateFolder);
  const inside = relative(root, priv);
  if (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) {
    throw new LedgerError("invalid", `the Private folder ${priv} is inside the Course project; it must sit outside it`);
  }
  if (!existsSync(priv)) throw new LedgerError("invalid", `no Private folder at ${priv}`);
  const masters = join(priv, "media", "masters");
  const inbox = ensureInbox(root);
  const result: IngestResult = { ingested: [], cleared: [], ignored: [] };
  const names = readdirSync(inbox, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== ".gitignore")
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const dropped = join(inbox, name);
    const ext = extname(name).toLowerCase();
    const id = basename(name, extname(name));
    const item = requireMediaFile(root).items.find((i) => i.id === id);
    const ignore = (reason: string) => result.ignored.push({ file: name, reason });
    if (item === undefined) {
      ignore(`no media item ${id} in this Course: name the file <item id><extension>, e.g. module-01-video.mp4`);
      continue;
    }
    if (statSync(dropped).size === 0) {
      ignore("an empty file");
      continue;
    }
    if (!EXTENSIONS[item.kind].includes(ext)) {
      ignore(`a ${item.kind} is saved as ${EXTENSIONS[item.kind].join(" or ")}`);
      continue;
    }
    const attempt = item.regenerations + 1;
    const master = join(masters, `${id}-${attempt}${ext}`);
    if (item.state !== "queued" && item.state !== "generating") {
      if (existsSync(master) && hashFile(master) === hashFile(dropped)) {
        unlinkSync(dropped);
        result.cleared.push(name);
      } else ignore(`${id} is ${item.state}, not waiting for a download`);
      continue;
    }
    take(stateDir, root, item, dropped, master);
    result.ingested.push({ item: id, attempt, master });
  }
  return result;
}

/** Keeps the master, moves the item to downloaded, then empties the inbox slot: a crash at any point re-runs cleanly. */
function take(stateDir: string, project: string, item: MediaItem, dropped: string, master: string): void {
  if (item.state === "queued") start(stateDir, project, item.id, true);
  mkdirSync(join(master, ".."), { recursive: true });
  copyFileSync(dropped, master);
  advance(stateDir, project, item.id, "downloaded");
  unlinkSync(dropped);
}
