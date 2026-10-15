// The Module wave's sim builders: the tool assignment against the Disciplines' Toolkits, the Owner's
// answer on a Discipline the intake didn't list, the builders' hand-backs, the fallback after two fix
// rounds, the merge gate's check of the content against the assignment and the build report. Run on
// the Fixture Course's Module 03 (gradient descent): its live sim, its step-through sim and its
// Pyodide tool, with no git, no template and no Materials.
import { readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { CATALOGUE } from "../scripts/intake/pads.ts";
import { requireLedger } from "../scripts/ledger/ledger.ts";
import { toolProblems, type ToolInventory } from "../scripts/wave/assign.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import {
  builderJob,
  disciplineOf,
  DISCIPLINES,
  nextTool,
  SIM_TOOLS,
  TOOL_NAMES,
  TOOLKITS,
} from "../scripts/wave/toolkits.ts";
import { EMPTY_INVENTORY, fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { jsonInput, ledger, writeFiles, type Result } from "./helpers.ts";

const holder = (project: string) => ["--project", project, "--holder", "session-a"];

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A faked template layer: every Gate report green, no rulings, and `inventory` as the Module's tools. */
const template = (inventory: ToolInventory | string = EMPTY_INVENTORY): WaveDeps["verifier"] => ({
  verify: () => ({ green: true, problems: [] }),
  rulings: () => [],
  inventory: () => inventory,
});

function wave(args: string[], inventory?: ToolInventory | string): Result {
  const { code, stdout } = runWave(args, { verifier: template(inventory) });
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

const FOLDER = "03-gradient-descent";
const OWN_FILE = (name: string) => `content/modules/${FOLDER}/sims/${name}.json`;

/** Module 03's wave with its tool assignment recorded, the content files the builders wrote, and the Private folder to hand back in. */
function assigned() {
  const { project, waveId } = module03();
  must(assignWave(project, waveId, ASSIGNMENT));
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  writeFiles(project, {
    [OWN_FILE("descent")]: "{}",
    [OWN_FILE("descent-steps")]: "{}",
    [`content/modules/${FOLDER}/python/normal-equation.yaml`]: "title: x\n",
  });
  return { project, waveId, privateFolder };
}

/** A builder's hand-back for `name`, clean unless `change` says otherwise. */
function handbackOf(name: string, change: (h: Record<string, unknown>) => void = () => {}) {
  const given: Record<string, unknown> = {
    handback: "learn-premium sim builder v1",
    module: "03",
    name,
    tool: "gradient-descent",
    figure: { file: "lecture-3-board.jpg", page: 4, box: [0.1, 0.1, 0.9, 0.5], label: "Figure 3" },
    files: [name === "normal-equation" ? `content/modules/${FOLDER}/python/${name}.yaml` : OWN_FILE(name)],
    counts: { parts: 0, nets: 0 },
    assumptions: [{ value: "alpha = 0.1", why: "the figure doesn't print it" }],
    unreadables: [],
    selfCheck: { ran: ["gates run --point job"], passed: true, notes: null },
  };
  change(given);
  return given;
}

const handBack = (
  { project, waveId, privateFolder }: ReturnType<typeof assigned>,
  name: string,
  given: unknown = handbackOf(name),
  inventory: ToolInventory | string = MODULE_03,
) => {
  writeFiles(privateFolder, { [`waves/03/builders/${name}.json`]: JSON.stringify(given) });
  return wave(["handback", ...holder(project), "--wave", waveId, "--name", name], inventory);
};

const toolRow = (project: string, name: string) =>
  (
    must(ledger("status", "--project", project)).assignments[0].tools as {
      name: string;
      ships: string;
      fallbacks: { from: string; to: string }[];
      handback: Record<string, number | string> | null;
    }[]
  ).find((t) => t.name === name);

describe("a builder's hand-back", () => {
  test("a hand-back carrying a time is refused: the main agent measures it", () => {
    const course = assigned();

    const top = handBack(
      course,
      "descent",
      handbackOf("descent", (h) => (h["minutes"] = 12)),
    );
    const nested = handBack(
      course,
      "descent",
      handbackOf("descent", (h) => ((h["selfCheck"] as Record<string, unknown>)["took"] = "4 min")),
    );

    for (const refused of [top, nested]) {
      expect(refused.code).toBe(2);
      expect(refused.out.error).toMatch(
        /the hand-back carries no time, the main agent measures it \(record job --started-at\)/,
      );
    }
    expect(top.out.error).toContain("handback.minutes");
    expect(nested.out.error).toContain("handback.selfCheck.took");
    expect(toolRow(course.project, "descent")?.handback).toBeNull();
  });

  test("a clean hand-back is stored as counts only: the ledger carries none of its text", () => {
    const course = assigned();

    const { code, out } = handBack(course, "descent");

    expect(code).toBe(0);
    expect(out).toMatchObject({ files: 1, parts: 0, nets: 0, assumptions: 1 });
    expect(toolRow(course.project, "descent")?.handback).toEqual({
      at: expect.any(String),
      files: 1,
      parts: 0,
      nets: 0,
      assumptions: 1,
    });
    const text =
      readFileSync(`${course.project}/build-ledger.json`, "utf8") +
      readFileSync(`${course.project}/build-records/build-report.md`, "utf8");
    for (const quoted of ["Figure 3", "alpha = 0.1", "doesn't print it", "lecture-3-board"])
      expect(text).not.toContain(quoted);
  });

  test.each([
    [
      "a file outside the Module",
      (h: Record<string, unknown>) => (h["files"] = [OWN_FILE("descent"), "template/src/sims/kinds.ts"]),
      /files outside content\/modules\/03-gradient-descent\/ and content\/build-records\/: template\/src\/sims\/kinds\.ts/,
    ],
    [
      "a path that climbs out of the Module",
      (h: Record<string, unknown>) =>
        (h["files"] = [OWN_FILE("descent"), `content/modules/${FOLDER}/../02-m02/module.yaml`]),
      /files outside content\/modules/,
    ],
    [
      "a file that isn't there",
      (h: Record<string, unknown>) => (h["files"] = [OWN_FILE("descent"), OWN_FILE("ghost")]),
      /files that aren't there: content\/modules\/03-gradient-descent\/sims\/ghost\.json/,
    ],
    [
      "files without the tool's own file",
      (h: Record<string, unknown>) => (h["files"] = [OWN_FILE("descent-steps")]),
      /don't include the tool's own file/,
    ],
    ["another Module's hand-back", (h: Record<string, unknown>) => (h["module"] = "02"), /not descent in Module 03/],
    [
      "a hand-back of another tool",
      (h: Record<string, unknown>) => (h["name"] = "descent-steps"),
      /not descent in Module 03/,
    ],
    ["a hand-back of the wrong shape", (h: Record<string, unknown>) => delete h["selfCheck"], /selfCheck/],
  ])("refuses %s (exit 2)", (_name, change, message) => {
    const course = assigned();

    const { code, out } = handBack(course, "descent", handbackOf("descent", change));

    expect(code).toBe(2);
    expect(out.error).toMatch(message);
    expect(toolRow(course.project, "descent")?.handback).toBeNull();
  });

  test("refuses a tool the assignment doesn't have, and a missing hand-back (exit 2)", () => {
    const course = assigned();
    expect(handBack(course, "ghost", handbackOf("ghost")).code).toBe(2);
    const missing = wave(["handback", ...holder(course.project), "--wave", course.waveId, "--name", "descent"]);
    expect(missing.code).toBe(2);
    expect(missing.out.error).toMatch(/no hand-back of descent/);
  });

  test("a failed self-check goes back to the builder (exit 1), and nothing is stored", () => {
    const course = assigned();
    const failed = handbackOf(
      "descent",
      (h) => (h["selfCheck"] = { ran: ["gates"], passed: false, notes: "drawing gate: 2 overlaps" }),
    );

    const { code, out } = handBack(course, "descent", failed);

    expect(code).toBe(1);
    expect(out.problems[0]).toMatch(/self-check didn't pass \(drawing gate: 2 overlaps\)/);
    expect(toolRow(course.project, "descent")?.handback).toBeNull();
  });

  test("an unreadable region is settled on its crop first (exit 1): the main agent settles it, or the job goes to the Owner", () => {
    const course = assigned();
    const unreadable = handbackOf(
      "descent",
      (h) => (h["unreadables"] = [{ where: "Figure 3, the second axis", what: "tick labels" }]),
    );

    const { code, out } = handBack(course, "descent", unreadable);

    expect(code).toBe(1);
    expect(out.problems[0]).toMatch(
      /settle each on its crop, then hand back again, or record the job --result checkpoint/,
    );
    expect(toolRow(course.project, "descent")?.handback).toBeNull();
    expect(handBack(course, "descent").code).toBe(0);
  });

  test("a schematic sim's counts must be the model's: one off is refused (exit 1), the model's own are kept", () => {
    const course = assigned();
    const model: ToolInventory = {
      ...EMPTY_INVENTORY,
      tools: [
        {
          name: "descent",
          entry: `modules/${FOLDER}/sims/descent.json`,
          collection: "sims",
          kind: "logic",
          worked: "1",
          live: true,
          counts: { parts: 5, nets: 4 },
        },
      ],
    };

    const off = handBack(
      course,
      "descent",
      handbackOf("descent", (h) => (h["counts"] = { parts: 5, nets: 3 })),
      model,
    );
    const right = handBack(
      course,
      "descent",
      handbackOf("descent", (h) => (h["counts"] = { parts: 5, nets: 4 })),
      model,
    );

    expect(off.code).toBe(1);
    expect(off.out.problems[0]).toMatch(/counts 5 parts and 3 nets, but the sim's model has 5 parts and 4 nets/);
    expect(right.code).toBe(0);
    expect(toolRow(course.project, "descent")?.handback).toMatchObject({ parts: 5, nets: 4 });
  });

  test("a tool the template can't read has no counts to check, so its hand-back waits (exit 1)", () => {
    const course = assigned();
    const unread: ToolInventory = {
      ...MODULE_03,
      tools: MODULE_03.tools.filter((t) => t.name !== "descent"),
      problems: [`modules/${FOLDER}/sims/descent.json: can't check the sim: the content contract reports kind`],
    };

    const { code, out } = handBack(course, "descent", handbackOf("descent"), unread);

    expect(code).toBe(1);
    expect(out.problems[0]).toMatch(
      /no tool descent the contract can read \(modules\/03-gradient-descent\/sims\/descent\.json: can't check the sim/,
    );
    expect(toolRow(course.project, "descent")?.handback).toBeNull();
  });

  test("a template layer that can't list the tools leaves the counts unchecked, so the hand-back waits (exit 1)", () => {
    const course = assigned();

    const { code, out } = handBack(
      course,
      "descent",
      handbackOf("descent"),
      "the template can't list the Module's tools: boom",
    );

    expect(code).toBe(1);
    expect(out.problems[0]).toMatch(/boom/);
  });
});

const minutesAgo = () => new Date(Date.now() - 60_000).toISOString();
const record = (project: string, waveId: string, job: string, result: string) =>
  ledger(
    "record",
    "job",
    ...holder(project),
    "--wave",
    waveId,
    "--job",
    job,
    "--result",
    result,
    "--started-at",
    minutesAgo(),
  );
/** A first block and the two fix rounds that are blocked too: the fix loop is spent. */
const blockThrice = (project: string, waveId: string, job: string) => {
  for (let round = 0; round < 3; round++) must(record(project, waveId, job, "blocked"));
};
const fallBack = (project: string, waveId: string, job: string) =>
  wave(["fallback", ...holder(project), "--wave", waveId, "--job", job, "--started-at", minutesAgo()]);

describe("fallback after two fix rounds", () => {
  test("is refused before the rounds are spent (exit 3), then a sim falls back to its step-through", () => {
    const { project, waveId } = assigned();
    must(record(project, waveId, "sim-descent", "blocked"));
    const afterOne = fallBack(project, waveId, "sim-descent");
    must(record(project, waveId, "sim-descent", "blocked"));
    const afterTwo = fallBack(project, waveId, "sim-descent");
    must(record(project, waveId, "sim-descent", "blocked"));

    const fell = fallBack(project, waveId, "sim-descent");

    expect(afterOne.code).toBe(3);
    expect(afterTwo.code).toBe(3);
    expect(afterTwo.out.error).toMatch(/falls back only once its two fix rounds are spent \(1 of 2 used\)/);
    expect(fell).toMatchObject({ code: 0, out: { job: "sim-descent", from: "gradient-descent", to: "step-through" } });
    expect(toolRow(project, "descent")).toMatchObject({
      ships: "step-through",
      fallbacks: [{ from: "gradient-descent", to: "step-through" }],
    });
    const job = must(ledger("status", "--project", project)).jobs.find((j: { job: string }) => j.job === "sim-descent");
    expect(job).toMatchObject({
      result: "fell-back",
      detail: "step-through (fell back from gradient-descent after 2 fix rounds)",
    });
    expect(job.startedAt).not.toBeNull();
  });

  test("a sim already on its step-through has nothing to fall back to (exit 3)", () => {
    const { project, waveId } = assigned();
    blockThrice(project, waveId, "sim-descent");
    must(fallBack(project, waveId, "sim-descent"));

    expect(fallBack(project, waveId, "sim-descent")).toMatchObject({
      code: 3,
      out: { error: expect.stringContaining("already ships its step-through") },
    });
  });

  test("a fallback recorded with a plain `record job` is finished by a re-run, not recorded twice", () => {
    const { project, waveId } = assigned();
    blockThrice(project, waveId, "sim-descent");
    must(
      ledger(
        ...["record", "job", ...holder(project), "--wave", waveId, "--job", "sim-descent"],
        ...["--result", "fell-back", "--detail", "step-through", "--started-at", minutesAgo()],
      ),
    );

    const { code } = fallBack(project, waveId, "sim-descent");

    expect(code).toBe(0);
    expect(toolRow(project, "descent")?.ships).toBe("step-through");
  });

  test("a tool with no next Toolkit tool goes to the Owner (exit 3, record --result checkpoint)", () => {
    const { project, waveId } = assigned();
    blockThrice(project, waveId, "tool-normal-equation");

    const { code, out } = fallBack(project, waveId, "tool-normal-equation");

    expect(code).toBe(3);
    expect(out.error).toMatch(
      /no next tool after pyodide in the Machine learning Toolkit for real Python: record --result checkpoint/,
    );
    expect(toolRow(project, "normal-equation")?.ships).toBe("pyodide");
  });

  test("a sim kind whose contract has no step-through goes to the Owner (exit 3, record --result checkpoint)", () => {
    const { project, waveId } = module03(["Automation and control"]);
    must(
      assignWave(project, waveId, {
        module: "03",
        worked: [{ n: "1", model: "computable", figure: null }],
        tools: [
          {
            name: "listing",
            worked: "1",
            discipline: "Automation and control",
            interaction: "STL listing",
            tool: "stl",
          },
        ],
      }),
    );
    blockThrice(project, waveId, "sim-listing");

    const { code, out } = fallBack(project, waveId, "sim-listing");

    expect(code).toBe(3);
    expect(out.error).toMatch(/sim-listing's stl sim has no step-through .*record --result checkpoint/);
    expect(toolRow(project, "listing")?.ships).toBe("stl");
  });

  test("is only for a builder job of the assignment (exit 2)", () => {
    const { project, waveId } = assigned();
    const { code, out } = fallBack(project, waveId, "writer");
    expect(code).toBe(2);
    expect(out.error).toMatch(/writer isn't a builder job/);
  });
});

/** The template's inventory of Fixture Module 03, as the skill's fixture holds it. */
const MODULE_03: ToolInventory = JSON.parse(
  readFileSync(new URL("./fixtures/tool-inventory/03-gradient-descent.json", import.meta.url), "utf8"),
);

/** The inventory's tool `name`. */
function toolIn(i: ToolInventory, name: string) {
  const found = i.tools.find((t) => t.name === name);
  if (found === undefined) throw new Error("no tool " + name + " in the inventory");
  return found;
}

/** `MODULE_03` with `change` applied to a copy. */
function inventory(change: (i: ToolInventory) => void = () => {}): ToolInventory {
  const copy = structuredClone(MODULE_03);
  change(copy);
  return copy;
}

/**
 * Module 03's wave built as the main agent builds it: every tool assigned and handed back, the live sim
 * and the Pyodide tool passed, and the step-through sim blocked through its fix rounds and fallen back.
 */
function built(input: unknown = ASSIGNMENT) {
  const course = module03();
  must(assignWave(course.project, course.waveId, input));
  const privateFolder = privateFolderOf(materialsOf(course.project));
  privates.push(privateFolder);
  writeFiles(course.project, {
    [OWN_FILE("descent")]: "{}",
    [OWN_FILE("descent-steps")]: "{}",
    [`content/modules/${FOLDER}/python/normal-equation.yaml`]: "title: x\n",
  });
  const full = { ...course, privateFolder };
  for (const name of ["descent", "descent-steps", "normal-equation"]) must(handBack(full, name));
  must(record(course.project, course.waveId, "sim-descent", "passed"));
  blockThrice(course.project, course.waveId, "sim-descent-steps");
  must(fallBack(course.project, course.waveId, "sim-descent-steps"));
  must(record(course.project, course.waveId, "tool-normal-equation", "passed"));
  return full;
}

const problemsOf = (course: { project: string; waveId: string }, given: ToolInventory | string = MODULE_03) =>
  toolProblems(requireLedger(course.project), course.waveId, FOLDER, given);

describe("the merge gate holds the content to the assignment", () => {
  test("the Fixture Module's content matches its assignment: toolProblems is empty, and names each mismatch", () => {
    const course = built();

    expect(problemsOf(course)).toEqual([]);

    // The step-through sim ships as one: the content says it is live, so the content isn't the assignment's.
    expect(
      problemsOf(
        course,
        inventory((i) => (toolIn(i, "descent-steps").live = true)),
      ),
    ).toEqual(["tool descent-steps should ship as step-through, but the content has a gradient-descent sim"]);
  });

  test("the template's own message, or a problem it found in the content, is a problem", () => {
    const course = built();
    expect(problemsOf(course, "the template can't list the Module's tools: boom")).toEqual([
      "the template can't list the Module's tools: boom",
    ]);
    expect(
      problemsOf(
        course,
        inventory((i) => i.problems.push("modules/03-gradient-descent/sims/x.json: can't check the sim: kind")),
      ),
    ).toEqual(["modules/03-gradient-descent/sims/x.json: can't check the sim: kind"]);
  });

  test("a content with a Worked example or tool and no assignment at all has none to match (negative control)", () => {
    const { project, waveId } = module03();

    expect(toolProblems(requireLedger(project), waveId, FOLDER, MODULE_03)).toEqual([
      expect.stringMatching(
        /^no tool assignment for module-03-1: 03-gradient-descent has 1 Worked example and 3 tools/,
      ),
    ]);
    expect(
      toolProblems(
        requireLedger(project),
        waveId,
        FOLDER,
        inventory((i) => ((i.worked = []), (i.tools = []))),
      ),
    ).toEqual([]);
  });

  test.each([
    [
      "a Worked example the assignment doesn't plan",
      (i: ToolInventory) =>
        i.worked.push({ n: "2", entry: "modules/03-gradient-descent/worked/2.json", figure: "none" }),
      "W03.2 has no entry in the tool assignment (modules/03-gradient-descent/worked/2.json)",
    ],
    [
      "a planned Worked example the Module doesn't have",
      (i: ToolInventory) => (i.worked = []),
      "the tool assignment plans W03.1, which the Module doesn't have",
    ],
    [
      "a tool no assignment names",
      (i: ToolInventory) =>
        i.tools.push({
          name: "extra",
          entry: "modules/03-gradient-descent/sims/extra.json",
          collection: "sims",
          kind: "logic",
          worked: null,
          live: true,
          counts: null,
        }),
      "the content has a tool extra (modules/03-gradient-descent/sims/extra.json) that no assignment names",
    ],
    [
      "an assigned tool the content lacks",
      (i: ToolInventory) => (i.tools = i.tools.filter((t) => t.name !== "normal-equation")),
      "the assigned tool normal-equation has no file in the content",
    ],
    [
      "a tool in another Worked example than the assignment says",
      (i: ToolInventory) => (toolIn(i, "descent").worked = null),
      "tool descent sits in no Worked example in the content, but the assignment says W03.1",
    ],
    [
      "a tool built as another kind",
      (i: ToolInventory) => (toolIn(i, "descent").kind = "tangent"),
      "tool descent should ship as gradient-descent, but the content has a tangent sim",
    ],
    [
      "a Pyodide tool that is a part",
      (i: ToolInventory) => (
        (toolIn(i, "normal-equation").collection = "parts"),
        (toolIn(i, "normal-equation").kind = "part")
      ),
      "tool normal-equation should ship as pyodide, but the content has a part",
    ],
  ])("names %s", (_name, change, message) => {
    const course = built();

    expect(problemsOf(course, inventory(change))).toEqual([message]);
  });

  test("a computable Worked example needs a tool in it in the content (negative control)", () => {
    const course = built();

    expect(
      problemsOf(
        course,
        inventory((i) => i.tools.forEach((t) => (t.worked = null))),
      ),
    ).toContainEqual("W03.1 is computable, but no tool in the content sits in it");
  });

  test("an illustration holds its figure: no tool in it, and the figure the assignment names (negative controls)", () => {
    const illustrated = (figure: string) => ({
      ...ASSIGNMENT,
      worked: [{ n: "1", model: "illustration", figure }],
      tools: ASSIGNMENT.tools.filter((t) => t.name === "descent-steps"),
    });
    const withoutTools = (i: ToolInventory) => (i.tools = i.tools.filter((t) => t.name === "descent-steps"));
    const course = (figure: string) => {
      const { project, waveId } = module03();
      must(assignWave(project, waveId, illustrated(figure)));
      return { project, waveId };
    };

    const matching = course("animate");
    expect(problemsOf(matching, inventory(withoutTools))).not.toContainEqual(expect.stringContaining("illustration"));
    // The content's figure is animated, but the plan says static.
    expect(problemsOf(course("static"), inventory(withoutTools))).toContainEqual(
      "W03.1 is planned as an illustration whose figure is static, but its figure in the content is animated",
    );
    // A tool in the content sits in the illustration.
    expect(problemsOf(matching, inventory())).toContainEqual(
      "W03.1 is an illustration, but the content puts a tool in it (descent, normal-equation)",
    );
  });

  test("a builder job that isn't timed, isn't passed, left no hand-back or has no row is a problem (negative controls)", () => {
    const untimed = built();
    // Re-recorded without its launch time.
    must(
      ledger(
        "record",
        "job",
        ...holder(untimed.project),
        "--wave",
        untimed.waveId,
        "--job",
        "tool-normal-equation",
        "--result",
        "passed",
      ),
    );
    expect(problemsOf(untimed)).toEqual([
      "job tool-normal-equation wasn't timed: record it with --started-at <when you launched it>",
    ]);

    const noHandBack = built();
    // A re-assignment that renames a tool drops its hand-back and its job.
    const renamed = assignment((a) => ((a.tools[0] as { name: string }).name = "descent-live"));
    must(assignWave(noHandBack.project, noHandBack.waveId, renamed));
    expect(
      problemsOf(
        noHandBack,
        inventory((i) => (toolIn(i, "descent").name = "descent-live")),
      ),
    ).toEqual([
      "job sim-descent-live hasn't been recorded for module-03-1",
      "tool descent-live has no hand-back: wave.ts handback --name descent-live",
      "job sim-descent builds a tool that no assignment names",
    ]);

    const failed = built();
    must(
      ledger(
        "record",
        "job",
        ...holder(failed.project),
        "--wave",
        failed.waveId,
        "--job",
        "tool-normal-equation",
        "--result",
        "checkpoint",
        "--detail",
        "needs the Owner",
        "--started-at",
        minutesAgo(),
      ),
    );
    expect(problemsOf(failed)).toEqual(["job tool-normal-equation is checkpoint: it must pass"]);
  });

  test("a blocked builder job is the wave's blocked-job problem alone: no second message about its tool", () => {
    const course = built();
    must(
      ledger(
        "record",
        "job",
        ...holder(course.project),
        "--wave",
        course.waveId,
        "--job",
        "tool-normal-equation",
        "--result",
        "blocked",
        "--started-at",
        minutesAgo(),
      ),
    );

    expect(
      problemsOf(
        course,
        inventory((i) => (i.tools = i.tools.filter((t) => t.name !== "normal-equation"))),
      ),
    ).toEqual([]);
  });

  test("a sim recorded fell-back by a plain `record job` ships its step-through all the same", () => {
    const course = built();
    // descent fell back without `wave.ts fallback`: the ledger's row still says it ships the live sim.
    blockThrice(course.project, course.waveId, "sim-descent");
    must(
      ledger(
        "record",
        "job",
        ...holder(course.project),
        "--wave",
        course.waveId,
        "--job",
        "sim-descent",
        "--result",
        "fell-back",
        "--detail",
        "step-through",
        "--started-at",
        minutesAgo(),
      ),
    );

    expect(problemsOf(course)).toEqual([
      "tool descent should ship as step-through, but the content has a gradient-descent sim",
    ]);
    expect(
      problemsOf(
        course,
        inventory((i) => (toolIn(i, "descent").live = false)),
      ),
    ).toEqual([]);
  });

  test("two content files sharing one name can't both be the assignment's tool (negative control)", () => {
    const course = built();

    expect(
      problemsOf(
        course,
        inventory((i) =>
          i.tools.push({
            name: "descent",
            entry: `modules/${FOLDER}/python/descent.yaml`,
            collection: "python",
            kind: "pyodide",
            worked: null,
            live: true,
            counts: null,
          }),
        ),
      ),
    ).toEqual([
      `modules/${FOLDER}/sims/descent.json and modules/${FOLDER}/python/descent.yaml share the name descent: a tool's name is its builder job's, so rename one`,
    ]);
  });

  test("a sim job with no assignment row, and an untimed subagent job, are problems (negative controls)", () => {
    const course = built();
    must(record(course.project, course.waveId, "sim-ghost", "passed"));
    must(
      ledger(
        "record",
        "job",
        ...holder(course.project),
        "--wave",
        course.waveId,
        "--job",
        "writer",
        "--result",
        "passed",
      ),
    );

    expect(problemsOf(course)).toEqual([
      "job sim-ghost builds a tool that no assignment names",
      "job writer wasn't timed: record it with --started-at <when you launched it>",
    ]);
  });
});

describe("the build report", () => {
  const report = (project: string) => readFileSync(`${project}/build-records/build-report.md`, "utf8");

  test("build report lists every assignment and fallback with measured times", () => {
    const course = built();
    // The live sim was launched two minutes and five seconds ago: the real clock, as the ledger's own tests use.
    must(
      ledger(
        ...["record", "job", ...holder(course.project), "--wave", course.waveId, "--job", "sim-descent"],
        ...["--result", "passed", "--started-at", new Date(Date.now() - 125_000).toISOString()],
      ),
    );
    // The Pyodide tool was recorded without a launch time.
    must(
      ledger(
        ...["record", "job", ...holder(course.project), "--wave", course.waveId, "--job", "tool-normal-equation"],
        ...["--result", "passed"],
      ),
    );

    const text = report(course.project);

    expect(text).toContain("Tool assignment (W03.1 computable):");
    expect(text).toMatch(
      /\| W03\.1 \| descent \| Machine learning \| optimisation \| gradient-descent \| gradient-descent \| sim-descent \| passed \| 2 min [5-9] s \| 1 file · 0 parts · 0 nets · 1 assumption \|/,
    );
    // Lab only, and fallen back to its step-through after two fix rounds.
    expect(text).toMatch(
      /\| Lab \| descent-steps \| Machine learning \| optimisation \| gradient-descent \| step-through \(fell back from gradient-descent\) \| sim-descent-steps \| fell-back \| 1 min \d+ s \| 1 file · 0 parts · 0 nets · 1 assumption \|/,
    );
    expect(text).toMatch(
      /\| W03\.1 \| normal-equation \| Machine learning \| real Python \| pyodide \| pyodide \| tool-normal-equation \| passed \| not measured \|/,
    );
    expect(text).toContain("The Owner can overrule any assignment or fallback; the wave re-assigns it.");
  });

  test("a wave with no assignment, or one waiting on the Owner's answer about a Discipline, shows no tool table", () => {
    const { project, waveId } = module03();
    expect(report(project)).not.toContain("Tool assignment");

    const asked = assignWave(
      project,
      waveId,
      assignment((a) => {
        a.tools = [
          {
            name: "wall",
            worked: "1",
            discipline: "Heat transfer",
            interaction: "conduction field",
            tool: "plane-wall",
          },
        ];
      }),
    );

    expect(asked.code).toBe(1);
    expect(report(project)).not.toContain("Tool assignment");
    expect(report(project)).not.toContain("Disciplines confirmed during the build");
    expect(must(ledger("status", "--project", project)).assignments).toEqual([]);
  });

  test("lists the Disciplines the Owner confirmed during the build, with his answer's outcome and not its text", () => {
    const { project, waveId } = module03();
    wave([
      ...["discipline", ...holder(project), "--wave", waveId],
      ...["--name", "Heat transfer", "--confirmed", "yes", "--answer", "Yes: the wall sim is Module 03's whole point."],
    ]);

    const text = report(project);

    expect(text).toContain("## Disciplines confirmed during the build");
    expect(text).toMatch(/\| Heat transfer \| module-03-1 \| confirmed \| \d{4}-/);
    expect(text).not.toContain("whole point");
  });

  test("build report lists the deploy report's pad fixes", () => {
    const { project, waveId } = module03();
    const fix =
      "course.yaml pad #D2691E: print #653518 → #533E33 (print at least 60° of hue from the red pen, or near-grey: was 18°)";
    const touch = () =>
      must(
        ledger("record", "job", ...holder(project), "--wave", waveId, "--job", "deploy-gates", "--result", "passed"),
      );

    touch();
    expect(report(project)).toContain("## Pad auto-fixes (deploy gates, reported only)\n\nNo deploy Gate report yet.");

    writeFiles(project, {
      "content/build-records/gate-reports/deploy.json": JSON.stringify({
        gates: [{ id: "pad", fixes: [fix] }, { id: "notation" }],
      }),
    });
    touch();
    expect(report(project)).toContain(`## Pad auto-fixes (deploy gates, reported only)\n\n- ${fix}\n`);

    writeFiles(project, {
      "content/build-records/gate-reports/deploy.json": JSON.stringify({ gates: [{ id: "pad", fixes: [] }] }),
    });
    touch();
    expect(report(project)).toContain("## Pad auto-fixes (deploy gates, reported only)\n\nNone.");

    writeFiles(project, { "content/build-records/gate-reports/deploy.json": "{ not json" });
    touch();
    expect(report(project)).toContain("The deploy Gate report isn't readable.");
  });
});
