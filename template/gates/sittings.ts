// The sitting gates, per Exam sitting (the `sitting` gate point), on the sitting's preview. They
// check what a Sitting wave builds: its past papers (the numbers three ways, the marks, the key), its
// mocks (the question DNA, the announced format, the marks, the recompute) and its pages (Revision
// holds only what the sitting's Modules ship, in exam-weight order; the Exam room has its pages).
// With no `sitting` in the input they check every complete sitting. A sitting with no past papers
// has Revision only: papers' gates then have nothing to check, and mocks or a format without a
// paper block.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";
import {
  announcedFormat as formatSchema,
  course as courseSchema,
  mock as mockSchema,
  MODULE_ID,
  paper as paperSchema,
} from "../src/content/contract.ts";
import { readStructured } from "../src/content/loaders.ts";
import { dnaProblems, examWeights, formatProblems, marksProblems, questionDna } from "../src/exam/dna.ts";
import type { AnnouncedFormat, Mock, Paper } from "../src/exam/paper.ts";
import { agreesAtPrint, printAt, readPrinted, rulingValues, type Printed } from "../src/sims/precision.ts";
import { courseCopy, filesIn } from "./course-files.ts";
import { copySite, textIn } from "./pages.ts";
import type { Finding, Gate, GateInput, GateRun } from "./runner.ts";
import { rulingsIn, type ContentRuling } from "./rulings.ts";
import { problems } from "./sims.ts";
import { fromHtml } from "hast-util-from-html";
import type { Element, Nodes } from "hast";

export const PAPER_RECOMPUTE_LOG = "learn-premium paper recompute v1";

/** What the independent recompute leaves in the Course's build records for one paper or mock. */
const paperRecomputeLog = z.strictObject({
  recompute: z.literal(PAPER_RECOMPUTE_LOG),
  /** Who or what recomputed it, and how. */
  by: z.string().min(1),
  /** Every numeric question's answer, by its number (`"1"`). */
  answers: z.record(z.string().regex(/^[1-9]\d*$/, "a question number"), z.number()),
});

/** Where the independent recompute logs one paper or mock of a sitting. */
export const paperLogEntry = (sitting: string, name: string) =>
  `build-records/recompute/sittings/${sitting}/${name}.json`;

const ignoreMath = () => {};
const PATTERN = (sitting: string, folder: string) => `sittings/${sitting}/${folder}/*.{json,yaml,yml}`;
const nameOf = (entry: string) => /([^/]+?)\.(?:json|ya?ml)$/.exec(entry)?.[1] ?? entry;

