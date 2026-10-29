// The molecule gates. `molecule-checks` holds each molecule's files to the record RDKit left when it
// built them (`npm run molecules`): the SMILES, the 2D structure and the 3D conformer bound by their
// SHA-256, the formula the Materials print against the one RDKit computes, and an SDF that is 3D.
// `structure-graphite` holds the 2D structure to graphite: element letters, no atom colours, no
// background (CPK oxygen would sit within a few degrees of the red pen). `pubchem-cross-check` holds
// the SMILES against what PubChem calls the name, as `npm run pubchem` recorded it, and never
// fetches. `cpk-palette` holds every built 3D viewer to standard Jmol CPK.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, Nodes } from "hast";
import { fromHtml } from "hast-util-from-html";
import { molecule as moleculeSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { JMOL_CPK } from "../src/molecules/cpk.ts";
import { elementCounts, hill, sameCounts } from "../src/molecules/formula.ts";
import {
  moleculeRecord,
  moleculeRecordEntry,
  moleculeSdfEntry,
  moleculeSvgEntry,
  pubchemRecord,
  pubchemRecordEntry,
  type MoleculeRecord,
} from "../src/molecules/record.ts";
import { readSdf, sdfCounts, zSpan } from "../src/molecules/sdf.ts";
import { INKS } from "../src/pads/catalogue.ts";
import { fightsRedPen, gapFromRedPen, oklchOf, sameColour } from "../src/pads/colour.ts";
import { coloursIn, declarations } from "./colour.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import { copySite, sitePages } from "./pages.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems, workedExample } from "./sims.ts";

const ignoreMath = () => {};

/** A text file's SHA-256 with its line endings as LF, as the build binds the files it wrote. */
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** An SDF of a conformer is flat when its atoms span no more than this in z (Å). */
const FLAT_Z_SPAN = 0.05;

interface Located {
  file: CourseFile;
  module: string;
  name: string;
}

/** The molecules in scope, and how many Modules were looked in. */
function moleculesInScope(input: GateInput) {
  const files = courseFiles(input);
  const molecules: Located[] = files
    .filter((f) => f.collection === "molecules")
    .map((file) => ({ file, module: moduleOf(file.entry) ?? "", name: nameOf(file.entry) }));
  return { files, molecules, modules: files.filter((f) => f.collection === "modules").length };
}

/** A molecule as written, and as the content contract reads it, or why it can't be checked. */
function readMolecule({ file }: Located) {
  let raw: unknown;
  try {
    raw = readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
  } catch (error) {
    return { problem: `can't check the molecule: ${(error as Error).message}` } as const;
  }
  const parsed = moleculeSchema.safeParse(raw);
  return parsed.success
    ? ({ molecule: parsed.data } as const)
    : ({ problem: `can't check the molecule: the content contract reports ${problems(parsed.error)}` } as const);
}

/** RDKit's record of a molecule, or why there is none. */
function readRecord(contentDir: string, { module, name }: Located): { record: MoleculeRecord } | { problem: string } {
  const entry = moleculeRecordEntry(module, name);
  const path = join(contentDir, entry);
  if (!existsSync(path))
    return { problem: `no molecule record at ${entry}: build the molecule with npm run molecules` };
  try {
    const parsed = moleculeRecord.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success
      ? { record: parsed.data }
      : { problem: `the molecule record ${entry} isn't one: ${problems(parsed.error)}` };
  } catch (error) {
    return { problem: `can't read the molecule record ${entry}: ${(error as Error).message}` };
  }
}

const formulaOf = (formula: string) => hill(elementCounts(formula));

// ---------------------------------------------------------------------------------------------------
// molecule-checks

