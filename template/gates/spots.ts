// Where a finding sits on the built site: the route and anchor a Checkpoint item links to on the
// Vercel preview, so the Owner judges it in context. A finding names a content file (`at`, maybe
// with `:line`) or a route; this maps it to the element the Module page renders it in.
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { readStructured } from "../src/content/loaders.ts";
import { practiceAnchor, workedAnchor } from "../src/progress/progress.ts";

/** The page and anchor `at` is shown at (`/01-slug/#worked-W01.1`), or undefined when it isn't a place on the site. */
export function spotOf(contentDir: string, at: string | undefined): string | undefined {
  if (at === undefined) return undefined;
  if (at.startsWith("/")) return at.split(" ")[0];
  // `modules/01-slug/worked/1.json:12:3 (steps.2.note)` → the file.
  const file = at.split(" ")[0]?.replace(/(:\d+)+$/, "") ?? "";
  const match = /^modules\/([^/]+)\/(?:([^/]+)\/)?([^/]+)$/.exec(file);
  if (!match) return undefined;
  const [, module, folder, name] = match as unknown as [string, string, string | undefined, string];
  const page = `/${module}/`;
  const number = basename(name, extname(name));
  const anchor = (id: string) => `${page}#${encodeURIComponent(id)}`;
  switch (folder) {
    case "worked": {
      const code = codeOf(join(contentDir, file));
      return code === undefined ? anchor("worked") : anchor(workedAnchor(code));
    }
    case "practice":
      return anchor(practiceAnchor(number));
    case "summary":
      return anchor("summary");
    case "sims":
      return anchor(`sim-${module}-${number}`);
    case "python":
      return anchor(`python-${module}-${number}`);
    case undefined:
      return name === "media.yaml" ? anchor("watch") : page;
    default:
      return page;
  }
}

/** A Worked example's code (`W01.1`), which its anchor is made from. */
function codeOf(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const { code } = readStructured(readFileSync(path, "utf8"), path, () => {});
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}
