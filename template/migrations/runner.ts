// Content migrations. A major Template release changes the content contract, and ships
// `migrations/v<major>.ts` to bring a Course's content and course config from the major before it.
// An upgrade from an earlier release runs every newer major's migration, oldest first. Nothing
// else ever edits a Course's content during an upgrade.
//
// A migration module exports `describe` (one line for the release notes and the Upgrade wave)
// and `migrate(contentDir)`, which rewrites the content folder in place.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The folder the Site template ships its migrations in. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname);

/** A Template release tag: `vMAJOR.MINOR.PATCH`, nothing else. */
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** A migration's file: `v<major>.ts`. */
const MIGRATION_FILE = /^v(\d+)\.ts$/;

export class MigrationError extends Error {}

export interface Migration {
  describe: string;
  migrate(contentDir: string): void | Promise<void>;
}

export interface MigrationRun {
  major: number;
  describe: string;
}

/** The major of a release tag, or a MigrationError naming what was given. */
export function majorOf(tag: string): number {
  const match = RELEASE_TAG.exec(tag);
  if (!match) throw new MigrationError(`"${tag}" is not a Template release tag (vX.Y.Z)`);
  return Number(match[1]);
}

/** The majors this folder ships a migration for, oldest first. */
export function shippedMajors(dir = MIGRATIONS_DIR): number[] {
  return readdirSync(dir)
    .map((name) => MIGRATION_FILE.exec(name)?.[1])
    .filter((major): major is string => major !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

async function load(dir: string, major: number): Promise<Migration> {
  const file = join(dir, `v${major}.ts`);
  const module = (await import(pathToFileURL(file).href)) as Partial<Migration>;
  if (typeof module.describe !== "string" || typeof module.migrate !== "function") {
    throw new MigrationError(`${file} must export describe (a string) and migrate(contentDir)`);
  }
  return module as Migration;
}

/**
 * Runs, in order, every shipped migration newer than `from` (the release the content was written
 * at), up to `to` when given. Stops at the first one that throws, naming it; the caller runs this
 * on a branch or a copy, so a half-migrated folder is thrown away, never merged.
 */
export async function runMigrations(options: {
  contentDir: string;
  from: string;
  to?: string;
  dir?: string;
}): Promise<MigrationRun[]> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const fromMajor = majorOf(options.from);
  const toMajor = options.to === undefined ? Infinity : majorOf(options.to);
  if (toMajor < fromMajor) throw new MigrationError(`can't migrate down, from ${options.from} to ${options.to}`);
  const ran: MigrationRun[] = [];
  for (const major of shippedMajors(dir).filter((m) => m > fromMajor && m <= toMajor)) {
    const migration = await load(dir, major);
    try {
      await migration.migrate(options.contentDir);
    } catch (error) {
      throw new MigrationError(`the v${major} migration failed: ${(error as Error).message}`);
    }
    ran.push({ major, describe: migration.describe });
  }
  return ran;
}
