// The Module wave's sim builders: the tool assignment against the Disciplines' Toolkits, the Owner's
// answer on a Discipline the intake didn't list, the builders' hand-backs, the fallback after two fix
// rounds, the merge gate's check of the content against the assignment and the build report. Run on
// the Fixture Course's Module 03 (gradient descent): its live sim, its step-through sim and its
// Pyodide tool, with no git, no template and no Materials.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CATALOGUE } from "../scripts/intake/pads.ts";
import { run as runWave } from "../scripts/wave/cli.ts";
import {
  builderJob,
  disciplineOf,
  DISCIPLINES,
  nextTool,
  SIM_TOOLS,
  TOOL_NAMES,
  TOOLKITS,
} from "../scripts/wave/toolkits.ts";
import { fixtureCourse } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { jsonInput, ledger, type Result } from "./helpers.ts";

const holder = (project: string) => ["--project", project, "--holder", "session-a"];

function wave(args: string[]): Result {
  const { code, stdout } = runWave(args);
  return { code, out: JSON.parse(stdout) };
}

/** Course "Fixture" with Modules 01 and 02 live and Module 03's wave running; its intake lists `disciplines`. */
function module03(disciplines: string[] = ["Machine learning"]) {
  const project = fixtureCourse("Fixture", {
    live: ["01", "02"],
    planned: ["03"],
    disciplines,
    slugs: { "03": "gradient-descent" },
  });
  const { wave: waveId } = must(
    ledger("wave", "start", ...holder(project), "--kind", "module", "--target", "03", "--branch", "module/03"),
  );
  return { project, waveId: waveId as string };
}

/** The assignment of Fixture Module 03 as it stands: W03.1 computable, with its live sim and its Pyodide tool, and the Lab-only step-through. */
const ASSIGNMENT = {
  module: "03",
  worked: [{ n: "1", model: "computable", figure: null }],
  tools: [
    {
      name: "descent",
      worked: "1",
      discipline: "Machine learning",
      interaction: "optimisation",
      tool: "gradient-descent",
    },
    {
      name: "descent-steps",
      worked: null,
      discipline: "Machine learning",
      interaction: "optimisation",
      tool: "gradient-descent",
    },
    {
      name: "normal-equation",
      worked: "1",
      discipline: "Machine learning",
      interaction: "real Python",
      tool: "pyodide",
    },
  ],
};

/** `ASSIGNMENT` with `change` applied to a copy. */
function assignment(change: (a: typeof ASSIGNMENT) => void = () => {}) {
  const copy = structuredClone(ASSIGNMENT);
  change(copy);
  return copy;
}

const assignWave = (project: string, waveId: string, input: unknown) =>
  wave(["assign", ...holder(project), "--wave", waveId, "--input", jsonInput(input)]);

describe("the Toolkits", () => {
  test("every tool a Toolkit lists is a sim kind the template ships, and every sim kind is in a Toolkit", () => {
    const contract = readFileSync(new URL("../../template/src/content/contract.ts", import.meta.url), "utf8");
    const kinds = [...(/SIM_KINDS = \[([\s\S]*?)\]/.exec(contract)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...SIM_TOOLS]).toEqual(kinds);
    const listed = Object.values(TOOLKITS).flatMap((kit) => Object.values(kit).flat());
    for (const tool of listed) expect(TOOL_NAMES as readonly string[]).toContain(tool);
    for (const kind of kinds) expect(listed).toContain(kind);
  });

  test("a Discipline is known by its catalogue name and the names the Owner uses for it", () => {
    for (const { discipline } of Object.values(CATALOGUE)) expect(disciplineOf(discipline)).toBe(discipline);
    expect(DISCIPLINES.map(disciplineOf)).toEqual([...DISCIPLINES]);
    expect(
      ["ML", "machine  learning", "Maths", "digital logic", "Automation & control", "control systems"].map(
        disciplineOf,
      ),
    ).toEqual([
      "Machine learning",
      "Machine learning",
      "Mathematics",
      "Logic circuits",
      "Automation and control",
      "Automation and control",
    ]);
    expect(disciplineOf("Electric machines")).toBeNull();
  });

  test("a builder job is named by what it builds: sim- for a sim kind, tool- for a Pyodide tool or a part", () => {
    expect(builderJob("gradient-descent", "descent")).toBe("sim-descent");
    expect(builderJob("pyodide", "normal-equation")).toBe("tool-normal-equation");
    expect(builderJob("part", "hub")).toBe("tool-hub");
  });

  test("the next Toolkit tool is the one after it in the interaction's list, or none", () => {
    const toolkit = { "function plot": ["tangent", "gradient-descent"] } as const;
    expect(nextTool(toolkit, "function plot", "tangent")).toBe("gradient-descent");
    expect(nextTool(toolkit, "function plot", "gradient-descent")).toBeNull();
    expect(nextTool(toolkit, "no such interaction", "tangent")).toBeNull();
    expect(nextTool(TOOLKITS["Machine learning"], "real Python", "pyodide")).toBeNull();
  });
});

