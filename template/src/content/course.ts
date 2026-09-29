// Read helpers the page templates use to place a Course's content.
import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import { renderProse } from "../math/katex";
import { MODULE_ID } from "./contract";

export async function getCourse() {
  const entry = await getEntry("course", "course");
  if (!entry) throw new Error("the Course has no course.yaml");
  return entry.data;
}

export interface ModuleRef {
  id: string;
  number: string;
  entry: CollectionEntry<"modules">;
}

export async function getModules(): Promise<ModuleRef[]> {
  const modules = await getCollection("modules");
  return modules
    .map((entry) => {
      const match = MODULE_ID.exec(entry.id);
      if (!match?.[1]) throw new Error(`module folder "${entry.id}" must be named NN-slug, e.g. 01-thermal-resistance`);
      return { id: entry.id, number: match[1], entry };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

type ModuleCollection = "beats" | "worked" | "practice";

/** A Module's entries of one kind, in file-number order (`summary/2.md` before `summary/10.md`). */
export async function moduleEntries<C extends ModuleCollection>(collection: C, moduleId: string) {
  const entries = (await getCollection(collection)) as CollectionEntry<C>[];
  const order = (e: CollectionEntry<C>) => Number(e.id.split("/").pop());
  return entries.filter((e) => e.id.startsWith(`${moduleId}/`)).sort((a, b) => order(a) - order(b));
}

/**
 * Prose field → HTML with paper math. The loader already rendered every string once and failed
 * the build on bad LaTeX with its file and line, so a location is never needed here.
 */
export const prose = (text: string) => renderProse(text, () => ({ file: "<checked at load>", line: 0 }));
