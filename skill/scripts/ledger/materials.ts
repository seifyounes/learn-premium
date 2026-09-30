// The Materials hash diff: the Materials folder as it is now against the ledger's inventory.
import { extname } from "node:path";
import { hashTree } from "./hash.ts";
import type { Ledger, MaterialKind } from "./model.ts";

const KINDS: Record<string, MaterialKind> = {
  ".pdf": "pdf",
  ".pptx": "slides",
  ".ppt": "slides",
  ".docx": "document",
  ".doc": "document",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".heic": "image",
  ".webp": "image",
  ".mp3": "audio",
  ".m4a": "audio",
  ".wav": "audio",
  ".mp4": "video",
  ".mov": "video",
  ".mkv": "video",
  ".webm": "video",
};

export function kindOf(path: string): MaterialKind {
  return KINDS[extname(path).toLowerCase()] ?? "other";
}

export interface MaterialsDiff {
  new: { path: string; kind: MaterialKind }[];
  changed: { path: string; kind: MaterialKind; module: string | null }[];
  deleted: { path: string; kind: MaterialKind; module: string | null }[];
}

export function diffMaterials(ledger: Ledger): MaterialsDiff {
  const onDisk = hashTree(ledger.intake.materialsPath);
  const known = new Map(ledger.materials.filter((m) => m.superseded === null).map((m) => [m.path, m]));
  const diff: MaterialsDiff = { new: [], changed: [], deleted: [] };
  for (const [path, hash] of Object.entries(onDisk)) {
    const row = known.get(path);
    if (row === undefined) diff.new.push({ path, kind: kindOf(path) });
    else if (row.hash !== hash) diff.changed.push({ path, kind: row.kind, module: row.module });
  }
  for (const row of known.values()) {
    if (!(row.path in onDisk)) diff.deleted.push({ path: row.path, kind: row.kind, module: row.module });
  }
  return diff;
}
