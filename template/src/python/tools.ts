// A Course's Pyodide tools as files: where each one's code sits, and the packages they load. The
// page, the content gate, the publishing integration and `npm run wheels` all read them here.
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pythonTool } from "../content/contract.ts";
import { COLLECTIONS } from "../content/layout.ts";
import { readStructured } from "../content/loaders.ts";

/** A Pyodide tool's code: the `.py` file it names, in its Module's `python/` folder. */
export const pythonSource = (contentDir: string, module: string, source: string) =>
  join(contentDir, "modules", module, "python", source);

/** How a gate or the build names a `.py` file its tool's folder doesn't hold. */
export const notInPythonFolder = (source: string) => `names python/${source}, which isn't in its folder`;

/**
 * Whether the Course has a Pyodide tool, and every package its tools load (each once). A tool that
 * breaks the content contract is left out here: the content layer fails the build on it.
 */
export function toolPackages(contentDir: string): { tools: number; packages: string[] } {
  const entries = globSync(COLLECTIONS.python.pattern, { cwd: contentDir });
  const packages = entries.flatMap((entry) => {
    const path = join(contentDir, entry);
    const parsed = pythonTool.safeParse(readStructured(readFileSync(path, "utf8"), path, () => {}));
    return parsed.success ? parsed.data.packages : [];
  });
  return { tools: entries.length, packages: [...new Set(packages)] };
}