async function moleculeChecksRun(input: GateInput) {
  const { files, molecules, modules } = moleculesInScope(input);
  const coverage = { modules, molecules: molecules.length, records: 0, sdfAtoms: 0 };
  const findings: Finding[] = [];
  for (const found of molecules) {
    const { file, module, name } = found;
    const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
    const read = readMolecule(found);
    if ("problem" in read) {
      block(read.problem);
      continue;
    }
    const { molecule: m } = read;
    if (m.worked !== undefined) {
      const example = workedExample(files, module, m.worked);
      if (typeof example === "string") block(example);
    }
    const made = readRecord(input.contentDir, found);
    if ("problem" in made) {
      block(made.problem);
      continue;
    }
    const { record } = made;
    coverage.records += 1;
    if (record.smiles !== m.smiles) block("the SMILES changed after the molecule was built: re-run npm run molecules");

    // The files each view needs, bound to the record by their hashes.
    const bound: [view: "structure" | "viewer", entry: string, hash: string | undefined, what: string][] = [
      ["structure", moleculeSvgEntry(module, name), record.svg, "2D structure"],
      ["viewer", moleculeSdfEntry(module, name), record.sdf, "3D conformer"],
    ];
    let sdfText: string | undefined;
    for (const [view, entry, hash, what] of bound) {
      if (!m.views.includes(view)) continue;
      const path = join(input.contentDir, entry);
      if (!existsSync(path)) {
        block(`no ${what} at ${entry}: build it with npm run molecules`);
        continue;
      }
      const text = readFileSync(path, "utf8");
      if (hash === undefined) block(`the molecule record holds no hash for the ${what}: re-run npm run molecules`);
      else if (sha256(text) !== hash)
        block(`the ${what} ${entry} isn't the one npm run molecules built: re-run it, never edit it`);
      if (view === "viewer") sdfText = text;
    }

    // The formula the Materials print, the record's and the SDF's atoms all agree.
    try {
      if (m.formula !== undefined && !sameCounts(elementCounts(m.formula), elementCounts(record.formula)))
        block(
          `the Materials print ${formulaOf(m.formula)}, but the SMILES ${m.smiles} gives ${formulaOf(record.formula)}: fix the SMILES (or the formula, if it was misread)`,
        );
    } catch (error) {
      block(`can't read the printed formula ${m.formula}: ${(error as Error).message}`);
    }
    if (sdfText !== undefined) {
      try {
        const { atoms } = readSdf(sdfText);
        coverage.sdfAtoms += atoms.length;
        if (!sameCounts(sdfCounts(atoms), elementCounts(record.formula)))
          block(
            `the SDF holds ${hill(sdfCounts(atoms))}, but the record's formula is ${formulaOf(record.formula)}: hydrogens included, the conformer has every atom of the molecule`,
          );
        if (zSpan(atoms) <= FLAT_Z_SPAN)
          block(`the SDF is flat (z span ${zSpan(atoms).toFixed(3)} Å): it holds no 3D conformer`);
      } catch (error) {
        block(`can't read the SDF: ${(error as Error).message}`);
      }
    }
  }
  return { coverage, findings };
}

/** A scratch copy of the Course with `plant` run on its first molecule that has a record. Throws when there is none. */
function plantInMolecule(
  good: GateInput,
  scratch: string,
  plant: (site: { contentDir: string; module: string; name: string; entry: string; record: MoleculeRecord }) => void,
): GateInput {
  const copy = courseCopy(good, scratch);
  for (const found of moleculesInScope(copy).molecules) {
    const made = readRecord(copy.contentDir, found);
    if ("problem" in made) continue;
    plant({
      contentDir: copy.contentDir,
      module: found.module,
      name: found.name,
      entry: found.file.entry,
      record: made.record,
    });
    return copy;
  }
  throw new Error(`no molecule with a record in ${good.contentDir} to plant a negative control in`);
}

