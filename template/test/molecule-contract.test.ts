// The molecule and the "go further" link in the content contract. A molecule is a descriptor (a
// name, a SMILES and the formula the Materials print); RDKit draws it at build. A "go further"
// link is a credited plain link to a page another site made (PhET, Falstad): never a tool.
import { describe, expect, it } from "vitest";
import { module, molecule } from "../src/content/contract.ts";
import { linkOnlyHost, LINK_ONLY_HOSTS } from "../src/content/links-only.ts";

const issuesOf =
  (schema: { safeParse(raw: unknown): { error?: { issues: { path: PropertyKey[]; message: string }[] } } }) =>
  (raw: unknown) =>
    schema.safeParse(raw).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
const issues = issuesOf(molecule);
const moduleIssues = issuesOf(module);

const glycine = () => ({
  title: "Glycine",
  caption: "The simplest amino acid; in solution it binds $\\ce{Cu^2+}$, lowering the free ion a cell sees.",
  name: "glycine",
  smiles: "NCC(=O)O",
  formula: "NH2CH2COOH",
  worked: "1",
  views: ["structure", "viewer"],
  provenance: {},
});

describe("the molecule contract", () => {
  it("glycine parses, with its views defaulted", () => {
    expect(issues(glycine())).toBeUndefined();
    const { views, ...bare } = glycine();
    expect(views).toHaveLength(2);
    expect(molecule.parse(bare).views).toEqual(["structure", "viewer"]);
    expect(molecule.parse({ ...bare, views: ["viewer"] }).views).toEqual(["viewer"]);
  });

  it("refuses a SMILES with a character it can't be", () => {
    expect(issues({ ...glycine(), smiles: "NCC(=O)O; rm" })).toEqual(["smiles: a SMILES string, e.g. NCC(=O)O"]);
    expect(issues({ ...glycine(), smiles: "" })).toBeDefined();
  });

  it("takes the printed formula as symbols, digits and brackets: no charge, no spaces", () => {
    expect(issues({ ...glycine(), formula: "C2H5NO2+" })).toEqual([
      "formula: a formula of element symbols, digits and brackets",
    ]);
    expect(issues({ ...glycine(), formula: "C2 H5" })).toBeDefined();
    const { formula, ...without } = glycine();
    expect(formula).toBeDefined();
    expect(issues(without)).toBeUndefined();
  });

  it("asks for at least one view, and only the two there are", () => {
    expect(issues({ ...glycine(), views: [] })).toBeDefined();
    expect(issues({ ...glycine(), views: ["ball"] })).toBeDefined();
  });

  it("names its Worked example by file number", () => {
    expect(issues({ ...glycine(), worked: "one" })).toEqual(["worked: a Worked example's file number, e.g. 1"]);
  });

  it("is a closed shape", () => {
    expect(issues({ ...glycine(), colour: "red" })).toEqual([': Unrecognized key: "colour"']);
  });
});

const link = (over: Record<string, unknown> = {}) => ({
  title: "Concentration",
  url: "https://phet.colorado.edu/en/simulations/concentration",
  credit: "PhET Interactive Simulations, University of Colorado Boulder",
  licence: "CC BY-NC 4.0",
  ...over,
});
const withFurther = (...links: Record<string, unknown>[]) => ({
  title: "Cell potential",
  summary: "S",
  further: links,
});

describe("the go-further link", () => {
  it("a Module lists its credited links, none by default", () => {
    expect(moduleIssues(withFurther(link()))).toBeUndefined();
    expect(module.parse({ title: "T", summary: "S" }).further).toEqual([]);
  });

  it("a PhET link without PhET's credit or a licence is refused", () => {
    expect(moduleIssues(withFurther(link({ credit: "Someone" })))).toEqual([
      "further.0.credit: PhET's pages are credited to PhET Interactive Simulations, University of Colorado Boulder",
    ]);
    expect(moduleIssues(withFurther(link({ licence: undefined })))).toEqual([
      "further.0.licence: PhET's pages carry a licence: name it, e.g. CC BY-NC 4.0",
    ]);
  });

  it("a Falstad link without Paul Falstad's credit is refused", () => {
    const falstad = { title: "Circuit simulator", url: "https://www.falstad.com/circuit/", licence: "GPL-2.0" };
    expect(moduleIssues(withFurther({ ...falstad, credit: "Falstad" }))).toEqual([
      "further.0.credit: Falstad's pages are credited to Paul Falstad",
    ]);
    expect(moduleIssues(withFurther({ ...falstad, credit: "Paul Falstad" }))).toBeUndefined();
  });

  it("takes https addresses only", () => {
    expect(moduleIssues(withFurther(link({ url: "http://phet.colorado.edu/en/simulations/concentration" })))).toEqual([
      "further.0.url: an https:// address",
    ]);
    expect(moduleIssues(withFurther(link({ url: "not a url" })))).toBeDefined();
  });

  it("another site's link needs only a credit", () => {
    expect(
      moduleIssues(
        withFurther({
          title: "Khan Academy",
          url: "https://www.khanacademy.org/science/chemistry",
          credit: "Khan Academy",
        }),
      ),
    ).toBeUndefined();
  });

  it("linkOnlyHost knows PhET and Falstad, and their subdomains", () => {
    expect(LINK_ONLY_HOSTS.map((h) => h.host)).toEqual(["phet.colorado.edu", "falstad.com"]);
    expect(linkOnlyHost("https://phet.colorado.edu/sims/html/x.html")?.host).toBe("phet.colorado.edu");
    expect(linkOnlyHost("https://www.falstad.com/circuit/")?.host).toBe("falstad.com");
    expect(linkOnlyHost("https://notfalstad.com/")).toBeUndefined();
    expect(linkOnlyHost("https://example.org/falstad.com")).toBeUndefined();
    expect(linkOnlyHost("not a url")).toBeUndefined();
  });

  it("linkOnlyHost sees a protocol-relative URL and a trailing-dot host as the same site", () => {
    expect(linkOnlyHost("//phet.colorado.edu/sims/html/x.html")?.host).toBe("phet.colorado.edu");
    expect(linkOnlyHost("https://phet.colorado.edu./en/simulations/concentration")?.host).toBe("phet.colorado.edu");
    expect(linkOnlyHost("https://www.falstad.com./circuit/")?.host).toBe("falstad.com");
    // A relative path or a lookalike is still no link-only site.
    expect(linkOnlyHost("/sims/phet.colorado.edu/x.html")).toBeUndefined();
    expect(linkOnlyHost("//notphet.colorado.edu.example.org/")).toBeUndefined();
  });
});
