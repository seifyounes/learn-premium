import { defineCollection } from "astro:content";
import { resolve } from "node:path";
import { COLLECTIONS, type CollectionLayout } from "./content/layout";
import { markdownLoader, structuredLoader } from "./content/loaders";

// The Course's content folder sits beside the template layer. In this repo that is the Fixture
// Course; CONTENT_DIR points the build at any other Course's content.
const CONTENT_DIR = resolve(process.cwd(), process.env.CONTENT_DIR ?? "../fixture-course");

const loader = ({ pattern, format, generateId }: CollectionLayout) =>
  (format === "markdown" ? markdownLoader : structuredLoader)({ base: CONTENT_DIR, pattern, generateId });

export const collections = {
  course: defineCollection({ loader: loader(COLLECTIONS.course), schema: COLLECTIONS.course.schema }),
  modules: defineCollection({ loader: loader(COLLECTIONS.modules), schema: COLLECTIONS.modules.schema }),
  beats: defineCollection({ loader: loader(COLLECTIONS.beats), schema: COLLECTIONS.beats.schema }),
  worked: defineCollection({ loader: loader(COLLECTIONS.worked), schema: COLLECTIONS.worked.schema }),
  practice: defineCollection({ loader: loader(COLLECTIONS.practice), schema: COLLECTIONS.practice.schema }),
};
