// NotebookLM's Custom style for a Course's media, described from its pad (DESIGN.md: "NotebookLM's
// Custom style is given the Course pad"). The scripts run with nothing installed, so they can't load
// the Site template's pad code (it needs culori): the catalogue's paper and print colours are copied
// here, and a test holds them to template/src/pads/catalogue.ts.
import { LedgerError } from "../ledger/file.ts";

/** The colours the style names, per catalogue pad: sheet, fine grid, print. */
export const PAD_COLOURS = {
  green: { sheet: "#E6EFDC", grid: "#CADBBB", print: "#2E5A38" },
  bluegrey: { sheet: "#E1E9EF", grid: "#C9D6E0", print: "#1F4B73" },
  teal: { sheet: "#DAEFED", grid: "#BBDCD9", print: "#035455" },
  violet: { sheet: "#EAE8F4", grid: "#D4D1E4", print: "#493F6F" },
  steel: { sheet: "#E2ECEE", grid: "#C8D7DB", print: "#32484F" },
  graphite: { sheet: "#E9EAEC", grid: "#D3D4D7", print: "#3A3B43" },
  indigo: { sheet: "#E5EAF6", grid: "#CCD4E8", print: "#2D3E7E" },
} as const;

/** The fixed inks (DESIGN.md "Fixed inks"), the same on every pad. */
export const GRAPHITE = "#262B25";
export const RED_PEN = "#C0341D";

const PAD_COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** The Custom style text for a Course's pad: a catalogue key, or the colour a custom pad is built from. */
export function customStyle(pad: string): string {
  return (
    `Hand-drawn on an engineering computation pad: ${paperOf(pad)}, working written in graphite pencil ` +
    `(${GRAPHITE}), corrections circled in one red pen (${RED_PEN}). Clean and uncluttered, no photographs.`
  );
}

function paperOf(pad: string): string {
  if (Object.hasOwn(PAD_COLOURS, pad)) {
    const { sheet, grid, print } = PAD_COLOURS[pad as keyof typeof PAD_COLOURS];
    return `pale ${sheet} paper with a faint 5 mm ${grid} grid, headings and rules printed in ${print}`;
  }
  if (!PAD_COLOUR.test(pad)) {
    throw new LedgerError("invalid", `pad "${pad}" is neither a catalogue pad nor a colour #RRGGBB`);
  }
  const hex = pad.toUpperCase();
  return `pale paper lightly tinted with ${hex}, a faint 5 mm grid in a light shade of ${hex}, headings and rules printed in a deep shade of ${hex}`;
}
