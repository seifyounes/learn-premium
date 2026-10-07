// Evidence-shaped paths: where Professor-derived Build evidence (transcriptions, quotes, crops,
// the Materials reader's renders) or a copy of the Materials would sit if it reached a Course
// project. It belongs in the Private folder, outside any repo. The Go-public check uses these
// rules; the pre-commit gate (#68) is meant to share them, and confirms or narrows them.
//
// Two identical copies: `skill/scripts/go-public/evidence.ts` (the Go-public check) and
// `template/gates/evidence.ts` (the deploy gates, which a Course project carries without the skill).
// The template's tests hold them identical.

export interface EvidenceMatch {
  rule: string;
  reason: string;
}

interface Rule extends EvidenceMatch {
  /** Folder names (lower-cased) along the path, and the file name (lower-cased). */
  test: (folders: string[], file: string) => boolean;
}

const RULES: Rule[] = [
  {
    rule: "private-folder",
    reason: "inside a Private folder",
    test: (folders) => folders.some((folder) => /(^|[-_. ])private$/.test(folder)),
  },
  {
    rule: "reader-output",
    reason: "the Materials reader's output (renders, deck media, transcripts)",
    test: (folders) => {
      const reader = folders.indexOf("reader");
      return reader !== -1 && folders.slice(reader + 1).some((folder) => READER_OUTPUT.has(folder));
    },
  },
  {
    rule: "page-render",
    reason: "named like a page the Materials reader renders",
    test: (_, file) => /^page-\d{3,}\.png$/.test(file),
  },
  {
    rule: "transcription",
    reason: "a transcription",
    test: (folders, file) =>
      folders.some((folder) => /^transcri(pt|ption)s$/.test(folder)) ||
      (/(^|[-_.])transcri(pt|ption)s?([-_.]|$)/.test(file) && !CODE.test(file)),
  },
  { rule: "crop", reason: "crops of the Materials", test: (folders) => folders.includes("crops") },
  { rule: "quote", reason: "quotes of the Professor", test: (folders) => folders.includes("quotes") },
  {
    rule: "blind-reading",
    reason: "a Blind reader's readings",
    test: (folders) => folders.some((folder) => /^blind-?read(ings?|ers?)$/.test(folder)),
  },
  {
    rule: "materials-copy",
    reason: "a copy of the Materials folder",
    test: (folders) => folders.includes("materials"),
  },
  {
    rule: "evidence-folder",
    reason: "a folder named evidence/ (gate reports and recompute logs go in build-records/)",
    test: (folders) => folders.includes("evidence"),
  },
  {
    rule: "wave-reading",
    reason: "a Module wave's Blind readings, rulings or settled reading (they live in the Private folder)",
    test: (folders, file) => {
      const waves = folders.lastIndexOf("waves");
      return waves !== -1 && /^\d{2}$/.test(folders[waves + 1] ?? "") && WAVE_READING.test(file);
    },
  },
];

const WAVE_READING = /^(reading(-[ab])?|resolutions|checkpoint-items)\.json$/;

const READER_OUTPUT = new Set(["pages", "media", "transcripts"]);

/** Site code: a `transcript-panel.tsx` component is not a transcription. */
const CODE = /\.(astro|[cm]?[jt]sx?|css)$/;

/** The first rule `path` ('/'-separated, relative to the repo root) matches, or null. */
export function evidenceShape(path: string): EvidenceMatch | null {
  const parts = path.toLowerCase().split("/");
  const file = parts.pop() ?? "";
  const match = RULES.find((rule) => rule.test(parts, file));
  return match === undefined ? null : { rule: match.rule, reason: match.reason };
}
