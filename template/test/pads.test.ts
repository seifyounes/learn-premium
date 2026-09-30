import { describe, expect, it } from "vitest";
import { course } from "../src/content/contract.ts";
import { CATALOGUE, INKS, PAD_KEYS, slotsOf } from "../src/pads/catalogue.ts";
import { contrast, fightsRedPen, oklchOf, RED_PEN, type Oklch } from "../src/pads/colour.ts";
import { buildPad, checkPad, fixPad, padStyle, resolvePad } from "../src/pads/pad.ts";

const HEX = /^#[0-9A-F]{6}$/;

describe("the pad catalogue", () => {
  it("ships DESIGN.md's seven starting pads, each with its default Discipline", () => {
    expect(PAD_KEYS).toEqual(["green", "bluegrey", "teal", "violet", "steel", "graphite", "indigo"]);
    expect(CATALOGUE.teal).toMatchObject({ discipline: "Heat transfer", sheet: "#DAEFED", print: "#035455" });
  });

  it.each(PAD_KEYS)("%s passes every contrast requirement as approved, so the auto-fix leaves it alone", (key) => {
    const pad = resolvePad(key);
    expect(pad.checks.filter((c) => !c.pass)).toEqual([]);
    expect(pad.checks).toHaveLength(18);
    expect(pad.changes).toEqual([]);
    expect(pad.slots).toEqual(slotsOf(CATALOGUE[key]));
  });

  it("measures the tightest pair on each pad as DESIGN.md records it: the red pen on the sheet", () => {
    const measured = (key: (typeof PAD_KEYS)[number]) =>
      resolvePad(key).checks.find((c) => c.requirement === "red-pen on sheet at least 4.5:1")?.measured;
    expect(measured("green")).toBe("4.73:1");
    expect(measured("bluegrey")).toBe("4.56:1");
  });
});

describe("a custom pad", () => {
  it("is built from any colour into a full slot set on the catalogue's geometry", () => {
    const pad = resolvePad("#7A3FB0");
    expect(pad.key).toBe("custom");
    for (const slot of ["desk", "sheet", "gridFine", "gridMajor", "print", "muted"] as const) {
      expect(pad.slots[slot], slot).toMatch(HEX);
    }
    expect(pad.slots.shadowTint).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(oklchOf(pad.slots.sheet)?.l).toBeCloseTo(93.6, 0);
    expect(oklchOf(pad.slots.print)?.l).toBeCloseTo(38.5, 0);
    expect(oklchOf(pad.slots.print)?.h).toBeCloseTo(oklchOf("#7A3FB0")?.h ?? 0, -1);
    expect(pad.checks.every((c) => c.pass)).toBe(true);
  });

  it("near the red pen's hue gets its print and grid greyed, and each change is listed with its reason", () => {
    const built = buildPad("#D2691E");
    const pad = resolvePad("#D2691E");
    const redHue = (slot: string) =>
      expect.stringMatching(new RegExp(`^${slot} at least 60° of hue from the red pen, or near-grey: was \\d+°$`));
    expect(pad.changes).toEqual([
      { slot: "grid-major", from: built.gridMajor, to: pad.slots.gridMajor, because: [redHue("grid-major")] },
      { slot: "print", from: built.print, to: pad.slots.print, because: [redHue("print")] },
    ]);
    expect(pad.checks.every((c) => c.pass)).toBe(true);
  });

  it.each(["#C0341D", "#D2691E", "#8B4513"])(
    "from %s draws nothing on the sheet the red pen could be taken for",
    (colour) => {
      const { slots } = resolvePad(colour);
      for (const slot of ["print", "muted", "gridFine", "gridMajor"] as const) {
        expect(fightsRedPen(oklchOf(slots[slot]) as Oklch), `${slot} ${slots[slot]}`).toBe(false);
      }
    },
  );

  it("is only a catalogue key or a #RRGGBB colour", () => {
    expect(() => resolvePad("orange")).toThrow(/neither a catalogue pad nor a colour/);
    expect(course.shape.pad.safeParse("#7a3fb0").success).toBe(true);
    expect(course.shape.pad.safeParse("indigo").success).toBe(true);
    for (const bad of ["orange", "#7A3FB", "rgb(1, 2, 3)"]) {
      expect(course.shape.pad.safeParse(bad).error?.issues[0]?.message, bad).toMatch(/catalogue pad .* or a colour/);
    }
  });
});

describe("the contrast auto-fix", () => {
  const bluegrey = slotsOf(CATALOGUE.bluegrey);

  it("lightens a sheet too dark for the red pen, never the red pen, and keeps the grid faint", () => {
    const pad = { ...bluegrey, sheet: "#D3DCE3" };
    expect(checkPad(pad).find((c) => c.requirement === "red-pen on sheet at least 4.5:1")?.pass).toBe(false);
    const { slots, changes } = fixPad(pad);
    expect(checkPad(slots).filter((c) => !c.pass)).toEqual([]);
    expect(contrast(RED_PEN, slots.sheet)).toBeGreaterThanOrEqual(4.5);
    expect(changes.map((c) => c.slot)).toContain("sheet");
    expect(changes.find((c) => c.slot === "sheet")?.because).toEqual([
      expect.stringMatching(/^red-pen on sheet at least 4\.5:1: was 4\.\d\d:1$/),
    ]);
  });

  it("darkens a print too light to read, and moves nothing else", () => {
    const { slots, changes } = fixPad({ ...bluegrey, print: "#6E8FAE" });
    expect(checkPad(slots).filter((c) => !c.pass)).toEqual([]);
    expect(changes.map((c) => c.slot)).toEqual(["print"]);
    expect({ ...slots, print: bluegrey.print }).toEqual(bluegrey);
  });

  it("darkens a desk that is lighter than the sheet", () => {
    const { changes } = fixPad({ ...bluegrey, desk: "#F2F6F8" });
    expect(changes).toEqual([
      expect.objectContaining({ slot: "desk", because: ["sheet lighter than desk: was 1.13:1 darker"] }),
    ]);
  });

  it("lightens a grid that competes with the text", () => {
    const { slots, changes } = fixPad({ ...bluegrey, gridFine: "#9FB3C2" });
    expect(changes.map((c) => c.slot)).toEqual(["grid-fine"]);
    expect(contrast(slots.gridFine, slots.sheet)).toBeLessThanOrEqual(1.5);
  });
});

describe("the red pen", () => {
  it("is #C0341D on every pad and no pad slot", () => {
    expect(INKS["red-pen"]).toBe("#C0341D");
    for (const value of [...PAD_KEYS, "#D2691E", "#7A3FB0"]) {
      const { slots } = resolvePad(value);
      expect(Object.keys(slots)).not.toContain("red-pen");
      expect(padStyle(slots)).not.toMatch(/red/);
    }
  });
});
