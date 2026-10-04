// The Licences file: the third-party notices a Study site ships at /licences.txt, a URL the UI
// never links to. The build writes it (`integration.ts`) from the packages it bundled plus the
// notices the template keeps by hand (`hand-written.ts`); the licence gates read it back here.

/** A package the build bundled into the site, with its licence text as the package ships it. */
export interface PackageNotice {
  name: string;
  version: string;
  /** The SPDX expression its package.json declares; undefined when it declares none. */
  licence: string | undefined;
  /** Where its source is (the package's repository), when it says. */
  source?: string;
  text: string;
}

/** A notice the template keeps by hand, for what the build can't see. */
export interface HandWrittenNotice {
  /** Stable key, for the gate to find it by. */
  id: string;
  title: string;
  /** What in (or loaded by) the site it covers. */
  covers: string;
  licence: string;
  copyright?: string;
  /** Where the source is, in the words the licence asks for (EPL-2.0 and MPL-2.0 need one). */
  source: string;
  text: string;
}

export const LICENCES_ROUTE = "/licences.txt";

const RULE = "=".repeat(78);
const UNDER = "-".repeat(78);
const NO_LICENCE = "(none declared)";

const PREAMBLE = `Third-party notices

This Study site ships the open-source software and fonts below, each under its own licence. The
packages come first, listed from what the site's build bundled. The notices after them are kept by
hand for what that can't see: code inside another package, fonts, compiled libraries and the
runtimes a tool loads.`;

export function renderLicences(packages: readonly PackageNotice[], notices: readonly HandWrittenNotice[]): string {
  return `${PREAMBLE}\n${renderEntries(packages, notices)}`;
}

/** The entries alone, without the preamble: what a negative control appends to a built file. */
export function renderEntries(packages: readonly PackageNotice[], notices: readonly HandWrittenNotice[]): string {
  return [
    ...packages.map((p) =>
      block(
        [
          `Package: ${p.name}@${p.version}`,
          `Licence: ${p.licence ?? NO_LICENCE}`,
          ...(p.source === undefined ? [] : [`Source: ${p.source}`]),
        ],
        p.text,
      ),
    ),
    ...notices.map((n) =>
      block(
        [
          `Notice: ${n.id}`,
          `Title: ${n.title}`,
          `Covers: ${n.covers}`,
          `Licence: ${n.licence}`,
          ...(n.copyright === undefined ? [] : [`Copyright: ${n.copyright}`]),
          `Source: ${n.source}`,
        ],
        n.text,
      ),
    ),
  ].join("");
}

const block = (header: string[], text: string) => `\n${RULE}\n${header.join("\n")}\n${UNDER}\n${text.trimEnd()}\n`;

export interface LicencesFile {
  packages: { name: string; version: string; licence: string | undefined }[];
  notices: { id: string; licence: string }[];
}

/** Reads back what `renderLicences` wrote: each entry's header, never its licence text. */
export function readLicences(text: string): LicencesFile {
  const file: LicencesFile = { packages: [], notices: [] };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let at = 0; at < lines.length; at++) {
    if (lines[at] !== RULE) continue;
    const header = new Map<string, string>();
    for (at++; at < lines.length && lines[at] !== UNDER; at++) {
      const match = /^([A-Za-z]+): (.*)$/.exec(lines[at] ?? "");
      if (match?.[1] !== undefined && match[2] !== undefined) header.set(match[1], match[2]);
    }
    const licence = header.get("Licence");
    const pkg = header.get("Package");
    const notice = header.get("Notice");
    if (pkg !== undefined) {
      const split = pkg.lastIndexOf("@");
      file.packages.push({
        name: split > 0 ? pkg.slice(0, split) : pkg,
        version: split > 0 ? pkg.slice(split + 1) : "",
        licence: licence === NO_LICENCE ? undefined : licence,
      });
    } else if (notice !== undefined) file.notices.push({ id: notice, licence: licence ?? "" });
  }
  return file;
}