describe("assign", () => {
  test("records Fixture Module 03's plan and returns one builder per tool", () => {
    const { project, waveId } = module03();

    const { code, out } = assignWave(project, waveId, ASSIGNMENT);

    expect(code).toBe(0);
    expect(out.builders).toEqual([
      { job: "sim-descent", name: "descent", tool: "gradient-descent", worked: "1" },
      { job: "sim-descent-steps", name: "descent-steps", tool: "gradient-descent", worked: null },
      { job: "tool-normal-equation", name: "normal-equation", tool: "pyodide", worked: "1" },
    ]);
    const [row] = must(ledger("status", "--project", project)).assignments as {
      wave: string;
      module: string;
      tools: { name: string; ships: string; fallbacks: unknown[]; handback: unknown }[];
    }[];
    expect(row).toMatchObject({ wave: waveId, module: "03" });
    expect(row?.tools.map((t) => [t.name, t.ships, t.fallbacks, t.handback])).toEqual([
      ["descent", "gradient-descent", [], null],
      ["descent-steps", "gradient-descent", [], null],
      ["normal-equation", "pyodide", [], null],
    ]);
  });

  test("assigning again supersedes the wave's row", () => {
    const { project, waveId } = module03();
    must(assignWave(project, waveId, ASSIGNMENT));

    const again = assignWave(
      project,
      waveId,
      assignment((a) => {
        a.tools.pop();
      }),
    );

    expect(again.code).toBe(0);
    const { assignments } = must(ledger("status", "--project", project));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].tools.map((t: { name: string }) => t.name)).toEqual(["descent", "descent-steps"]);
  });

  test.each([
    [
      "a computable Worked example with no tool",
      (a: typeof ASSIGNMENT) => {
        a.tools = [];
      },
      /W03\.1 is computable, so it needs a tool/,
    ],
    [
      "an illustration with a tool",
      (a: typeof ASSIGNMENT) => {
        (a.worked[0] as { model: string; figure: string | null }).model = "illustration";
        (a.worked[0] as { figure: string | null }).figure = "static";
      },
      /W03\.1 is an illustration, so no tool sits in it/,
    ],
    [
      "an illustration without a figure kind",
      (a: typeof ASSIGNMENT) => {
        a.worked.push({ n: "2", model: "illustration", figure: null });
      },
      /W03\.2 is an illustration: say whether its figure is none, static or animate/,
    ],
    [
      "a tool outside its Discipline's Toolkit",
      (a: typeof ASSIGNMENT) => {
        (a.tools[0] as { tool: string }).tool = "logic";
      },
      /logic isn't in Machine learning's Toolkit for optimisation \(it has gradient-descent\)/,
    ],
    [
      "an interaction the Toolkit lacks",
      (a: typeof ASSIGNMENT) => {
        (a.tools[0] as { interaction: string }).interaction = "ladder or FBD";
      },
      /Machine learning's Toolkit has no interaction "ladder or FBD" \(it has optimisation, real Python\)/,
    ],
    [
      "a tool in a Discipline with an empty Toolkit",
      (a: typeof ASSIGNMENT) => {
        (a.tools[0] as { discipline: string }).discipline = "Electric circuits";
      },
      /Electric circuits has no built tool for optimisation \(tool descent\): ask the Owner/,
    ],
    [
      "a Module the wave doesn't build",
      (a: typeof ASSIGNMENT) => {
        a.module = "02";
      },
      /for Module 02, but wave module-03-1 builds Module 03/,
    ],
    [
      "a name used twice",
      (a: typeof ASSIGNMENT) => {
        (a.tools[1] as { name: string }).name = "descent";
      },
      /tool descent is listed twice/,
    ],
    [
      "a Worked example listed twice",
      (a: typeof ASSIGNMENT) => {
        a.worked.push({ n: "1", model: "computable", figure: null });
      },
      /Worked example 1 is listed twice/,
    ],
    [
      "a name that isn't a file name",
      (a: typeof ASSIGNMENT) => {
        (a.tools[0] as { name: string }).name = "Descent Sim";
      },
      /tool name "Descent Sim" must be lower-case words joined by dashes/,
    ],
    [
      "a tool in a Worked example the assignment doesn't plan",
      (a: typeof ASSIGNMENT) => {
        (a.tools[1] as { worked: string | null }).worked = "7";
      },
      /tool descent-steps sits in Worked example 7, which the assignment doesn't plan/,
    ],
  ])("refuses %s (exit 2), recording nothing", (_name, change, message) => {
    const { project, waveId } = module03();

    const { code, out } = assignWave(project, waveId, assignment(change));

    expect(code).toBe(2);
    expect(out.error).toMatch(message);
    expect(must(ledger("status", "--project", project)).assignments).toEqual([]);
  });

  test("refuses a wave that isn't a running Module wave", () => {
    const { project } = module03();
    expect(assignWave(project, "module-03-9", ASSIGNMENT).code).toBe(2);
  });
});

