// Publishes each Module's media next to its page, at `/<module>/media/<file>`: copied into the
// build, and served by the dev server. Only the files a `media.yaml` names are published, so
// nothing else in a media folder ever ships.
import type { AstroIntegration } from "astro";
import { copyFileSync, createReadStream, globSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { media } from "../content/contract.ts";
import { readStructured } from "../content/loaders.ts";
import { mediaFiles, mediaFolder, MEDIA_TYPES } from "./media.ts";

/** Every published media file: its Module and file name. */
function published(contentDir: string): { module: string; file: string }[] {
  return globSync("modules/*/media.yaml", { cwd: contentDir }).flatMap((entry) => {
    const module = entry.split(/[\\/]/)[1] ?? "";
    const path = join(contentDir, entry);
    // A media.yaml that breaks the content contract fails the build in the content layer.
    const parsed = media.safeParse(readStructured(readFileSync(path, "utf8"), path, () => {}));
    return parsed.success ? mediaFiles(parsed.data).map((file) => ({ module, file })) : [];
  });
}

export function moduleMedia(contentDir: string): AstroIntegration {
  return {
    name: "learn-premium:media",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const files = published(contentDir);
        for (const { module, file } of files) {
          const to = join(fileURLToPath(dir), module, "media");
          mkdirSync(to, { recursive: true });
          copyFileSync(join(mediaFolder(contentDir, module), file), join(to, file));
        }
        if (files.length > 0) logger.info(`published ${files.length} media file(s)`);
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const match = /^\/([^/]+)\/media\/([^/?#]+)/.exec(req.url ?? "");
          const [, module, file] = match ?? [];
          if (!module || !file || !published(contentDir).some((p) => p.module === module && p.file === file))
            return next();
          const path = join(mediaFolder(contentDir, module), file);
          const size = statSync(path).size;
          const type = MEDIA_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream";
          // Ranges let the dev preview seek a video.
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
          if (range) {
            const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
            const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            res.writeHead(206, {
              "Content-Type": type,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Content-Length": end - start + 1,
              "Accept-Ranges": "bytes",
            });
            createReadStream(path, { start, end }).pipe(res);
            return;
          }
          res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
          createReadStream(path).pipe(res);
        });
      },
    },
  };
}
