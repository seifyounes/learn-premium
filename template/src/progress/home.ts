// The home page's own script: each Module's Mastery and each sitting's readiness, measured on what
// the student has done in this browser, and the red-pen resume note in the margin of the Module
// they stopped in. Kept current as progress changes in another tab.
import { mastery, placeHref, placeLabel, readiness, type MasteryShape } from "./progress.ts";
import { onProgress, readProgress } from "./store.ts";

const percent = (value: number | undefined) => (value === undefined ? "–" : String(Math.round(value * 100)));

function start(contents: HTMLElement) {
  const shapes = JSON.parse(contents.dataset.shapes ?? "{}") as Record<string, MasteryShape>;
  const note = contents.querySelector<HTMLAnchorElement>("[data-resume]");

  const paint = () => {
    const progress = readProgress();
    const masteryOf = (module: string) => {
      const shape = shapes[module];
      return shape && mastery(progress.modules[module], shape);
    };

    for (const line of contents.querySelectorAll<HTMLElement>(".contents-line")) {
      const cell = line.querySelector("[data-mastery]");
      if (cell) cell.textContent = percent(masteryOf(line.dataset.module ?? ""));
    }

    for (const line of contents.querySelectorAll<HTMLElement>(".sitting-line")) {
      const modules = JSON.parse(line.dataset.modules ?? "[]") as string[];
      const ready = readiness(modules.map(masteryOf));
      const cell = line.querySelector("[data-readiness]");
      if (cell) cell.textContent = percent(ready);
      const filled = Math.round((ready ?? 0) * 10);
      line.querySelectorAll(".readiness-box").forEach((box, i) => box.toggleAttribute("data-filled", i < filled));
    }

    // The note sits in the margin of the line the student stopped in.
    const last = progress.last;
    const margin =
      last && contents.querySelector(`.contents-line[data-module="${CSS.escape(last.module)}"] [data-margin]`);
    if (!note) return;
    if (!last || !margin) {
      note.hidden = true;
      return;
    }
    note.href = placeHref(last);
    const place = note.querySelector("[data-resume-place]");
    if (place) place.textContent = placeLabel(last);
    if (note.parentElement !== margin) margin.append(note);
    note.hidden = false;
  };

  paint();
  onProgress(paint);
}

const contents = document.querySelector<HTMLElement>("[data-contents]");
if (contents) start(contents);
