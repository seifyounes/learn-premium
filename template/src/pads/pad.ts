// A Course's pad: one course-config value, a catalogue key or a colour to build a custom pad from.
// Every build checks the pad against DESIGN.md's contrast requirements and auto-fixes it until it
// passes, moving only pad slots (never the red pen, graphite or pencil) and reporting every change.
import {
  CATALOGUE,
  INKS,
  isPadKey,
  PAD_COLOUR,
  SLOT_NAMES,
  slotsOf,
  type PadKey,
  type PadSlots,
  type Slot,
} from "./catalogue.ts";
import { contrast, fightsRedPen, gapFromRedPen, hexOf, isLighter, oklchOf, rgbTriplet, type Oklch } from "./colour.ts";

// The catalogue's shared OKLCH geometry (ticket #21): every pad sits at these lightnesses, so a
// custom pad differs from a catalogue one only in hue and chroma. The chroma ratios are read off
// the catalogue's own pads.
const PAPER = {
  desk: { l: 86.8, chromaScale: 1.45 },
  sheet: { l: 93.6, chromaScale: 1 },
  gridFine: { l: 86.9, chromaScale: 1.6 },
  gridMajor: { l: 81.4, chromaScale: 2 },
} as const;
const PRINT_L = 38.5;
const MUTED_L = 45;
const SHADOW_L = 30;
/** The catalogue's strongest print (Slate-violet); a louder colour is toned down to it. */
const MAX_PRINT_CHROMA = 0.08;
/** Sheet chroma as a share of the print's, capped at the catalogue's most tinted sheet (Teal). */
const SHEET_SHARE = 0.28;
const MAX_SHEET_CHROMA = 0.022;
/** Muted chroma as a share of the print's, capped at the catalogue's most tinted muted. */
const MUTED_SHARE = 0.38;
const MAX_MUTED_CHROMA = 0.028;
/** The shadow's chroma as a multiple of the sheet's, never quite grey. */
const SHADOW_SCALE = 1.6;
const MIN_SHADOW_CHROMA = 0.02;

/** A custom pad on the catalogue's geometry, taking the colour's hue and (capped) chroma. */
export function buildPad(colour: string): PadSlots {
  const base = oklchOf(colour);
  if (!base) throw new Error(`"${colour}" is not a colour`);
  const { h } = base;
  const printChroma = Math.min(base.c, MAX_PRINT_CHROMA);
  const sheetChroma = Math.min(printChroma * SHEET_SHARE, MAX_SHEET_CHROMA);
  const paper = (slot: keyof typeof PAPER) => hexOf({ l: PAPER[slot].l, c: sheetChroma * PAPER[slot].chromaScale, h });
  return {
    desk: paper("desk"),
    sheet: paper("sheet"),
    gridFine: paper("gridFine"),
    gridMajor: paper("gridMajor"),
    print: hexOf({ l: PRINT_L, c: printChroma, h }),
    muted: hexOf({ l: MUTED_L, c: Math.min(printChroma * MUTED_SHARE, MAX_MUTED_CHROMA), h }),
    shadowTint: rgbTriplet(hexOf({ l: SHADOW_L, c: Math.max(MIN_SHADOW_CHROMA, sheetChroma * SHADOW_SCALE), h })),
  };
}

type ColourSlot = Exclude<Slot, "shadowTint">;
type Ink = keyof typeof INKS;
type Role = Ink | ColourSlot;

const isInk = (role: Role): role is Ink => Object.hasOwn(INKS, role);
const colourOf = (pad: PadSlots, role: Role) => (isInk(role) ? INKS[role] : pad[role]);
const nameOf = (role: Role) => (isInk(role) ? role : SLOT_NAMES[role]);

type Step = (colour: Oklch) => Oklch;
const lighter: Step = ({ l, c, h }) => ({ l: Math.min(100, l + 0.25), c, h });
const darker: Step = ({ l, c, h }) => ({ l: Math.max(0, l - 0.25), c, h });
const greyer: Step = ({ l, c, h }) => ({ l, c: c * 0.9, h });

interface Requirement {
  name: string;
  check(pad: PadSlots): { pass: boolean; measured: string };
  /** The pad slot the auto-fix moves, and which way. Every step is monotonic, so fixes never undo each other. */
  fix: { slot: ColourSlot; step: Step };
}

const ratio = (n: number) => `${n.toFixed(2)}:1`;

function minContrast(fg: Role, bg: ColourSlot, min: number, fix: Requirement["fix"]): Requirement {
  return {
    name: `${nameOf(fg)} on ${nameOf(bg)} at least ${min}:1`,
    check(pad) {
      const measured = contrast(colourOf(pad, fg), pad[bg]);
      return { pass: measured >= min, measured: ratio(measured) };
    },
    fix,
  };
}

const TEXT_ROLES: readonly Role[] = ["graphite", "pencil", "print", "muted", "red-pen"];
/** A text role that fails on a paper slot: an ink holds, so the paper lightens; a pad role darkens. */
const onPaper = (role: Role, paper: ColourSlot, min: number) =>
  minContrast(
    role,
    paper,
    min,
    isInk(role) ? { slot: paper, step: lighter } : { slot: role as ColourSlot, step: darker },
  );

const faintGrid = (grid: ColourSlot): Requirement => ({
  name: `${nameOf(grid)} at most 1.5:1 on sheet`,
  check(pad) {
    const measured = contrast(pad[grid], pad.sheet);
    return { pass: measured <= 1.5, measured: ratio(measured) };
  },
  fix: { slot: grid, step: lighter },
});

