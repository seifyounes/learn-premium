// Progress is kept per browser, with no accounts: what the student has watched, read, stepped
// through and practised on each Module. Pure: the browser store (`store.ts`) reads and writes it,
// the Module page's rail marks sections done from it, and Mastery is built on it.

export const SECTIONS = ["watch", "summary", "worked", "practice"] as const;
export type Section = (typeof SECTIONS)[number];

export type PracticeResult = { kind: "numeric"; correct: boolean } | { kind: "prose"; marks: number; of: number };

export interface ModuleProgress {
  watched?: true;
  summaryRead?: true;
  /** Per Worked example (by its code): the furthest step reached, counted from 0, of how many. */
  worked?: Record<string, { furthest: number; steps: number }>;
  /** Per Practice item (by its number): the last result. */
  practice?: Record<string, PracticeResult>;
}

export interface Progress {
  version: 1;
  modules: Record<string, ModuleProgress>;
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
    return { version: 1, modules: p.modules };
  } catch {
    return emptyProgress();
  }
}

const update = (p: Progress, module: string, change: (m: ModuleProgress) => ModuleProgress): Progress => ({
  ...p,
  modules: { ...p.modules, [module]: change(p.modules[module] ?? {}) },
});

export const markWatched = (p: Progress, module: string) => update(p, module, (m) => ({ ...m, watched: true }));

export const markSummaryRead = (p: Progress, module: string) => update(p, module, (m) => ({ ...m, summaryRead: true }));

/** The student is on `step` (from 0) of a Worked example with `steps` steps. */
export const recordStep = (p: Progress, module: string, code: string, step: number, steps: number) =>
  update(p, module, (m) => {
    const furthest = Math.max(step, m.worked?.[code]?.furthest ?? -1);
    return { ...m, worked: { ...m.worked, [code]: { furthest, steps } } };
  });

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