/** The content's own words for how one entry reads, or why it can't be read. */
function readEntry<T>(contentDir: string, entry: string, schema: z.ZodType<T>): { data: T } | { problem: string } {
  let raw: Record<string, unknown>;
  try {
    raw = readStructured(readFileSync(join(contentDir, entry), "utf8"), entry, ignoreMath);
  } catch (error) {
    return { problem: `can't read the file: ${(error as Error).message}` };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { problem: `the content contract reports ${problems(parsed.error)}` };
}

interface Sitting {
  id: string;
  modules: string[];
  complete: boolean;
}

/** The sittings the gate checks: the one named, or every complete sitting. */
export function sittingsInScope({ contentDir, sitting }: GateInput): Sitting[] {
  const path = join(contentDir, "course.yaml");
  const course = courseSchema.parse(readStructured(readFileSync(path, "utf8"), "course.yaml", ignoreMath));
  if (sitting === undefined) return course.sittings.filter((s) => s.complete);
  const found = course.sittings.find((s) => s.id === sitting);
  if (!found) throw new Error(`course.yaml has no sitting "${sitting}"`);
  return [found];
}

interface Loaded<T> {
  entry: string;
  name: string;
  data: T;
}

/** A sitting's files of one kind, read; a file that can't be is a finding and left out. */
function load<T>(
  input: GateInput,
  pattern: string,
  schema: z.ZodType<T>,
  block: (message: string, at: string) => void,
  what: string,
): Loaded<T>[] {
  const loaded: Loaded<T>[] = [];
  for (const file of filesIn(input.contentDir, pattern, () => true)) {
    const read = readEntry(input.contentDir, file.entry, schema);
    if ("problem" in read) block(`can't check the ${what}: ${read.problem}`, file.entry);
    else loaded.push({ entry: file.entry, name: nameOf(file.entry), data: read.data });
  }
  return loaded;
}

/** How many rulings name each magnitude, and one used up at a time: each ruling covers one question. */
const countsOf = (written: readonly string[]) => {
  const counts = new Map<number, number>();
  for (const n of written.flatMap(rulingValues)) counts.set(n, (counts.get(n) ?? 0) + 1);
  return counts;
};
const take = (counts: Map<number, number>, value: number) => {
  const remaining = counts.get(value) ?? 0;
  if (remaining === 0) return false;
  counts.set(value, remaining - 1);
  return true;
};

/** A paper's or mock's recompute log: its answers by question number, or the finding that says why not. */
function recomputeOf(
  input: GateInput,
  sitting: string,
  name: string,
  numeric: number[],
  block: (message: string, at?: string) => void,
): Record<string, number> | undefined {
  const entry = paperLogEntry(sitting, name);
  const path = join(input.contentDir, entry);
  if (!existsSync(path)) {
    block(
      `no recompute log at ${entry}: every numeric answer is checked against an independent recompute${numeric.length === 0 ? "" : ` (questions ${numeric.join(", ")})`}`,
    );
    return undefined;
  }
  let log;
  try {
    log = paperRecomputeLog.safeParse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    block(`can't read the recompute log ${entry}: ${(error as Error).message}`);
    return undefined;
  }
  if (!log.success) {
    block(`the recompute log ${entry} isn't one: ${problems(log.error)}`);
    return undefined;
  }
  const { answers } = log.data;
  for (const n of Object.keys(answers))
    if (!numeric.includes(Number(n)))
      block(`the recompute log ${entry} gives question ${n}, which isn't a numeric question`);
  const missing = numeric.filter((n) => answers[String(n)] === undefined);
  if (missing.length > 0)
    block(
      `the recompute log ${entry} doesn't give question${missing.length === 1 ? "" : "s"} ${missing.join(", ")}: the recompute works out every numeric answer`,
    );
  return answers;
}

const numericQuestions = (sheet: Paper | Mock) =>
  sheet.questions.flatMap((q, i) => (q.answer.kind === "numeric" ? [i + 1] : []));

/**
 * The answers of a key-less paper as the Owner is asked to confirm them: a short digest of every
 * answer in full (value, unit and tolerance; model answer and each point it earns), so a change to
 * any of them asks him again.
 */
const answersDigest = (paper: Paper) =>
  createHash("sha256")
    .update(JSON.stringify(paper.questions.map((q, i) => [i + 1, q.marks, q.answer])))
    .digest("hex")
    .slice(0, 10);

const asPrinted = (value: number, decimals: number): Printed => ({ value, decimals, written: String(value) });

async function runPapers(input: GateInput): Promise<GateRun> {
  const sittings = sittingsInScope(input);
  const coverage = { sittings: sittings.length, papers: 0, questions: 0, values: 0 };
  const findings: Finding[] = [];
  for (const sitting of sittings) {
    const papers = load(
      input,
      PATTERN(sitting.id, "papers"),
      paperSchema,
      (message, at) => findings.push({ outcome: "block", at, message }),
      "past paper",
    );
    for (const { entry, name, data: paper } of papers) {
      coverage.papers += 1;
      coverage.questions += paper.questions.length;
      const block = (message: string, at = entry) => findings.push({ outcome: "block", at, message });
      for (const problem of marksProblems(paper)) block(problem);
      const numeric = numericQuestions(paper);
      const answers = recomputeOf(input, sitting.id, name, numeric, block);
      const divergences = countsOf(paper.provenance.divergences.map((d) => d.value));
      const slips = countsOf(paper.provenance.slips.map((s) => s.sheet));
      paper.questions.forEach((q, i) => {
        const n = i + 1;
        if (q.answer.kind !== "numeric") return;
        const recomputed = answers?.[String(n)];
        const { value: answer, tolerance, key } = q.answer;
        if (paper.key === "solved") {
          if (recomputed === undefined) return;
          coverage.values += 1;
          if (Math.abs(answer - recomputed) > tolerance + 1e-9 * Math.max(1, Math.abs(recomputed)))
            block(
              `question ${n}'s answer ${answer} and the independent recompute ${recomputed} differ by more than its tolerance ${tolerance}`,
            );
          return;
        }
        if (key === undefined) {
          block(
            `question ${n}'s numeric answer carries no key: a Professor's paper prints a key for every numeric answer`,
          );
          return;
        }
        const printed = readPrinted(key);
        if (typeof printed === "string") {
          block(`question ${n}'s key can't be compared with the recompute: ${printed}`);
          return;
        }
        if (recomputed === undefined) return;
        coverage.values += 1;
        // Three ways at the key's printed precision: the content's answer, the Professor's key, the recompute.
        const ofAnswer = asPrinted(answer, printed.decimals);
        const answerIsRecompute = agreesAtPrint(recomputed, ofAnswer);
        const answerIsKey = agreesAtPrint(answer, printed);
        const recomputeIsKey = agreesAtPrint(recomputed, printed);
        const computed = printAt(recomputed, printed.decimals).replace("−", "-");
        if (answerIsKey && recomputeIsKey && answerIsRecompute) return;
        if (answerIsKey && recomputeIsKey) {
          // Each within one unit of the key's last digit, but on opposite sides of it: the answer the
          // Exam room grades against and the recompute disagree with each other.
          block(
            `question ${n}'s answer ${answer} and the independent recompute ${computed} disagree with each other, though each is within a unit of the key ${printed.written}`,
          );
          return;
        }
        const ruling = (counts: Map<number, number>) => take(counts, Math.abs(printed.value));
        if (answerIsRecompute) {
          // The answer follows the recompute and the key prints something else: the Professor's call.
          if (ruling(slips)) return;
          if (ruling(divergences)) {
            block(
              `question ${n}'s key prints ${printed.written}, which the Owner ruled a Divergence: the site ships it as the answer, but the answer is ${answer}`,
            );
            return;
          }
          findings.push({
            outcome: "checkpoint",
            at: entry,
            message: `question ${n}'s key prints ${printed.written}, but the answer and the recompute give ${computed}: rule it a Slip or a Divergence`,
          });
          return;
        }
        if (answerIsKey) {
          // The answer follows the key and the recompute differs.
          if (ruling(divergences)) return;
          if (ruling(slips)) {
            block(
              `question ${n}'s key prints ${printed.written}, which the Owner ruled a Slip: the site ships the corrected value, ${computed}, but the answer is ${answer}`,
            );
            return;
          }
          findings.push({
            outcome: "checkpoint",
            at: entry,
            message: `question ${n}'s key prints ${printed.written} and the answer matches it, but the independent recompute gives ${computed}: rule it a Slip or a Divergence`,
          });
          return;
        }
        block(
          `question ${n}'s answer ${answer} matches neither the key ${printed.written} nor the independent recompute ${computed}`,
        );
      });
      if (paper.key === "solved") {
        findings.push({
          outcome: "checkpoint",
          at: entry,
          message: `no Professor key; its answers are the build's solution, recomputed independently. Confirm them (answers ${answersDigest(paper)})`,
        });
      }
    }
  }
  return { coverage, findings };
}

async function runMocks(input: GateInput): Promise<GateRun> {
  const sittings = sittingsInScope(input);
  const coverage = { sittings: sittings.length, papers: 0, mocks: 0, questions: 0, values: 0 };
  const findings: Finding[] = [];
  for (const sitting of sittings) {
    const where = `sittings/${sitting.id}`;
    const quiet = (message: string, at: string) => findings.push({ outcome: "block", at, message });
    const papers = load(input, PATTERN(sitting.id, "papers"), paperSchema, quiet, "past paper");
    const mocks = load(input, PATTERN(sitting.id, "mocks"), mockSchema, quiet, "mock");
    const formatFiles = filesIn(input.contentDir, `${where}/format.{json,yaml,yml}`, () => true);
    const formats = load(input, `${where}/format.{json,yaml,yml}`, formatSchema, quiet, "announced format");
    coverage.papers += papers.length;
    coverage.mocks += mocks.length;
    const at = mocks[0]?.entry ?? formatFiles[0]?.entry ?? where;
    const sitWith = (message: string, to = at) => findings.push({ outcome: "block", at: to, message });
    const format = formats[0]?.data;
    if (papers.length === 0) {
      if (mocks.length > 0 || formatFiles.length > 0)
        sitWith(
          `sitting "${sitting.id}" has no past papers: Revision only, so it has no mocks and no announced format`,
        );
      continue;
    }
    const announced = mocks.filter((m) => m.data.pattern === "announced");
    // A mock the contract rejected is already a finding; the counts below only judge the ones read.
    const allRead = mocks.length === filesIn(input.contentDir, PATTERN(sitting.id, "mocks"), () => true).length;
    if (allRead && !mocks.some((m) => m.data.pattern === "dna"))
      sitWith(
        `sitting "${sitting.id}" has past papers but no pattern-matched mock (pattern: dna): the Exam room needs at least one`,
        `${where}/mocks`,
      );
    if (allRead && formatFiles.length > 0 && announced.length !== 1)
      sitWith(
        `the Professor announced a format, so the sitting has exactly one announced mock; it has ${announced.length}`,
        formatFiles[0]?.entry,
      );
    if (allRead && formatFiles.length === 0 && announced.length > 0)
      sitWith(
        `the sitting has an announced mock but no format.yaml, the format the Owner confirmed it matches`,
        announced[0]?.entry,
      );
    const dna = questionDna(papers.map((p) => p.data));
    for (const { entry, name, data: mock } of mocks) {
      coverage.questions += mock.questions.length;
      const block = (message: string, to = entry) => findings.push({ outcome: "block", at: to, message });
      for (const problem of marksProblems(mock)) block(problem);
      if (mock.pattern === "dna") for (const problem of dnaProblems(mock, dna)) block(problem);
      else if (format !== undefined)
        for (const problem of formatProblems(mock, format as AnnouncedFormat)) block(problem);
      const answers = recomputeOf(input, sitting.id, name, numericQuestions(mock), block);
      mock.questions.forEach((q, i) => {
        const recomputed = answers?.[String(i + 1)];
        if (q.answer.kind !== "numeric" || recomputed === undefined) return;
        coverage.values += 1;
        const { value, tolerance } = q.answer;
        if (Math.abs(value - recomputed) > tolerance + 1e-9 * Math.max(1, Math.abs(recomputed)))
          block(
            `question ${i + 1}'s answer ${value} and the independent recompute ${recomputed} differ by more than its tolerance ${tolerance}`,
          );
      });
    }
  }
  return { coverage, findings };
}

/** The `Module NN` label Revision gives a Module's section. */
const moduleLabel = (id: string) => `Module ${MODULE_ID.exec(id)?.[1] ?? id}`;

const classesOf = (node: Element) => (node.properties.className as string[] | undefined) ?? [];

/** The aria-labels of a page's Module sections, in order. */
function moduleSections(html: string): string[] {
  const labels: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "element" && node.tagName === "section" && classesOf(node).includes("hub-module")) {
      const label = node.properties.ariaLabel;
      labels.push(typeof label === "string" ? label : textIn(node).slice(0, 20));
    }
    if (node.type === "element" || node.type === "root")
      node.children.forEach((child) => child.type === "element" && visit(child));
  };
  visit(fromHtml(html));
  return labels;
}