/**
 * The Red Hue Rule on a pad slot drawn onto the sheet (the grid, the printing, faded notes): at
 * least 60° of hue from the red pen, or a grey. The fix greys the slot and keeps its lightness.
 */
const clearOfRedPen = (slot: ColourSlot): Requirement => ({
  name: `${nameOf(slot)} at least 60° of hue from the red pen, or near-grey`,
  check(pad) {
    const colour = oklchOf(pad[slot]) as Oklch;
    const gap = gapFromRedPen(colour);
    return {
      pass: !fightsRedPen(colour),
      measured: gap === undefined ? `near-grey (chroma ${colour.c.toFixed(3)})` : `${gap.toFixed(0)}°`,
    };
  },
  fix: { slot, step: greyer },
});

/**
 * DESIGN.md's contrast requirements for any Course palette, in its order, with the Red Hue Rule
 * held on every slot drawn onto the sheet. DESIGN.md's list names only print; without the rest, a
 * custom pad near the red would print a reddish grid.
 */
const REQUIREMENTS: readonly Requirement[] = [
  ...TEXT_ROLES.map((role) => onPaper(role, "sheet", 4.5)),
  ...TEXT_ROLES.map((role) => onPaper(role, "gridMajor", 3)),
  minContrast("sheet", "print", 4.5, { slot: "print", step: darker }),
  faintGrid("gridFine"),
  faintGrid("gridMajor"),
  {
    name: "sheet lighter than desk",
    check(pad) {
      const lighter = isLighter(pad.sheet, pad.desk);
      return { pass: lighter, measured: `${ratio(contrast(pad.sheet, pad.desk))} ${lighter ? "lighter" : "darker"}` };
    },
    fix: { slot: "desk", step: darker },
  },
  clearOfRedPen("print"),
  clearOfRedPen("muted"),
  clearOfRedPen("gridFine"),
  clearOfRedPen("gridMajor"),
];

export interface RequirementResult {
  requirement: string;
  measured: string;
  pass: boolean;
}

export function checkPad(pad: PadSlots): RequirementResult[] {
  return REQUIREMENTS.map((r) => ({ requirement: r.name, ...r.check(pad) }));
}

export interface PadChange {
  /** The slot's DESIGN.md name. */
  slot: string;
  from: string;
  to: string;
  /** Each requirement that moved it, with what it measured before the move. */
  because: string[];
}

const SLOT_ORDER = Object.keys(SLOT_NAMES) as Slot[];
const MAX_STEPS = 400;
const MAX_PASSES = 10;

/** The pad moved, slot by slot, until every requirement passes (or no step is left to take). */
export function fixPad(pad: PadSlots): { slots: PadSlots; changes: PadChange[] } {
  const slots = { ...pad };
  /** Each moved slot's exact OKLCH, so rounding to hex never stalls a step. */
  const exact: Partial<Record<ColourSlot, Oklch>> = {};
  const because: Partial<Record<ColourSlot, string[]>> = {};
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moved = false;
    for (const requirement of REQUIREMENTS) {
      const before = requirement.check(slots);
      if (before.pass) continue;
      const { slot, step } = requirement.fix;
      (because[slot] ??= []).push(`${requirement.name}: was ${before.measured}`);
      for (let n = 0; n < MAX_STEPS && !requirement.check(slots).pass; n += 1) {
        exact[slot] = step(exact[slot] ?? (oklchOf(slots[slot]) as Oklch));
        slots[slot] = hexOf(exact[slot]);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const changes = (Object.keys(because) as ColourSlot[])
    .filter((slot) => slots[slot] !== pad[slot])
    .sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b))
    .map((slot) => ({ slot: SLOT_NAMES[slot], from: pad[slot], to: slots[slot], because: because[slot] ?? [] }));
  return { slots, changes };
}

export interface ResolvedPad {
  /** The course-config value: a catalogue key, or the colour a custom pad is built from. */
  value: string;
  key: PadKey | "custom";
  label: string;
  /** Every slot, after the auto-fix. */
  slots: PadSlots;
  /** What the auto-fix changed; empty for every catalogue pad. */
  changes: PadChange[];
  /** Every requirement, measured on the final slots. */
  checks: RequirementResult[];
}

const resolved = new Map<string, ResolvedPad>();

/** The pad a course-config value names, checked and auto-fixed. Throws on a value that is neither. */
export function resolvePad(value: string): ResolvedPad {
  const cached = resolved.get(value);
  if (cached) return cached;
  let pad: ResolvedPad;
  if (isPadKey(value)) {
    pad = { value, key: value, label: CATALOGUE[value].label, ...checkedAndFixed(slotsOf(CATALOGUE[value])) };
  } else if (PAD_COLOUR.test(value)) {
    pad = {
      value,
      key: "custom",
      label: `Custom pad from ${value.toUpperCase()}`,
      ...checkedAndFixed(buildPad(value)),
    };
  } else {
    throw new Error(`pad "${value}" is neither a catalogue pad nor a colour written #RRGGBB`);
  }
  resolved.set(value, pad);
  return pad;
}

function checkedAndFixed(pad: PadSlots) {
  const { slots, changes } = fixPad(pad);
  return { slots, changes, checks: checkPad(slots) };
}

/** The pad's slots as the CSS variables the design tokens read (`--pad-sheet: #…; …`). */
export function padStyle(slots: PadSlots): string {
  return SLOT_ORDER.map((slot) => `--pad-${SLOT_NAMES[slot]}: ${slots[slot]}`).join("; ");
}

/** One line for a build log or report: `print #683129 → #553D39 (…: was 2°)`. */
export const describeChange = ({ slot, from, to, because }: PadChange) =>
  `${slot} ${from} → ${to} (${because.join("; ")})`;
