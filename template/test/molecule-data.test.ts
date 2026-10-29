// The molecule data layer, pure: formulas as element counts, the SDF reader, the atom a tap means,
// the structure on a page, Jmol's colours, and PubChem's answers (asked of fakes and recorded
// fixtures: nothing here, or anywhere in the tests, touches the network).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { JMOL_CPK, paletteFor } from "../src/molecules/cpk.ts";
import { elementCounts, hill, hillOrder, sameCounts } from "../src/molecules/formula.ts";
import { nearestAtom } from "../src/molecules/pick.ts";
import { askPubchem, pubchemUrl, recordOf, type Fetched } from "../src/molecules/pubchem.ts";
import { runPubchem } from "../src/molecules/pubchem-cli.ts";
import { pubchemRecord } from "../src/molecules/record.ts";
import { readSdf, sdfCounts, zSpan } from "../src/molecules/sdf.ts";
import { inlineSvg } from "../src/molecules/svg.ts";

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");
const FIXTURES = join(TEMPLATE_DIR, "test", "fixtures", "pubchem");
const recorded = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as Fetched & { recorded: string };

describe("formulas as element counts", () => {
  it("elementCounts reads NH2CH2COOH as C2H5NO2", () => {
    expect(elementCounts("NH2CH2COOH")).toEqual({ N: 1, H: 5, C: 2, O: 2 });
    expect(sameCounts(elementCounts("NH2CH2COOH"), elementCounts("C2H5NO2"))).toBe(true);
    expect(sameCounts(elementCounts("C2H5NO2"), elementCounts("C3H7NO2"))).toBe(false);
  });

  it("multiplies brackets, drops a trailing charge, and tells CO from Co", () => {
    expect(elementCounts("Ca(OH)2")).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(elementCounts("Al2(SO4)3")).toEqual({ Al: 2, S: 3, O: 12 });
    expect(elementCounts("NH4+")).toEqual({ N: 1, H: 4 });
    expect(elementCounts("SO4^2-")).toEqual({ S: 1, O: 4 });
    expect(elementCounts("CO")).toEqual({ C: 1, O: 1 });
    expect(elementCounts("Co")).toEqual({ Co: 1 });
  });

  it("throws on an unknown symbol, a stray character and a bracket left open", () => {
    expect(() => elementCounts("Xx2")).toThrow(/isn't an element/);
    expect(() => elementCounts("C2H5 NO2")).toThrow(/can't read/);
    expect(() => elementCounts("Ca(OH")).toThrow(/leaves a bracket open/);
    expect(() => elementCounts("CaOH)2")).toThrow(/closes a bracket it never opened/);
  });

  it("hill and hillOrder put carbon, then hydrogen, then the rest A–Z", () => {
    expect(hill(elementCounts("NH2CH2COOH"))).toBe("C2H5NO2");
    expect(hill(elementCounts("CH3CH2OH"))).toBe("C2H6O");
    expect(hill({ Cl: 1, H: 1 })).toBe("ClH");
    expect(hillOrder(["O", "N", "H", "C"])).toEqual(["C", "H", "N", "O"]);
    expect(hillOrder(["S", "O", "Br"])).toEqual(["Br", "O", "S"]);
  });
});

/** Ethanol, hydrogens included: a small V2000 block written for the test. */
const ETHANOL = [
  "ethanol",
  "  test",
  "",
  "  9  8  0  0  0  0  0  0  0  0999 V2000",
  "   -0.9500    0.0600    0.0300 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.5000   -0.4000   -0.1000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.3500    0.7000    0.4200 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -1.6000   -0.7600    0.3200 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -1.0600    0.8800    0.7400 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "   -1.2300    0.4000   -0.9600 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.6200   -1.3400    0.4400 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "    0.7800   -0.5500   -1.1500 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "    2.2400    0.4200    0.2900 H   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  1  0",
  "  2  3  1  0",
  "  1  4  1  0",
  "  1  5  1  0",
  "  1  6  1  0",
  "  2  7  1  0",
  "  2  8  1  0",
  "  3  9  1  0",
  "M  END",
  "$$$$",
  "",
].join("\n");

describe("the SDF reader", () => {
  it("readSdf reads a V2000 block", () => {
    const { atoms, bonds } = readSdf(ETHANOL);
    expect(atoms).toHaveLength(9);
    expect(bonds).toBe(8);
    expect(atoms[2]).toEqual({ element: "O", x: 1.35, y: 0.7, z: 0.42 });
    expect(sdfCounts(atoms)).toEqual({ C: 2, O: 1, H: 6 });
    expect(sameCounts(sdfCounts(atoms), elementCounts("C2H6O"))).toBe(true);
    // z runs from -1.15 to 0.74: a conformer, not a flat drawing.
    expect(zSpan(atoms)).toBeCloseTo(1.89, 12);
    expect(readSdf(ETHANOL.replace(/\n/g, "\r\n")).atoms).toHaveLength(9);
  });

  it("refuses a molfile that is not V2000", () => {
    expect(() => readSdf(ETHANOL.replace("V2000", "V3000"))).toThrow(/V2000/);
  });
});

describe("the atom a tap means", () => {
  const atoms = [
    { index: 0, element: "C", x: 100, y: 100, z: 5 },
    { index: 1, element: "O", x: 200, y: 100, z: 1 },
    { index: 2, element: "H", x: 100, y: 100, z: -2 },
  ];

  it("nearestAtom picks within 18 px, the nearer to the camera on a tie", () => {
    expect(nearestAtom(atoms, 198, 101)?.element).toBe("O");
    expect(nearestAtom(atoms, 260, 100)).toBeUndefined();
    // C and H are the same distance away on screen: the smaller z is in front, so H hides C.
    expect(nearestAtom(atoms, 105, 100)?.element).toBe("H");
    expect(nearestAtom(atoms, 118, 100)?.element).toBe("H");
    expect(nearestAtom(atoms, 119, 100)).toBeUndefined();
    expect(nearestAtom(atoms, 119, 100, 40)?.element).toBe("H");
    expect(nearestAtom([], 0, 0)).toBeUndefined();
  });
});

describe("the structure on a page", () => {
  it("inlineSvg drops the prolog and labels the drawing", () => {
    const svg =
      "<?xml version='1.0' encoding='iso-8859-1'?>\n<svg version='1.1' width='10px'>\n<!-- END OF HEADER -->\n<path d='M0 0'/>\n</svg>\n";
    const page = inlineSvg(svg, 'Glycine & "friends"');
    expect(page).toBe(
      `<svg role="img" aria-label="Glycine &amp; &quot;friends&quot;" class="structure-svg" version='1.1' width='10px'>\n<path d='M0 0'/>\n</svg>`,
    );
    expect(() => inlineSvg("<div/>", "x")).toThrow(/isn't an SVG/);
  });
});

describe("Jmol's colours", () => {
  it("JMOL_CPK is Jmol's table", () => {
    const anchors = {
      H: "#FFFFFF",
      C: "#909090",
      N: "#3050F8",
      O: "#FF0D0D",
      F: "#90E050",
      Na: "#AB5CF2",
      Mg: "#8AFF00",
      P: "#FF8000",
      S: "#FFFF30",
      Cl: "#1FF01F",
      K: "#8F40D4",
      Ca: "#3DFF00",
      Fe: "#E06633",
      Cu: "#C88033",
      Zn: "#7D80B0",
      Br: "#A62929",
      I: "#940094",
    };
    for (const [element, colour] of Object.entries(anchors)) expect(JMOL_CPK[element], element).toBe(colour);
    expect(Object.keys(JMOL_CPK)).toHaveLength(109);
    for (const colour of Object.values(JMOL_CPK)) expect(colour).toMatch(/^#[0-9A-F]{6}$/);
    expect(paletteFor(["C", "H", "N", "O"])).toEqual({ C: "#909090", H: "#FFFFFF", N: "#3050F8", O: "#FF0D0D" });
    expect(() => paletteFor(["Xx"])).toThrow(/no colour for Xx/);
  });

  it("JMOL_CPK equals 3Dmol.js's own Jmol colours, for every element both list", () => {
    // 3Dmol touches window at import, so its UMD build is run in a context with just enough of one.
    const sandbox: Record<string, unknown> = { console, TextEncoder, TextDecoder };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.navigator = { userAgent: "" };
    sandbox.document = {
      createElement: () => ({ getContext: () => null, style: {} }),
      addEventListener: () => {},
      documentElement: { style: {} },
    };
    createContext(sandbox);
    runInContext(readFileSync(join(TEMPLATE_DIR, "node_modules", "3dmol", "build", "3Dmol.js"), "utf8"), sandbox);
    const theirs = (sandbox["$3Dmol"] as { elementColors: { Jmol: Record<string, number> } }).elementColors.Jmol;
    const hex = (n: number) => `#${n.toString(16).toUpperCase().padStart(6, "0")}`;
    let shared = 0;
    for (const [element, colour] of Object.entries(JMOL_CPK)) {
      if (!(element in theirs)) continue;
      shared += 1;
      expect(colour, element).toBe(hex(theirs[element] as number));
    }
    // 3Dmol lists every element Jmol colours.
    expect(shared).toBe(Object.keys(JMOL_CPK).length);
  });
});

/** A fetch that answers from a list of recorded responses, one per call. */
function fakeFetch(...answers: (Fetched | Error)[]) {
  const asked: string[] = [];
  const fake = vi.fn(async (url: string | URL | Request) => {
    asked.push(String(url));
    const answer = answers.shift();
    if (!answer) throw new Error("PubChem was asked more times than the test expects");
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  return { fetch: fake as unknown as typeof fetch, asked, calls: fake };
}
const io = (ask: typeof fetch, over: { wait?: (ms: number) => Promise<void>; timeoutMs?: number } = {}) => ({
  fetch: ask,
  today: () => "2026-10-29",
  wait: over.wait ?? (async () => {}),
  ...(over.timeoutMs === undefined ? {} : { timeoutMs: over.timeoutMs }),
});

describe("PubChem", () => {
  it("asks for the name's formula and InChIKey, by name", () => {
    expect(pubchemUrl("glycine")).toBe(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/glycine/property/MolecularFormula,InChIKey,IUPACName,Title/JSON",
    );
    expect(pubchemUrl("2-aminoacetic acid")).toContain("/name/2-aminoacetic%20acid/");
  });

  it("records glycine, and a name PubChem doesn't know", () => {
    expect(recordOf("glycine", recorded("glycine"), "2026-10-29")).toEqual({
      record: "learn-premium pubchem record v1",
      query: "glycine",
      url: pubchemUrl("glycine"),
      fetched: "2026-10-29",
      found: true,
      cid: 750,
      formula: "C2H5NO2",
      inchiKey: "DHMQDGOQFOQNFH-UHFFFAOYSA-N",
      iupacName: "2-aminoacetic acid",
      title: "Glycine",
      matches: 1,
    });
    expect(recordOf("not-a-molecule", recorded("not-a-molecule"), "2026-10-29")).toEqual({
      record: "learn-premium pubchem record v1",
      query: "not-a-molecule",
      url: pubchemUrl("not-a-molecule"),
      fetched: "2026-10-29",
      found: false,
      status: 404,
    });
  });

  it("says nothing about a molecule when PubChem is busy or answers something unreadable", () => {
    expect(recordOf("glycine", recorded("busy"), "2026-10-29")).toEqual({ offline: "PubChem answered 503" });
    expect(recordOf("glycine", { status: 200, body: { PropertyTable: {} } }, "2026-10-29")).toEqual({
      offline: "PubChem's answer holds no compound properties",
    });
  });

  it("askPubchem waits a second and asks once more when PubChem is busy", async () => {
    const waits: number[] = [];
    const fake = fakeFetch(recorded("busy"), recorded("glycine"));
    const record = await askPubchem("glycine", io(fake.fetch, { wait: async (ms) => void waits.push(ms) }));
    expect(record).toMatchObject({ found: true, cid: 750 });
    expect(fake.asked).toEqual([pubchemUrl("glycine"), pubchemUrl("glycine")]);
    expect(waits).toEqual([1000]);
    // Busy twice is still busy: it stops there.
    const stuck = fakeFetch(recorded("busy"), recorded("busy"));
    expect(await askPubchem("glycine", io(stuck.fetch))).toEqual({ offline: "PubChem answered 503" });
    expect(stuck.calls).toHaveBeenCalledTimes(2);
  });

  it("a rejected fetch and a timeout are offline, not a crash", async () => {
    expect(await askPubchem("glycine", io(fakeFetch(new Error("getaddrinfo ENOTFOUND")).fetch))).toEqual({
      offline: "getaddrinfo ENOTFOUND",
    });
    // A server that never answers: the signal's timeout rejects the fetch.
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_done, fail) =>
        init?.signal?.addEventListener("abort", () => fail(init.signal?.reason)),
      )) as typeof fetch;
    const result = await askPubchem("glycine", io(hang, { timeoutMs: 20 }));
    expect(result).toHaveProperty("offline");
  });
});

/** A scratch Course holding one molecule descriptor, to record PubChem's answer for. */
function scratchCourse(name = "glycine"): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-pubchem-"));
  mkdirSync(join(dir, "modules", "13-cell-potential", "molecules"), { recursive: true });
  writeFileSync(join(dir, "modules", "13-cell-potential", "molecules", `${name}.json`), JSON.stringify({ name }));
  return dir;
}
const RECORD = ["build-records", "pubchem", "13-cell-potential", "glycine.json"];

describe("npm run pubchem", () => {
  const silent = () => {
    const lines: string[] = [];
    return { lines, log: (line: string) => void lines.push(line) };
  };
  const neverFetch = (() => {
    throw new Error("a replay must never touch the network");
  }) as unknown as typeof fetch;

  it("--replay writes the record into a scratch Course copy and fetches nothing", async () => {
    const course = scratchCourse();
    const out = silent();
    const code = await runPubchem(["--content", course, "--replay", FIXTURES], { ...io(neverFetch), ...out });
    expect(code).toBe(0);
    expect(out.lines).toEqual([
      "recorded: build-records/pubchem/13-cell-potential/glycine.json",
      "fetched 1, had 0, offline 0, not found 0",
    ]);
    const written = readFileSync(join(course, ...RECORD), "utf8");
    // The record carries the day the replayed response was recorded, so a replay is byte for byte reproducible.
    expect(pubchemRecord.parse(JSON.parse(written))).toMatchObject({
      found: true,
      fetched: recorded("glycine").recorded,
      cid: 750,
      inchiKey: "DHMQDGOQFOQNFH-UHFFFAOYSA-N",
    });
    expect(written).not.toContain("\r");
    expect(written.endsWith("}\n")).toBe(true);
  });

  it("records a name PubChem doesn't know as not found", async () => {
    const course = scratchCourse("not-a-molecule");
    const out = silent();
    await runPubchem(["--content", course, "--replay", FIXTURES], { ...io(neverFetch), ...out });
    expect(out.lines.at(-1)).toBe("fetched 0, had 0, offline 0, not found 1");
    const written = JSON.parse(
      readFileSync(join(course, "build-records", "pubchem", "13-cell-potential", "not-a-molecule.json"), "utf8"),
    );
    expect(written).toMatchObject({ found: false, status: 404, query: "not-a-molecule" });
  });

  it("a name with no replay file counts as offline, and writes nothing", async () => {
    const course = scratchCourse("water");
    const out = silent();
    await runPubchem(["--content", course, "--replay", FIXTURES], { ...io(neverFetch), ...out });
    expect(out.lines.at(-1)).toBe("fetched 0, had 0, offline 1, not found 0");
    expect(existsSync(join(course, "build-records"))).toBe(false);
  });

  it("an existing record is kept offline, and --refresh asks again", async () => {
    const course = scratchCourse();
    await runPubchem(["--content", course, "--replay", FIXTURES], { ...io(neverFetch), ...silent() });
    const before = readFileSync(join(course, ...RECORD), "utf8");

    const offline = silent();
    const failing = fakeFetch(new Error("getaddrinfo ENOTFOUND"));
    await runPubchem(["--content", course], { ...io(failing.fetch), ...offline });
    expect(offline.lines).toEqual(["fetched 0, had 1, offline 0, not found 0"]);
    expect(failing.calls).not.toHaveBeenCalled();
    expect(readFileSync(join(course, ...RECORD), "utf8")).toBe(before);

    const refreshed = silent();
    await runPubchem(["--content", course, "--refresh"], { ...io(failing.fetch), ...refreshed });
    expect(refreshed.lines).toEqual([
      'offline: no PubChem record for 13-cell-potential/glycine ("glycine"): the pubchem-cross-check gate asks the Owner until it is fetched',
      "fetched 0, had 0, offline 1, not found 0",
    ]);
    // A refresh that couldn't reach PubChem keeps the record it had.
    expect(readFileSync(join(course, ...RECORD), "utf8")).toBe(before);
  });

  it("--save keeps each live response to replay later", async () => {
    const course = scratchCourse();
    const save = mkdtempSync(join(tmpdir(), "lp-pubchem-save-"));
    const fake = fakeFetch(recorded("glycine"));
    await runPubchem(["--content", course, "--save", save], { ...io(fake.fetch), ...silent() });
    expect(JSON.parse(readFileSync(join(save, "glycine.json"), "utf8"))).toEqual({
      status: 200,
      body: recorded("glycine").body,
      recorded: "2026-10-29",
    });
  });

  it("the command runs as a program, and reads the replay without the network", () => {
    const course = scratchCourse();
    cpSync(FIXTURES, join(course, "replay"), { recursive: true });
    const run = spawnSync(
      process.execPath,
      [
        join(TEMPLATE_DIR, "src", "molecules", "pubchem-cli.ts"),
        "--content",
        course,
        "--replay",
        join(course, "replay"),
      ],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("fetched 1, had 0, offline 0, not found 0");
    expect(existsSync(join(course, ...RECORD))).toBe(true);
  });
});