async function runShipped(input: GateInput): Promise<GateRun> {
  const distDir = input.distDir;
  if (distDir === undefined) throw new Error("no built site given to check (distDir)");
  if (!existsSync(distDir)) throw new Error(`the built site ${distDir} does not exist`);
  const sittings = sittingsInScope(input);
  const coverage = { sittings: sittings.length, pages: 0, sections: 0 };
  const findings: Finding[] = [];
  for (const sitting of sittings) {
    const block = (message: string, at: string) => findings.push({ outcome: "block", at, message });
    const papers = load(input, PATTERN(sitting.id, "papers"), paperSchema, () => {}, "past paper");
    const mocks = load(input, PATTERN(sitting.id, "mocks"), mockSchema, () => {}, "mock");
    // What Revision must hold: the sitting's Modules in exam-weight order, nothing the sitting doesn't cover.
    const expected = examWeights(
      sitting,
      papers.map((p) => p.data),
    ).map((w) => moduleLabel(w.module));
    const revision = `revision/${sitting.id}/index.html`;
    if (!existsSync(join(distDir, revision)))
      block(`the build has no Revision page for sitting "${sitting.id}"`, `/revision/${sitting.id}/`);
    else {
      coverage.pages += 1;
      const found = moduleSections(readFileSync(join(distDir, revision), "utf8"));
      coverage.sections += found.length;
      if (found.join("|") !== expected.join("|"))
        block(
          `Revision holds ${found.join(", ") || "no Module"}; the sitting's Modules in exam-weight order are ${expected.join(", ")}`,
          `/revision/${sitting.id}/`,
        );
    }
    const room = `exam/${sitting.id}/index.html`;
    const hasRoom = existsSync(join(distDir, room));
    if (papers.length === 0) {
      if (hasRoom)
        block(
          `the build has an Exam room for sitting "${sitting.id}", which has no past papers`,
          `/exam/${sitting.id}/`,
        );
      continue;
    }
    if (!hasRoom)
      block(`the build has no Exam room for sitting "${sitting.id}", which has past papers`, `/exam/${sitting.id}/`);
    else coverage.pages += 1;
    for (const { name } of [...papers, ...mocks]) {
      const page = `exam/${sitting.id}/${name}/index.html`;
      if (!existsSync(join(distDir, page))) block(`the build has no page for ${name}`, `/exam/${sitting.id}/${name}/`);
      else coverage.pages += 1;
    }
  }
  return { coverage, findings };
}

