// The Python media kit (skill/scripts/media_kit.py, run in the machine venv: PyAV's FFmpeg, Pillow,
// faster-whisper) and what the Media pass does with it: `evidence` for the fact check, `encode` for the web
// copy. The kit is a seam: tests give a fake one, so no Node test needs Python.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { LedgerError } from "../ledger/file.ts";
import { hashFile } from "../ledger/hash.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { arr, nonEmpty, nullable, obj, oneOf, sha256, type Infer, type Schema, fail } from "../ledger/schema.ts";
import { readJsonFile } from "../wave/reading.ts";
import { moduleFolder, type Verifier } from "../wave/wave.ts";
import { fail as failItem, recordEncoded, requireMediaFile } from "./media.ts";
import { WEB_EXTENSION, type MediaItem, type MediaKind } from "./model.ts";
import { EXTENSIONS, requirePrivateFolder } from "./notebook.ts";
import { size } from "./render.ts";

/** The machine venv's Python (the installer's layout: machine_install.py's `Layout.venv`). */
export const DEFAULT_PYTHON = join(
  homedir(),
  ".claude",
  "learn-premium",
  "venv",
  ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
);

const KIT_SCRIPT = resolve(import.meta.dirname, "..", "media_kit.py");

/** One run of the kit: `master` read, `out` written (a web file for `encode`, a folder for `evidence`). */
export interface KitRequest {
  kind: "video" | "audio" | "infographic";
  master: string;
  out: string;
}

export interface MediaKit {
  /** Frames and transcript (or the image itself) into the folder `out`, with an `evidence.json`. `null` model: the kit's default. */
  evidence(r: KitRequest & { whisperModel: string | null }): { ok: true } | { ok: false; error: string };
  /** The web copy at `out`; `harder` is the second profile, for a file still over the size limit. */
  encode(r: KitRequest & { harder: boolean }): { ok: true; duration: number | null } | { ok: false; error: string };
}

/** What the Media pass's commands depend on outside the Course project: the kit, the template's gates, the size limit. */
export interface MediaDeps {
  kit: MediaKit;
  verifier: Verifier;
  /** A file over this many bytes is re-encoded harder, once (GitHub blocks a pushed file over 100 MiB). */
  limitBytes: number;
}

/** The kit as a child process of the venv's Python. The kit prints one JSON document; exit ≠ 0 is a failure. */
export function venvKit(python: string): MediaKit {
  const call = (args: string[]) => {
    const child = spawnSync(python, [KIT_SCRIPT, ...args], { encoding: "utf8" });
    if (child.error !== undefined) {
      return { ok: false as const, error: `can't run the media kit with ${python}: ${child.error.message}` };
    }
    const last = (child.stdout ?? "").trim().split(/\r?\n/).at(-1) ?? "";
    try {
      const out = JSON.parse(last) as { ok?: boolean; error?: string; duration?: number | null };
      if (child.status === 0 && out.ok === true) return { ok: true as const, duration: out.duration ?? null };
      return { ok: false as const, error: out.error ?? `the media kit exited ${child.status}` };
    } catch {
      return {
        ok: false as const,
        error: `the media kit exited ${child.status}: ${(child.stderr ?? "").trim() || last}`,
      };
    }
  };
  return {
    evidence: (r) => {
      const run = call([
        "evidence",
        "--kind",
        r.kind,
        "--master",
        r.master,
        "--out",
        r.out,
        ...(r.whisperModel === null ? [] : ["--whisper-model", r.whisperModel]),
      ]);
      return run.ok ? { ok: true } : run;
    },
    encode: (r) =>
      call(["encode", "--kind", r.kind, "--master", r.master, "--out", r.out, ...(r.harder ? ["--harder"] : [])]),
  };
}

/** Where an item's files sit in the Private folder, `<Private>/media/`: masters, evidence, checks, web copies. */
export const mediaDir = (priv: string, ...parts: string[]) => join(priv, "media", ...parts);
export const evidenceDir = (priv: string, id: string, attempt: number) =>
  mediaDir(priv, "evidence", `${id}-${attempt}`);
export const checkPath = (priv: string, id: string, attempt: number) =>
  mediaDir(priv, "checks", `${id}-${attempt}.json`);

