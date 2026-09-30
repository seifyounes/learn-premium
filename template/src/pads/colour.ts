// Colour arithmetic for the pads and the colour gates: WCAG 2.x contrast, OKLCH, and how far a
// colour sits from the red pen's hue. Lightness is on DESIGN.md's 0–100 scale throughout.
import { converter, formatHex, formatRgb, parse, toGamut, wcagContrast } from "culori";

export interface Oklch {
  /** 0–100, as DESIGN.md writes it. */
  l: number;
  c: number;
  /** Degrees; 0 for a grey, which has no hue. */
  h: number;
}

const oklch = converter("oklch");
const intoRgb = toGamut("rgb", "oklch");

/** Any CSS colour → OKLCH, or undefined when it isn't a colour. */
export function oklchOf(colour: string): Oklch | undefined {
  const parsed = oklch(parse(colour));
  if (!parsed) return undefined;
  return { l: parsed.l * 100, c: parsed.c, h: parsed.h ?? 0 };
}

/** OKLCH → `#RRGGBB`, mapped into sRGB the CSS Color 4 way (chroma gives, lightness and hue hold). */
export function hexOf({ l, c, h }: Oklch): string {
  return formatHex(intoRgb({ mode: "oklch", l: l / 100, c, h })).toUpperCase();
}

/** `#RRGGBB` → `"r g b"`, the triplet form the sheet's shadow tint takes. */
export function rgbTriplet(colour: string): string {
  const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(formatRgb(colour) ?? "");
  if (!rgb) throw new Error(`"${colour}" is not a colour`);
  return rgb.slice(1).join(" ");
}

/** WCAG 2.x contrast ratio, 1–21. */
export const contrast = (a: string, b: string) => wcagContrast(a, b);

/** Whether two CSS colours are the same sRGB colour, whatever syntax each is written in. */
export const sameColour = (a: string, b: string) => {
  const x = parse(a);
  const y = parse(b);
  return x !== undefined && y !== undefined && formatHex(x) === formatHex(y);
};

/** The red pen: the same red on every Course, and never a pad slot. */
export const RED_PEN = "#C0341D";
/** How far from the red pen's hue any other colour on the sheet must sit (the Red Hue Rule). */
export const RED_HUE_GAP = 60;
/** Under this OKLCH chroma a colour reads as grey, so its hue can't be mistaken for the red pen. */
export const ACHROMATIC = 0.035;

const RED_PEN_HUE = (oklchOf(RED_PEN) as Oklch).h;

export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/** Degrees between a colour's hue and the red pen's, or undefined when the colour is grey. */
export function gapFromRedPen(colour: Oklch): number | undefined {
  return colour.c < ACHROMATIC ? undefined : hueGap(colour.h, RED_PEN_HUE);
}

/** A colour that could be taken for the red pen: chromatic and within 60° of its hue. */
export function fightsRedPen(colour: Oklch): boolean {
  const gap = gapFromRedPen(colour);
  return gap !== undefined && gap < RED_HUE_GAP;
}