// Negative controls: each plants one defect in a scratch copy of the Course (or of its built site)
// and the gate must catch it. They throw when there is nothing to plant it in.

/** The first sitting the gate checks, for a control to plant in. */
const targetOf = (good: GateInput) => {
  const [first] = sittingsInScope(good);
  if (!first) throw new Error("no complete sitting to plant a negative control in");
  return first;
};

/** One change to one of the sitting's content files: its path from the sitting's id, and text in, text out. */
type Edit = [file: (id: string) => string, edit: (text: string) => string];

/** A scratch copy of the Course with every `edits` change made, to plant a defect in. */
function editFiles(good: GateInput, scratch: string, ...edits: Edit[]): GateInput {
  const copy = courseCopy(good, scratch);
  for (const [file, edit] of edits) {
    const path = join(copy.contentDir, file(targetOf(good).id));
    if (!existsSync(path)) throw new Error(`${path} isn't in the Course to plant a negative control in`);
    const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    const edited = edit(source);
    if (edited === source) throw new Error(`${path} had nothing to plant a negative control in`);
    writeFileSync(path, edited);
  }
  return copy;
}

/** A recompute log with its answers changed by `change`. */
const logEdit = (name: string, change: (answers: Record<string, number>) => Record<string, number>): Edit => [
  (id) => paperLogEntry(id, name),
  (text) => {
    const log = JSON.parse(text) as { answers: Record<string, number> };
    return JSON.stringify({ ...log, answers: change(log.answers) });
  },
];

