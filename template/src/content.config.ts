import { defineCollection } from "astro:content";
import { resolve } from "node:path";
import * as contract from "./content/contract";
import { markdownLoader, structuredLoader } from "./content/loaders";

// The Course's content folder sits beside the template layer. In this repo that is the Fixture
// Course; CONTENT_DIR points the build at any other Course's content.
const CONTENT_DIR = resolve(process.cwd(), process.env.CONTENT_DIR ?? "../fixture-course");

/** `modules/01-slug/worked/1.json` → `01-slug/worked/1` */
const moduleEntryId = (entry: string) => entry.replace(/^modules\//, "").replace(/\.(md|json|ya?ml)$/, "");

export const collections = {
  course: defineCollection({
    loader: structuredLoader({ base: CONTENT_DIR, pattern: "course.yaml", generateId: () => "course" }),
    schema: contract.course,
  }),
  modules: defineCollection({
    loader: structuredLoader({
      base: CONTENT_DIR,
      pattern: "modules/*/module.yaml",
      generateId: (entry) => entry.split("/")[1] ?? entry,
    }),
    schema: contract.module,
  }),
  beats: defineCollection({
    loader: markdownLoader({ base: CONTENT_DIR, pattern: "modules/*/summary/*.md", generateId: moduleEntryId }),
    schema: contract.beat,
  }),
  worked: defineCollection({
    loader: structuredLoader({
      base: CONTENT_DIR,
      pattern: "modules/*/worked/*.{json,yaml,yml}",
      generateId: moduleEntryId,
    }),
    schema: contract.worked,
  }),
  practice: defineCollection({
    loader: structuredLoader({
      base: CONTENT_DIR,
      pattern: "modules/*/practice/*.{json,yaml,yml}",
      generateId: moduleEntryId,
    }),
    schema: contract.practice,
  }),
};
