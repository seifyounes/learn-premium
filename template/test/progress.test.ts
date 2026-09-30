import { describe, expect, it } from "vitest";
import {
  doneSections,
  emptyProgress,
  markSummaryRead,
  markWatched,
  parseProgress,
  recordPractice,
  recordStep,
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
    expect(p.modules[M]?.worked?.["W01.1"]).toEqual({ furthest: 4, steps: 6 });
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

  it("starts afresh on nothing stored, bad JSON or another version", () => {
    for (const stored of [null, "", "{not json", '{"version":0,"modules":{}}', "[]", '"x"']) {
      expect(parseProgress(stored), String(stored)).toEqual(emptyProgress());
    }
  });
});
