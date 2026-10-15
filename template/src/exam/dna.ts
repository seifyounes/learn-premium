// What a mock must look like, and what a paper's marks must add up to. Pure: the sitting gates
// check the content with it, and the Exam room page orders Revision by `examWeights`.
import type { AnnouncedFormat, Sheet } from "./paper.ts";

/** The question DNA of a sitting's past papers: its type mix and how often it asks in reverse. */
export interface QuestionDna {
  /** The mean number of questions of each type per paper. */
  types: Record<string, number>;
  /** The share of questions that give the result and ask for an input. */
  reverseRate: number;
}

type Shape = Pick<Sheet, "questions">;

const countTypes = (sheet: Shape) => {
  const counts = new Map<string, number>();
  for (const q of sheet.questions) counts.set(q.type, (counts.get(q.type) ?? 0) + 1);
  return counts;
};

/** The DNA of `papers`: the mean count per type over them, and reverse questions over all questions. */
export function questionDna(papers: readonly Shape[]): QuestionDna {
  const totals = new Map<string, number>();
  let questions = 0;
  let reverse = 0;
  for (const paper of papers) {
    for (const [type, n] of countTypes(paper)) totals.set(type, (totals.get(type) ?? 0) + n);
    questions += paper.questions.length;
    reverse += paper.questions.filter((q) => q.reverse).length;
  }
  return {
    types: Object.fromEntries([...totals].map(([type, n]) => [type, n / papers.length])),
    reverseRate: questions === 0 ? 0 : reverse / questions,
  };
}

const NOISE = 1e-9;

/** What a mock does against the DNA: a type count more than one from the past papers' mean, a type none has, too few reverse questions. */
export function dnaProblems(mock: Shape, dna: QuestionDna): string[] {
  const problems: string[] = [];
  const counts = countTypes(mock);
  for (const type of [...new Set([...Object.keys(dna.types), ...counts.keys()])].sort()) {
    const count = counts.get(type) ?? 0;
    const mean = dna.types[type];
    if (mean === undefined) {
      problems.push(`the mock asks ${count} ${type} question${count === 1 ? "" : "s"}, a type no past paper has`);
    } else if (Math.abs(count - mean) > 1 + NOISE) {
      problems.push(
        `the mock asks ${count} ${type} questions; the past papers average ${round(mean)}, and a mock may differ by 1`,
      );
    }
  }
  const rate = mock.questions.length === 0 ? 0 : mock.questions.filter((q) => q.reverse).length / mock.questions.length;
  if (rate < dna.reverseRate - NOISE)
    problems.push(
      `the mock's rate of reverse questions is ${round(rate)}, below the past papers' ${round(dna.reverseRate)}`,
    );
  return problems;
}

const round = (n: number) => String(Math.round(n * 100) / 100);

/** What a mock does against the announced format: slot by slot, in order, then the total and the time. */
export function formatProblems(mock: Shape & Pick<Sheet, "marks" | "minutes">, format: AnnouncedFormat): string[] {
  const problems: string[] = [];
  const asked = mock.questions.length;
  if (asked !== format.slots.length)
    problems.push(
      `the mock has ${asked} question${asked === 1 ? "" : "s"}; the format announces ${format.slots.length}`,
    );
  format.slots.forEach((slot, i) => {
    const q = mock.questions[i];
    if (!q) return;
    if (q.type !== slot.type)
      problems.push(`slot ${i + 1}: the mock asks a ${q.type} question; the format says ${slot.type}`);
    if (q.marks !== slot.marks)
      problems.push(`slot ${i + 1}: the mock gives ${q.marks} marks; the format says ${slot.marks} marks`);
    if (slot.reverse !== undefined && q.reverse !== slot.reverse)
      problems.push(`slot ${i + 1}: the mock's reverse is ${q.reverse}; the format says ${slot.reverse}`);
  });
  const announced = format.slots.reduce((sum, s) => sum + s.marks, 0);
  const total = mock.questions.reduce((sum, q) => sum + q.marks, 0);
  if (total !== announced)
    problems.push(`the mock's questions carry ${total} marks; the format's slots carry ${announced}`);
  if (mock.minutes !== format.minutes)
    problems.push(`the mock gives ${mock.minutes} minutes; the format announces ${format.minutes} minutes`);
  return problems;
}

/** Whether a paper's or a mock's marks add up: the questions to the printed total, a written answer's points to its marks. */
export function marksProblems(sheet: Shape & Pick<Sheet, "marks">): string[] {
  const problems: string[] = [];
  const total = sheet.questions.reduce((sum, q) => sum + q.marks, 0);
  if (total !== sheet.marks)
    problems.push(`the questions carry ${total} marks, but the paper prints a total of ${sheet.marks}`);
  sheet.questions.forEach((q, i) => {
    if (q.answer.kind === "prose" && q.answer.earns.length !== q.marks) {
      const points = q.answer.earns.length;
      problems.push(
        `question ${i + 1} is worth ${q.marks} marks, but its answer lists ${points} point${points === 1 ? "" : "s"} to earn`,
      );
    }
  });
  return problems;
}

/**
 * Exam weight: the marks each of the sitting's Modules has over its past papers, heaviest first;
 * ties, and Modules no question examines, in Module order.
 */
export function examWeights(
  sitting: { modules: readonly string[] },
  papers: readonly { questions: readonly { module: string; marks: number }[] }[],
): { module: string; marks: number }[] {
  const marks = new Map(sitting.modules.map((module) => [module, 0]));
  for (const paper of papers)
    for (const q of paper.questions) if (marks.has(q.module)) marks.set(q.module, (marks.get(q.module) ?? 0) + q.marks);
  return [...marks]
    .map(([module, total]) => ({ module, marks: total }))
    .sort((a, b) => b.marks - a.marks || a.module.localeCompare(b.module));
}
