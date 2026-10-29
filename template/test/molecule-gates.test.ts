// The molecule gates on the Fixture Course's glycine (Module 13): RDKit's record holds its SVG, SDF
// and SMILES; the 2D structure is graphite only; PubChem's recorded answer for "glycine" agrees
// with the SMILES; and every built 3D viewer is standard Jmol CPK with a key that shows its
// elements. Nothing here touches the network: PubChem's answer is the committed record.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cpkPalette,
  graphiteProblems,
  moleculeChecks,
  pubchemCrossCheck,
  structureGraphite,
} from "../gates/molecules.ts";
import { pagesOf } from "../gates/pages.ts";
import { runControls, type Gate } from "../gates/runner.ts";
import { moleculeRecord } from "../src/molecules/record.ts";
import { INKS } from "../src/pads/catalogue.ts";
import { buildCourse, FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "13-cell-potential";
const DESCRIPTOR = `modules/${MODULE}/molecules/glycine.json`;
const SVG = `modules/${MODULE}/molecules/glycine.svg`;
const RECORD = `build-records/molecules/${MODULE}/glycine.json`;
const PUBCHEM = `build-records/pubchem/${MODULE}/glycine.json`;
const input = { contentDir: FIXTURE_COURSE, module: MODULE };

const run = (gate: Gate, contentDir = FIXTURE_COURSE) => gate.run({ contentDir, module: MODULE });
const messages = async (gate: Gate, contentDir: string) =>
  (await run(gate, contentDir)).findings.map((f) => `${f.outcome}: ${f.message}`);
const json = (file: string) => JSON.parse(readFileSync(join(FIXTURE_COURSE, file), "utf8")) as Record<string, unknown>;
const editJson = (file: string, edit: (data: Record<string, unknown>) => void) =>
  fixtureWith(file, (source) => {
    const data = JSON.parse(source) as Record<string, unknown>;
    edit(data);
    return `${JSON.stringify(data, null, 2)}\n`;
  });
const caught = (result: Awaited<ReturnType<typeof runControls>>) =>
  result.gates[0]?.controls.map((c) => `${c.caught ? "caught" : "MISSED"}: ${c.defect}`);

describe("molecule-checks", () => {
  it("molecule-checks passes glycine", async () => {
    const result = await run(moleculeChecks);
    expect(result.findings).toEqual([]);
    // One Module, one molecule, its record, and the SDF's ten atoms: five heavy and five hydrogens.
    expect(result.coverage).toEqual({ modules: 1, molecules: 1, records: 1, sdfAtoms: 10 });
    expect(moleculeRecord.parse(json(RECORD))).toMatchObject({ formula: "C2H5NO2", atoms: ["N", "C", "C", "O", "O"] });
  });

  it("names an SVG redrawn after the record", async () => {
    const course = fixtureWith(SVG, (svg) => svg.replace(/(<path[^>]* d=')M (\d)/, "$1M 9$2"));
    expect(await messages(moleculeChecks, course)).toEqual([
      `block: the 2D structure ${SVG} isn't the one npm run molecules built: re-run it, never edit it`,
    ]);
  });

  it("names a SMILES edited after the build", async () => {
    const course = editJson(DESCRIPTOR, (m) => void (m["smiles"] = "NCC(=O)OC"));
    expect(await messages(moleculeChecks, course)).toEqual([
      "block: the SMILES changed after the molecule was built: re-run npm run molecules",
    ]);
  });

  it("names a printed formula the SMILES doesn't give", async () => {
    const course = editJson(DESCRIPTOR, (m) => void (m["formula"] = "NH2CH2COO"));
    expect(await messages(moleculeChecks, course)).toEqual([
      "block: the Materials print C2H4NO2, but the SMILES NCC(=O)O gives C2H5NO2: fix the SMILES (or the formula, if it was misread)",
    ]);
  });

  it("names a molecule with no record, and a missing file", async () => {
    const noRecord = fixtureWith(DESCRIPTOR, (s) => s);
    const { rmSync } = await import("node:fs");
    rmSync(join(noRecord, RECORD));
    expect(await messages(moleculeChecks, noRecord)).toEqual([
      `block: no molecule record at ${RECORD}: build the molecule with npm run molecules`,
    ]);
    const noSvg = fixtureWith(DESCRIPTOR, (s) => s);
    rmSync(join(noSvg, SVG));
    expect(await messages(moleculeChecks, noSvg)).toEqual([
      `block: no 2D structure at ${SVG}: build it with npm run molecules`,
    ]);
  });

  it("names a Worked example the molecule sits in but the Module doesn't have", async () => {
    const course = editJson(DESCRIPTOR, (m) => void (m["worked"] = "9"));
    expect((await messages(moleculeChecks, course)).join("\n")).toContain("names Worked example 9");
  });

  it("molecule-checks catches its five controls", async () => {
    const result = await runControls({ input, gates: [moleculeChecks] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(caught(result)).toEqual([
      "caught: an SVG redrawn after the record",
      "caught: a SMILES edited after the build",
      "caught: a printed formula the SMILES doesn't give",
      "caught: an SDF missing an oxygen",
      "caught: a flat SDF",
    ]);
  });
});

describe("structure-graphite", () => {
  it("structure-graphite passes glycine as RDKit drew it", async () => {
    const result = await run(structureGraphite);
    expect(result.findings).toEqual([]);
    // 13 colours in glycine.svg: seven strokes (five bonds, two bond corners) and six filled letter paths.
    expect(result.coverage).toEqual({ modules: 1, structures: 1, paints: 13 });
  });

  it("it names the atom", () => {
    const svg = readFileSync(join(FIXTURE_COURSE, SVG), "utf8");
    const red = svg.replace(new RegExp(`(<path class='atom-3'[^>]*fill=')${INKS.graphite}'`, "i"), "$1#FF0000'");
    expect(red).not.toBe(svg);
    const { problems } = graphiteProblems(red, ["N", "C", "C", "O", "O"]);
    expect(problems).toEqual([
      expect.stringMatching(
        /^atom 3 \(O\) is painted #FF0000: a 2D structure is graphite with element letters, never atom colours \(it sits \d+° from the red pen's hue\)$/,
      ),
    ]);
  });

  it("names an opaque background, and a colour in a stylesheet", () => {
    const svg = readFileSync(join(FIXTURE_COURSE, SVG), "utf8");
    const white = svg.replace(
      /(<svg\b[^>]*>)/,
      "$1<rect style='fill:#FFFFFF;stroke:none' width='100%' height='100%'/>",
    );
    expect(graphiteProblems(white, []).problems).toEqual([
      "<rect> is painted #FFFFFF: a 2D structure sits on the sheet in graphite, with no background",
    ]);
    const styled = svg.replace("</svg>", "<style>.atom-0 { fill: #3050F8 }</style></svg>");
    expect(graphiteProblems(styled, ["N"]).problems).toHaveLength(1);
    expect(graphiteProblems(svg, []).problems).toEqual([]);
  });

  it("structure-graphite catches its three controls", async () => {
    const result = await runControls({ input, gates: [structureGraphite] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(caught(result)).toEqual([
      "caught: RDKit's default palette: oxygen drawn red",
      "caught: a pad-safe darkened CPK nitrogen on its bonds",
      "caught: an opaque white background",
    ]);
  });
});

describe("pubchem-cross-check", () => {
  it("pubchem-cross-check passes glycine against CID 750", async () => {
    const result = await run(pubchemCrossCheck);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, molecules: 1, crossChecked: 1 });
    expect(json(PUBCHEM)).toMatchObject({ found: true, cid: 750, formula: "C2H5NO2", query: "glycine" });
  });

  it("pubchem-cross-check never fetches", async () => {
    const fetching = vi.fn(() => {
      throw new Error("the gate asked the network");
    });
    vi.stubGlobal("fetch", fetching);
    try {
      expect((await run(pubchemCrossCheck)).findings).toEqual([]);
      expect(fetching).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks a valid but wrong SMILES, naming both formulas", async () => {
    const course = editJson(RECORD, (r) => {
      Object.assign(r, { formula: "C3H7NO2", inchiKey: "QNAYBMKLOCPYGJ-UHFFFAOYSA-N" });
    });
    expect(await messages(pubchemCrossCheck, course)).toEqual([
      "block: PubChem's glycine (CID 750) is C2H5NO2, but the SMILES gives C3H7NO2: the SMILES is valid, but not the molecule the Materials name",
    ]);
  });

  it("blocks an isomer, and raises a Checkpoint item for other stereo", async () => {
    const isomer = editJson(RECORD, (r) => void (r["inchiKey"] = "ZZZZZZZZZZZZZZ-UHFFFAOYSA-N"));
    const [block] = await messages(pubchemCrossCheck, isomer);
    expect(block).toMatch(
      /^block: .*an isomer's skeleton: PubChem's skeleton DHMQDGOQFOQNFH, the SMILES's ZZZZZZZZZZZZZZ/,
    );
    const stereo = editJson(PUBCHEM, (p) => void (p["inchiKey"] = "DHMQDGOQFOQNFH-ZZZZZZZZZZ-N"));
    expect(await messages(pubchemCrossCheck, stereo)).toEqual([
      "checkpoint: PubChem's glycine (CID 750) has the same skeleton as the SMILES's, but its stereo, isotopes or charge differ (ZZZZZZZZZZ-N against UHFFFAOYSA-N): confirm which the Materials mean",
    ]);
  });

  it("raises a Checkpoint item when PubChem doesn't know the name, or was never asked", async () => {
    const unknown = fixtureWith(PUBCHEM, () =>
      JSON.stringify({
        record: "learn-premium pubchem record v1",
        query: "glycine",
        url: "u",
        fetched: "d",
        found: false,
        status: 404,
      }),
    );
    expect(await messages(pubchemCrossCheck, unknown)).toEqual([
      `checkpoint: PubChem doesn't know "glycine" (status 404): confirm the structure against the Materials' drawing`,
    ]);
    const asked = fixtureWith(PUBCHEM, () =>
      JSON.stringify({
        record: "learn-premium pubchem record v1",
        query: "alanine",
        url: "u",
        fetched: "d",
        found: false,
        status: 404,
      }),
    );
    expect(await messages(pubchemCrossCheck, asked)).toEqual([
      'checkpoint: no PubChem record for "glycine" (run npm run pubchem online): the structure from its SMILES is unchecked',
    ]);
  });

  it("pubchem-cross-check catches its five controls", async () => {
    const result = await runControls({ input, gates: [pubchemCrossCheck] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(caught(result)).toEqual([
      "caught: a valid but wrong SMILES (alanine's for glycine)",
      "caught: an isomer with glycine's formula",
      "caught: the same skeleton with other stereo",
      "caught: PubChem doesn't know the name",
      "caught: no PubChem record (fetched offline, or never)",
    ]);
  });
});

describe("cpk-palette on the built pages", () => {
  const build = buildCourse(FIXTURE_COURSE);
  const built = { contentDir: FIXTURE_COURSE, distDir: build.outDir };
  beforeAll(() => expect(build.ok, build.output).toBe(true));

  it("cpk-palette passes the built viewers: C, H, N, O in Jmol CPK", async () => {
    const result = await cpkPalette.run(built);
    expect(result.findings).toEqual([]);
    // Glycine's viewer on its Module page, in the Lab and in the Tool gallery: four elements each.
    expect(result.coverage).toEqual({ pages: pagesOf(build.outDir).length, viewers: 3, elements: 12 });
  });

  it("names a key whose oxygen is darkened, a monochrome palette and a key without hydrogen", async () => {
    const page = build.page(MODULE);
    expect(page).toContain("background-color:#FF0D0D");
    expect(page).toContain("&quot;C&quot;:&quot;#909090&quot;");
    const result = await runControls({ input: built, gates: [cpkPalette] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(caught(result)).toEqual([
      "caught: a key whose oxygen is darkened to pass contrast",
      "caught: a monochrome 3D palette, carbon in graphite",
      "caught: a key that leaves out hydrogen",
    ]);
  });
});