/** A recompute log without question `n`'s answer. */
const without = (n: string) => (answers: Record<string, number>) =>
  Object.fromEntries(Object.entries(answers).filter(([q]) => q !== n));

/** A content file's text with `from` replaced by `to`. */
const swap = (file: (id: string) => string, from: string, to: string): Edit => [file, (s) => s.replace(from, to)];

const paperFile = (name: string) => (id: string) => `sittings/${id}/papers/${name}.yaml`;
const mockFile = (name: string) => (id: string) => `sittings/${id}/mocks/${name}.yaml`;
const formatFile = (id: string) => `sittings/${id}/format.yaml`;

// The Fixture's 2025 key for question 1 is 0.25: a key printed 0.30 is five units of its last digit
// off the answer and the recompute, past the one unit a hand may round either way.
const KEY = "key: '0.25'";
const OFF_KEY = "key: '0.30'";

export const pastPapers: Gate = {
  id: "past-papers",
  checks:
    "every past paper's numeric answers agree three ways (the content's answer, the Professor's printed key, an independent recompute) at the key's printed precision, its marks add up, and a key-less paper's solution waits for the Owner's confirmation",
  points: ["sitting"],
  run: runPapers,
  controls: [
    {
      defect: "an answer that neither the Professor's key nor the independent recompute gives",
      plant: (good, scratch) =>
        editFiles(good, scratch, swap(paperFile("2025"), "value: 0.25, unit: K/W", "value: 0.3, unit: K/W")),
    },
    {
      defect: "a key the answer and the recompute both disagree with, which only the Owner can rule",
      expect: "checkpoint",
      plant: (good, scratch) => editFiles(good, scratch, swap(paperFile("2025"), KEY, OFF_KEY)),
    },
    {
      defect: "a Divergence on the key, with the answer still the recompute's rather than the key's",
      plant: (good, scratch) =>
        editFiles(
          good,
          scratch,
          swap(paperFile("2025"), KEY, OFF_KEY),
          swap(
            paperFile("2025"),
            "questions:",
            "provenance:\n  divergences:\n    - { value: '0.30', note: 'The exam takes the key.' }\nquestions:",
          ),
        ),
    },
    {
      defect: "a paper with no Professor key, whose solution only the Owner can confirm",
      expect: "checkpoint",
      plant: (good, scratch) =>
        editFiles(good, scratch, [
          paperFile("2025"),
          (s) => s.replace("key: professor", "key: solved").replaceAll(/, key: '[^']*'/g, ""),
        ]),
    },
    {
      defect: "questions whose marks don't add up to the paper's printed total",
      plant: (good, scratch) =>
        editFiles(good, scratch, swap(paperFile("2025"), "marks: 10\nminutes: 30", "marks: 11\nminutes: 30")),
    },
    {
      defect: "a written answer listing fewer points than the question has marks",
      plant: (good, scratch) =>
        editFiles(
          good,
          scratch,
          swap(paperFile("2025"), "        - 'The same $\\dot{Q}$ crosses every layer in series.'\n", ""),
        ),
    },
    {
      defect: "a recompute log that leaves out a numeric question",
      plant: (good, scratch) => editFiles(good, scratch, logEdit("2025", without("2"))),
    },
  ],
};

