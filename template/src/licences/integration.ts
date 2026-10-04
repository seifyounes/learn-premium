// Writes the Licences file into every build at /licences.txt: the npm packages the build actually
// shipped, plus the template's hand-written notices. "Shipped" is read off the bundle itself, so a
// package used only to build the site (Astro's compiler, sharp, Tailwind) is never listed:
//
// - everything the client bundle holds (the islands' JavaScript);
// - every stylesheet and asset, from any part of the build (KaTeX's CSS and fonts, Fontsource);
// - Astro itself, whose island loader is written inline into every page with an island.
//
// The committed copy at public/licences.txt (what the Go-public check looks for) is refreshed from
// the build with `npm run deploy -- licences`; the `licences-file` gate blocks a stale one.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";
import { renderLicences } from "./file.ts";
import { HAND_WRITTEN_NOTICES } from "./hand-written.ts";
import { packageDirOf, readPackage } from "./packages.ts";

const STYLE = /\.(css|scss|sass|less|styl)$/;

/** Records the folder of every package the bundle ships, from each build environment it runs in. */
function shippedPackages(into: Set<string>): Plugin {
  return {
    name: "learn-premium:shipped-packages",
    generateBundle(_options, bundle) {
      const client = this.environment.name === "client";
      for (const output of Object.values(bundle)) {
        const ids =
          output.type === "chunk"
            ? output.moduleIds.filter((id) => client || STYLE.test(id.replace(/[?#].*$/, "")))
            : output.originalFileNames;
        for (const id of ids) {
          const dir = packageDirOf(id);
          if (dir !== undefined) into.add(dir);
        }
      }
    },
  };
}

export function licencesFile(): AstroIntegration {
  const shipped = new Set<string>();
  return {
    name: "learn-premium:licences-file",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        shipped.clear();
        updateConfig({ vite: { plugins: [shippedPackages(shipped)] } });
      },
      "astro:build:done": ({ dir, logger }) => {
        const astro = dirname(createRequire(import.meta.url).resolve("astro/package.json"));
        const packages = new Map(
          [...shipped, astro].map(readPackage).map((p) => [`${p.name}@${p.version}`, p] as const),
        );
        const sorted = [...packages.values()].sort((a, b) =>
          a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
        );
        writeFileSync(new URL("licences.txt", dir), renderLicences(sorted, HAND_WRITTEN_NOTICES));
        logger.info(
          `Licences file: ${sorted.length} shipped packages and ${HAND_WRITTEN_NOTICES.length} hand-written notices`,
        );
      },
    },
  };
}