const editText = (path: string, edit: (text: string) => string) => {
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  if (after === before) throw new Error(`${path} had nothing to plant a negative control in`);
  writeFileSync(path, after);
  return after;
};
const editJson = (path: string, edit: (data: Record<string, unknown>) => void) =>
  editText(path, (text) => {
    const data = JSON.parse(text) as Record<string, unknown>;
    edit(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });

/** The record bound to an SDF edited by `edit`, so only the conformer's own content can give it away. */
function editedSdf(site: { contentDir: string; module: string; name: string }, edit: (lines: string[]) => string[]) {
  const path = join(site.contentDir, moleculeSdfEntry(site.module, site.name));
  const text = editText(path, (before) => edit(before.replace(/\r\n/g, "\n").split("\n")).join("\n"));
  editJson(join(site.contentDir, moleculeRecordEntry(site.module, site.name)), (record) => {
    record["sdf"] = sha256(text);
  });
}

export const moleculeChecks: Gate = {
  id: "molecule-checks",
  checks:
    "every molecule's SVG, SDF and record are what npm run molecules built from its SMILES; the formula the Materials print, the record's and the SDF's atoms agree; the SDF is 3D",
  points: ["job", "deploy"],
  run: moleculeChecksRun,
  controls: [
    {
      defect: "an SVG redrawn after the record",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editText(join(site.contentDir, moleculeSvgEntry(site.module, site.name)), (svg) =>
            svg.replace(/(<path[^>]* d=')M (\d)/, (_all, before: string, digit: string) => `${before}M 9${digit}`),
          ),
        ),
    },
    {
      defect: "a SMILES edited after the build",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editJson(join(site.contentDir, site.entry), (m) => {
            m["smiles"] = "NCC(=O)OC";
          }),
        ),
    },
    {
      defect: "a printed formula the SMILES doesn't give",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editJson(join(site.contentDir, site.entry), (m) => {
            m["formula"] = "NH2CH2COO";
          }),
        ),
    },
    {
      defect: "an SDF missing an oxygen",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editedSdf(site, (lines) => {
            const counts = lines[3] ?? "";
            const atoms = Number(counts.slice(0, 3));
            const at = lines.findIndex((line, i) => i >= 4 && i < 4 + atoms && line.trim().split(/\s+/)[3] === "O");
            if (at < 0) throw new Error("the SDF has no oxygen to drop");
            const rest = lines.filter((_line, i) => i !== at);
            rest[3] = `${String(atoms - 1).padStart(3)}${counts.slice(3)}`;
            return rest;
          }),
        ),
    },
    {
      defect: "a flat SDF",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editedSdf(site, (lines) => {
            const atoms = Number((lines[3] ?? "").slice(0, 3));
            return lines.map((line, i) =>
              i >= 4 && i < 4 + atoms ? `${line.slice(0, 20)}    0.0000${line.slice(30)}` : line,
            );
          }),
        ),
    },
  ],
};

// ---------------------------------------------------------------------------------------------------
// structure-graphite

/** SVG presentation attributes that paint (hast property names), and the CSS properties of the same names. */
const PAINT_ATTRIBUTES = ["fill", "stroke", "stopColor", "floodColor", "lightingColor", "color"] as const;
const PAINT_PROPERTIES = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"]);

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];

/**
 * Every colour a 2D structure paints that isn't graphite, one problem each. The structure is
 * graphite with element letters: no atom colours, no background. `atoms` are the record's heavy
 * atoms in RDKit's order, which the SVG's `atom-<i>` classes name.
 */
export function graphiteProblems(svg: string, atoms: readonly string[]): { problems: string[]; paints: number } {
  const found: string[] = [];
  let paints = 0;
  const judge = (colour: string, node: Element) => {
    paints += 1;
    if (sameColour(colour, INKS.graphite)) return;
    const atom = classesOf(node)
      .map((c) => /^atom-(\d+)$/.exec(c)?.[1])
      .find((i) => i !== undefined);
    const oklch = oklchOf(colour);
    const gap = oklch && fightsRedPen(oklch) ? gapFromRedPen(oklch) : undefined;
    const near = gap === undefined ? "" : ` (it sits ${gap.toFixed(0)}° from the red pen's hue)`;
    found.push(
      atom === undefined
        ? `<${node.tagName}> is painted ${colour}: a 2D structure sits on the sheet in graphite, with no background${near}`
        : `atom ${atom} (${atoms[Number(atom)] ?? "?"}) is painted ${colour}: a 2D structure is graphite with element letters, never atom colours${near || " (CPK oxygen sits 3° from the red pen)"}`,
    );
  };
  const visit = (node: Nodes): void => {
    if (node.type === "element") {
      for (const attribute of PAINT_ATTRIBUTES) {
        const value = node.properties[attribute];
        if (typeof value === "string") for (const c of coloursIn(value)) judge(c, node);
      }
      const css =
        typeof node.properties.style === "string"
          ? node.properties.style
          : node.tagName === "style"
            ? node.children.map((child) => (child.type === "text" ? child.value : "")).join("")
            : "";
      for (const [property, value] of declarations(css))
        if (PAINT_PROPERTIES.has(property)) for (const c of coloursIn(value)) judge(c, node);
    }
    if (node.type === "element" || node.type === "root") node.children.forEach(visit);
  };
  visit(fromHtml(svg, { space: "svg", fragment: true }));
  return { problems: found, paints };
}

