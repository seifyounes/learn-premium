// Scoring a paper: what the site checks, what the student marks, and how the result reads.
import { describe, expect, it } from "vitest";
import { formatClock, paperScore, resultLabel, type Mark } from "../src/exam/score.ts";

const numeric = (marks: number, correct: boolean): Mark => ({ kind: "numeric", marks, correct });
const prose = (marks: number, got: number | null): Mark => ({ kind: "prose", marks, got });

describe("paperScore", () => {
  it("adds the checked and the self-marked marks once every written answer is marked", () => {
    const score = paperScore([numeric(4, true), numeric(4, false), prose(2, 1)]);
    expect(score.checked).toEqual({ got: 4, of: 8 });
    expect(score.self).toEqual({ got: 1, of: 2, pending: 0 });
    expect(score.total).toEqual({ got: 5, of: 10 });
  });

  it("has no total while a written answer is unmarked", () => {
    const score = paperScore([numeric(4, true), prose(2, null), prose(4, 3)]);
    expect(score.self).toEqual({ got: 3, of: 6, pending: 1 });
    expect(score.total).toBeNull();
  });
});

describe("a written paper's label", () => {
  it("says Sat, mark it yourself for every all-prose score, and never a 0/0", () => {
    for (const marks of [[prose(6, null), prose(4, null)], [prose(10, null)], [prose(6, 2), prose(4, null)]]) {
      const label = resultLabel(paperScore(marks));
      expect(label).toMatch(/^Sat, mark it yourself/);
      expect(label).not.toMatch(/\b0\s*\/\s*0\b/);
    }
  });

  it("counts what is auto-checked and what is left to mark", () => {
    expect(resultLabel(paperScore([numeric(4, true), numeric(4, true), numeric(1, false), prose(2, null)]))).toBe(
      "8 / 9 auto-checked · mark 1 yourself",
    );
  });

  it("is the total once everything is marked", () => {
    expect(resultLabel(paperScore([numeric(4, true), prose(2, 2)]))).toBe("6 / 6");
    expect(resultLabel(paperScore([prose(6, 0), prose(4, 0)]))).toBe("0 / 10");
  });
});

describe("formatClock", () => {
  it("counts down in minutes and seconds", () => {
    expect(formatClock(1800)).toBe("30:00");
    expect(formatClock(59.2)).toBe("01:00");
    expect(formatClock(61)).toBe("01:01");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-3)).toBe("00:00");
    expect(formatClock(7200)).toBe("120:00");
  });
});
