// Reading and writing the media files, the Course registry and the usage log. Each has its own mutex,
// separate from the Build ledger's, so the Media pass never waits on (or holds up) a driving session.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LedgerError, readChecked, withMutex, writeChecked } from "../ledger/file.ts";
import {
  MEDIA_FILE,
  mediaFileSchema,
  REGISTRY_FILE,
  registrySchema,
  SCHEMA_VERSION,
  USAGE_FILE,
  usageSchema,
  type MediaFile,
  type Registry,
  type Usage,
} from "./model.ts";

export function mediaPath(project: string): string {
  return join(project, MEDIA_FILE);
}

/** A Course's media file, or null before its first gather. The driving session reads it through here too. */
export function readMediaFile(project: string): MediaFile | null {
  return readChecked(mediaPath(project), mediaFileSchema, "media");
}

/**
 * Applies `change` to a Course's media file under its mutex, then `after` (the media page) while still
 * holding it. Only a gather passes `course`, which creates the file; every other command needs it made.
 */
export function updateMediaFile<T>(
  project: string,
  change: (file: MediaFile) => T,
  after: (file: MediaFile) => void,
  course?: string,
): T {
  return withMutex(mediaPath(project), () => {
    const file =
      readMediaFile(project) ?? (course === undefined ? null : { schema: SCHEMA_VERSION, course, items: [] });
    if (file === null) throw new LedgerError("invalid", `no media file in ${project}: gather the Media queue first`);
    const result = change(file);
    writeChecked(mediaPath(project), mediaFileSchema, "media", file);
    after(file);
    return result;
  });
}

export function readRegistry(state: string): Registry {
  return readChecked(join(state, REGISTRY_FILE), registrySchema, "registry") ?? { schema: SCHEMA_VERSION, courses: [] };
}

export function updateRegistry<T>(state: string, change: (registry: Registry) => T): T {
  mkdirSync(state, { recursive: true });
  const path = join(state, REGISTRY_FILE);
  return withMutex(path, () => {
    const registry = readRegistry(state);
    const result = change(registry);
    writeChecked(path, registrySchema, "registry", registry);
    return result;
  });
}

const EMPTY_USAGE: Usage = {
  schema: SCHEMA_VERSION,
  limits: { "5-hour": null, weekly: null },
  costs: { video: null, audio: null, infographic: null, "sitting-audio": null },
  spends: [],
  stops: [],
};

export function readUsage(state: string): Usage {
  return readChecked(join(state, USAGE_FILE), usageSchema, "usage") ?? structuredClone(EMPTY_USAGE);
}

/**
 * Applies `change` to the usage log under its mutex, then `after` while still holding it. A command
 * that also moves a media item does so in `after`, once the usage write is safely on disk.
 */
export function updateUsage<T>(state: string, change: (usage: Usage) => T, after: (result: T) => void = () => {}): T {
  mkdirSync(state, { recursive: true });
  const path = join(state, USAGE_FILE);
  return withMutex(path, () => {
    const usage = readUsage(state);
    const result = change(usage);
    writeChecked(path, usageSchema, "usage", usage);
    after(result);
    return result;
  });
}