describe("a tool in a Discipline the Course didn't list", () => {
  const heat = (a: typeof ASSIGNMENT) => {
    a.worked = [{ n: "1", model: "computable", figure: null }];
    a.tools = [
      { name: "wall", worked: "1", discipline: "Heat transfer", interaction: "conduction field", tool: "plane-wall" },
    ];
  };

  test("asks the Owner at that point: nothing is recorded, and the question names the Discipline, not Materials text", () => {
    const { project, waveId } = module03();

    const { code, out } = assignWave(project, waveId, assignment(heat));

    expect(code).toBe(1);
    expect(out.ask).toEqual([
      {
        key: "03/discipline/heat-transfer",
        question: expect.stringContaining("Heat transfer"),
        discipline: "Heat transfer",
        tools: ["wall"],
      },
    ]);
    expect(must(ledger("status", "--project", project)).assignments).toEqual([]);
  });

  test("his yes is recorded as a Discipline row and a Checkpoint row, and the assignment then goes through", () => {
    const { project, waveId } = module03();
    const asked = assignWave(project, waveId, assignment(heat)).out.ask[0];

    const answered = wave([
      ...["discipline", ...holder(project), "--wave", waveId],
      ...["--name", "Heat transfer", "--confirmed", "yes", "--answer", "Yes, this Module is thermal."],
    ]);
    const again = assignWave(project, waveId, assignment(heat));

    expect(answered.code).toBe(0);
    expect(again.code).toBe(0);
    const status = must(ledger("status", "--project", project));
    expect(status.disciplines).toMatchObject([{ name: "Heat transfer", wave: waveId, confirmed: true }]);
    expect(status.checkpoints).toEqual([
      expect.objectContaining({
        key: asked.key,
        question: asked.question,
        answer: "Yes, this Module is thermal.",
        ruling: null,
      }),
    ]);
  });

  test("his no keeps it asked, and says it was declined", () => {
    const { project, waveId } = module03();
    wave([
      ...["discipline", ...holder(project), "--wave", waveId],
      ...["--name", "Heat transfer", "--confirmed", "no", "--answer", "No: keep to the Course's Disciplines."],
    ]);

    const { code, out } = assignWave(project, waveId, assignment(heat));

    expect(code).toBe(1);
    expect(out.ask[0].question).toMatch(/declined/);
  });

  test("a later answer supersedes the earlier one", () => {
    const { project, waveId } = module03();
    const answer = (confirmed: string) =>
      wave([
        ...["discipline", ...holder(project), "--wave", waveId],
        ...["--name", "Heat transfer", "--confirmed", confirmed, "--answer", `answer ${confirmed}`],
      ]);
    answer("no");
    answer("yes");

    const status = must(ledger("status", "--project", project));
    expect(status.disciplines).toMatchObject([{ confirmed: true }]);
    expect(status.checkpoints).toMatchObject([{ answer: "answer yes" }]);
    expect(assignWave(project, waveId, assignment(heat)).code).toBe(0);
  });

  test("a Discipline the Course's intake lists needs no answer, even under another name", () => {
    const { project, waveId } = module03(["Maths"]);
    const input = assignment((a) => {
      a.worked = [{ n: "1", model: "computable", figure: null }];
      a.tools = [
        { name: "slope", worked: "1", discipline: "Mathematics", interaction: "function plot", tool: "tangent" },
      ];
    });

    expect(assignWave(project, waveId, input).code).toBe(0);
  });

  test("a Discipline the Toolkit doesn't list asks with ticket #79, and can't be added by an answer (exit 3)", () => {
    const { project, waveId } = module03();
    const input = assignment((a) => {
      a.tools = [{ name: "motor", worked: "1", discipline: "Electric machines", interaction: "rotor", tool: "part" }];
    });

    const asked = assignWave(project, waveId, input);
    const answered = wave([
      ...["discipline", ...holder(project), "--wave", waveId],
      ...["--name", "Electric machines", "--confirmed", "yes", "--answer", "yes"],
    ]);

    expect(asked.code).toBe(1);
    expect(asked.out.ask[0]).toMatchObject({ key: "03/discipline/electric-machines", discipline: "Electric machines" });
    expect(asked.out.ask[0].question).toContain("ticket #79");
    expect(answered.code).toBe(3);
    expect(answered.out.error).toContain("ticket #79");
    expect(must(ledger("status", "--project", project)).disciplines).toEqual([]);
  });
});
