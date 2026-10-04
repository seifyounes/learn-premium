// The deploy gates that keep what is private out of the build, before it merges: no Materials file
// and nothing from Build evidence in the output, and noindex on every page and in Vercel's config.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { z } from "astro/zod";
import { allFiles, courseCopy, foldersUp, templateOf, templateWith } from "./course-files.ts";
import { evidenceShape } from "./evidence.ts";
import { copySite, siteFilesWith } from "./pages.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { EVERY_PATH, NOINDEX, readVercelConfig, VERCEL_CONFIG } from "./vercel-config.ts";

/** The built site the gate input names. */
function siteOf({ distDir }: GateInput): string {
  if (distDir === undefined) throw new Error("no built site given to check (distDir)");
  if (!existsSync(distDir)) throw new Error(`the built site ${distDir} does not exist`);
  return distDir;
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * File types a Study site never ships but Materials come in: documents, decks, sheets and camera
 * originals. The site's own figures are SVG, PNG, JPEG or WebP, and its media MP4, MP3 and VTT.
 */
const MATERIALS_TYPES = new Set([
  ".pdf",
  ".ppt",
  ".pptx",
  ".pps",
  ".ppsx",
  ".key",
  ".odp",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".pages",
  ".xls",
  ".xlsx",
  ".ods",
  ".numbers",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".dng",
  ".cr2",
  ".nef",
  ".arw",
]);

export const LEDGER_FILE = "build-ledger.json";

const ledgerMaterials = z.object({ materials: z.array(z.object({ path: z.string(), hash: z.string() })) });

/**
 * The Course project's Build ledger, found from the content folder up to its repo's root: the
 * Materials inventory, superseded rows too. Null when the Course keeps none (the Fixture Course).
 */
export function readLedgerMaterials(
  contentDir: string,
): { file: string; materials: { path: string; hash: string }[] } | null {
  for (const dir of foldersUp(contentDir)) {
    const file = join(dir, LEDGER_FILE);
    if (existsSync(file)) {
      const parsed = ledgerMaterials.safeParse(JSON.parse(readFileSync(file, "utf8")));
      if (!parsed.success) throw new Error(`${file} has no Materials inventory the gate can read`);
      return { file, materials: parsed.data.materials };
    }
    if (existsSync(join(dir, ".git"))) return null;
  }
  return null;
}

export const noMaterials: Gate = {
  id: "no-materials",
  checks:
    "the build output holds no Materials file: no document, deck, sheet or camera original, and nothing matching a Materials hash in the Build ledger",
  points: ["deploy"],
  async run(input) {
    const files = allFiles(siteOf(input));
    const ledger = readLedgerMaterials(input.contentDir);
    const known = new Map((ledger?.materials ?? []).map((m) => [m.hash.toLowerCase(), m.path]));
    const findings: Finding[] = [];
    for (const { entry, path } of files) {
      const block = (message: string) => findings.push({ outcome: "block", at: `/${entry}`, message });
      if (MATERIALS_TYPES.has(extname(entry).toLowerCase()))
        block(`a ${extname(entry).slice(1).toUpperCase()} file in the output: Materials never ship`);
      const material = known.size > 0 ? known.get(sha256(path)) : undefined;
      if (material !== undefined) block(`is the Materials file ${material} (its hash is in the Build ledger)`);
    }
    return { coverage: { files: files.length, materialsHashes: known.size }, findings };
  },
  controls: [
    {
      defect: "a lecture PDF in the build output",
      plant: (good, scratch) => siteFilesWith(good, scratch, { "01-planted/lecture-03.pdf": "%PDF-1.7 planted\n" }),
    },
    {
      defect: "a board photo the Build ledger lists, shipped under a figure's name",
      plant: (good, scratch) => {
        const photo = "planted board photo: not a real image\n";
        const course = courseCopy(good, scratch);
        const hash = createHash("sha256").update(photo).digest("hex");
        writeFileSync(
          join(course.contentDir, LEDGER_FILE),
          JSON.stringify({ materials: [{ path: "Lecture 3/board.jpg", hash }] }),
        );
        return siteFilesWith(course, scratch, { "_astro/figure.planted.jpg": photo });
      },
    },
  ],
};

export const noBuildEvidence: Gate = {
  id: "no-build-evidence",
  checks:
    "the build output holds nothing from Build evidence: no evidence-shaped path (transcriptions, crops, quotes, reader renders, Private-folder copies), no build-records/ and no copy of a recompute log or Gate report",
  points: ["deploy"],
  async run(input) {
    const files = allFiles(siteOf(input));
    const recordsDir = join(input.contentDir, "build-records");
    const records = existsSync(recordsDir) ? allFiles(recordsDir) : [];
    const recordOf = new Map(records.map((r) => [sha256(r.path), `build-records/${r.entry}`]));
    const findings: Finding[] = [];
    for (const { entry, path } of files) {
      const block = (message: string) => findings.push({ outcome: "block", at: `/${entry}`, message });
      const shape = evidenceShape(entry);
      if (shape !== null) block(`evidence-shaped path: ${shape.reason}`);
      else if (entry.split("/").includes("build-records")) block("inside build-records/, which is never deployed");
      const record = recordOf.get(sha256(path));
      if (record !== undefined) block(`is a copy of the build record ${record}`);
    }
    return { coverage: { files: files.length, buildRecords: records.length }, findings };
  },
  controls: [
    {
      defect: "a transcription folder in the build output",
      plant: (good, scratch) => siteFilesWith(good, scratch, { "transcripts/lecture-01.txt": "Planted transcript.\n" }),
    },
    {
      defect: "a recompute log copied into the output under another name",
      plant: (good, scratch) => {
        const log = '{"planted": "recompute log"}\n';
        const course = courseCopy(good, scratch);
        mkdirSync(join(course.contentDir, "build-records", "recompute"), { recursive: true });
        writeFileSync(join(course.contentDir, "build-records", "recompute", "planted.json"), log);
        return siteFilesWith(course, scratch, { "_astro/data.planted.json": log });
      },
    },
  ],
};

export const noindexGate: Gate = {
  id: "noindex",
  checks:
    "every built page carries a robots noindex meta tag, and vercel.json sends X-Robots-Tag: noindex on every path",
  points: ["deploy"],
  async run(input) {
    const pages = allFiles(siteOf(input)).filter((f) => f.entry.endsWith(".html"));
    if (pages.length === 0) throw new Error("the build has no page to check for noindex");
    const findings: Finding[] = [];
    for (const { entry, path } of pages) {
      if (!robotsMetas(fromHtml(readFileSync(path, "utf8"))).some((c) => NOINDEX.test(c)))
        findings.push({ outcome: "block", at: `/${entry}`, message: "the page has no robots noindex meta tag" });
    }
    const config = readVercelConfig(templateOf(input));
    const header = (config.headers ?? [])
      .filter((rule) => rule.source === EVERY_PATH)
      .flatMap((rule) => rule.headers)
      .find((h) => h.key.toLowerCase() === "x-robots-tag");
    if (header === undefined || !NOINDEX.test(header.value)) {
      findings.push({
        outcome: "block",
        at: VERCEL_CONFIG,
        message: `vercel.json sends no X-Robots-Tag: noindex on every path ("${EVERY_PATH}")`,
      });
    }
    return { coverage: { pages: pages.length, configs: 1 }, findings };
  },
  controls: [
    {
      defect: "a page without its robots noindex meta tag",
      plant: (good, scratch) => {
        const distDir = copySite(good, scratch);
        const page = join(distDir, "index.html");
        const html = readFileSync(page, "utf8");
        const stripped = html.replace(/<meta name="robots"[^>]*>/, "");
        if (stripped === html) throw new Error("the home page has no robots meta tag to strip");
        writeFileSync(page, stripped);
        return { ...good, distDir };
      },
    },
    {
      defect: "vercel.json without the X-Robots-Tag header",
      plant: (good, scratch) => templateWith(good, scratch, { config: (config) => ({ ...config, headers: [] }) }),
    },
  ],
};

function robotsMetas(tree: Nodes): string[] {
  const found: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "element") {
      const { name, content } = (node as Element).properties;
      if (node.tagName === "meta" && String(name).toLowerCase() === "robots") found.push(String(content ?? ""));
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return found;
}
