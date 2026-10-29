// Chemical formulas as element counts: what a molecule's stated formula, RDKit's, the SDF's atoms
// and PubChem's are all compared by, whatever order and condensing they were written in.

/** Every element symbol, in atomic-number order. */
// prettier-ignore
export const ELEMENTS = [
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y",
  "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce",
  "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir",
  "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm",
  "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc",
  "Lv", "Ts", "Og",
] as const;
const SYMBOLS: ReadonlySet<string> = new Set(ELEMENTS);

type Counts = Record<string, number>;

/**
 * The element counts of a formula: NH2CH2COOH is C2H5NO2. Brackets multiply (Ca(OH)2), and a trailing
 * charge (`SO4^2-`, `NH4+`) is dropped. Throws on an unknown symbol or a bracket left open.
 */
export function elementCounts(formula: string): Counts {
  const text = formula.replace(/(?:\^\d*)?[+-]$/, "");
  const stack: Counts[] = [{}];
  let i = 0;
  const number = () => {
    const digits = /^\d+/.exec(text.slice(i))?.[0];
    i += digits?.length ?? 0;
    return digits === undefined ? 1 : Number(digits);
  };
  while (i < text.length) {
    const char = text[i] ?? "";
    if (char === "(") {
      stack.push({});
      i += 1;
    } else if (char === ")") {
      i += 1;
      const inner = stack.pop();
      const outer = stack[stack.length - 1];
      if (!inner || !outer) throw new Error(`the formula ${formula} closes a bracket it never opened`);
      const times = number();
      for (const [element, count] of Object.entries(inner)) outer[element] = (outer[element] ?? 0) + count * times;
    } else if (/[A-Z]/.test(char)) {
      const symbol = /^[A-Z][a-z]?/.exec(text.slice(i))?.[0] ?? char;
      // "Co" is cobalt, but "CO" is carbon and oxygen: a lower-case letter belongs to the symbol only if it makes one.
      const element = SYMBOLS.has(symbol) ? symbol : char;
      if (!SYMBOLS.has(element)) throw new Error(`the formula ${formula} names ${element}, which isn't an element`);
      i += element.length;
      const top = stack[stack.length - 1] as Counts;
      top[element] = (top[element] ?? 0) + number();
    } else throw new Error(`the formula ${formula} has a ${JSON.stringify(char)} it can't read`);
  }
  if (stack.length !== 1) throw new Error(`the formula ${formula} leaves a bracket open`);
  return stack[0] as Counts;
}

/** Hill order: carbon, then hydrogen, then the rest A–Z; with no carbon, every element A–Z. */
export function hillOrder(elements: readonly string[]): string[] {
  const alphabetical = (list: readonly string[]) => [...list].sort((a, b) => a.localeCompare(b));
  if (!elements.includes("C")) return alphabetical(elements);
  return [
    "C",
    ...(elements.includes("H") ? ["H"] : []),
    ...alphabetical(elements.filter((e) => e !== "C" && e !== "H")),
  ];
}

/** A formula written from its counts in Hill order: C2H5NO2. */
export function hill(counts: Counts): string {
  return hillOrder(Object.keys(counts))
    .map((element) => `${element}${counts[element] === 1 ? "" : counts[element]}`)
    .join("");
}

export function sameCounts(a: Counts, b: Counts): boolean {
  const elements = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...elements].every((element) => (a[element] ?? 0) === (b[element] ?? 0));
}
