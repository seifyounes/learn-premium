// The licence gates, per deploy, on the built Licences file (`src/licences/`). `licences` holds every
// shipped npm package to the allow-list, and anything else (GPL, NC, ND, unknown) is the Owner's to
// decide. `licences-file` holds the file itself: every hand-written notice in it, no page linking
// it, and the committed copy (public/licences.txt) the same as the build's.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMITTED_LICENCES,
  LICENCES_FILE,
  LICENCES_ROUTE,
  NO_TEXT,
  readLicences,
  renderEntries,
  type LicencesFile,
  type PackageNotice,
} from "../src/licences/file.ts";
import { HAND_WRITTEN_NOTICES } from "../src/licences/hand-written.ts";
import { readPackage } from "../src/licences/packages.ts";
import { ALLOWED_LICENCES, licenceVerdict } from "../src/licences/spdx.ts";
import { allFiles, templateOf, templateWith } from "./course-files.ts";
import { inMain, siteFilesWith, siteWith } from "./pages.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

function builtLicences(input: GateInput): { path: string; text: string; file: LicencesFile } {
  if (input.distDir === undefined) throw new Error("no built site given to check (distDir)");
  const path = join(input.distDir, LICENCES_FILE);
  if (!existsSync(path)) throw new Error(`the build wrote no Licences file at ${LICENCES_ROUTE}`);
  const text = readFileSync(path, "utf8");
  return { path, text, file: readLicences(text) };
}

/** A planted package with a licence the allow-list doesn't hold, for the negative controls. */
const PLANTED_GPL = fileURLToPath(new URL("./planted/gpl-package/", import.meta.url));

/** A scratch copy of the built site whose Licences file also lists `pkg`. */
function licencesWith(good: GateInput, scratch: string, pkg: PackageNotice) {
  return siteFilesWith(good, scratch, { [LICENCES_FILE]: `${builtLicences(good).text}${renderEntries([pkg], [])}` });
}

export const licencesGate: Gate = {
  id: "licences",
  checks: `every npm package the build ships is under ${[...ALLOWED_LICENCES].join(", ")} and ships its licence text; anything else is a Checkpoint item`,
  points: ["deploy"],
  async run(input) {
    const { packages } = builtLicences(input).file;
    const findings: Finding[] = [];
    for (const { name, version, licence, hasText } of packages) {
      const ask = (why: string) =>
        findings.push({
          outcome: "checkpoint",
          at: `${name}@${version}`,
          message: `${name} ships in the site and ${why}: the Owner decides whether it ships`,
        });
      const verdict = licenceVerdict(licence);
      if (!verdict.allowed) ask(verdict.reason);
      // Its notice can't be reproduced without the text (an MIT licence asks for its copyright line).
      else if (!hasText) ask("ships no licence text for the Licences file to carry");
    }
    return { coverage: { packages: packages.length }, findings };
  },
  controls: [
    {
      defect: "a GPL-3.0 package in the bundle (the planted package)",
      expect: "checkpoint",
      plant: (good, scratch) => licencesWith(good, scratch, readPackage(PLANTED_GPL)),
    },
    {
      defect: "a package that declares no licence",
      expect: "checkpoint",
      plant: (good, scratch) =>
        licencesWith(good, scratch, {
          name: "planted-unlicensed",
          version: "0.0.1",
          licence: undefined,
          text: NO_TEXT,
        }),
    },
    {
      defect: "an MIT package that ships no licence text",
      expect: "checkpoint",
      plant: (good, scratch) =>
        licencesWith(good, scratch, { name: "planted-textless", version: "0.0.1", licence: "MIT", text: NO_TEXT }),
    },
  ],
};

export const licencesFileGate: Gate = {
  id: "licences-file",
  checks: `the build ships the Licences file at ${LICENCES_ROUTE} with every hand-written notice, no page links to it, and the committed ${COMMITTED_LICENCES} is the same file`,
  points: ["deploy"],
  async run(input) {
    const built = builtLicences(input);
    const findings: Finding[] = [];
    const block = (at: string, message: string) => findings.push({ outcome: "block", at, message });

    const present = new Set(built.file.notices.map((n) => n.id));
    for (const notice of HAND_WRITTEN_NOTICES) {
      if (!present.has(notice.id))
        block(LICENCES_ROUTE, `the hand-written notice "${notice.id}" (${notice.title}) is missing`);
    }

    // The UI never links to it: no href, src or action on any page names the file.
    const pages = allFiles(input.distDir ?? "").filter((f) => f.entry.endsWith(".html"));
    const link = new RegExp(`(?:href|src|action)\\s*=\\s*["'][^"']*${LICENCES_FILE.replace(".", "\\.")}`, "i");
    for (const { entry, path } of pages) {
      if (link.test(readFileSync(path, "utf8"))) block(`/${entry}`, `the page links to ${LICENCES_ROUTE}`);
    }

    const committedPath = join(templateOf(input), COMMITTED_LICENCES);
    const normal = (text: string) => text.replace(/\r\n/g, "\n");
    if (!existsSync(committedPath)) {
      block(COMMITTED_LICENCES, "no committed Licences file: run `npm run deploy -- licences` and commit it");
    } else if (normal(readFileSync(committedPath, "utf8")) !== normal(built.text)) {
      block(
        COMMITTED_LICENCES,
        "the committed Licences file differs from the one the build wrote: run `npm run deploy -- licences` and commit it",
      );
    }
    return {
      coverage: { files: 1, notices: present.size, pages: pages.length },
      findings,
    };
  },
  controls: [
    {
      defect: "a Licences file missing a hand-written notice",
      plant: (good, scratch) => {
        const built = builtLicences(good);
        const without = built.text.replace(/\n={78}\nNotice: elkjs\n[\s\S]*$/, "\n");
        if (without === built.text) throw new Error("the Licences file has no elkjs notice to remove");
        const site = siteFilesWith(good, scratch, { [LICENCES_FILE]: without });
        return templateWith(site, scratch, { licences: without });
      },
    },
    {
      defect: "a page that links to the Licences file",
      plant: (good, scratch) => {
        const site = siteWith(good, scratch, inMain(`<a href="${LICENCES_ROUTE}">Licences</a>`));
        writeFileSync(join(site.distDir ?? "", LICENCES_FILE), builtLicences(good).text);
        return site;
      },
    },
    {
      defect: "a committed Licences file the build has moved on from",
      plant: (good, scratch) => templateWith(good, scratch, { licences: `${builtLicences(good).text}\nstale line\n` }),
    },
  ],
};
