// Read helpers the page templates use to place a Course's content.
import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import { join } from "node:path";
import { renderProse } from "../math/katex";
import { mediaFolder, mediaUrl, missingMediaFiles, notInMediaFolder, pngSize, type Media } from "../media/media";
import { MODULE_ID } from "./contract";
import { buildContentDir } from "./layout";

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

export interface ModuleMedia {
  video?: { url: string; duration: string; captionsUrl?: string };
  audio?: { url: string; duration: string };
  infographic?: { url: string; alt: string; width: number; height: number };
  youtube: Media["youtube"];
}

/**
 * A Module's media as the page places it, with each file's published URL. A file its `media.yaml`
 * names but its `media/` folder doesn't hold fails the build, naming both.
 */
export async function getMedia(moduleId: string): Promise<ModuleMedia> {
  const entry = await getEntry("media", moduleId);
  if (!entry) return { youtube: [] };
  const m = entry.data;
  const contentDir = buildContentDir();
  const missing = missingMediaFiles(contentDir, moduleId, m);
  if (missing.length > 0)
    throw new Error(`modules/${moduleId}/media.yaml ${notInMediaFolder(missing.join(", media/"))}`);
  const url = (file: string) => mediaUrl(moduleId, file);
  return {
    ...(m.video && {
      video: {
        url: url(m.video.file),
        duration: m.video.duration,
        ...(m.video.captions && { captionsUrl: url(m.video.captions) }),
      },
    }),
    ...(m.audio && { audio: { url: url(m.audio.file), duration: m.audio.duration } }),
    ...(m.infographic && {
      infographic: {
        url: url(m.infographic.file),
        alt: m.infographic.alt,
        ...pngSize(join(mediaFolder(contentDir, moduleId), m.infographic.file)),
      },
    }),
    youtube: m.youtube,
  };
}
