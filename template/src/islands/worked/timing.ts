// The sheet's motion, in seconds (DESIGN.md: the pen on the sheet). Values land in hand order,
// then the red pen draws; figure marks draw in as the steps add them.
import type { Shown } from "../../worked/stepping.ts";

/** Each value fades in from 2px above. */
export const VALUE_LAND = 0.26;
/** Between values landing: tighter when a step writes many. */
export const valueStagger = (count: number) => (count > 14 ? 0.024 : 0.034);

/** A red-pen ring drawing itself, in-out sine. */
export const MARK_DRAW = 0.52;
export const MARK_STAGGER = 0.09;
/** The pause before a mark when nothing lands ahead of it. */
export const MARK_PAUSE = 0.1;
export const IN_OUT_SINE = [0.37, 0, 0.63, 1] as const;

/** A done step's tick. */
export const TICK_DRAW = 0.3;

/** A figure line drawing in; points and guides fade in. */
export const LINE_DRAW = 0.95;
export const MARK_FADE = 0.5;
/** Between figure elements a step adds. */
export const FIGURE_STAGGER = 0.15;
/** A label follows its mark. */
export const LABEL_AFTER = 0.4;
export const LABEL_FADE = 0.3;

/** When a step's red-pen marks on the table start: after the last value has landed. */
export const tableMarksDelay = ({ state, animate }: Shown) =>
  animate && state.fresh.length > 0 ? state.fresh.length * valueStagger(state.fresh.length) + VALUE_LAND : MARK_PAUSE;

/** When the figure's rings start: after what the step draws onto the figure. */
export const figureRingsDelay = (added: number) => (added > 0 ? LINE_DRAW : 0) + MARK_PAUSE;
