import { describe, expect, it } from "vitest";
import {
  doneSections,
  emptyProgress,
  markSummaryRead,
  markPlace,
  markWatched,
  mastery,
  parseProgress,
  placeHref,
  placeLabel,
  readiness,
  recordPractice,
  recordStep,
  type MasteryShape,
} from "../src/progress/progress.ts";

const M = "01-thermal-resistance";
const page = { worked: ["W01.1", "W01.2"], practice: ["1", "2"] };

describe("a Module's progress", () => {
  it("starts with nothing done", () => {
    expect([...doneSections(emptyProgress().modules[M], page)]).toEqual([]);
  });

  it("marks Watch and Summary done once seen", () => {
    const p = markSummaryRead(markWatched(emptyProgress(), M), M);
    expect([...doneSections(p.modules[M], page)]).toEqual(["watch", "summary"]);
  });

  it("marks Worked examples done when every example reached its last step", () => {
    let p = recordStep(emptyProgress(), M, "W01.1", 5, 6);
    expect(doneSections(p.modules[M], page).has("worked")).toBe(false);
    p = recordStep(p, M, "W01.2", 2, 3);
    expect(doneSections(p.modules[M], page).has("worked")).toBe(true);
  });

  it("keeps the furthest step reached when the student goes back", () => {
    const p = recordStep(recordStep(emptyProgress(), M, "W01.1", 4, 6), M, "W01.1", 1, 6);
    expect(p.modules[M]?.worked?.["W01.1"]).toMatchObject({ furthest: 4, steps: 6 });
  });

  it("marks Practice done when every item has been checked or self-marked", () => {
    let p = recordPractice(emptyProgress(), M, "1", { kind: "numeric", correct: false });
    expect(doneSections(p.modules[M], page).has("practice")).toBe(false);
    p = recordPractice(p, M, "2", { kind: "prose", marks: 1, of: 3 });
    expect(doneSections(p.modules[M], page).has("practice")).toBe(true);
    expect(p.modules[M]?.practice).toEqual({
      "1": { kind: "numeric", correct: false },
      "2": { kind: "prose", marks: 1, of: 3 },
    });
  });

  it("never marks a section with nothing in it done", () => {
    const p = recordStep(emptyProgress(), M, "W01.1", 5, 6);
    expect(doneSections(p.modules[M], { worked: [], practice: [] }).has("worked")).toBe(false);
  });

  it("leaves the progress it was given untouched", () => {
    const before = emptyProgress();
    markWatched(before, M);
    expect(before).toEqual(emptyProgress());
  });
});

describe("reading stored progress", () => {
  it("round-trips through JSON", () => {
    const p = recordPractice(recordStep(markWatched(emptyProgress(), M), M, "W01.1", 2, 6), M, "1", {
      kind: "numeric",
      correct: true,
    });
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
  });

  it("keeps where the student was", () => {
    const p = markPlace(emptyProgress(), { module: M, kind: "worked", code: "W01.1", step: 3, steps: 6 });
    expect(parseProgress(JSON.stringify(p)).last).toEqual(p.last);
  });

  it("starts afresh on nothing stored, bad JSON or another version", () => {
    for (const stored of [null, "", "{not json", '{"version":0,"modules":{}}', "[]", '"x"']) {
      expect(parseProgress(stored), String(stored)).toEqual(emptyProgress());
    }
  });
});

// Mastery (CONTEXT.md): 60% Practice + 40% Worked examples. A Practice item counts 1 when right
// (prose: its marks out of its points); a Worked step counts 1 when read and 1 more when worked
// try-first, out of 2.
const shape: MasteryShape = {
  worked: [
    { code: "W01.1", steps: 4 },
    { code: "W01.2", steps: 1 },
  ],
  practice: ["1", "2"],
};

describe("a Module's Mastery", () => {
  it("is nothing before the student starts", () => {
    expect(mastery(undefined, shape)).toBe(0);
    expect(mastery(emptyProgress().modules[M], shape)).toBe(0);
  });

  it("weights Practice most", () => {
    const p = recordPractice(recordPractice(emptyProgress(), M, "1", { kind: "numeric", correct: true }), M, "2", {
      kind: "prose",
      marks: 2,
      of: 4,
    });
    expect(mastery(p.modules[M], shape)).toBeCloseTo(0.6 * 0.75);
  });

  it("counts a wrong answer as practice not yet mastered", () => {
    const p = recordPractice(emptyProgress(), M, "1", { kind: "numeric", correct: false });
    expect(mastery(p.modules[M], shape)).toBe(0);
  });

  it("counts each step read, and each step worked try-first twice", () => {
    let p = emptyProgress();
    for (let step = 0; step < 4; step++) p = recordStep(p, M, "W01.1", step, 4);
    p = recordStep(p, M, "W01.2", 0, 1);
    // Read through: half the Worked share.
    expect(mastery(p.modules[M], shape)).toBeCloseTo(0.4 * 0.5);
    for (let step = 0; step < 4; step++) p = recordStep(p, M, "W01.1", step, 4, true);
    p = recordStep(p, M, "W01.2", 0, 1, true);
    expect(mastery(p.modules[M], shape)).toBeCloseTo(0.4);
  });

  it("counts only the steps the student has been on", () => {
    // Jumping straight to the last step reads one step of four.
    const p = recordStep(emptyProgress(), M, "W01.1", 3, 4);
    expect(mastery(p.modules[M], { worked: [{ code: "W01.1", steps: 4 }], practice: [] })).toBeCloseTo(1 / 8);
  });

  it("counts a part in full when the Module has no other", () => {
    const p = recordPractice(emptyProgress(), M, "1", { kind: "numeric", correct: true });
    expect(mastery(p.modules[M], { worked: [], practice: ["1"] })).toBe(1);
    expect(mastery(p.modules[M], { worked: [], practice: [] })).toBeUndefined();
  });

  it("reads steps stored before the steps read were kept as every step up to the furthest", () => {
    const stored = { version: 1, modules: { [M]: { worked: { "W01.1": { furthest: 1, steps: 4 } } } } };
    const p = parseProgress(JSON.stringify(stored));
    expect(mastery(p.modules[M], { worked: [{ code: "W01.1", steps: 4 }], practice: [] })).toBeCloseTo(2 / 8);
  });
});

describe("a sitting's readiness", () => {
  it("is the average Mastery of its Modules", () => {
    expect(readiness([1, 0.5, 0])).toBeCloseTo(0.5);
  });

  it("leaves out a Module with nothing to master, and is nothing without any", () => {
    expect(readiness([0.8, undefined])).toBeCloseTo(0.8);
    expect(readiness([undefined])).toBeUndefined();
    expect(readiness([])).toBeUndefined();
  });
});

describe("where the student stopped", () => {
  it("names a Worked example's step, counted from 1", () => {
    const place = { module: M, kind: "worked", code: "W01.1", step: 3, steps: 6 } as const;
    expect(placeLabel(place)).toBe("W01.1, step 4 of 6");
    expect(placeHref(place)).toBe(`/${M}/#worked-W01.1`);
  });

  it("names a Practice item", () => {
    const place = { module: M, kind: "practice", item: "2" } as const;
    expect(placeLabel(place)).toBe("Practice 2");
    expect(placeHref(place)).toBe(`/${M}/#practice-2`);
  });

  it("is the last place marked", () => {
    let p = markPlace(emptyProgress(), { module: M, kind: "practice", item: "1" });
    p = markPlace(p, { module: "02-convection", kind: "practice", item: "3" });
    expect(p.last).toEqual({ module: "02-convection", kind: "practice", item: "3" });
  });
});
