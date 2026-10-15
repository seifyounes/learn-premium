// Progress is kept per browser, with no accounts: what the student has watched, read, stepped
// through and practised on each Module, and where they stopped. Pure: the browser store
// (`store.ts`) reads and writes it, the Module page's rail marks sections done from it, and the
// home page builds Mastery, sitting readiness and the resume note on it.

export const SECTIONS = ["watch", "summary", "worked", "practice"] as const;
export type Section = (typeof SECTIONS)[number];

export type PracticeResult = { kind: "numeric"; correct: boolean } | { kind: "prose"; marks: number; of: number };

export interface ModuleProgress {
  watched?: true;
  summaryRead?: true;
  /** Per Worked example (by its code): the furthest step reached, counted from 0, of how many. */
  worked?: Record<string, WorkedProgress>;
  /** Per Practice item (by its number): the last result. */
  practice?: Record<string, PracticeResult>;
}

export interface WorkedProgress {
  furthest: number;
  steps: number;
  /** The steps the student has been on, from 0. Absent in progress kept before it was recorded. */
  seen?: number[];
  /** The steps worked try-first: values held back until the student had a go. */
  tried?: number[];
}

/** Where the student stopped: the last Worked example step or Practice item they worked on. */
export type Place = { module: string } & (
  { kind: "worked"; code: string; step: number; steps: number } | { kind: "practice"; item: string }
);

/** A paper sat in the Exam room: the marks the student got of the marks it carries, and when. */
export interface PaperResult {
  got: number;
  of: number;
  /** An ISO time. */
  at: string;
}

/** A paper's results: the last sitting and the best one. */
export interface PaperProgress {
  last: PaperResult;
  best: PaperResult;
}

export interface Progress {
  version: 1;
  modules: Record<string, ModuleProgress>;
  last?: Place;
  /** Per paper or mock, by `<sitting>/<variant>`; a result is kept once every question is marked. */
  papers?: Record<string, PaperProgress>;
}

export const emptyProgress = (): Progress => ({ version: 1, modules: {} });

/** Stored progress, or a fresh start when there is none or it can't be read. */
export function parseProgress(stored: string | null): Progress {
  if (!stored) return emptyProgress();
  try {
    const parsed: unknown = JSON.parse(stored);
    const p = parsed as Partial<Progress> | null;
    if (!p || typeof p !== "object" || p.version !== 1 || typeof p.modules !== "object" || p.modules === null)
      return emptyProgress();
    const papers = readPapers(p.papers);
    return {
      version: 1,
      modules: p.modules,
      ...(isPlace(p.last) && { last: p.last }),
      ...(papers && { papers }),
    };
  } catch {
    return emptyProgress();
  }
}

const isResult = (value: unknown): value is PaperResult => {
  const r = value as Partial<Record<string, unknown>> | null;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.got === "number" &&
    typeof r.of === "number" &&
    r.of > 0 &&
    typeof r.at === "string"
  );
};

/** The stored paper results that are results; undefined when none is. */
function readPapers(stored: unknown): Record<string, PaperProgress> | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const kept = Object.entries(stored).flatMap(([key, value]) => {
    const { last, best } = (value ?? {}) as Partial<Record<string, unknown>>;
    return isResult(last) && isResult(best) ? [[key, { last, best }] as const] : [];
  });
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

const update = (p: Progress, module: string, change: (m: ModuleProgress) => ModuleProgress): Progress => ({
  ...p,
  modules: { ...p.modules, [module]: change(p.modules[module] ?? {}) },
});

export const markWatched = (p: Progress, module: string) => update(p, module, (m) => ({ ...m, watched: true }));

export const markSummaryRead = (p: Progress, module: string) => update(p, module, (m) => ({ ...m, summaryRead: true }));

