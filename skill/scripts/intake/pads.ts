// The pad intake suggests for a Course's main Discipline (DESIGN.md "How a Course gets its pad"): the
// catalogue pad mapped to that Discipline, else the pad of the nearest listed Discipline, else
// Graphite-grey. The Owner confirms or swaps it. The scripts can't load the Site template's pad code
// (it needs culori), so the catalogue's Discipline mapping is copied here, and a test holds it to
// template/src/pads/catalogue.ts.
import { PAD_COLOURS } from "../media/pads.ts";

type PadKey = keyof typeof PAD_COLOURS;

/** Each catalogue pad with its label and default Discipline, as template/src/pads/catalogue.ts lists them. */
export const CATALOGUE: Record<PadKey, { label: string; discipline: string }> = {
  green: { label: "Green", discipline: "Machine learning" },
  bluegrey: { label: "Blue-grey", discipline: "Electric circuits" },
  teal: { label: "Teal", discipline: "Heat transfer" },
  violet: { label: "Slate-violet", discipline: "Mathematics" },
  steel: { label: "Steel", discipline: "Machinery" },
  graphite: { label: "Graphite-grey", discipline: "Logic circuits" },
  indigo: { label: "Indigo ink", discipline: "Engineering chemistry" },
};

/** Other names the Owner uses for a listed Discipline: the same Discipline, so its own pad. */
const SAME: Record<string, PadKey> = {
  ml: "green",
  "machine learning": "green",
  circuits: "bluegrey",
  "electrical circuits": "bluegrey",
  "electric circuit": "bluegrey",
  maths: "violet",
  math: "violet",
  "digital logic": "graphite",
  logic: "graphite",
  chemistry: "indigo",
};

/** DESIGN.md's nearest listed Discipline for the Disciplines the catalogue has no pad for. */
const NEAREST: Record<string, PadKey> = {
  control: "bluegrey",
  "control systems": "bluegrey",
  "control engineering": "bluegrey",
  automation: "bluegrey",
  "automation and control": "bluegrey",
  fluids: "teal",
  "fluid mechanics": "teal",
  thermodynamics: "teal",
  "fluids and thermodynamics": "teal",
  statics: "steel",
  "strength of materials": "steel",
  "mechanics of materials": "steel",
  "statics and strength of materials": "steel",
};

/** When nothing listed is close. */
export const FALLBACK_PAD: PadKey = "graphite";

export interface PadSuggestion {
  pad: PadKey;
  label: string;
  /** `catalogue`: the Discipline's own pad; `nearest`: the nearest listed Discipline's; `fallback`: Graphite-grey. */
  match: "catalogue" | "nearest" | "fallback";
  /** The listed Discipline whose pad it is; null for the fallback. */
  listed: string | null;
}

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function suggestPad(discipline: string): PadSuggestion {
  const name = normalise(discipline);
  const own = (Object.keys(CATALOGUE) as PadKey[]).find((key) => normalise(CATALOGUE[key].discipline) === name);
  const same = own ?? SAME[name];
  if (same !== undefined) return suggestion(same, "catalogue");
  const near = NEAREST[name];
  if (near !== undefined) return suggestion(near, "nearest");
  return { pad: FALLBACK_PAD, label: CATALOGUE[FALLBACK_PAD].label, match: "fallback", listed: null };
}

function suggestion(pad: PadKey, match: "catalogue" | "nearest"): PadSuggestion {
  return { pad, label: CATALOGUE[pad].label, match, listed: CATALOGUE[pad].discipline };
}
