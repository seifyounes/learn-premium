// The Exam room's pure logic over the Fixture Course's midterm: a past paper's question DNA, what a
// mock may differ by, the announced format's exact match, marks that sum, and exam weight.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { announcedFormat, mock as mockSchema, paper as paperSchema } from "../src/content/contract.ts";
import { readStructured } from "../src/content/loaders.ts";
import { dnaProblems, examWeights, formatProblems, marksProblems, questionDna } from "../src/exam/dna.ts";
import type { AnnouncedFormat, Mock, Paper } from "../src/exam/paper.ts";
import { FIXTURE_COURSE } from "./build-course";

const read = (file: string) =>
  readStructured(readFileSync(join(FIXTURE_COURSE, "sittings/midterm", file), "utf8"), file, () => {});
const past: Paper = paperSchema.parse(read("papers/2025.yaml"));
const mock1: Mock = mockSchema.parse(read("mocks/mock-1.yaml"));
const announced: Mock = mockSchema.parse(read("mocks/announced.yaml"));
const format: AnnouncedFormat = announcedFormat.parse(read("format.yaml"));

const withQuestions = (m: Mock, change: (q: Mock["questions"]) => Mock["questions"]): Mock => ({
  ...m,
  questions: change(m.questions),
});
const first = <T>(list: readonly T[]): T => {
  const [item] = list;
  if (item === undefined) throw new Error("empty list");
  return item;
};

describe("question DNA", () => {
  it("midterm's mock-1 matches 2025's DNA", () => {
    const dna = questionDna([past]);
    expect(dna.types).toEqual({ calculation: 2, explain: 1 });
    expect(dna.reverseRate).toBeCloseTo(1 / 3);
    expect(dnaProblems(mock1, dna)).toEqual([]);
  });

  it("is the mean count per type over several papers", () => {
    const other: Paper = { ...past, questions: past.questions.filter((q) => q.type === "calculation") };
    expect(questionDna([past, other]).types).toEqual({ calculation: 2, explain: 0.5 });
  });

  it("blocks a mock two over a type's mean, and passes one over", () => {
    const dna = questionDna([past]);
    const extra = mock1.questions[1] ?? first(mock1.questions);
    const plusOne = withQuestions(mock1, (q) => [...q, extra]);
    const plusTwo = withQuestions(mock1, (q) => [...q, extra, extra]);
    expect(dnaProblems(plusOne, dna)).toEqual([]);
    expect(dnaProblems(plusTwo, dna).join("\n")).toMatch(/calculation/);
  });

  it("blocks a type no past paper has", () => {
    const dna = questionDna([past]);
    const foreign = withQuestions(mock1, (q) => [...q, { ...first(q), type: "diagram" }]);
    expect(dnaProblems(foreign, dna).join("\n")).toMatch(/diagram.*no past paper/);
  });

  it("blocks a mock whose rate of reverse questions is below the past papers'", () => {
    const dna = questionDna([past]);
    const none = withQuestions(mock1, (q) => q.map((x) => ({ ...x, reverse: false })));
    expect(dnaProblems(none, dna).join("\n")).toMatch(/reverse/);
  });
});

describe("the announced format", () => {
  it("matches midterm's announced mock exactly", () => {
    expect(formatProblems(announced, format)).toEqual([]);
  });

  it("blocks one slot's marks changed", () => {
    const changed = withQuestions(announced, (q) => q.map((x, i) => (i === 1 ? { ...x, marks: 5 } : x)));
    expect(formatProblems({ ...changed, marks: 11 }, format).join("\n")).toMatch(/slot 2.*marks/);
  });

  it("blocks slots out of order", () => {
    const swapped = withQuestions(announced, (q) => [...q].reverse());
    expect(formatProblems(swapped, format).join("\n")).toMatch(/slot 1/);
  });

  it("blocks a different number of questions and a different time", () => {
    const short = withQuestions(announced, (q) => q.slice(0, 1));
    expect(formatProblems(short, format).join("\n")).toMatch(/1 question/);
    expect(formatProblems({ ...announced, minutes: 25 }, format).join("\n")).toMatch(/minutes/);
  });

  it("holds a slot's reverse flag when it gives one", () => {
    const strict: AnnouncedFormat = {
      ...format,
      slots: format.slots.map((s, i) => (i === 0 ? { ...s, reverse: true } : s)),
    };
    expect(formatProblems(announced, strict).join("\n")).toMatch(/slot 1.*reverse/);
  });
});

describe("marksProblems", () => {
  it("passes the Fixture's paper and mocks", () => {
    for (const sheet of [past, mock1, announced]) expect(marksProblems(sheet)).toEqual([]);
  });

  it("blocks questions whose marks don't sum to the paper's total", () => {
    expect(marksProblems({ ...past, marks: 11 }).join("\n")).toMatch(/10.*11/);
  });

  it("blocks a prose answer whose earns don't number its marks", () => {
    const short = {
      ...past,
      questions: past.questions.map((q) =>
        q.answer.kind === "prose" ? { ...q, answer: { ...q.answer, earns: q.answer.earns.slice(0, 1) } } : q,
      ),
    };
    expect(marksProblems(short).join("\n")).toMatch(/question 3.*2 marks.*1 point/);
  });
});

describe("exam weight", () => {
  it("is the marks each Module has over the past papers, heaviest first, ties in Module order", () => {
    const sitting = { modules: ["01-a", "02-b", "03-c"] };
    const q = (module: string, marks: number) => ({ module, marks });
    expect(examWeights(sitting, [{ questions: [q("03-c", 5), q("02-b", 2), q("03-c", 1)] }])).toEqual([
      { module: "03-c", marks: 6 },
      { module: "02-b", marks: 2 },
      { module: "01-a", marks: 0 },
    ]);
    expect(examWeights(sitting, [{ questions: [q("02-b", 2), q("03-c", 2)] }]).map((w) => w.module)).toEqual([
      "02-b",
      "03-c",
      "01-a",
    ]);
  });

  it("keeps Module order when there are no past papers", () => {
    expect(examWeights({ modules: ["02-b", "01-a"] }, []).map((w) => w.module)).toEqual(["01-a", "02-b"]);
  });
});
