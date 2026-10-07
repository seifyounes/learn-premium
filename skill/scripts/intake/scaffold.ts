// The files a new Course project starts with besides the template layer: the /newproject skeleton
// (README.md, CLAUDE.md, .gitignore) and the course config the Site template builds from.
import type { Answers } from "./answers.ts";

/** Where the Course's content sits; the Vercel project's CONTENT_DIR points the template's build at it. */
export const CONTENT_DIR = "content";
/** The Course overrides area: template files shadowed for one Course, each tied to its gate gap. */
export const OVERRIDES_DIR = "overrides";

export interface Paths {
  materials: string;
  private: string;
  release: string;
}

/** A YAML scalar: a JSON string is a valid YAML double-quoted one. */
const q = (value: string) => JSON.stringify(value);

export function courseConfig(a: Answers): string {
  return [
    "# The course config: one value per setting, read by the Site template at every build. The pad is a",
    "# catalogue key or a colour; changing it rebuilds the whole site.",
    `name: ${q(a.courseName)}`,
    `code: ${q(a.code)}`,
    `pad: ${q(a.pad)}`,
    "credit:",
    `  professor: ${q(a.professor)}`,
    `  course: ${q(`${a.courseName} (${a.code})`)}`,
    `  university: ${q(a.university)}`,
    `owner: ${q(a.owner)}`,
    "# The Arabic-notes toggle: on, the content's Arabic notes show beside the English. Media stays English.",
    `arabicNotes: ${a.arabicNotes}`,
    "# The Exam sittings are in the Build ledger. The template lists a sitting with the Modules it covers,",
    "# so each joins here once Modules are mapped to it.",
    "sittings: []",
    "",
  ].join("\n");
}

export function readme(a: Answers, p: Paths): string {
  return `# ${a.courseName}

The Study site for ${a.courseName} (${a.code}), built by learn-premium from the Course's Materials.
Status: created ${new Date().toISOString().slice(0, 10)} at Template release ${p.release}; no Module built yet.

## Layout

- \`template/\`: the Site template at ${p.release}. Read-only: only an Upgrade wave replaces it, and a
  local fix goes in \`${OVERRIDES_DIR}/\` as a Course override tied to its gate gap.
- \`${OVERRIDES_DIR}/\`: Course overrides.
- \`${CONTENT_DIR}/\`: the course config (\`course.yaml\`) and one folder per Module.
- \`build-ledger.json\`: the Build ledger, written only through learn-premium's ledger commands.
- \`build-records/\`: the status page, build report, recompute logs and Gate reports. Committed,
  never deployed.

The Materials are read from \`${p.materials}\` and never copied here. Professor-derived evidence and
media masters live in the Private folder, \`${p.private}\`, outside any repo.

## Building

Vercel builds \`template/\` with \`CONTENT_DIR=../${CONTENT_DIR}\`: \`main\` is the live site, every other
branch a preview. Locally: \`cd template && npm ci && CONTENT_DIR=../${CONTENT_DIR} npm run build\`.
`;
}

export function claudeMd(a: Answers, p: Paths): string {
  return `# ${a.courseName} — Course project rules

Inherits the global standards in ../CLAUDE.md.

## What this is

The Course project for ${a.courseName} (${a.code}): the Study site learn-premium builds from this
Course's Materials. Run \`/learn-premium ${p.materials}\` to resume it; the Build ledger says what's next.

## Rules

- The Materials (\`${p.materials}\`) are referenced by path, never copied or committed here.
- Professor-derived evidence (transcriptions, quotes, crops) and media masters go only in the Private
  folder, \`${p.private}\`.
- \`template/\` is the Site template at ${p.release}, read-only. Never edit it: a fix is a Course
  override in \`${OVERRIDES_DIR}/\` with its gate-gap issue, recorded in the ledger.
- \`build-ledger.json\` and the pages in \`build-records/\` change only through learn-premium's ledger
  commands, never by hand.
- Disciplines: ${a.disciplines.join(", ")}. Pad: ${a.pad}. Arabic notes: ${a.arabicNotes ? "on" : "off"}.
`;
}

export const GITIGNORE = [
  "# Secrets",
  ".env*",
  "!.env.example",
  "# Builds and installs",
  "node_modules/",
  "dist/",
  "dist-production/",
  ".astro/",
  ".test-out/",
  ".vercel/",
  "# Downloaded media wait here for the Media pass; their masters go to the Private folder",
  "media-inbox/",
  "# OS clutter",
  "*.log",
  ".DS_Store",
  "Thumbs.db",
  "",
].join("\n");
