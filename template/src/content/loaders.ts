// Loads a Course's content for Astro's content collections. Every file is read here, not by
// Astro's own loaders: its glob loader logs a Markdown render error and drops the entry, and the
// build still passes. Here any error fails the build, naming the file and line it sits on.
//
// Structured content (JSON or YAML) has every string run through the Paper Math step as it is
// read; Markdown is rendered through the configured processor (remark-math + rehype-paper-math).
// Zod then checks each entry's shape against the content contract.
import type { Loader, LoaderContext } from "astro/loaders";
import { globSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isScalar, LineCounter, parseDocument, visit } from "yaml";
import { renderProse, type SourceLocation } from "../math/katex";

export interface CourseLoaderOptions {
  /** Absolute path of the Course's content folder. */
  base: string;
  /** Glob, relative to `base`, of the files this collection holds. */
  pattern: string;
  /** The entry id for a file path relative to `base` (forward slashes, extension kept). */
  generateId?: (entry: string) => string;
}

const withoutExtension = (entry: string) => entry.replace(/\.(md|json|ya?ml)$/, "");
const slashes = (path: string) => path.replace(/\\/g, "/");

/** A collection of JSON or YAML files. */
export function structuredLoader(options: CourseLoaderOptions): Loader {
  return courseLoader("learn-premium-structured", options, async ({ source, file }) => ({
    data: readStructured(source, file),
  }));
}

/** A collection of Markdown files with YAML frontmatter. */
export function markdownLoader(options: CourseLoaderOptions): Loader {
  return courseLoader("learn-premium-markdown", options, async ({ source, file, path, context }) => {
    const { frontmatter, body } = splitFrontmatter(source);
    const data = frontmatter === undefined ? {} : readStructured(frontmatter, file);
    // The body keeps its place in the file (frontmatter blanked, not removed), so the math step
    // reports real line numbers.
    const rendered = await context.renderMarkdown(body, { fileURL: pathToFileURL(path) });
    return { data, body, rendered };
  });
}

interface ReadFile {
  source: string;
  /** The file's absolute path with forward slashes, as errors name it. */
  file: string;
  path: string;
  context: LoaderContext;
}

type Entry = Pick<Parameters<LoaderContext["store"]["set"]>[0], "data" | "body" | "rendered">;

function courseLoader(
  name: string,
  { base, pattern, generateId = withoutExtension }: CourseLoaderOptions,
  read: (file: ReadFile) => Promise<Entry>,
): Loader {
  return {
    name,
    load: async (context) => {
      const { store, parseData, generateDigest, config, watcher } = context;
      store.clear();
      const root = fileURLToPath(config.root);
      for (const entry of globSync(pattern, { cwd: base }).map(slashes).sort()) {
        const path = join(base, entry);
        const source = readFileSync(path, "utf8");
        const { data, ...rest } = await read({ source, file: slashes(path), path, context });
        const id = generateId(entry);
        const filePath = slashes(relative(root, path));
        store.set({
          id,
          data: await parseData({ id, data, filePath }),
          filePath,
          digest: generateDigest(source),
          ...rest,
        });
      }
      watcher?.add(base);
    },
  };
}

/**
 * Splits `---` frontmatter from a Markdown file. Both parts keep the source's line numbers: the
 * frontmatter gains a blank first line (for the opening fence) and the body has the whole
 * frontmatter block blanked out.
 */
export function splitFrontmatter(source: string): { frontmatter?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { body: source };
  const block = match[0];
  const blank = "\n".repeat(block.split("\n").length - 1);
  return { frontmatter: `\n${match[1] ?? ""}`, body: blank + source.slice(block.length) };
}

/** Parses JSON or YAML, runs every string through the Paper Math step, and returns the data. */
export function readStructured(source: string, file: string): Record<string, unknown> {
  const lines = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lines, prettyErrors: false });
  const syntax = doc.errors[0];
  if (syntax) {
    const { line, col } = lines.linePos(syntax.pos[0]);
    throw new Error(`${file}:${line}:${col} ${syntax.message}`);
  }
  visit(doc, {
    Scalar(_key, node) {
      if (!isScalar(node) || typeof node.value !== "string" || !node.range) return;
      const value = node.value;
      const start = node.range[0];
      const locate = (offset: number): SourceLocation => {
        const { line, col } = lines.linePos(findInSource(source, start, value, offset));
        return { file, line, column: col };
      };
      renderProse(value, locate);
    },
  });
  return (doc.toJS() ?? {}) as Record<string, unknown>;
}

/**
 * Maps an offset in a parsed string back to the source. The math is found by its own text
 * (as written, or JSON-escaped), searching from the scalar's start; failing that, the scalar's
 * start is the best line there is (e.g. a folded YAML block that breaks inside the math).
 */
function findInSource(source: string, scalarStart: number, value: string, offset: number): number {
  // Shorter needles survive a folded line break sooner, at the risk of matching earlier text.
  for (const length of [40, 16, 6]) {
    const tail = value.slice(offset, offset + length);
    for (const needle of [tail, JSON.stringify(tail).slice(1, -1)]) {
      const at = needle ? source.indexOf(needle, scalarStart) : -1;
      if (at !== -1) return at;
    }
  }
  return scalarStart;
}
