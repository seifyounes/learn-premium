// Where each kind of content sits in a Course's content folder, and the contract it keeps. The
// build's content collections and the content gates both read it, so they see the same files.
import * as contract from "./contract.ts";

export interface CollectionLayout {
  /** Glob, relative to the content folder. */
  pattern: string;
  format: "structured" | "markdown";
  /** The entry id for a file path relative to the content folder. */
  generateId: (entry: string) => string;
}

export const withoutExtension = (entry: string) => entry.replace(/\.(md|json|ya?ml)$/, "");

/** `modules/01-slug/worked/1.json` → `01-slug/worked/1` */
const moduleEntryId = (entry: string) => withoutExtension(entry).replace(/^modules\//, "");

export const COLLECTIONS = {
  course: { pattern: "course.yaml", format: "structured", generateId: () => "course", schema: contract.course },
  modules: {
    pattern: "modules/*/module.yaml",
    format: "structured",
    generateId: (entry: string) => entry.split("/")[1] ?? entry,
    schema: contract.module,
  },
  beats: { pattern: "modules/*/summary/*.md", format: "markdown", generateId: moduleEntryId, schema: contract.beat },
  worked: {
    pattern: "modules/*/worked/*.{json,yaml,yml}",
    format: "structured",
    generateId: moduleEntryId,
    schema: contract.worked,
  },
  practice: {
    pattern: "modules/*/practice/*.{json,yaml,yml}",
    format: "structured",
    generateId: moduleEntryId,
    schema: contract.practice,
  },
} as const satisfies Record<string, CollectionLayout & { schema: unknown }>;

/** The Module a content file belongs to (its folder name), or undefined for Course-level files. */
export const moduleOf = (entry: string) => /^modules\/([^/]+)\//.exec(entry)?.[1];
