// Read helpers the page templates use to place a Course's content.
import { getCollection, getEntry, type CollectionEntry } from "astro:content";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderProse } from "../math/katex";
import {
  moleculeRecord,
  moleculeRecordEntry,
  moleculeSdfEntry,
  moleculeSvgEntry,
  type MoleculeRecord,
} from "../molecules/record";
import { partGlbEntry, partGlbUrl } from "../parts/record";
import { notInPythonFolder, pythonSource } from "../python/tools";
import { mediaFolder, mediaUrl, missingMediaFiles, notInMediaFolder, pngSize, type Media } from "../media/media";
import type { MasteryShape } from "../progress/progress";
import { MODULE_ID, uncoveredModules } from "./contract";

export type { Sitting } from "./contract";
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

/**
 * The Course's Exam sittings, in course.yaml's order. A sitting covering a Module the Course has
 * no folder for fails the build.
 */
export async function getSittings() {
  const [course, modules] = await Promise.all([getCourse(), getModules()]);
  const [uncovered] = uncoveredModules(course.sittings, new Set(modules.map((m) => m.id)));
  if (uncovered) throw new Error(`course.yaml: ${uncovered.message}`);
  return course.sittings;
}

/** A paper or a mock of an Exam sitting, with the name its route and its progress are kept by. */
export interface ExamSheetRef<C extends "papers" | "mocks"> {
  sitting: string;
  /** Its file name in the sitting's folder, without the extension: its route `/exam/<sitting>/<name>/`. */
  name: string;
  entry: CollectionEntry<C>;
}

const examRef = <C extends "papers" | "mocks">(entry: CollectionEntry<C>): ExamSheetRef<C> => {
  const [sitting = "", name = ""] = entry.id.split("/");
  return { sitting, name, entry };
};

/**
 * A sitting's content in the Exam room: its past papers and mocks (each by file name), and the
 * format the Professor announced. A folder `sittings/<id>/` the Course has no sitting for, a name
 * used by two papers or mocks of a sitting, and a question examining a Module the sitting doesn't
 * cover fail the build, naming the file.
 */
async function examContent() {
  const [sittings, papers, mocks, formats] = await Promise.all([
    getSittings(),
    getCollection("papers"),
    getCollection("mocks"),
    getCollection("formats"),
  ]);
  const ids = new Set(sittings.map((s) => s.id));
  const seen = new Map<string, string>();
  for (const e of [...papers, ...mocks, ...formats]) {
    const id = e.id.split("/")[0] ?? "";
    const where = e.filePath ?? e.id;
    if (!ids.has(id)) throw new Error(`${where} sits in sittings/${id}/, which course.yaml has no sitting for`);
    const sitting = sittings.find((s) => s.id === id);
    const covers = new Set(sitting?.modules);
    if ("questions" in e.data) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id.split("/")[1] ?? ""))
        throw new Error(`${where}: a paper or mock is named in lower-case letters, digits and dashes, as its route is`);
      if (seen.has(e.id))
        throw new Error(`${where}: the name "${e.id.split("/")[1]}" is already used by ${seen.get(e.id)}`);
      seen.set(e.id, where);
      e.data.questions.forEach((q, i) => {
        if (!covers.has(q.module))
          throw new Error(`${where}: question ${i + 1} examines ${q.module}, which sitting "${id}" doesn't cover`);
      });
    }
  }
  const byName = <C extends "papers" | "mocks">(list: CollectionEntry<C>[]) =>
    list.map((e) => examRef<C>(e)).sort((a, b) => a.sitting.localeCompare(b.sitting) || a.name.localeCompare(b.name));
  return { sittings, papers: byName<"papers">(papers), mocks: byName<"mocks">(mocks), formats };
}

/** A sitting's past papers, by file name. */
export async function getPapers(sitting: string) {
  return (await examContent()).papers.filter((p) => p.sitting === sitting);
}

/** A sitting's mocks: the pattern-matched ones by file name, then the one for the announced format. */
export async function getMocks(sitting: string) {
  const announced = (m: ExamSheetRef<"mocks">) => Number(m.entry.data.pattern === "announced");
  return (await examContent()).mocks
    .filter((m) => m.sitting === sitting)
    .sort((a, b) => announced(a) - announced(b) || a.name.localeCompare(b.name));
}

/** The format the Professor announced for a sitting; undefined when none was. */
export async function getFormat(sitting: string) {
  return (await examContent()).formats.find((f) => f.id === sitting)?.data;
}

/**
 * The sittings with an Exam room: complete ones with at least one past paper. A complete sitting
 * without past papers has Revision only.
 */
export async function examRooms() {
  const { sittings, papers } = await examContent();
  return sittings.filter((s) => s.complete && papers.some((p) => p.sitting === s.id));
}

/** A Module's rules for Master Rules and Revision, in solving order; undefined when it has no rules.yaml. */
export async function getRules(moduleId: string) {
  return (await getEntry("rules", moduleId))?.data;
}

/** What a Module's Mastery is measured on: its Worked examples, with their steps, and its Practice items. */
export async function masteryShape(moduleId: string): Promise<MasteryShape> {
  const [worked, practice] = await Promise.all([
    moduleEntries("worked", moduleId),
    moduleEntries("practice", moduleId),
  ]);
  return {
    worked: worked.map((w) => ({ code: w.data.code, steps: w.data.steps.length })),
    practice: practice.map((p) => itemNumber(p.id)),
  };
}

