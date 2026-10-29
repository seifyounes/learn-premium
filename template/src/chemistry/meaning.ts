// The apparatus's meaning colours: what a metal and a solution look like in the lab. Copper is
// copper and a copper(II) solution is blue, as a student has seen them. Colour data, never a view
// file: imported by the 3D cell scene only (a test holds that), and drawn only inside a framed
// viewer, where DESIGN.md allows meaning colours; on the sheet there are none. Copper sits near the
// red pen's hue, which is allowed inside the frame and nowhere else.

/** A metal electrode's colour, by the metal's symbol. */
export const METAL_COLOURS: Readonly<Record<string, string>> = {
  Cu: "#B87333",
  Zn: "#8E96A3",
  Ag: "#C9CDD2",
  Fe: "#6E7378",
  Ni: "#8F9A8F",
  Al: "#BCC3C9",
  Pb: "#5A5F66",
  Sn: "#A8ADB3",
  Mg: "#B4B9BE",
  Co: "#6F7F96",
  Mn: "#8D8A94",
  Cr: "#9AA3AB",
  Au: "#D4AF37",
  Pt: "#C8CAD0",
};

/** A metal not listed here is drawn in this neutral grey. */
export const NEUTRAL_METAL = "#9AA0A6";

/**
 * A solution's tint, by the ion as mhchem writes it. An ion not listed, and a colourless one (zinc,
 * silver), is drawn in the sheet's own colour.
 */
export const ION_TINTS: Readonly<Record<string, string>> = {
  "Cu^2+": "#2E86C1",
  "Ni^2+": "#4CAF7A",
  "Fe^2+": "#9BCF8E",
  "Fe^3+": "#C98B2B",
  "Co^2+": "#D98BA3",
  "Cr^3+": "#5E8F6E",
};