/** The first question block of a mock's YAML, to repeat. */
const firstQuestion = (text: string) => /^ {2}- module: [\s\S]*?(?=^ {2}- module: )/m.exec(text)?.[0].trimEnd() ?? "";

export const mockDna: Gate = {
  id: "mock-dna",
  checks:
    "every mock's marks add up and its numeric answers agree with the independent recompute; a pattern-matched mock keeps the past papers' question DNA (type mix within one of each type's mean, no type they lack, reverse questions at least their rate) and the announced-format mock matches the format exactly",
  points: ["sitting"],
  run: runMocks,
  controls: [
    {
      defect: "a mock with two more calculation questions than the past papers' mix allows",
      plant: (good, scratch) =>
        editFiles(
          good,
          scratch,
          [
            mockFile("mock-1"),
            (s) =>
              `${s.trimEnd()}\n${firstQuestion(s)}\n${firstQuestion(s)}\n`.replace(
                "marks: 10\nminutes: 30",
                "marks: 18\nminutes: 30",
              ),
          ],
          // The new questions are numeric, so their answers are in the recompute too.
          [
            (id) => paperLogEntry(id, "mock-1"),
            (text) => {
              const log = JSON.parse(text) as { answers: Record<string, number> };
              return JSON.stringify({ ...log, answers: { ...log.answers, "4": 0.5, "5": 0.5 } });
            },
          ],
        ),
    },
    {
      defect: "a mock with a question type no past paper has",
      plant: (good, scratch) => editFiles(good, scratch, swap(mockFile("mock-1"), "type: explain", "type: diagram")),
    },
    {
      defect: "a mock that asks no reverse question, below the past papers' rate",
      plant: (good, scratch) => editFiles(good, scratch, swap(mockFile("mock-1"), "reverse: true", "reverse: false")),
    },
    {
      defect: "an announced-format mock whose second slot carries a mark more than the format says",
      plant: (good, scratch) =>
        editFiles(
          good,
          scratch,
          swap(mockFile("announced"), "marks: 10\nminutes: 20", "marks: 11\nminutes: 20"),
          swap(mockFile("announced"), "    marks: 4\n", "    marks: 5\n"),
          // A fifth point to earn, so the written answer still lists one point per mark.
          swap(
            mockFile("announced"),
            "        - 'Their heat rates add, so their conductances add.'\n",
            "        - 'Their heat rates add, so their conductances add.'\n        - 'Names the sum of conductances.'\n",
          ),
        ),
    },
    {
      defect: "an announced mock kept after the announced format is removed",
      plant: (good, scratch) => {
        const copy = courseCopy(good, scratch);
        rmSync(join(copy.contentDir, formatFile(targetOf(good).id)));
        return copy;
      },
    },
    {
      defect: "mocks and a format with no past paper to match",
      plant: (good, scratch) => {
        const copy = courseCopy(good, scratch);
        rmSync(join(copy.contentDir, "sittings", targetOf(good).id, "papers"), { recursive: true });
        return copy;
      },
    },
    {
      defect: "a mock's recompute log that leaves out a numeric question",
      plant: (good, scratch) => editFiles(good, scratch, logEdit("mock-1", without("1"))),
    },
  ],
};

