// Reading and writing the media files, the Course registry and the usage log. Each has its own mutex,
// separate from the Build ledger's, so the Media pass never waits on (or holds up) a driving session.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LedgerError, readChecked, withMutex, writeChecked } from "../ledger/file.ts";
import {
  CHROME_FILE,
  chromeSchema,
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
import type { Schema } from "../ledger/schema.ts";

export function mediaPath(project: string): string {
  return join(project, MEDIA_FILE);
}

/** A Course's media file, or null before its first gather. The driving session reads it through here too. */
export function readMediaFile(project: string): MediaFile | null {
  return readChecked(mediaPath(project), mediaFileSchema, "media");
}

export function noMediaFile(project: string): LedgerError {
  return new LedgerError("invalid", `no media file in ${project}: gather the Media queue first`);
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
      readMediaFile(project) ??
      (course === undefined ? null : { schema: SCHEMA_VERSION, course, notebook: null, items: [] });
    if (file === null) throw noMediaFile(project);
    const result = change(file);
    writeChecked(mediaPath(project), mediaFileSchema, "media", file);
    after(file);
    return result;
  });
}

export function readRegistry(stateDir: string): Registry {
  return (
    readChecked(join(stateDir, REGISTRY_FILE), registrySchema, "registry") ?? { schema: SCHEMA_VERSION, courses: [] }
  );
}

export function updateRegistry<T>(stateDir: string, change: (registry: Registry) => T): T {
  return updateStateFile(stateDir, REGISTRY_FILE, registrySchema, readRegistry, change, () => {});
}

const EMPTY_USAGE: Usage = {
  schema: SCHEMA_VERSION,
  limits: { "5-hour": null, weekly: null },
  costs: { video: null, audio: null, infographic: null, "sitting-audio": null },
  spends: [],
  stops: [],
};

export function readUsage(stateDir: string): Usage {
  return readChecked(join(stateDir, USAGE_FILE), usageSchema, "usage") ?? structuredClone(EMPTY_USAGE);
}

/**
 * Applies `change` to the usage log under its mutex, then `after` while still holding it. A command
 * that also moves a media item takes this mutex first, then the media file's.
 */
export function updateUsage<T>(
  stateDir: string,
  change: (usage: Usage) => T,
  after: (result: T) => void = () => {},
): T {
  return updateStateFile(stateDir, USAGE_FILE, usageSchema, readUsage, change, after);
}

/** A read-modify-write of one file in the machine state folder, which the first write creates. */
function updateStateFile<D, T>(
  stateDir: string,
  name: string,
  schema: Schema<D>,
  read: (stateDir: string) => D,
  change: (data: D) => T,
  after: (result: T) => void,
): T {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, name);
  return withMutex(path, () => {
    const data = read(stateDir);
    const result = change(data);
    writeChecked(path, schema, name, data);
    after(result);
    return result;
  });
}

const readChrome = (stateDir: string) => readChecked(join(stateDir, CHROME_FILE), chromeSchema, "chrome");

/**
 * The dedicated Chrome profile's name, as Claude in Chrome lists the browser (null until the Owner sets
 * it), after recording `profile` when given.
 */
export function chromeProfile(stateDir: string, profile: string | null): { profile: string | null } {
  if (profile !== null) {
    updateStateFile(
      stateDir,
      CHROME_FILE,
      chromeSchema,
      (dir) => readChrome(dir) ?? { schema: SCHEMA_VERSION, profile },
      (data) => (data.profile = profile),
      () => {},
    );
  }
  return { profile: readChrome(stateDir)?.profile ?? null };
}