const isPlace = (value: unknown): value is Place => {
  const place = value as Partial<Record<string, unknown>> | null;
  if (!place || typeof place !== "object" || typeof place.module !== "string") return false;
  if (place.kind === "practice") return typeof place.item === "string";
  return (
    place.kind === "worked" &&
    typeof place.code === "string" &&
    typeof place.step === "number" &&
    typeof place.steps === "number"
  );
};

const withStep = (list: number[] | undefined, step: number) =>
  list?.includes(step) ? list : [...(list ?? []), step].sort((a, b) => a - b);

/**
 * The student is on `step` (from 0) of a Worked example with `steps` steps; `tried` when they
 * worked it try-first (its values held back until they had a go).
 */
export const recordStep = (p: Progress, module: string, code: string, step: number, steps: number, tried = false) =>
  update(p, module, (m) => {
    const before = m.worked?.[code];
    const furthest = Math.max(step, before?.furthest ?? -1);
    const seen = withStep(seenSteps(before), step);
    const triedSteps = tried ? withStep(before?.tried, step) : before?.tried;
    return {
      ...m,
      worked: { ...m.worked, [code]: { furthest, steps, seen, ...(triedSteps && { tried: triedSteps }) } },
    };
  });

/** The steps read; progress kept before they were recorded counts every step up to the furthest. */
const seenSteps = (w: WorkedProgress | undefined): number[] | undefined =>
  w && (w.seen ?? Array.from({ length: w.furthest + 1 }, (_, i) => i));

/** Where the student stopped. */
export const markPlace = (p: Progress, place: Place): Progress => ({ ...p, last: place });

/**
 * What a Worked example sheet records at a step: the step read and maybe worked try-first, unless
 * its values are still held back (it counts once the student asks to see them); and, once the
 * student has moved, where they stopped, held back or not.
 */
export function recordSheet(
  p: Progress,
  at: { module: string; code: string; step: number; steps: number },
  { held, tried, moved }: { held: boolean; tried: boolean; moved: boolean },
): Progress {
  const next = held ? p : recordStep(p, at.module, at.code, at.step, at.steps, tried);
  return moved ? markPlace(next, { ...at, kind: "worked" }) : next;
}

/**
 * A stored place as the site has it now: gone when its Module, Worked example or Practice item is,
 * and a Worked step brought within an example that has fewer steps than when it was stored.
 */
export function resumable(place: Place, shapes: Record<string, MasteryShape>): Place | undefined {
  const shape = shapes[place.module];
  if (!shape) return undefined;
  if (place.kind === "practice") return shape.practice.includes(place.item) ? place : undefined;
  const example = shape.worked.find((w) => w.code === place.code);
  if (!example) return undefined;
  return { ...place, step: Math.min(place.step, example.steps - 1), steps: example.steps };
}

/** The resume note's location line: "W01.1, step 4 of 6" or "Practice 2". */
export const placeLabel = (place: Place) =>
  place.kind === "worked" ? `${place.code}, step ${place.step + 1} of ${place.steps}` : `Practice ${place.item}`;

/** The id of a Worked example's element on its Module page. */
export const workedAnchor = (code: string) => `worked-${code}`;
/** The id of a Practice item's element on its Module page. */
export const practiceAnchor = (item: string) => `practice-${item}`;

/** The element a place sits in on its Module page. */
export const placeAnchor = (place: Place) =>
  place.kind === "worked" ? workedAnchor(place.code) : practiceAnchor(place.item);

export const placeHref = (place: Place) => `/${place.module}/#${encodeURIComponent(placeAnchor(place))}`;

export const recordPractice = (p: Progress, module: string, item: string, result: PracticeResult) =>
  update(p, module, (m) => ({ ...m, practice: { ...m.practice, [item]: result } }));

/** What a Module page holds that progress is kept on: its Worked examples' codes and Practice items. */
export interface PageShape {
  worked: string[];
  practice: string[];
}