export const structureGraphite: Gate = {
  id: "structure-graphite",
  checks: "every 2D structure SVG paints in graphite only: no atom colour, no background",
  points: ["job", "deploy"],
  async run(input) {
    const { molecules, modules } = moleculesInScope(input);
    const coverage = { modules, structures: 0, paints: 0 };
    const findings: Finding[] = [];
    for (const found of molecules) {
      const { module, name } = found;
      const read = readMolecule(found);
      // A molecule the contract can't read is molecule-checks' to name.
      if ("problem" in read || !read.molecule.views.includes("structure")) continue;
      const made = readRecord(input.contentDir, found);
      const path = join(input.contentDir, moleculeSvgEntry(module, name));
      if ("problem" in made || !existsSync(path)) continue;
      coverage.structures += 1;
      const { problems: wrong, paints } = graphiteProblems(readFileSync(path, "utf8"), made.record.atoms);
      coverage.paints += paints;
      for (const message of wrong) findings.push({ outcome: "block", at: moleculeSvgEntry(module, name), message });
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "RDKit's default palette: oxygen drawn red",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) => {
          const oxygen = site.record.atoms.indexOf("O");
          if (oxygen < 0) throw new Error("the molecule has no oxygen to paint");
          editText(join(site.contentDir, moleculeSvgEntry(site.module, site.name)), (svg) =>
            svg.replace(
              new RegExp(`(<path class='atom-${oxygen}'[^>]*fill=')${INKS.graphite}'`, "i"),
              (_all, before: string) => `${before}#FF0000'`,
            ),
          );
        }),
    },
    {
      defect: "a pad-safe darkened CPK nitrogen on its bonds",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) => {
          const nitrogen = site.record.atoms.indexOf("N");
          if (nitrogen < 0) throw new Error("the molecule has no nitrogen to paint");
          editText(join(site.contentDir, moleculeSvgEntry(site.module, site.name)), (svg) =>
            svg.replace(
              new RegExp(`(<path class='[^']*\\batom-${nitrogen}\\b[^']*'[^>]*style='[^']*?)${INKS.graphite}`, "i"),
              (_all, before: string) => `${before}#2A3F9E`,
            ),
          );
        }),
    },
    {
      defect: "an opaque white background",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editText(join(site.contentDir, moleculeSvgEntry(site.module, site.name)), (svg) =>
            svg.replace(
              /(<svg\b[^>]*>)/,
              "$1\n<rect style='opacity:1.0;fill:#FFFFFF;stroke:none' width='100%' height='100%'/>",
            ),
          ),
        ),
    },
  ],
};

// ---------------------------------------------------------------------------------------------------
// pubchem-cross-check

async function pubchemRun(input: GateInput) {
  const { molecules, modules } = moleculesInScope(input);
  const coverage = { modules, molecules: molecules.length, crossChecked: 0 };
  const findings: Finding[] = [];
  for (const found of molecules) {
    const { file, module, name } = found;
    const read = readMolecule(found);
    const made = readRecord(input.contentDir, found);
    // A molecule that can't be read, or has no record, is molecule-checks' to name.
    if ("problem" in read || "problem" in made) continue;
    const { molecule: m } = read;
    const { record } = made;
    const finding = (outcome: Finding["outcome"], message: string) =>
      findings.push({ outcome, at: file.entry, message });
    const entry = pubchemRecordEntry(module, name);
    const path = join(input.contentDir, entry);
    let pub;
    if (existsSync(path)) {
      try {
        const parsed = pubchemRecord.safeParse(JSON.parse(readFileSync(path, "utf8")));
        if (!parsed.success) {
          finding("block", `the PubChem record ${entry} isn't one: ${problems(parsed.error)}`);
          continue;
        }
        pub = parsed.data;
      } catch (error) {
        finding("block", `can't read the PubChem record ${entry}: ${(error as Error).message}`);
        continue;
      }
    }
    if (pub === undefined || pub.query !== m.name) {
      finding(
        "checkpoint",
        `no PubChem record for "${m.name}" (run npm run pubchem online): the structure from its SMILES is unchecked`,
      );
      continue;
    }
    if (!pub.found) {
      finding(
        "checkpoint",
        `PubChem doesn't know "${m.name}" (status ${pub.status}): confirm the structure against the Materials' drawing`,
      );
      continue;
    }
    coverage.crossChecked += 1;
    const who = `PubChem's ${m.name} (CID ${pub.cid})`;
    try {
      if (!sameCounts(elementCounts(record.formula), elementCounts(pub.formula))) {
        finding(
          "block",
          `${who} is ${formulaOf(pub.formula)}, but the SMILES gives ${formulaOf(record.formula)}: the SMILES is valid, but not the molecule the Materials name`,
        );
        continue;
      }
    } catch (error) {
      finding("block", `can't compare the formulas: ${(error as Error).message}`);
      continue;
    }
    const [mySkeleton = "", ...myRest] = record.inchiKey.split("-");
    const [theirSkeleton = "", ...theirRest] = pub.inchiKey.split("-");
    if (mySkeleton !== theirSkeleton)
      finding(
        "block",
        `${who} has the formula of the SMILES's but an isomer's skeleton: PubChem's skeleton ${theirSkeleton}, the SMILES's ${mySkeleton}: it is not the molecule the Materials name`,
      );
    else if (myRest.join("-") !== theirRest.join("-"))
      finding(
        "checkpoint",
        `${who} has the same skeleton as the SMILES's, but its stereo, isotopes or charge differ (${theirRest.join("-")} against ${myRest.join("-")}): confirm which the Materials mean`,
      );
  }
  return { coverage, findings };
}