/** The item's master for its current attempt, as `ingest` kept it; refused when it isn't there. */
export function masterOf(priv: string, item: MediaItem): string {
  const attempt = item.regenerations + 1;
  const found = EXTENSIONS[item.kind]
    .map((ext) => mediaDir(priv, "masters", `${item.id}-${attempt}${ext}`))
    .find((path) => existsSync(path));
  if (found === undefined) {
    throw new LedgerError(
      "refused",
      `no master for ${item.id} (attempt ${attempt}) in ${mediaDir(priv, "masters")}: ingest it first`,
    );
  }
  return found;
}

const num: Schema<number> = (v, p) => (typeof v === "number" && Number.isFinite(v) ? v : fail(p, "a number", v));

export const EVIDENCE_FORMAT = "learn-premium media evidence v1";

const evidenceSchema = obj({
  evidence: (v, p) => (v === EVIDENCE_FORMAT ? EVIDENCE_FORMAT : fail(p, EVIDENCE_FORMAT, v)),
  kind: oneOf("video", "audio", "infographic"),
  masterHash: sha256,
  duration: nullable(num),
  /** The transcript's file name in the evidence folder; null for an infographic, and for a video with no audio. */
  transcript: nullable(nonEmpty),
  /** The sampled frames, relative to the evidence folder. */
  frames: arr(nonEmpty),
  /** The infographic's own file. */
  image: nullable(nonEmpty),
});
export type Evidence = Infer<typeof evidenceSchema>;

/** The evidence of an item's attempt, refused when it is missing or was gathered from another master. */
export function readEvidence(priv: string, item: MediaItem, master: string): { folder: string; evidence: Evidence } {
  const attempt = item.regenerations + 1;
  const folder = evidenceDir(priv, item.id, attempt);
  const path = join(folder, "evidence.json");
  if (!existsSync(path)) {
    throw new LedgerError("refused", `no evidence for ${item.id} (attempt ${attempt}): run evidence first`);
  }
  const evidence = readJsonFile(path, evidenceSchema, "evidence");
  if (evidence.masterHash !== hashFile(master)) {
    throw new LedgerError(
      "refused",
      `the evidence in ${folder} is of another master than ${item.id}'s: run evidence again`,
    );
  }
  return { folder, evidence };
}

/** A Module's media item (video, audio or infographic): what the fact check and the placement work on. */
export type ModuleItem = MediaItem & { kind: Exclude<MediaKind, "sitting-audio">; module: string };

export function moduleItem(project: string, id: string): { item: ModuleItem; module: string } {
  const item = requireMediaFile(project).items.find((i) => i.id === id);
  if (item === undefined) throw new LedgerError("invalid", `no media item ${id}`);
  if (item.kind === "sitting-audio" || item.module === null) {
    throw new LedgerError(
      "refused",
      `${id} is a sitting audio: the Build ledger doesn't record which Modules a sitting covers yet, so there is no Module content to check it against`,
    );
  }
  return { item: item as ModuleItem, module: item.module };
}

export interface EvidenceResult {
  item: string;
  attempt: number;
  kind: MediaKind;
  module: { id: string; folder: string };
  /** The Module's content folder: what every claim is checked against. */
  content: string;
  evidence: string;
  transcript: string | null;
  frames: string[];
  image: string | null;
  duration: number | null;
  /** The file the fact-check subagent writes (`briefs/media-check.md`), and the judge reads. */
  check: string;
}

/**
 * Gathers what the fact-check subagent reads for a downloaded item: sampled frames and a transcript (or the
 * infographic itself), into the Private folder's `media/evidence/<item>-<attempt>/`.
 */
export function gatherEvidence(
  project: string,
  id: string,
  privateFolder: string,
  kit: MediaKit,
  whisperModel: string | null,
): EvidenceResult {
  const root = resolve(project);
  const priv = requirePrivateFolder(root, privateFolder);
  const { item, module } = moduleItem(root, id);
  if (item.state !== "downloaded")
    throw new LedgerError("refused", `${id} is ${item.state}; evidence needs it downloaded`);
  const master = masterOf(priv, item);
  const attempt = item.regenerations + 1;
  const folder = evidenceDir(priv, id, attempt);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(priv, "media", "checks"), { recursive: true });
  const ran = kit.evidence({ kind: item.kind, master, out: folder, whisperModel });
  if (!ran.ok) throw new LedgerError("invalid", `the media kit couldn't gather evidence for ${id}: ${ran.error}`);
  const { evidence } = readEvidence(priv, item, master);
  const { folder: moduleDir } = moduleFolder(requireLedger(root), module);
  return {
    item: id,
    attempt,
    kind: item.kind,
    module: { id: module, folder: moduleDir },
    content: join(root, "content", "modules", moduleDir),
    evidence: folder,
    transcript: evidence.transcript === null ? null : join(folder, evidence.transcript),
    frames: evidence.frames.map((f) => join(folder, f)),
    image: evidence.image,
    duration: evidence.duration,
    check: checkPath(priv, id, attempt),
  };
}

