// The Nernst engine: a galvanic cell of two metal | metal-ion half-cells, written first | second.
// The first electrode is oxidised as written (the anode), the second is reduced. Pure, so the number
// gate runs it in Node and the page runs the same code for the student. Never name the electrodes
// by their sides on the page: the Logical Direction Rule, and a cell turns round when E goes negative.
//
//   n  = lcm(z₁, z₂)                           electrons moved in the cell reaction
//   Q  = c₁^(n/z₁) / c₂^(n/z₂)                 the reaction quotient, the first ion's concentration over the second's
//   E° = E°(second) − E°(first)
//   E  = E° − (R·T / n·F) · ln Q               the Nernst equation
//   ΔG = −n·F·E / 1000  (kJ/mol)               K = exp(n·F·E° / R·T)
//
// Activities are taken as concentrations and there is no junction potential.

/** J/(mol·K), CODATA 2018. */
export const R = 8.314462618;
/** C/mol, CODATA 2018. */
export const F = 96485.33212;

/** `ion` as mhchem writes it: "Cu^2+", "Ag^+". `e0` is the couple's standard reduction potential (V). */
export interface HalfCell {
  metal: string;
  ion: string;
  charge: number;
  e0: number;
}
export interface Model {
  first: HalfCell;
  second: HalfCell;
}
/** What students tune: the two concentrations (mol/L) and the temperature (K). */
export interface Inputs {
  c1: number;
  c2: number;
  T: number;
}
export interface Cell {
  E0cell: number;
  n: number;
  Q: number;
  E: number;
  /** kJ/mol */
  deltaG: number;
  K: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The electrons the cell reaction moves: the least common multiple of the two charges. */
export function electrons(m: Model): number {
  const { charge: a } = m.first;
  const { charge: b } = m.second;
  return (a * b) / gcd(a, b);
}

export function cellPotential(m: Model, i: Inputs): Cell {
  const n = electrons(m);
  const Q = i.c1 ** (n / m.first.charge) / i.c2 ** (n / m.second.charge);
  const E0cell = m.second.e0 - m.first.e0;
  const E = E0cell - ((R * i.T) / (n * F)) * Math.log(Q);
  return { E0cell, n, Q, E, deltaG: (-n * F * E) / 1000, K: Math.exp((n * F * E0cell) / (R * i.T)) };
}

/** Every number the engine gives for the cell at `i`, by the names sheets and recompute logs use. */
export function quantities(m: Model, i: Inputs): Record<string, number> {
  const { E0cell, n, Q, E, deltaG, K } = cellPotential(m, i);
  return { E0cell, n, Q, E, deltaG, K };
}

const ION = /^([A-Z][a-z]?)\^(\d?)\+$/;

/** The charge an ion as mhchem writes it carries: "Cu^2+" is 2, "Ag^+" is 1. */
export function ionCharge(ion: string): number | undefined {
  const found = ION.exec(ion);
  return found ? Number(found[2] || 1) : undefined;
}

const SUPERSCRIPT: Record<string, string> = { "1": "¹", "2": "²", "3": "³", "4": "⁴", "+": "⁺" };

/** An ion as plain Unicode, for a label in a 3D scene: "Cu^2+" is "Cu²⁺". */
export function ionText(ion: string): string {
  const found = ION.exec(ion);
  if (!found) return ion;
  const digits = found[2] ?? "";
  return `${found[1]}${[...digits].map((d) => SUPERSCRIPT[d] ?? d).join("")}${SUPERSCRIPT["+"]}`;
}

/** What the model gets wrong about itself: a charge its ion contradicts, an ion that isn't its metal's. */
export function nernstProblems(m: Model): { path: (string | number)[]; message: string }[] {
  const problems: { path: (string | number)[]; message: string }[] = [];
  for (const which of ["first", "second"] as const) {
    const half = m[which];
    const found = ION.exec(half.ion);
    if (found && found[1] !== half.metal)
      problems.push({
        path: ["model", which, "ion"],
        message: `the ion ${half.ion} isn't the metal ${half.metal}'s: a metal | metal-ion half-cell holds its own metal's ion`,
      });
    const charge = ionCharge(half.ion);
    if (charge !== undefined && charge !== half.charge)
      problems.push({
        path: ["model", which, "charge"],
        message: `the ion ${half.ion} carries charge ${charge}, but charge says ${half.charge}`,
      });
  }
  return problems;
}
