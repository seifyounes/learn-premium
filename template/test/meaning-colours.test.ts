// Meaning colours (a metal's, a solution's tint, an element's CPK colour) are colour data for the
// inside of a framed 3D viewer, where DESIGN.md allows them; on the sheet there are none. So the
// files that hold them are imported only by the viewers' scenes and the molecule layer, never by a
// board, a sim island or a page: a colour that can't be reached can't leak onto the sheet.
import { globSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src");
/** The colour data files, by their path under src/. */
const MEANING = ["chemistry/meaning.ts", "molecules/cpk.ts"];
/** Who may import them: the cell scene, the molecule page component, and the molecule layer itself. */
const ALLOWED = [/^islands\/three\/cell-scene\.ts$/, /^components\/Molecule\.astro$/, /^molecules\//];

/** Every file under src/ that imports a meaning-colour file, by the importer's path under src/. */
export function meaningImporters(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, source] of Object.entries(files)) {
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (!specifier?.startsWith(".")) continue;
      const target = posix.normalize(posix.join(dirname(file), specifier)).replace(/\.(ts|js)$/, "");
      if (MEANING.some((m) => m.replace(/\.ts$/, "") === target)) found.push(file);
    }
  }
  return found;
}

const sources = (): Record<string, string> =>
  Object.fromEntries(
    globSync("**/*.{ts,tsx,astro}", { cwd: SRC }).map((file) => {
      const path = file.replaceAll("\\", "/");
      return [path, readFileSync(join(SRC, path), "utf8")];
    }),
  );

describe("meaning colours", () => {
  it("meaning colours are imported only inside viewers", () => {
    const importers = meaningImporters(sources());
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((file) => !ALLOWED.some((ok) => ok.test(file)))).toEqual([]);
    // The cell scene reads the apparatus's colours; nothing else does.
    expect(importers).toContain("islands/three/cell-scene.ts");
  });

  it("flags a planted import from a board", () => {
    const planted = {
      ...sources(),
      "islands/sim/nernst-board.ts": 'import { METAL_COLOURS } from "../../chemistry/meaning.ts";\n',
      "islands/sim/series-toggles.tsx": 'import { JMOL_CPK } from "../../molecules/cpk";\n',
    };
    const outside = meaningImporters(planted).filter((file) => !ALLOWED.some((ok) => ok.test(file)));
    expect(outside).toEqual(["islands/sim/nernst-board.ts", "islands/sim/series-toggles.tsx"]);
  });
});
