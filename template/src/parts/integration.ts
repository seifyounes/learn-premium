// Publishes each machine part's GLB next to its Module's page, at `/<module>/parts/<name>.glb`:
// copied into the build, and served by the dev server. Only a part's own GLB is published; its
// build123d script and its record never ship.
import type { AstroIntegration } from "astro";
import { copyFileSync, createReadStream, existsSync, globSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTIONS } from "../content/layout.ts";

/** Every part's GLB that exists: its Module and name. A missing one fails the build in the page layer. */
function published(contentDir: string): { module: string; name: string; path: string }[] {
  return globSync(COLLECTIONS.parts.pattern, { cwd: contentDir }).flatMap((entry) => {
    const [, module = "", , file = ""] = entry.split(/[\\/]/);
    const name = file.replace(/\.json$/, "");
    const path = join(contentDir, "modules", module, "parts", `${name}.glb`);
    return existsSync(path) ? [{ module, name, path }] : [];
  });
}

export function partFiles(contentDir: string): AstroIntegration {
  return {
    name: "learn-premium:parts",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const files = published(contentDir);
        for (const { module, name, path } of files) {
          const to = join(fileURLToPath(dir), module, "parts", `${name}.glb`);
          mkdirSync(dirname(to), { recursive: true });
          copyFileSync(path, to);
        }
        if (files.length > 0) logger.info(`published ${files.length} part GLB(s)`);
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const [, module, name] = /^\/([^/]+)\/parts\/([^/?#]+)\.glb/.exec(req.url ?? "") ?? [];
          const file = published(contentDir).find((p) => p.module === module && p.name === name);
          if (!file) return next();
          res.writeHead(200, { "Content-Type": "model/gltf-binary" });
          createReadStream(file.path).pipe(res);
        });
      },
    },
  };
}
