// The Fixture Course's midterm as the template's `gates sitting` command prints it (held by both
// layers: template/test/sitting-dump.test.ts checks the template against this very file), and the
// Blind readers' reading of its past paper, for the Sitting wave tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadItem } from "../scripts/wave/reading.ts";
import type { DumpPaper, SittingDump } from "../scripts/wave/sitting.ts";

/** The dump as the template prints it for the Fixture Course (a copy: tests change it freely). */
export const midtermDump = (): SittingDump =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "sitting-dump", "midterm.json"), "utf8"),
  ) as SittingDump;

/**
 * The dump of a Course project whose Module folder is `01-m01` and whose midterm the wave has built: the
 * Fixture's papers, mocks and format, `complete: true` and the Module named by its folder. `main` is the
 * same Course before the wave: its sitting entry not yet complete, nothing built.
 */
export function waveDumps(modules = ["01-m01"]): { head: SittingDump; main: SittingDump } {
  const fixture = midtermDump();
  const entry = { id: "midterm", name: "Midterm", date: "2026-11-10", modules };
  const course = { name: "Fixture Course", code: "FX 101", sittings: [entry] };
  const head: SittingDump = {
    ...fixture,
    course: { ...course, sittings: [{ ...entry, complete: true }] },
    sitting: { ...entry, complete: true },
  };
  const main: SittingDump = { course, sitting: entry, papers: [], mocks: [], format: null, rulings: [] };
  return { head, main };
}

const item = (key: string, value: string | null, kind: ReadItem["kind"], file: string): ReadItem => ({
  key,
  file,
  page: 1,
  box: null,
  quantity: null,
  kind,
  value,
});

/** What a Blind reader reads off past paper `slug`'s file for `paper`: every question's text, marks and key, the total and the minutes. */
export function readingItems(paper: DumpPaper, slug = paper.name, file = `${slug}.pdf`): ReadItem[] {
  return [
    ...paper.questions.flatMap((q) => [
      item(`${slug}/q${q.n}/text`, q.question, "text", file),
      item(`${slug}/q${q.n}/marks`, String(q.marks), "number", file),
      ...(q.key === null ? [] : [item(`${slug}/q${q.n}/key`, q.key, "number", file)]),
    ]),
    item(`${slug}/total`, String(paper.marks), "number", file),
    item(`${slug}/minutes`, String(paper.minutes), "number", file),
  ];
}

/** A Blind reader's reading file for a sitting. */
export const sittingReading = (reader: "a" | "b", items: ReadItem[], sitting = "midterm") => ({
  reading: "learn-premium blind reading v1",
  reader,
  sitting,
  items,
});