/**
 * A scratch copy of the built site with the sitting's Revision page changed by `edit`, and of the
 * Course with `course.yaml` changed by `courseEdit` when given.
 */
function revisionWith(
  good: GateInput,
  scratch: string,
  edit: (page: string) => string,
  courseEdit?: (text: string) => string,
): GateInput {
  const planted = courseEdit === undefined ? { ...good } : editFiles(good, scratch, [() => "course.yaml", courseEdit]);
  const site = copySite(good, scratch);
  const path = join(site, "revision", targetOf(good).id, "index.html");
  const page = readFileSync(path, "utf8");
  const edited = edit(page);
  if (edited === page) throw new Error("the Revision page had nothing to plant a negative control in");
  writeFileSync(path, edited);
  return { ...planted, distDir: site };
}

/** The Revision page's first Module section, as HTML, to copy as another Module's. */
const firstSection = (page: string) => /<section class="hub-module"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
const asModule02 = (section: string) => section.replace(/aria-label="Module \d+"/, 'aria-label="Module 02"');

export const revisionShipped: Gate = {
  id: "revision-shipped",
  checks:
    "Revision holds exactly the Modules the sitting covers, in exam-weight order, and the Exam room and its page for every paper and mock are built (none when the sitting has no past papers)",
  points: ["sitting"],
  run: runShipped,
  controls: [
    {
      defect: "a Revision section for a Module the sitting doesn't cover",
      plant: (good, scratch) =>
        revisionWith(good, scratch, (page) => {
          const section = firstSection(page);
          return page.replace(section, `${section}${asModule02(section)}`);
        }),
    },
    {
      defect: "a Revision with its Modules out of exam-weight order",
      plant: (good, scratch) =>
        revisionWith(
          good,
          scratch,
          (page) => {
            const section = firstSection(page);
            return page.replace(section, `${asModule02(section)}${section}`);
          },
          // The sitting now covers Module 02 too, which the papers give no marks: it belongs last.
          (course) =>
            course.replace(
              "modules: [01-thermal-resistance]\n    complete: true",
              "modules: [01-thermal-resistance, 02-convection]\n    complete: true",
            ),
        ),
    },
    {
      defect: "an Exam room missing from the build",
      plant: (good, scratch) => {
        const distDir = copySite(good, scratch);
        rmSync(join(distDir, "exam", targetOf(good).id), { recursive: true });
        return { ...good, distDir };
      },
    },
    {
      defect: "a paper's page missing from the build",
      plant: (good, scratch) => {
        const distDir = copySite(good, scratch);
        rmSync(join(distDir, "exam", targetOf(good).id, "mock-1"), { recursive: true });
        return { ...good, distDir };
      },
    },
  ],
};

