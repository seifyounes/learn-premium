// Reads the atoms out of an SDF (an MDL V2000 molfile), as RDKit writes the 3D conformer: the
// elements to compare with the record's formula, and the coordinates to see the conformer is 3D.

export interface SdfAtom {
  element: string;
  x: number;
  y: number;
  z: number;
}

/** The first molecule in an SDF: its atoms in order, and how many bonds it declares. V2000 only. */
export function readSdf(text: string): { atoms: SdfAtom[]; bonds: number } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const counts = lines[3] ?? "";
  if (!/V2000\s*$/.test(counts)) throw new Error("the SDF isn't a V2000 molfile");
  const atomCount = Number(counts.slice(0, 3));
  const bonds = Number(counts.slice(3, 6));
  if (!Number.isInteger(atomCount) || !Number.isInteger(bonds)) throw new Error("the SDF's counts line can't be read");
  const atoms: SdfAtom[] = [];
  for (let i = 0; i < atomCount; i++) {
    const line = lines[4 + i] ?? "";
    const [x, y, z, element] = line.trim().split(/\s+/);
    if (x === undefined || y === undefined || z === undefined || element === undefined)
      throw new Error(`the SDF's atom ${i + 1} can't be read`);
    atoms.push({ element, x: Number(x), y: Number(y), z: Number(z) });
  }
  return { atoms, bonds };
}

/** The elements of an SDF's atoms, counted. */
export function sdfCounts(atoms: readonly SdfAtom[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { element } of atoms) counts[element] = (counts[element] ?? 0) + 1;
  return counts;
}

/** How far the conformer reaches along z (Å): a flat 2D drawing has none. */
export const zSpan = (atoms: readonly SdfAtom[]) =>
  atoms.length === 0 ? 0 : Math.max(...atoms.map((a) => a.z)) - Math.min(...atoms.map((a) => a.z));
