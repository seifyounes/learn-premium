// Serves Pyodide from the Course project at `/pyodide/`: its core from the template's pinned
// `pyodide` package and the packages the Course's tools load from the Course's `pyodide/` folder,
// copied into the build and served by the dev server. Only what a tool loads ships, and a Course
// with no Pyodide tool ships no Pyodide at all.
import type { AstroIntegration } from "astro";
import { copyFileSync, createReadStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coreDir, coursePackages, PYODIDE_PATH } from "./download.ts";
import { CORE_FILES } from "./lock.ts";
import { toolPackages } from "./tools.ts";

const TYPES: Record<string, string> = {
  mjs: "text/javascript",
  wasm: "application/wasm",
  json: "application/json",
  zip: "application/zip",
  whl: "application/zip",
};

/** Every file the Course's Pyodide tools fetch, by name, with where it comes from. */
export function servedFiles(contentDir: string): Map<string, string> {
  const { tools, packages } = toolPackages(contentDir);
  const files = new Map<string, string>();
  if (tools === 0) return files;
  for (const file of CORE_FILES) files.set(file, join(coreDir(), file));
  for (const { file, path } of coursePackages(contentDir, packages)) files.set(file, path);
  return files;
}

export function pyodideFiles(contentDir: string): AstroIntegration {
  return {
    name: "learn-premium:pyodide",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const files = servedFiles(contentDir);
        if (files.size === 0) return;
        const to = join(fileURLToPath(dir), PYODIDE_PATH);
        mkdirSync(to, { recursive: true });
        for (const [file, from] of files) copyFileSync(from, join(to, file));
        logger.info(`published Pyodide at ${PYODIDE_PATH}: ${files.size} file(s)`);
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const path = (req.url ?? "").split(/[?#]/)[0] ?? "";
          if (!path.startsWith(PYODIDE_PATH)) return next();
          const from = servedFiles(contentDir).get(path.slice(PYODIDE_PATH.length));
          if (!from) return next();
          const type = TYPES[from.split(".").pop() ?? ""] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": type, "Content-Length": statSync(from).size });
          createReadStream(from).pipe(res);
        });
      },
    },
  };
}