export const SITTING_GATES: readonly Gate[] = [pastPapers, mockDna, revisionShipped];

/** A raw question of a past paper, as the Sitting wave holds it to the settled reading. */
export interface DumpQuestion {
  n: number;
  module: string;
  type: string;
  reverse: boolean;
  marks: number;
  /** The question as written in the content (math un-rendered). */
  question: string;
  kind: string;
  /** The Professor's printed key, as printed; null when the answer has none. */
  key: string | null;
}

export interface SittingDump {
  /** course.yaml as written. */
  course: Record<string, unknown>;
  /** The sitting's entry in `course.sittings`, as written; null when the Course has none by that id. */
  sitting: Record<string, unknown> | null;
  papers: { name: string; key: unknown; marks: unknown; minutes: unknown; questions: DumpQuestion[] }[];
  mocks: { name: string; pattern: unknown }[];
  /** format.yaml as written; null when the Professor announced none. */
  format: Record<string, unknown> | null;
  /** The Owner's rulings the sitting's own papers and mocks carry. */
  rulings: ContentRuling[];
}

const objectOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** course.yaml as `ref` has it, from the repo the content folder sits in. */
function courseAt(contentDir: string, ref: string): string {
  const shown = spawnSync("git", ["-C", contentDir, "show", `${ref}:./course.yaml`], { encoding: "utf8" });
  if (shown.status !== 0) throw new Error(`can't read course.yaml at ${ref}: ${shown.stderr.trim()}`);
  return shown.stdout;
}

/**
 * What the Sitting wave reads of a sitting's content, raw (no schema defaults, no rendering): the
 * papers' questions by number with their text, marks and keys, the mocks' patterns, the format, and
 * the rulings the papers and mocks carry. The skill's scripts carry no YAML parser, so the template
 * reads it, and the skill holds the papers to the settled reading with it.
 */
export function sittingDump(contentDir: string, id: string, options: { courseRef?: string } = {}): SittingDump {
  const read = (entry: string) =>
    objectOf(readStructured(readFileSync(join(contentDir, entry), "utf8"), entry, ignoreMath));
  // `courseRef`: read course.yaml as the revision has it (the base a single-checkout wave left), so a
  // wave can't pass its own edit of the Course config off as the base's.
  const course =
    options.courseRef === undefined
      ? read("course.yaml")
      : objectOf(readStructured(courseAt(contentDir, options.courseRef), "course.yaml", ignoreMath));
  const sittings = Array.isArray(course["sittings"]) ? course["sittings"].map(objectOf) : [];
  const files = (folder: string) => filesIn(contentDir, PATTERN(id, folder), () => true);
  const papers = files("papers").map(({ entry }) => {
    const raw = read(entry);
    const questions = (Array.isArray(raw["questions"]) ? raw["questions"] : []).map((q, i): DumpQuestion => {
      const question = objectOf(q);
      const answer = objectOf(question["answer"]);
      return {
        n: i + 1,
        module: String(question["module"] ?? ""),
        type: String(question["type"] ?? ""),
        reverse: question["reverse"] === true,
        marks: Number(question["marks"]),
        question: String(question["question"] ?? ""),
        kind: String(answer["kind"] ?? ""),
        key: typeof answer["key"] === "string" ? answer["key"] : null,
      };
    });
    return { name: nameOf(entry), key: raw["key"], marks: raw["marks"], minutes: raw["minutes"], questions };
  });
  const mocks = files("mocks").map(({ entry }) => ({ name: nameOf(entry), pattern: read(entry)["pattern"] }));
  const [format] = filesIn(contentDir, `sittings/${id}/format.{json,yaml,yml}`, () => true);
  return {
    course,
    sitting: sittings.find((s) => s["id"] === id) ?? null,
    papers,
    mocks,
    format: format === undefined ? null : read(format.entry),
    rulings: rulingsIn({ contentDir }).filter((r) => r.entry.startsWith(`sittings/${id}/`)),
  };
}