/** The sections the student has done. A section with nothing in it is never done. */
export function doneSections(m: ModuleProgress | undefined, page: PageShape): Set<Section> {
  const done = new Set<Section>();
  if (!m) return done;
  if (m.watched) done.add("watch");
  if (m.summaryRead) done.add("summary");
  const reachedEnd = (code: string) => {
    const w = m.worked?.[code];
    return w !== undefined && w.furthest >= w.steps - 1;
  };
  if (page.worked.length > 0 && page.worked.every(reachedEnd)) done.add("worked");
  if (page.practice.length > 0 && page.practice.every((item) => m.practice?.[item] !== undefined)) done.add("practice");
  return done;
}

/** What a Module holds that Mastery is measured on: its Worked examples (with their steps) and Practice items. */
export interface MasteryShape {
  worked: { code: string; steps: number }[];
  practice: string[];
}

/** Practice is weighted most (decided on #45). */
const PRACTICE_WEIGHT = 0.6;

const practiceScore = (result: PracticeResult | undefined) =>
  !result ? 0 : result.kind === "numeric" ? (result.correct ? 1 : 0) : result.of > 0 ? result.marks / result.of : 0;

/**
 * A Module's Mastery, from 0 to 1: Practice (each item's result) weighted 60%, Worked examples
 * (each step read counts 1, each step worked try-first 1 more, out of 2) 40%. A Module with only
 * one of them counts it in full; one with neither has no Mastery.
 */
export function mastery(m: ModuleProgress | undefined, shape: MasteryShape): number | undefined {
  const practice =
    shape.practice.length === 0
      ? undefined
      : shape.practice.reduce((sum, item) => sum + practiceScore(m?.practice?.[item]), 0) / shape.practice.length;
  const total = shape.worked.reduce((sum, w) => sum + 2 * w.steps, 0);
  const worked =
    total === 0
      ? undefined
      : shape.worked.reduce((sum, { code, steps }) => {
          const w = m?.worked?.[code];
          const counted = (list: number[] | undefined) => (list ?? []).filter((s) => s >= 0 && s < steps).length;
          return sum + counted(seenSteps(w)) + counted(w?.tried);
        }, 0) / total;
  if (practice === undefined) return worked;
  if (worked === undefined) return practice;
  return PRACTICE_WEIGHT * practice + (1 - PRACTICE_WEIGHT) * worked;
}

/**
 * Records a paper sat: its last result, and its best (the larger share of the marks; an equal one
 * keeps the earlier). Record only a fully marked result: a paper with written answers unmarked has
 * no score yet.
 */
export const recordPaper = (p: Progress, key: string, result: PaperResult): Progress => {
  const before = p.papers?.[key];
  const best = !before || result.got / result.of > before.best.got / before.best.of ? result : before.best;
  return { ...p, papers: { ...p.papers, [key]: { last: result, best } } };
};

/** The best share of the marks over the mocks (`<sitting>/<variant>` keys) the student has fully marked; undefined when none. */
export function bestMock(p: Progress, keys: readonly string[]): number | undefined {
  const shares = keys.flatMap((key) => {
    const best = p.papers?.[key]?.best;
    return best ? [best.got / best.of] : [];
  });
  return shares.length === 0 ? undefined : Math.max(...shares);
}

/**
 * An Exam sitting's readiness, from 0 to 1: the average Mastery of its Modules, leaving out any
 * with nothing to master. Once the sitting has an Exam room and the student has fully marked a
 * mock, the best mock score joins it: readiness is the mean of the two (with no Module to master,
 * the mock alone). Past-paper attempts are kept but never counted.
 */
export function readiness(masteries: (number | undefined)[], mock?: number): number | undefined {
  const counted = masteries.filter((m): m is number => m !== undefined);
  const average = counted.length === 0 ? undefined : counted.reduce((a, b) => a + b, 0) / counted.length;
  if (mock === undefined) return average;
  return average === undefined ? mock : (average + mock) / 2;
}
