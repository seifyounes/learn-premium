// A Template release's notes: the gate gaps it closes, the Course overrides it retires, the
// migrations a major ships, and the Owner's real-phone pass. They are the annotated tag's message
// and the GitHub Release's body; `parseNotes` reads them back for the Upgrade wave's offer.

export type Bump = "major" | "minor" | "patch";

export interface ClosedGateGap {
  number: number;
  title: string;
  /** The Course that filed it, from its issue's `Course:` line. */
  course: string | null;
  /** The Course overrides it works around, from its issue's `Course override:` lines. */
  overrides: string[];
}

export interface PhonePass {
  description: string;
  by: string;
  at: string;
  url: string | null;
}

export interface NotesInput {
  version: string;
  previous: string | null;
  kind: Bump;
  sha: string;
  gateGaps: ClosedGateGap[];
  migrations: { major: number; describe: string }[];
  phonePass: PhonePass | null;
}

export interface ParsedNotes {
  version: string | null;
  /** The commit the notes were written for. */
  sha: string | null;
  gateGapsClosed: number[];
  overridesRetired: { path: string; course: string | null; gateGap: number }[];
}

export const GATE_GAPS_HEADING = "## Gate gaps closed";
export const OVERRIDES_HEADING = "## Course overrides retired";

const list = (lines: string[]) => (lines.length === 0 ? "None." : lines.join("\n"));

export function renderNotes(input: NotesInput): string {
  const previous = input.previous ?? "none, the first Template release";
  const overrides = input.gateGaps.flatMap((gap) =>
    gap.overrides.length === 0
      ? [`- Gate gap #${gap.number}: no Course override recorded on the issue`]
      : gap.overrides.map((path) => `- \`${path}\`${gap.course ? ` (${gap.course})` : ""}, gate gap #${gap.number}`),
  );
  const migrations =
    input.migrations.length === 0
      ? "None: Course content from the previous release upgrades as it is."
      : input.migrations.map((m) => `- v${m.major}: ${m.describe}`).join("\n");
  const pass = passText(input.phonePass);
  return [
    `# Template release ${input.version}`,
    "",
    `${input.kind} release · commit ${input.sha} · previous release: ${previous}`,
    "",
    GATE_GAPS_HEADING,
    "",
    list(input.gateGaps.map((gap) => `- #${gap.number} ${gap.title}`)),
    "",
    OVERRIDES_HEADING,
    "",
    list(overrides),
    "",
    "## Migrations",
    "",
    migrations,
    "",
    PASS_HEADING,
    "",
    pass,
    "",
  ].join("\n");
}

const PASS_HEADING = "## Real-phone pass";

function passText(pass: PhonePass | null): string {
  if (pass === null) return "Not recorded yet.";
  return [pass.description, "", `Recorded by @${pass.by} at ${pass.at}${pass.url ? ` on ${pass.url}` : ""}.`].join(
    "\n",
  );
}

/**
 * The notes with their real-phone pass section rewritten from the recorded pass, whatever an
 * Owner-edited draft said there: the pass is evidence, not wording.
 */
export function withPhonePass(notes: string, pass: PhonePass | null): string {
  const lines = notes.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const start = lines.findIndex((line) => line.trim() === PASS_HEADING);
  const block = [PASS_HEADING, "", passText(pass)];
  if (start === -1) return [...lines, "", ...block, ""].join("\n");
  const after = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  const rest = after === -1 ? [] : ["", ...lines.slice(start + 1 + after)];
  return [...lines.slice(0, start), ...block, ...rest, ""].join("\n");
}

/** The lines of one `## ` section, or undefined when the notes lack it. */
function section(notes: string, heading: string): string[] | undefined {
  const lines = notes.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

export class NotesError extends Error {}

/** Reads notes back; throws when either required section is missing. */
export function parseNotes(notes: string): ParsedNotes {
  const gaps = section(notes, GATE_GAPS_HEADING);
  if (gaps === undefined) throw new NotesError(`the release notes have no "${GATE_GAPS_HEADING}" section`);
  const overrides = section(notes, OVERRIDES_HEADING);
  if (overrides === undefined) throw new NotesError(`the release notes have no "${OVERRIDES_HEADING}" section`);
  return {
    version: /^# Template release (v\d+\.\d+\.\d+)\s*$/m.exec(notes)?.[1] ?? null,
    sha: /^\w+ release · commit ([0-9a-f]{40}) ·/m.exec(notes)?.[1] ?? null,
    gateGapsClosed: gaps.flatMap((line) => {
      const match = /^- #(\d+)\b/.exec(line);
      return match ? [Number(match[1])] : [];
    }),
    overridesRetired: overrides.flatMap((line) => {
      const match = /^- `([^`]+)`(?: \((.+)\))?, gate gap #(\d+)\s*$/.exec(line);
      return match ? [{ path: match[1] ?? "", course: match[2] ?? null, gateGap: Number(match[3]) }] : [];
    }),
  };
}

/**
 * What a `gate-gap` issue says about its Course and its Course overrides: a `Course: <name>` line
 * and one `Course override: <template path>` line per override (backticks optional).
 */
export function overridesOnIssue(body: string | null): { course: string | null; overrides: string[] } {
  const text = body ?? "";
  const course = /^\s*(?:[-*]\s+)?Course:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
  const overrides = [...text.matchAll(/^\s*(?:[-*]\s+)?Course override:\s*`?([^`\r\n]+?)`?\s*$/gm)].map(
    (m) => m[1] ?? "",
  );
  return { course, overrides };
}
