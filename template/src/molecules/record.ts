// What `npm run molecules` (molecules/build.py, in the machine venv) and `npm run pubchem` leave
// for each molecule, and where: RDKit's own word on the structure, bound to the files it drew by
// their SHA-256, and PubChem's formula and InChIKey for the name as recorded at an explicit online
// step. The molecule gates read them; Template CI has no RDKit and never asks PubChem.
import { z } from "astro/zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const MOLECULE_RECORD = "learn-premium molecule record v1";
export const moleculeRecord = z.strictObject({
  record: z.literal(MOLECULE_RECORD),
  /** The toolkit that drew it, with its version: "RDKit 2025.09.3". */
  by: z.string().min(1),
  smiles: z.string(),
  canonical: z.string(),
  /** RDKit's CalcMolFormula, in Hill order. */
  formula: z.string(),
  inchi: z.string().startsWith("InChI="),
  inchiKey: z.string().regex(/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/),
  /** The heavy atoms' elements in RDKit's order: the 2D drawing's `atom-<i>` classes. */
  atoms: z.array(z.string()),
  /** SHA-256 of the 2D structure's SVG and of the 3D conformer's SDF, line endings as LF. */
  svg: sha256.optional(),
  sdf: sha256.optional(),
  /** The embedding's random seed, so a rebuild draws the same conformer. */
  seed: z.number().int(),
});
export type MoleculeRecord = z.output<typeof moleculeRecord>;

export const PUBCHEM_RECORD = "learn-premium pubchem record v1";
export const pubchemRecord = z.discriminatedUnion("found", [
  z.strictObject({
    record: z.literal(PUBCHEM_RECORD),
    /** The name PubChem was asked for. */
    query: z.string(),
    url: z.string(),
    /** The day it was asked (or, for a replay, the day the replayed response was recorded). */
    fetched: z.string(),
    found: z.literal(true),
    cid: z.number().int().positive(),
    formula: z.string(),
    inchiKey: z.string(),
    iupacName: z.string().optional(),
    title: z.string().optional(),
    /** How many compounds PubChem matched the name to; the first is the one recorded. */
    matches: z.number().int().positive(),
  }),
  z.strictObject({
    record: z.literal(PUBCHEM_RECORD),
    query: z.string(),
    url: z.string(),
    fetched: z.string(),
    found: z.literal(false),
    /** PubChem's HTTP status for the name: 404 for a name it doesn't know. */
    status: z.number().int(),
  }),
]);
export type PubchemRecord = z.output<typeof pubchemRecord>;

/** A molecule is `<module>/<name>`, as the page's `data-molecule` and its record paths name it. */
export const moleculeId = (module: string, name: string) => `${module}/${name}`;
/** The molecule's descriptor, in the Module's own folder. */
export const moleculeDescriptorEntry = (module: string, name: string) => `modules/${module}/molecules/${name}.json`;
/** The 2D structure RDKit drew, beside the descriptor. */
export const moleculeSvgEntry = (module: string, name: string) => `modules/${module}/molecules/${name}.svg`;
/** The 3D conformer RDKit embedded. */
export const moleculeSdfEntry = (module: string, name: string) => `modules/${module}/molecules/${name}.sdf`;
export const moleculeRecordEntry = (module: string, name: string) => `build-records/molecules/${module}/${name}.json`;
export const pubchemRecordEntry = (module: string, name: string) => `build-records/pubchem/${module}/${name}.json`;
