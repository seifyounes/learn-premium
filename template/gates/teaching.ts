// The teaching-method gate, per job: a Worked example is solved the Professor's way. It declares
// the artefact the Professor solves on and ships it (a kind this template renders, with values
// left to work out), declares the order values are written in and fills every worked-out value
// exactly once, and opens on the question figure as the question sets it.
import { readFileSync } from "node:fs";
import { ARTEFACT_KINDS, worked } from "../src/content/contract.ts";
import { readStructured } from "../src/content/loaders.ts";
import { cellAt, handOrder, type Worked } from "../src/worked/sheet.ts";
import { courseFiles, courseWith } from "./course-files.ts";
import type { Finding, Gate } from "./runner.ts";

const ignoreMath = () => {};

export const teachingMethod: Gate = {
  id: "teaching-method",
  checks:
    "every Worked example declares and ships its artefact, declares its fill order and opens on its question figure",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input).filter((f) => f.collection === "worked");
    const coverage = { examples: files.length, steps: 0 };
    const findings: Finding[] = [];
    for (const file of files) {
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      let raw: unknown;
      try {
        raw = readStructured(readFileSync(file.path, "utf8"), file.entry, ignoreMath);
      } catch (error) {
        block(`can't read the example, so its method can't be checked: ${(error as Error).message}`);
        continue;
      }
      const parsed = worked.safeParse(raw);
      if (!parsed.success) {
        // Its shape is the content contract's to report; the method needs these two declarations.
        declarations(raw).forEach(block);
        continue;
      }
      coverage.steps += parsed.data.steps.length;
      method(parsed.data).forEach(block);
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a Worked example that declares no artefact",
      plant: (good, scratch) => plantExample(good, scratch, (e) => delete e.artefact),
    },
    {
      defect: "a Worked example with no fill order",
      plant: (good, scratch) => plantExample(good, scratch, (e) => delete e.fillOrder),
    },
    {
      defect: "a worked-out value that no step fills",
      plant: (good, scratch) => plantExample(good, scratch, (e) => (stepsOf(e)[1].fill = [])),
    },
    {
      defect: "a first step that draws the answer onto the question figure, so the question figure isn't first",
      plant: (good, scratch) => plantExample(good, scratch, (e) => (stepsOf(e)[0].figure = { add: ["answer"] })),
    },
  ],
};

/** What an example that fails the content contract still owes the method. */
function declarations(raw: unknown): string[] {
  const example = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const artefact = example.artefact as { kind?: unknown } | undefined;
  if (artefact === undefined) {
    problems.push(
      "declares no solving artefact: name the one the Professor solves on in `artefact` (its `kind`, e.g. table)",
    );
  } else if (!(ARTEFACT_KINDS as readonly unknown[]).includes(artefact.kind)) {
    problems.push(
      `declares a ${JSON.stringify(artefact.kind)} artefact, which this template doesn't ship (it ships: ${ARTEFACT_KINDS.join(", ")})`,
    );
  }
  if (example.fillOrder === undefined) {
    problems.push("declares no fill order: say how the Professor writes values in (`fillOrder`: columns or rows)");
  }
  return problems;
}

function method(example: Worked): string[] {
  const problems: string[] = [];
  const { columns, rows } = example.artefact;
  const given = (ref: string) => columns[ref.charCodeAt(0) - 65]?.given === true;
  const value = (ref: string) => rows[Number(ref.slice(1)) - 1]?.[ref.charCodeAt(0) - 65] ?? "";
  const toFill = handOrder(
    rows.flatMap((row, r) => row.flatMap((cell, c) => (cell !== "" && !columns[c]?.given ? [cellAt(r, c)] : []))),
    "columns",
  );
  if (toFill.length === 0)
    problems.push("the artefact has nothing to work out: every value is given with the question");

  const figure = example.figure;
  if (figure && figure.question.length === 0) {
    problems.push("the figure declares no question figure: list the elements the question shows (figure.question)");
  }
  const filledAt = new Map<string, number[]>();
  const written = new Set<string>();
  const drawn = new Set(figure?.question ?? []);
  example.steps.forEach((step, i) => {
    const n = i + 1;
    for (const ref of step.fill) {
      if (value(ref) === "") problems.push(`step ${n} fills ${ref}, which is blank on the Professor's sheet`);
      else if (given(ref)) problems.push(`step ${n} fills ${ref}, which is given with the question`);
      filledAt.set(ref, [...(filledAt.get(ref) ?? []), n]);
      written.add(ref);
    }
    for (const ref of step.marks) {
      if (!given(ref) && !written.has(ref)) problems.push(`step ${n} rings ${ref} before its value is written`);
    }
    for (const id of step.figure?.add ?? []) {
      if (i === 0) {
        problems.push(
          `step 1 draws "${id}" onto the question figure: the first step shows the figure as the question sets it`,
        );
      } else if (drawn.has(id)) problems.push(`step ${n} draws "${id}", which is already on the figure`);
      drawn.add(id);
    }
    for (const id of step.figure?.ring ?? []) {
      if (!drawn.has(id)) problems.push(`step ${n} rings "${id}" before it is drawn`);
    }
  });
  for (const ref of toFill) {
    const at = filledAt.get(ref) ?? [];
    if (at.length === 0) problems.push(`${ref} is never filled: no step writes it`);
    if (at.length > 1) problems.push(`${ref} is filled at steps ${at.join(" and ")}: each value is written once`);
  }
  for (const e of figure?.elements ?? []) {
    if (!drawn.has(e.id)) problems.push(`figure element "${e.id}" is never drawn`);
  }
  return problems;
}

type PlantedStep = { title: string; note: string; fill: string[]; figure?: { add: string[] } };
const stepsOf = (example: Record<string, unknown>) => example.steps as [PlantedStep, PlantedStep];

/** A small Worked example that keeps the method; each negative control breaks one rule of it. */
export function plantedExample(): Record<string, unknown> {
  return {
    code: "W00.1",
    title: "Planted example",
    statement: "Find $y$ where the line meets $x = 1$.",
    artefact: {
      kind: "table",
      caption: "Planted table",
      columns: [{ label: "$x$", given: true }, { label: "$y$" }],
      rows: [["1", "2"]],
    },
    fillOrder: "columns",
    figure: {
      kind: "plot",
      caption: "Planted plot",
      x: { label: "$x$", min: 0, max: 2, step: 1 },
      y: { label: "$y$", min: 0, max: 2, step: 1 },
      elements: [
        {
          id: "line",
          kind: "line",
          through: [
            [0, 0],
            [2, 2],
          ],
        },
        { id: "answer", kind: "point", at: [1, 2] },
      ],
      question: ["line"],
    },
    steps: [
      { title: "Read", note: "Read the line." },
      { title: "Solve", note: "$y = 2$.", fill: ["B1"], figure: { add: ["answer"] } },
    ],
    answer: "$y = 2$",
  };
}

function plantExample(
  good: Parameters<typeof courseWith>[0],
  scratch: string,
  breakIt: (example: Record<string, unknown>) => void,
) {
  const example = plantedExample();
  breakIt(example);
  return courseWith(good, scratch, { "worked/900.json": JSON.stringify(example) });
}
