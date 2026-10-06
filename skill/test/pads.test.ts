// The Custom style's copy of the pad colours stays the Site template's: the template's pad code needs
// culori, which the scripts can't load, so the catalogue is read here as text.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CATALOGUE } from "../scripts/intake/pads.ts";
import { GRAPHITE, PAD_COLOURS, RED_PEN } from "../scripts/media/pads.ts";

const read = (path: string) => readFileSync(new URL(`../../template/src/pads/${path}`, import.meta.url), "utf8");

describe("the Custom style's pad colours", () => {
  const catalogue = read("catalogue.ts");

  test("every catalogue pad has its sheet, fine grid and print", () => {
    const keys = [...catalogue.matchAll(/^ {2}(\w+): \{\n {4}label:/gm)].map((m) => m[1]);
    expect(Object.keys(PAD_COLOURS).sort()).toEqual(keys.sort());
    for (const [key, colours] of Object.entries(PAD_COLOURS)) {
      const block = catalogue.slice(catalogue.indexOf(`  ${key}: {`));
      const slot = (name: string) => new RegExp(`${name}: "(#[0-9A-F]{6})"`).exec(block)?.[1];
      expect({ sheet: slot("sheet"), grid: slot("gridFine"), print: slot("print") }).toEqual(colours);
    }
  });

  test("intake's catalogue has every pad with the template's label and default Discipline", () => {
    const keys = [...catalogue.matchAll(/^ {2}(\w+): \{\n {4}label:/gm)].map((m) => m[1]);
    expect(Object.keys(CATALOGUE).sort()).toEqual(keys.sort());
    for (const [key, { label, discipline }] of Object.entries(CATALOGUE)) {
      const block = catalogue.slice(catalogue.indexOf(`  ${key}: {`));
      expect({
        label: /label: "([^"]+)"/.exec(block)?.[1],
        discipline: /discipline: "([^"]+)"/.exec(block)?.[1],
      }).toEqual({ label, discipline });
    }
  });

  test("the inks are the template's", () => {
    expect(catalogue).toContain(`graphite: "${GRAPHITE}"`);
    expect(read("colour.ts")).toMatch(new RegExp(`RED_PEN = "${RED_PEN}"`));
  });
});