export const pubchemCrossCheck: Gate = {
  id: "pubchem-cross-check",
  checks:
    "every molecule's formula and InChIKey, from its SMILES, against PubChem's for its name, as recorded by npm run pubchem",
  points: ["job", "deploy"],
  run: pubchemRun,
  controls: [
    {
      defect: "a valid but wrong SMILES (alanine's for glycine)",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) => {
          editJson(join(site.contentDir, site.entry), (m) => {
            m["smiles"] = "CC(N)C(=O)O";
          });
          editJson(join(site.contentDir, moleculeRecordEntry(site.module, site.name)), (record) => {
            Object.assign(record, {
              smiles: "CC(N)C(=O)O",
              canonical: "CC(N)C(=O)O",
              formula: "C3H7NO2",
              inchiKey: "QNAYBMKLOCPYGJ-UHFFFAOYSA-N",
            });
          });
        }),
    },
    {
      defect: "an isomer with glycine's formula",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editJson(join(site.contentDir, moleculeRecordEntry(site.module, site.name)), (record) => {
            record["inchiKey"] = `ZZZZZZZZZZZZZZ-${String(record["inchiKey"]).split("-").slice(1).join("-")}`;
          }),
        ),
    },
    {
      defect: "the same skeleton with other stereo",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editJson(join(site.contentDir, pubchemRecordEntry(site.module, site.name)), (pub) => {
            pub["inchiKey"] = `${String(pub["inchiKey"]).split("-")[0]}-ZZZZZZZZZZ-N`;
          }),
        ),
    },
    {
      defect: "PubChem doesn't know the name",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) =>
          editJson(join(site.contentDir, pubchemRecordEntry(site.module, site.name)), (pub) => {
            for (const key of Object.keys(pub))
              if (!["record", "query", "url", "fetched"].includes(key)) delete pub[key];
            Object.assign(pub, { found: false, status: 404 });
          }),
        ),
    },
    {
      defect: "no PubChem record (fetched offline, or never)",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInMolecule(good, scratch, (site) => {
          const path = join(site.contentDir, pubchemRecordEntry(site.module, site.name));
          if (!existsSync(path)) throw new Error("the molecule has no PubChem record to remove");
          // An emptied record is the same as none: the gate asks for the step to be run.
          writeFileSync(
            path,
            `${JSON.stringify({ record: "learn-premium pubchem record v1", query: "", url: "", fetched: "", found: false, status: 0 })}\n`,
          );
        }),
    },
  ],
};

// ---------------------------------------------------------------------------------------------------
// cpk-palette

/** The first built page in scope holding a 3D molecule viewer, copied and edited. */
function moleculePageWith(good: GateInput, scratch: string, edit: (page: string) => string): GateInput {
  const first = sitePages(good).find((page) => readFileSync(page.path, "utf8").includes("data-molecule="));
  if (!first) throw new Error("no built page holds a 3D molecule viewer to plant a negative control in");
  const distDir = copySite(good, scratch);
  const path = join(distDir, first.entry);
  const page = readFileSync(path, "utf8");
  const edited = edit(page);
  if (edited === page) throw new Error(`${first.route} had nothing to plant a negative control in`);
  writeFileSync(path, edited);
  return { ...good, distDir };
}

