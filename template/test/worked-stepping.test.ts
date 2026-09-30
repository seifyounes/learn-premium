import { describe, expect, it } from "vitest";
import { plantedExample } from "../gates/teaching.ts";
import { worked } from "../src/content/contract.ts";
import { toSheet } from "../src/worked/sheet.ts";
import { shownAt, startStepping, stepping, type Stepping, type SteppingAction } from "../src/worked/stepping.ts";

// Three steps: read the question (writes nothing), then two that write a value each.
const example = plantedExample() as { artefact: { rows: string[][] }; steps: object[] };
example.artefact.rows = [
  ["1", "2"],
  ["2", "4"],
];
example.steps.push({ title: "Again", note: "$y = 4$.", fill: ["B2"] });
const sheet = toSheet(worked.parse(example), (prose) => prose);

const run = (...actions: SteppingAction[]) =>
  actions.reduce<Stepping>((s, a) => stepping(sheet, s, a), startStepping(sheet));
const shown = (s: Stepping, reducedMotion = false) => shownAt(sheet, s, reducedMotion);

describe("stepping through a sheet", () => {
  it("opens on the question, drawn at once, with the phone on the question figure", () => {
    const s = run();
    expect(s.step).toBe(0);
    expect(shown(s).animate).toBe(false);
    expect(s.tab).toBe("figure");
  });

  it("draws a step's changes going forward and renders at once going back", () => {
    const forward = run({ type: "onward" }, { type: "onward" });
    expect(forward.step).toBe(2);
    expect(shown(forward).animate).toBe(true);
    const back = stepping(sheet, forward, { type: "go", to: 1 });
    expect(shown(back)).toMatchObject({ animate: false, epoch: forward.epoch + 1 });
    expect([...shown(back).state.written]).toEqual(["B1"]);
  });

  it("renders every change at once under reduced motion", () => {
    expect(shown(run({ type: "onward" }), true).animate).toBe(false);
  });

  it("stays put at either end", () => {
    const end = run({ type: "go", to: 2 });
    expect(stepping(sheet, end, { type: "onward" })).toBe(end);
    expect(stepping(sheet, run(), { type: "go", to: -1 }).step).toBe(0);
  });

  it("in try-first, holds a step's values back until the student asks for them", () => {
    const tried = run({ type: "toggle-try-first" }, { type: "onward" });
    expect(tried.step).toBe(1);
    expect(shown(tried).hidden).toBe(true);
    const revealed = stepping(sheet, tried, { type: "onward" });
    expect(revealed.step).toBe(1);
    expect(shown(revealed)).toMatchObject({ hidden: false, animate: true });
    expect(stepping(sheet, revealed, { type: "onward" }).step).toBe(2);
  });

  it("in try-first, doesn't hold back a first step that only reads the question", () => {
    expect(shown(run({ type: "toggle-try-first" })).hidden).toBe(false);
  });

  it("in try-first, shows the steps passed over as worked", () => {
    const jumped = run({ type: "toggle-try-first" }, { type: "go", to: 2 });
    expect(shown(jumped).hidden).toBe(true);
    expect(shown(stepping(sheet, jumped, { type: "go", to: 1 })).hidden).toBe(false);
  });

  it("points the phone's region at the work, until the student picks a tab", () => {
    expect(run({ type: "onward" }).tab).toBe("table");
    const picked = run({ type: "pick-tab", tab: "figure" }, { type: "onward" });
    expect(picked.tab).toBe("figure");
  });
});
