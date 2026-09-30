// The starting pad catalogue (DESIGN.md, approved by the Owner on 2026-09-26): seven cool pads on
// one OKLCH geometry, each mapped to a default Discipline and checked against every contrast
// requirement. A pad joins the catalogue only with the Owner's approval.
import { RED_PEN } from "./colour.ts";

/** A value for every themeable slot. The inks (graphite, pencil, red pen) are fixed and never here. */
export interface PadSlots {
  desk: string;
  sheet: string;
  gridFine: string;
  gridMajor: string;
  print: string;
  muted: string;
  /** The hue of the shadow the sheet casts on the desk, as an `r g b` triplet. */
  shadowTint: string;
}

export type Slot = keyof PadSlots;

/** Each slot's name in DESIGN.md, which is also its CSS variable (`--pad-<name>`). */
export const SLOT_NAMES = {
  desk: "desk",
  sheet: "sheet",
  gridFine: "grid-fine",
  gridMajor: "grid-major",
  print: "print",
  muted: "muted",
  shadowTint: "shadow",
} as const satisfies Record<Slot, string>;

export interface CataloguePad extends PadSlots {
  label: string;
  discipline: string;
}

export const CATALOGUE = {
  green: {
    label: "Green",
    discipline: "Machine learning",
    desk: "#CFDCC2",
    sheet: "#E6EFDC",
    gridFine: "#CADBBB",
    gridMajor: "#B9CEA7",
    print: "#2E5A38",
    muted: "#4F5B4B",
    shadowTint: "30 45 28",
  },
  bluegrey: {
    label: "Blue-grey",
    discipline: "Electric circuits",
    desk: "#C8D5DE",
    sheet: "#E1E9EF",
    gridFine: "#C9D6E0",
    gridMajor: "#B3C4D1",
    print: "#1F4B73",
    muted: "#4A5763",
    shadowTint: "26 40 55",
  },
  teal: {
    label: "Teal",
    discipline: "Heat transfer",
    desk: "#BDDBD8",
    sheet: "#DAEFED",
    gridFine: "#BBDCD9",
    gridMajor: "#A2CCC8",
    print: "#035455",
    muted: "#455A5A",
    shadowTint: "22 52 50",
  },
  violet: {
    label: "Slate-violet",
    discipline: "Mathematics",
    desk: "#D3D1E2",
    sheet: "#EAE8F4",
    gridFine: "#D4D1E4",
    gridMajor: "#C2BFD6",
    print: "#493F6F",
    muted: "#555364",
    shadowTint: "46 44 58",
  },
  steel: {
    label: "Steel",
    discipline: "Machinery",
    desk: "#C8D6DA",
    sheet: "#E2ECEE",
    gridFine: "#C8D7DB",
    gridMajor: "#B3C6CB",
    print: "#32484F",
    muted: "#4C575C",
    shadowTint: "34 49 52",
  },
  graphite: {
    label: "Graphite-grey",
    discipline: "Logic circuits",
    desk: "#D2D3D6",
    sheet: "#E9EAEC",
    gridFine: "#D3D4D7",
    gridMajor: "#C1C2C6",
    print: "#3A3B43",
    muted: "#54555A",
    shadowTint: "43 45 56",
  },
  indigo: {
    label: "Indigo ink",
    discipline: "Engineering chemistry",
    desk: "#CCD3E5",
    sheet: "#E5EAF6",
    gridFine: "#CCD4E8",
    gridMajor: "#B8C2DA",
    print: "#2D3E7E",
    muted: "#4E5566",
    shadowTint: "40 45 61",
  },
} as const satisfies Record<string, CataloguePad>;

export type PadKey = keyof typeof CATALOGUE;
export const PAD_KEYS = Object.keys(CATALOGUE) as [PadKey, ...PadKey[]];

/** The fixed inks, the same on every pad (DESIGN.md "Fixed inks"). */
export const INKS = { graphite: "#262B25", pencil: "#3D433C", "red-pen": RED_PEN } as const;

export const isPadKey = (value: string): value is PadKey => Object.hasOwn(CATALOGUE, value);

/** A custom pad's config value: the colour it is built from. */
export const PAD_COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** A catalogue pad's slot values, without its label and Discipline. */
export function slotsOf(pad: CataloguePad): PadSlots {
  const { desk, sheet, gridFine, gridMajor, print, muted, shadowTint } = pad;
  return { desk, sheet, gridFine, gridMajor, print, muted, shadowTint };
}
