import { defineCollection } from "astro:content";
import { buildContentDir, COLLECTIONS, type CollectionLayout } from "./content/layout";
import { markdownLoader, structuredLoader } from "./content/loaders";

const CONTENT_DIR = buildContentDir();

const loader = ({ pattern, format, generateId }: CollectionLayout) =>
  (format === "markdown" ? markdownLoader : structuredLoader)({ base: CONTENT_DIR, pattern, generateId });

export const collections = {
  course: defineCollection({ loader: loader(COLLECTIONS.course), schema: COLLECTIONS.course.schema }),
  modules: defineCollection({ loader: loader(COLLECTIONS.modules), schema: COLLECTIONS.modules.schema }),
  beats: defineCollection({ loader: loader(COLLECTIONS.beats), schema: COLLECTIONS.beats.schema }),
  worked: defineCollection({ loader: loader(COLLECTIONS.worked), schema: COLLECTIONS.worked.schema }),
  practice: defineCollection({ loader: loader(COLLECTIONS.practice), schema: COLLECTIONS.practice.schema }),
};