const hasProperty = (node: Element, name: string) => node.properties[name] !== undefined;
export const cpkPalette: Gate = {
  id: "cpk-palette",
  checks:
    "every 3D molecule viewer draws in standard Jmol CPK, and its element key shows exactly the molecule's elements in those colours",
  points: ["module", "deploy"],
  async run(input) {
    const pages = sitePages(input);
    const coverage = { pages: pages.length, viewers: 0, elements: 0 };
    const findings: Finding[] = [];
    for (const { route, path } of pages) {
      const block = (message: string) => findings.push({ outcome: "block", at: route, message });
      const viewers: Element[] = [];
      const collect = (node: Nodes): void => {
        if (node.type === "element" && hasProperty(node, "dataMolecule")) viewers.push(node);
        if (node.type === "element" || node.type === "root") node.children.forEach(collect);
      };
      collect(fromHtml(readFileSync(path, "utf8")));
      for (const viewer of viewers) {
        coverage.viewers += 1;
        const id = String(viewer.properties.dataMolecule);
        const [module = "", name = ""] = id.split("/");
        let palette: Record<string, string>;
        try {
          palette = JSON.parse(String(viewer.properties.dataPalette)) as Record<string, string>;
        } catch {
          block(`the viewer of ${id} carries no readable palette (data-palette)`);
          continue;
        }
        const recordPath = join(input.contentDir, moleculeRecordEntry(module, name));
        if (!existsSync(recordPath)) {
          block(`the viewer of ${id} has no molecule record at ${moleculeRecordEntry(module, name)}`);
          continue;
        }
        const record = moleculeRecord.parse(JSON.parse(readFileSync(recordPath, "utf8")));
        const elements = Object.keys(elementCounts(record.formula));
        for (const [element, colour] of Object.entries(palette)) {
          coverage.elements += 1;
          const standard = JMOL_CPK[element];
          if (standard === undefined) block(`${id}: Jmol's CPK table has no colour for ${element}`);
          else if (!sameColour(colour, standard))
            block(`${id}: ${element} is drawn ${colour}, not standard Jmol CPK ${standard}`);
        }
        const same = (a: readonly string[], b: readonly string[]) =>
          a.length === b.length && [...a].sort().join() === [...b].sort().join();
        if (!same(Object.keys(palette), elements))
          block(
            `${id}: its palette has ${Object.keys(palette).sort().join(", ")}, but the molecule is ${elements.sort().join(", ")}`,
          );
        // The key below the viewer: one entry for each element, dotted in the same colour.
        const key: Element[] = [];
        const find = (node: Nodes): void => {
          if (node.type === "element" && hasProperty(node, "dataElement")) key.push(node);
          if (node.type === "element" || node.type === "root") node.children.forEach(find);
        };
        find(viewer);
        const keyed = key.map((li) => String(li.properties.dataElement));
        if (!same(keyed, elements))
          block(
            `${id}: its element key lists ${[...keyed].sort().join(", ") || "nothing"}, but the molecule is ${[...elements].sort().join(", ")}`,
          );
        for (const li of key) {
          const element = String(li.properties.dataElement);
          const dot = li.children.find(
            (c): c is Element => c.type === "element" && classesOf(c).includes("element-dot"),
          );
          const background =
            dot && /background-color\s*:\s*([^;]+)/i.exec(String(dot.properties.style ?? ""))?.[1]?.trim();
          const standard = JMOL_CPK[element];
          if (!background || standard === undefined || !sameColour(background, standard))
            block(
              `${id}: the key's dot for ${element} is ${background ?? "unpainted"}, not standard Jmol CPK ${standard ?? "(none)"}`,
            );
        }
      }
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a key whose oxygen is darkened to pass contrast",
      plant: (good, scratch) =>
        moleculePageWith(good, scratch, (page) => page.replace("background-color:#FF0D0D", "background-color:#B3241A")),
    },
    {
      defect: "a monochrome 3D palette, carbon in graphite",
      plant: (good, scratch) =>
        moleculePageWith(good, scratch, (page) =>
          page.replace("&quot;C&quot;:&quot;#909090&quot;", `&quot;C&quot;:&quot;${INKS.graphite}&quot;`),
        ),
    },
    {
      defect: "a key that leaves out hydrogen",
      plant: (good, scratch) =>
        moleculePageWith(good, scratch, (page) => page.replace(/<li data-element="H">[\s\S]*?<\/li>/, "")),
    },
  ],
};
