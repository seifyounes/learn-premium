// A Discipline added at intake, synthetic: electric machines, with a made-up ready-made "Motor Lab"
// that passes the five eligibility checks and Desmos, which doesn't (the matrix's own finding: it needs
// an API key in the script URL and its production use is a paid tier). No candidate here is fetched.
import type { Answers } from "../scripts/intake/answers.ts";
import type { AddedDiscipline, ToolkitProposal } from "../scripts/ledger/model.ts";
import { fixtureCourse } from "./fixture-courses.ts";

const pass = (evidence: string) => ({ pass: true, evidence });

export const PROPOSAL: ToolkitProposal = {
  name: "Electric machines",
  nearest: "Electric circuits",
  interactions: [
    {
      interaction: "motor starting sequence",
      tools: ["ladder"],
      readyMade: [
        {
          name: "Motor Lab",
          source: "https://example.org/motor-lab",
          licence: "MIT",
          checks: {
            embeddable: pass("MIT, bundles as a script, no API key"),
            padFrame: pass("colours come from CSS variables the page sets"),
            touch: pass("pointer events, 44px targets"),
            writable: pass("the starting sequence is a JSON config"),
            headless: pass("the model runs in Node"),
          },
        },
        {
          name: "Desmos",
          source: "https://www.desmos.com/api",
          licence: "Commercial Tier",
          checks: {
            embeddable: {
              pass: false,
              evidence: "needs an apiKey in the script URL; production use needs the paid Commercial Tier",
            },
            padFrame: pass("themeable"),
            touch: pass("touch is supported"),
            writable: pass("graph state is JSON"),
            headless: pass("the expression evaluator runs in Node"),
          },
        },
      ],
    },
    { interaction: "torque-speed curve", tools: [], readyMade: [] },
    { interaction: "motor equations", tools: ["pyodide", "part"], readyMade: [] },
  ],
};

/** The proposal's `i`th interaction (the fixture always has it). */
export function interactionOf(p: ToolkitProposal, i: number) {
  const found = p.interactions[i];
  if (found === undefined) throw new Error(`the proposal has no interaction ${i}`);
  return found;
}

/** The fixture's passing ready-made candidate, Motor Lab. */
export function motorLabOf(p: ToolkitProposal) {
  const found = interactionOf(p, 0).readyMade[0];
  if (found === undefined) throw new Error("the proposal has no candidate");
  return found;
}

/** The Owner's confirmed Toolkit for the Discipline: the proposal, his feel pick and his words. */
export const ADDED: AddedDiscipline = {
  ...PROPOSAL,
  chosen: [{ interaction: "motor starting sequence", readyMade: "Motor Lab" }],
  answer: "Yes, that Toolkit. Motor Lab looked better than the ladder sim beside it, but build the ladder one for now.",
};

/** The intake answers of a Course whose main Discipline is listed and whose second one was added at intake. */
export const AUTOMATION_ANSWERS: Answers = {
  courseName: "Machines and Automation",
  code: "EEE 410",
  slug: "machines-and-automation",
  materialsPath: "/materials/machines",
  disciplines: ["Automation and control", "Electric machines"],
  added: [ADDED],
  pad: "bluegrey",
  arabicNotes: false,
  sittings: [],
  expectedModules: 4,
  professor: "A. Professor",
  university: "Example University",
  owner: "A. N. Owner",
};

/** Course "Fixture" with Modules 01 and 02 live and 03 and 04 planned, whose intake added Electric machines. */
export function addedCourse(): string {
  return fixtureCourse("Fixture", {
    live: ["01", "02"],
    planned: ["03", "04"],
    disciplines: ["Machine learning", "Electric machines"],
    added: [ADDED],
    slugs: { "03": "gradient-descent", "04": "motor-starting" },
  });
}