/** A Practice item's number in its Module: its file name. */
export const itemNumber = (id: string) => id.split("/").pop() ?? id;

type ModuleCollection = "beats" | "worked" | "practice";

/** A Module's entries of one kind, in file-number order (`summary/2.md` before `summary/10.md`). */
export async function moduleEntries<C extends ModuleCollection>(collection: C, moduleId: string) {
  const entries = (await getCollection(collection)) as CollectionEntry<C>[];
  const order = (e: CollectionEntry<C>) => Number(e.id.split("/").pop());
  return entries.filter((e) => e.id.startsWith(`${moduleId}/`)).sort((a, b) => order(a) - order(b));
}

export interface SimRef {
  /** The Module it belongs to (its folder name). */
  module: string;
  /** Its file name in the Module's `sims/` folder, without the extension. */
  name: string;
  entry: CollectionEntry<"sims">;
}

/** Every Agent-built sim in the Course, Module by Module, by file name within each. */
export async function getSims(): Promise<SimRef[]> {
  const sims = await getCollection("sims");
  return sims
    .map((entry) => {
      const [module = "", , name = ""] = entry.id.split("/");
      return { module, name, entry };
    })
    .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

export interface PythonRef {
  /** The Module it belongs to (its folder name). */
  module: string;
  /** Its file name in the Module's `python/` folder, without the extension. */
  name: string;
  entry: CollectionEntry<"python">;
  /** Its code, read from the `.py` file it names. */
  code: string;
}

/**
 * Every Pyodide tool in the Course, Module by Module, by file name within each, with its code. A
 * tool naming a `.py` file its folder doesn't hold fails the build, naming both.
 */
export async function getPythonTools(): Promise<PythonRef[]> {
  const contentDir = buildContentDir();
  const tools = await getCollection("python");
  return tools
    .map((entry) => {
      const [module = "", , name = ""] = entry.id.split("/");
      const path = pythonSource(contentDir, module, entry.data.source);
      if (!existsSync(path)) throw new Error(`${entry.filePath ?? entry.id} ${notInPythonFolder(entry.data.source)}`);
      return { module, name, entry, code: readFileSync(path, "utf8") };
    })
    .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

export interface PartRef {
  /** The Module it belongs to (its folder name). */
  module: string;
  /** Its file name in the Module's `parts/` folder, without the extension. */
  name: string;
  entry: CollectionEntry<"parts">;
  /** Where the site publishes its GLB. */
  glbUrl: string;
}

/**
 * Every machine part in the Course, Module by Module, by file name within each. A part whose GLB
 * hasn't been built (`npm run parts`) fails the build, naming it.
 */
export async function getParts(): Promise<PartRef[]> {
  const contentDir = buildContentDir();
  const parts = await getCollection("parts");
  return parts
    .map((entry) => {
      const [module = "", , name = ""] = entry.id.split("/");
      if (!existsSync(join(contentDir, "modules", module, "module.yaml")))
        throw new Error(`${entry.filePath ?? entry.id} sits in modules/${module}/, which has no module.yaml`);
      const glb = partGlbEntry(module, name);
      if (!existsSync(join(contentDir, glb)))
        throw new Error(`${entry.filePath ?? entry.id} has no GLB at ${glb}: build it with npm run parts`);
      return { module, name, entry, glbUrl: partGlbUrl(module, name) };
    })
    .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}

export interface MoleculeRef {
  /** The Module it belongs to (its folder name). */
  module: string;
  /** Its file name in the Module's `molecules/` folder, without the extension. */
  name: string;
  entry: CollectionEntry<"molecules">;
  /** RDKit's record of it: the formula, the heavy atoms, the files' hashes. */
  record: MoleculeRecord;
  /** The 2D structure RDKit drew, when the molecule has that view. */
  svg: string | undefined;
  /** The 3D conformer RDKit embedded, when the molecule has that view. */
  sdf: string | undefined;
}

/**
 * Every molecule in the Course, Module by Module, by file name within each. A molecule whose
 * record or files haven't been built (`npm run molecules`) fails the build, naming the missing one.
 */
export async function getMolecules(): Promise<MoleculeRef[]> {
  const contentDir = buildContentDir();
  const molecules = await getCollection("molecules");
  return molecules
    .map((entry) => {
      const [module = "", , name = ""] = entry.id.split("/");
      const where = entry.filePath ?? entry.id;
      if (!existsSync(join(contentDir, "modules", module, "module.yaml")))
        throw new Error(`${where} sits in modules/${module}/, which has no module.yaml`);
      const need = (file: string) => {
        if (!existsSync(join(contentDir, file)))
          throw new Error(`${where} has no ${file}: build it with npm run molecules`);
        return readFileSync(join(contentDir, file), "utf8");
      };
      const record = moleculeRecord.parse(JSON.parse(need(moleculeRecordEntry(module, name))));
      const views = entry.data.views;
      return {
        module,
        name,
        entry,
        record,
        svg: views.includes("structure") ? need(moleculeSvgEntry(module, name)) : undefined,
        sdf: views.includes("viewer") ? need(moleculeSdfEntry(module, name)) : undefined,
      };
    })
    .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
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
  // A Module may have no media.yaml; looked up in the collection so its absence isn't logged as a miss.
  const entry = (await getCollection("media")).find((e) => e.id === moduleId);
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
