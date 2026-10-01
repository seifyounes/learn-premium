// One Course's media page, generated from its media file on every change the Media pass makes to it.
// It sits beside the ledger's status page; nobody edits it by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_RECORDS_DIR } from "../ledger/model.ts";
import { table } from "../ledger/render.ts";
import { MEDIA_FILE, MEDIA_PAGE, type MediaFile, type Usage } from "./model.ts";
import { capacity, price, type WindowCapacity } from "./quota.ts";

export function writeMediaPage(project: string, file: MediaFile, usage: Usage, at: number): void {
  const dir = join(project, BUILD_RECORDS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MEDIA_PAGE), mediaPage(file, usage, at));
}

function mediaPage(file: MediaFile, usage: Usage, at: number): string {
  const queued = file.items.filter((item) => item.state === "queued");
  const units = price(
    usage,
    queued.map((item) => item.kind),
  );
  const left = capacity(usage, at);
  const demand = `Demand: ${queued.length} items queued (${units === null ? "not priced until NotebookLM's usage is measured" : `${units} units`})`;
  return [
    `# ${file.course}: Module media`,
    "",
    `Generated from \`${MEDIA_FILE}\` by the Media pass on every change to it. Don't edit.`,
    "",
    `${demand} · Left across all Courses: 5-hour window ${remaining(left["5-hour"])} · week ${remaining(left.weekly)}`,
    "",
    file.notebook === null
      ? "Course notebook: not made yet"
      : `Course notebook: ${file.notebook.url} (${file.notebook.sources.length} sources)`,
    "",
    table(
      ["Item", "For", "Kind", "State", "Regenerations", "Nearest sitting", "File"],
      file.items.map((item) => [
        item.id,
        item.module === null ? `Sitting ${item.sitting}` : `Module ${item.module}`,
        item.kind,
        item.state,
        item.regenerations,
        item.nearestSitting ?? "none ahead",
        item.file ?? "",
      ]),
    ),
  ].join("\n");
}

function remaining(window: WindowCapacity): string {
  return window.remaining === null ? "not measured" : `${window.remaining} of ${window.limit}`;
}