/** The one field of the check file the re-encode reads (check.ts holds the whole schema, and imports this file). */
const checkedMaster: Schema<{ masterHash: unknown }> = (v, p) =>
  typeof v === "object" && v !== null && "masterHash" in v ? { masterHash: v.masterHash } : fail(p, "a check file", v);

export interface EncodeResult {
  /** The web copy, relative to the Private folder; absent when the item was dropped for its size. */
  file?: string;
  bytes?: number;
  masterBytes: number;
  harder: boolean;
  tries: { profile: "standard" | "harder"; bytes: number }[];
  /** Set when the item was dropped: its state then, and `code` 1. */
  state?: string;
  code?: number;
  error?: string;
}

/**
 * The web copy of a checked item's master, in the Private folder's `media/web/`. One over `limitBytes`
 * (GitHub's) is re-encoded harder, once; still over, the item is dropped (`fail --final`: a regeneration
 * won't be smaller). Sizes are reported, never capped. A kit failure leaves the item as it was.
 */
export function encodeItem(
  stateDir: string,
  project: string,
  id: string,
  privateFolder: string,
  kit: MediaKit,
  limitBytes: number,
): EncodeResult {
  const root = resolve(project);
  const priv = requirePrivateFolder(root, privateFolder);
  const { item } = moduleItem(root, id);
  if (item.state !== "checked")
    throw new LedgerError("refused", `${id} is ${item.state}; the re-encode needs it checked`);
  const attempt = item.regenerations + 1;
  const master = masterOf(priv, item);
  // Only the bytes the fact check passed: its file names the master it read, and a replaced master isn't that.
  const checkFile = checkPath(priv, id, attempt);
  if (existsSync(checkFile)) {
    const { masterHash } = readJsonFile(checkFile, checkedMaster, "check file");
    if (masterHash !== hashFile(master)) {
      throw new LedgerError(
        "refused",
        `${master} is another master than the one ${id}'s fact check passed: check it again`,
      );
    }
  }
  const masterBytes = statSync(master).size;
  const ext = WEB_EXTENSION[item.kind];
  const tries: EncodeResult["tries"] = [];
  let duration: number | null = null;
  let out = mediaDir(priv, "web", `${id}-${attempt}${ext}`);
  for (const harder of [false, true]) {
    if (harder) out = mediaDir(priv, "web", `${id}-${attempt}-harder${ext}`);
    const ran = kit.encode({ kind: item.kind, master, out, harder });
    if (!ran.ok) throw new LedgerError("invalid", `the media kit couldn't re-encode ${id}: ${ran.error}`);
    duration = ran.duration;
    tries.push({ profile: harder ? "harder" : "standard", bytes: statSync(out).size });
    if ((tries.at(-1)?.bytes ?? 0) <= limitBytes) break;
  }
  const last = tries.at(-1)?.bytes ?? 0;
  if (last > limitBytes) {
    const first = tries[0]?.bytes ?? 0;
    const reason = `still ${size(last)} after the harder re-encode (limit ${size(limitBytes)}, first try ${size(first)})`;
    const dropped = failItem(stateDir, root, id, reason, true);
    return { masterBytes, harder: true, tries, ...dropped, code: 1, error: reason };
  }
  const harder = tries.length === 2;
  recordEncoded(stateDir, root, id, {
    attempt,
    file: relative(priv, out).replaceAll("\\", "/"),
    hash: hashFile(out),
    bytes: last,
    masterBytes,
    harder,
    duration,
  });
  return { file: relative(priv, out).replaceAll("\\", "/"), bytes: last, masterBytes, harder, tries };
}
