// The starting Disciplines' Toolkits: for each Discipline, the tool the Module wave builds for each
// kind of interaction a Worked example or Lab item has. The first tool listed for an interaction is
// its default; the ones after it are what a tool falls back to once its fix rounds are spent. A
// Discipline whose Toolkit is empty has no engine built yet, so a computable example in it goes to
// the Owner. The Site template can't be loaded here (it needs its own dependencies), so the sim
// kinds are copied, and a test holds the copy to `template/src/content/contract.ts`. These are
// defaults the Owner may overrule.
import { normalise } from "../intake/pads.ts";

/** The sim kinds the template's content contract ships. */
export const SIM_TOOLS = [
  "gradient-descent",
  "logic",
  "tangent",
  "plane-wall",
  "stl",
  "scl",
  "control",
  "ladder",
] as const;
/** Every tool a Toolkit can list: a sim kind, a Pyodide tool or a machine-part viewer. */
export const TOOL_NAMES = [...SIM_TOOLS, "pyodide", "part"] as const;
export type SimTool = (typeof SIM_TOOLS)[number];
export type ToolName = (typeof TOOL_NAMES)[number];

/** The Disciplines the Toolkit knows, by the name the catalogue and the Owner use. */
export const DISCIPLINES = [
  "Machine learning",
  "Mathematics",
  "Electric circuits",
  "Logic circuits",
  "Heat transfer",
  "Machinery",
  "Engineering chemistry",
  "Automation and control",
] as const;
export type StartingDiscipline = (typeof DISCIPLINES)[number];

/** Interaction (as the catalogue words it) → its tools, the default first. */
export type Toolkit = Record<string, readonly ToolName[]>;

export const TOOLKITS: Record<StartingDiscipline, Toolkit> = {
  "Machine learning": { optimisation: ["gradient-descent"], "real Python": ["pyodide"] },
  Mathematics: { "function plot": ["tangent"] },
  // No engine built for these two yet: a computable example in them goes to the Owner.
  "Electric circuits": {},
  "Logic circuits": { "combinational circuit": ["logic"] },
  "Heat transfer": { "conduction field": ["plane-wall"] },
  Machinery: { part: ["part"] },
  "Engineering chemistry": {},
  "Automation and control": {
    "STL listing": ["stl"],
    "SCL listing": ["scl"],
    "ladder or FBD": ["ladder"],
    "control response": ["control"],
  },
};

/** Other names the Owner uses for a Discipline, as `intake/pads.ts` knows them (normalised). */
const ALIASES: Record<string, StartingDiscipline> = {
  ml: "Machine learning",
  circuits: "Electric circuits",
  "electrical circuits": "Electric circuits",
  "electric circuit": "Electric circuits",
  maths: "Mathematics",
  math: "Mathematics",
  "digital logic": "Logic circuits",
  logic: "Logic circuits",
  chemistry: "Engineering chemistry",
  control: "Automation and control",
  "control systems": "Automation and control",
  "control engineering": "Automation and control",
  automation: "Automation and control",
};

/** The Toolkit's own Discipline for a name the Owner gave, or null when the Toolkit doesn't know it. */
export function disciplineOf(name: string): StartingDiscipline | null {
  const wanted = normalise(name);
  return DISCIPLINES.find((d) => normalise(d) === wanted) ?? ALIASES[wanted] ?? null;
}

/** The tool `interaction` calls for in `toolkit`: its list (default first), or null when the Toolkit has none. */
export function toolsFor(toolkit: Toolkit, interaction: string): readonly ToolName[] | null {
  const wanted = normalise(interaction);
  const key = Object.keys(toolkit).find((k) => normalise(k) === wanted);
  return key === undefined ? null : (toolkit[key] ?? null);
}

const isSim = (tool: ToolName): tool is SimTool => (SIM_TOOLS as readonly string[]).includes(tool);

/**
 * The sim kinds whose content contract has no step-through to fall back to (`stepThrough` is never):
 * their recompute is always independent, so a builder that can't pass goes to the Owner instead.
 */
export const NO_STEP_THROUGH: readonly ToolName[] = ["stl", "scl", "ladder"];

/** The job that builds a tool: `sim-<name>` for a sim, `tool-<name>` for a Pyodide tool or a part. */
export function builderJob(tool: ToolName, name: string): string {
  return `${isSim(tool) ? "sim" : "tool"}-${name}`;
}

/** The tool after `tool` in the Toolkit's list for `interaction`, or null when it is the last (or not listed). */
export function nextTool(toolkit: Toolkit, interaction: string, tool: ToolName): ToolName | null {
  const list = toolsFor(toolkit, interaction) ?? [];
  const at = list.indexOf(tool);
  return at === -1 ? null : (list[at + 1] ?? null);
}
