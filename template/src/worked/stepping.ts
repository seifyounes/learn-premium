// How a student moves through a Worked example sheet: the step on screen, whether its changes
// are drawn or rendered at once, try-first, and the phone's Table | Plot tab. Pure, so the island
// is a thin view over it.
import { stateAt, type SheetData, type StepState } from "./sheet.ts";

export type Tab = "table" | "figure";

export interface Stepping {
  step: number;
  /** Draw this step's changes; false renders the state at once (going back, the first render). */
  animate: boolean;
  /** Bumped whenever every mark must redraw without motion. */
  epoch: number;
  tryFirst: boolean;
  /** Steps the student has had a go at in try-first, so their values are on the sheet. */
  attempted: ReadonlySet<number>;
  tab: Tab;
  /** The student picked a tab themselves; the region stops following the work. */
  tabPicked: boolean;
}

export type SteppingAction =
  | { type: "go"; to: number }
  /** Next, or in try-first a step not yet attempted: show its values first. */
  | { type: "onward" }
  | { type: "toggle-try-first" }
  | { type: "pick-tab"; tab: Tab };

/** What the sheet shows: the step's state and how to draw it. */
export interface Shown {
  state: StepState;
  /** This step's values are held back: try-first, before the student has had a go. */
  hidden: boolean;
  /** Draw this step's changes (forward, motion allowed); otherwise render the state at once. */
  animate: boolean;
  /** Changes whenever the sheet must redraw without motion (going back, a jump back). */
  epoch: number;
}

/** The sheet opens on its question: step 1, and on a phone the question figure when there is one. */
export const startStepping = (sheet: SheetData): Stepping => ({
  step: 0,
  animate: false,
  epoch: 0,
  tryFirst: false,
  attempted: new Set(),
  tab: sheet.figure ? "figure" : "table",
  tabPicked: false,
});

/** A step with something to work out. Reading the question (a first step that writes nothing) isn't one. */
const hasWork = (state: StepState) => state.index > 0 || state.fresh.length > 0 || state.added.length > 0;

export const isHidden = (sheet: SheetData, s: Stepping) =>
  s.tryFirst && !s.attempted.has(s.step) && hasWork(stateAt(sheet, s.step));

export function shownAt(sheet: SheetData, s: Stepping, reducedMotion: boolean): Shown {
  return {
    state: stateAt(sheet, s.step),
    hidden: isHidden(sheet, s),
    animate: s.animate && !reducedMotion,
    epoch: s.epoch,
  };
}

export function stepping(sheet: SheetData, s: Stepping, action: SteppingAction): Stepping {
  switch (action.type) {
    case "go":
      return go(sheet, s, action.to);
    case "onward":
      return isHidden(sheet, s)
        ? { ...s, attempted: new Set([...s.attempted, s.step]), animate: true }
        : go(sheet, s, s.step + 1);
    case "toggle-try-first":
      return { ...s, tryFirst: !s.tryFirst };
    case "pick-tab":
      return { ...s, tab: action.tab, tabPicked: true };
  }
}

function go(sheet: SheetData, s: Stepping, to: number): Stepping {
  if (to < 0 || to >= sheet.steps.length || to === s.step) return s;
  const forward = to > s.step;
  const next = stateAt(sheet, to);
  // On a phone the region follows the work, until the student picks a tab themselves.
  const tab =
    s.tabPicked || !sheet.figure ? s.tab : next.fresh.length > 0 ? "table" : next.added.length > 0 ? "figure" : s.tab;
  return {
    ...s,
    step: to,
    animate: forward,
    epoch: forward ? s.epoch : s.epoch + 1,
    // In try-first, the steps passed over (going back, or jumping ahead) show as worked.
    attempted: s.tryFirst ? new Set([...s.attempted, ...Array.from({ length: to }, (_, i) => i)]) : s.attempted,
    tab,
  };
}
