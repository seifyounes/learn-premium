// Filing a recorded gate gap on learn-premium's tracker: one issue labelled `gate-gap`, carrying the
// defect, the affected Course, its Course overrides (on the lines the release notes read, see
// docs/release.md) and the synthetic minimal broken fixture inlined. Nothing from the Materials or
// the Private folder ever leaves the machine: a fixture file matching one is refused before GitHub
// is asked anything. Filing twice never opens two issues.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { privateFolderOf } from "../intake/create.ts";
import { fixtureFolder, markGateGapFiled } from "../ledger/gate-gaps.ts";
import { hashTree } from "../ledger/hash.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { current, GATE_GAP_REPO, type GateGap, type Ledger } from "../ledger/model.ts";
import { overrideProblem } from "../ledger/overrides.ts";
import { LedgerError } from "../ledger/store.ts";
import type { Tracker } from "./tracker.ts";

export const GATE_GAP_LABEL = "gate-gap";

/** GitHub keeps an issue body up to 65,536 characters; the fixture is minimal, and leaves room for the rest. */
export const FIXTURE_MAX_CHARS = 40_000;

/** A line the release notes would read as the issue's Course or one of its overrides. */
const NOTES_LINE = /^\s*(?:[-*]\s+)?Course(?: override)?:/m;

const FENCE_LANGUAGES: Record<string, string> = {
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".astro": "astro",
  ".css": "css",
  ".html": "html",
  ".py": "python",
  ".tex": "tex",
};

interface FixtureFile {
  path: string;
  text: string;
}

/** The line that ties an issue to this Course's gate gap, so a filing that lost GitHub's answer finds its issue again. */
const marker = (ledger: Ledger, gap: GateGap) =>
  `<!-- learn-premium gate gap: ${JSON.stringify(ledger.intake.courseName)} ${gap.id} -->`;

const issueUrl = (issue: number) => `https://github.com/${GATE_GAP_REPO}/issues/${issue}`;

export async function fileGateGap(
  project: string,
  holder: string,
  id: string,
  tracker: Tracker,
): Promise<{ issue: number; url: string; alreadyFiled: boolean }> {
  const ledger = requireLedger(project);
  if (ledger.lock?.holder !== holder)
    throw new LedgerError(
      "refused",
      `${holder} doesn't hold the ledger lock: only the driving session files gate gaps`,
    );
  const gap = current(ledger.gateGaps).find((row) => row.id === id);
  if (gap === undefined) throw new LedgerError("invalid", `no gate gap ${id} in the ledger: record it first`);
  if (gap.issue !== null) return { issue: gap.issue, url: issueUrl(gap.issue), alreadyFiled: true };

  for (const path of gap.overrides) {
    const problem = overrideProblem(project, ledger, path);
    if (problem !== null) throw new LedgerError("refused", problem);
  }
  const fixture = readFixture(project, ledger, gap);
  const body = issueBody(ledger, gap, fixture);

  const tag = marker(ledger, gap);
  const filed: { number: number; url: string } =
    (await tracker.labelled(GATE_GAP_LABEL)).find((issue) => issue.body.includes(tag)) ??
    (await tracker.create({ title: gap.title, body, labels: [GATE_GAP_LABEL] }));
  markGateGapFiled(project, holder, id, filed.number);
  return { issue: filed.number, url: filed.url, alreadyFiled: false };
}

/**
 * The gate gap's fixture, every file checked: text only, small enough to inline, and never a copy of
 * a Materials file (as on disk now or as the ledger inventoried it) or of a Private-folder file.
 */
function readFixture(project: string, ledger: Ledger, gap: GateGap): FixtureFile[] {
  const folder = fixtureFolder(gap.id);
  const hashes = hashTree(join(project, folder));
  const paths = Object.keys(hashes);
  if (paths.length === 0) throw new LedgerError("refused", `no fixture in ${folder}/: a gate gap is filed with one`);

  const materials = new Set([
    ...Object.values(hashTree(ledger.intake.materialsPath)),
    ...ledger.materials.map((row) => row.hash),
  ]);
  const privateFiles = new Set(Object.values(hashTree(privateFolderOf(ledger.intake.materialsPath))));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: FixtureFile[] = [];
  let chars = 0;
  for (const path of paths) {
    const hash = hashes[path] ?? "";
    if (materials.has(hash))
      throw new LedgerError(
        "refused",
        `${folder}/${path} is a Materials file: a gate gap's fixture is synthetic, never the Materials`,
      );
    if (privateFiles.has(hash))
      throw new LedgerError(
        "refused",
        `${folder}/${path} is a Private-folder file: a gate gap's fixture never carries evidence`,
      );
    const bytes = readFileSync(join(project, folder, path));
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      text = "\0";
    }
    if (text.includes("\0"))
      throw new LedgerError(
        "refused",
        `${folder}/${path} isn't text: a fixture is inlined in the issue, so it's text files only`,
      );
    if (NOTES_LINE.test(text))
      throw new LedgerError(
        "refused",
        `${folder}/${path} has a "Course:" or "Course override:" line, which the release notes would read as the issue's own`,
      );
    chars += text.length;
    files.push({ path, text });
  }
  if (chars > FIXTURE_MAX_CHARS)
    throw new LedgerError(
      "refused",
      `the fixture in ${folder}/ is ${chars} characters: a minimal one fits in ${FIXTURE_MAX_CHARS}`,
    );
  return files;
}

/** A fence longer than any run of backticks in `text`, so the file shows as it is. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function issueBody(ledger: Ledger, gap: GateGap, fixture: FixtureFile[]): string {
  const folder = fixtureFolder(gap.id);
  return [
    marker(ledger, gap),
    "",
    "A defect class a Course build found that no gate caught, filed by learn-premium's gate-gap step.",
    "It lands as a gate in a Template release; until then the Course works around it with the Course",
    "overrides below.",
    "",
    `Course: ${ledger.intake.courseName}`,
    ...gap.overrides.map((path) => `Course override: \`${path}\``),
    `Template release: ${ledger.template.release}`,
    "",
    "## Defect",
    "",
    gap.defect,
    "",
    "## Synthetic fixture",
    "",
    `A minimal broken fixture written for this issue, never taken from the Course's Materials: the Course project's \`${folder}/\`.`,
    "",
    ...fixture.flatMap(({ path, text }) => {
      const f = fence(text);
      return [
        `### \`${path}\``,
        "",
        `${f}${FENCE_LANGUAGES[extname(path).toLowerCase()] ?? ""}`,
        text.replace(/\n$/, ""),
        f,
        "",
      ];
    }),
  ].join("\n");
}
