// Adding a Discipline at intake. For a Discipline the template's Toolkit doesn't list, the agent
// writes a Toolkit proposal from the research matrix (`references/discipline-tools.md`) and the nearest
// listed Discipline. `checkProposal` (the `toolkit` command) checks it, runs the five eligibility
// checks on every ready-made candidate and gives the nearest pad and the question for the Owner.
// `addedProblems` is what `create` holds the answers file to: only a Toolkit the Owner confirmed, in
// his words, puts the Discipline in the course config and the ledger.
import { CHECK_LABELS, eligibilityOf, isLinkOnly, LINKS_ONLY, sameDiscipline } from "../ledger/disciplines.ts";
import { LedgerError } from "../ledger/file.ts";
import type { AddedDiscipline, ToolkitProposal } from "../ledger/model.ts";
import { DISCIPLINES, disciplineOf, TOOL_NAMES } from "../wave/toolkits.ts";
import type { Answers } from "./answers.ts";
import { normalise, suggestPad, type PadSuggestion } from "./pads.ts";

const ships = `it ships: ${TOOL_NAMES.join(", ")}`;

/** Names that appear twice (normalised), each once. */
function repeated(names: string[]): string[] {
  const seen = names.map(normalise);
  return [...new Set(names.filter((name, i) => seen.indexOf(normalise(name)) !== i))];
}

/** Everything wrong with a Toolkit proposal as written, all at once. */
export function proposalProblems(p: ToolkitProposal): string[] {
  const problems: string[] = [];
  const listed = disciplineOf(p.name);
  if (listed !== null) problems.push(`${p.name} is the Toolkit's ${listed}: list it as that, nothing to add`);
  if (p.nearest !== null && disciplineOf(p.nearest) === null)
    problems.push(`nearest "${p.nearest}" isn't a Discipline the Toolkit lists (it lists: ${DISCIPLINES.join(", ")})`);
  if (p.interactions.length === 0) problems.push("the Toolkit has no interactions: list at least one");
  for (const name of repeated(p.interactions.map((i) => i.interaction)))
    problems.push(`interaction ${name} is listed twice`);
  for (const { interaction, tools, readyMade } of p.interactions) {
    for (const tool of repeated(tools)) problems.push(`${interaction}: tool ${tool} is listed twice`);
    for (const tool of new Set(tools)) {
      if (isLinkOnly(tool)) problems.push(`${interaction}: tool ${tool}: ${LINKS_ONLY}`);
      else if (!(TOOL_NAMES as readonly string[]).includes(tool))
        problems.push(`${interaction}: tool ${tool} isn't a tool the template ships (${ships})`);
    }
    for (const name of repeated(readyMade.map((c) => c.name)))
      problems.push(`${interaction}: ready-made ${name} is listed twice`);
    for (const candidate of readyMade)
      if (isLinkOnly(candidate.name, candidate.source))
        problems.push(`${interaction}: ready-made ${candidate.name}: ${LINKS_ONLY}`);
  }
  return problems;
}

/** The pad for the proposed Discipline: its own, else the nearest listed Discipline's, else Graphite-grey. */
function padFor(p: ToolkitProposal): PadSuggestion {
  const own = suggestPad(p.name);
  if (own.match !== "fallback" || p.nearest === null) return own;
  return { ...suggestPad(p.nearest), match: "nearest" };
}

const cell = (text: string) => text.replace(/\|/g, "/");

/** `toolkit`: the proposal checked, each ready-made candidate's eligibility, the nearest pad, and the question for the Owner. */
export function checkProposal(p: ToolkitProposal) {
  const problems = proposalProblems(p);
  if (problems.length > 0) throw new LedgerError("invalid", problems.join("; "));

  const pad = padFor(p);
  const interactions = p.interactions.map(({ interaction, tools, readyMade }) => ({
    interaction,
    tools,
    readyMade: readyMade.map((c) => ({ name: c.name, ...eligibilityOf(c) })),
  }));
  const considered = ({ readyMade }: (typeof interactions)[number]) =>
    readyMade
      .map((c) =>
        c.eligible
          ? `${c.name} (passes all five)`
          : `${c.name} (fails: ${c.failed.map((k) => CHECK_LABELS[k]).join(", ")})`,
      )
      .join("; ");
  const question = [
    `**${p.name}** is off the Toolkit's list. Proposed Toolkit${p.nearest === null ? "" : `, started from ${p.nearest}`}:`,
    "",
    "| Interaction | Tools (default first) | Ready-made considered |",
    "| --- | --- | --- |",
    ...interactions.map(
      (i) =>
        `| ${cell(i.interaction)} | ${cell(i.tools.length === 0 ? "none built yet" : i.tools.join(", "))} | ${cell(considered(i) || "none")} |`,
    ),
    "",
    `Use pad ${pad.label} if ${p.name} is the main Discipline${pad.listed === null ? "" : ` (${pad.listed}'s pad)`}.`,
    "",
    ...interactions.flatMap((i) =>
      i.readyMade
        .filter((c) => c.eligible)
        .map(
          (c) =>
            `- On its own demo, beside the Agent-built tool: does ${c.name} win on feel over the Agent-built ${i.tools[0] ?? "nothing built yet"} for ${i.interaction}?`,
        ),
    ),
    "",
    "Confirm this Toolkit, or say what to change.",
  ].join("\n");
  return { name: p.name, nearest: p.nearest, pad, interactions, question };
}

/**
 * What is wrong with the answers' added Disciplines: a Discipline off the Toolkit's list without the
 * Owner's confirmed Toolkit, an entry that isn't one of the Course's Disciplines, a bad proposal, or a
 * ready-made tool chosen that isn't an eligible candidate. Empty when the answers add none.
 */
export function addedProblems(answers: Pick<Answers, "disciplines" | "added">): string[] {
  const problems: string[] = [];
  for (const name of answers.disciplines) {
    if (disciplineOf(name) !== null) continue;
    const entries = answers.added.filter((a) => sameDiscipline(a.name, name));
    if (entries.length === 0)
      problems.push(
        `${name} is off the Toolkit's list: propose its Toolkit (intake.ts toolkit), and put the Owner's confirmed Toolkit and his words in "added"`,
      );
    else if (entries.length > 1) problems.push(`${name} has more than one entry in "added"`);
  }
  for (const added of answers.added) {
    if (!answers.disciplines.some((name) => sameDiscipline(name, added.name)))
      problems.push(`"added" has ${added.name}, which isn't in "disciplines": the Course doesn't list it`);
    problems.push(...proposalProblems(added), ...chosenProblems(added));
  }
  return problems;
}

/** What is wrong with an added Discipline's ready-made picks: each is one eligible candidate of an interaction, one per interaction. */
function chosenProblems(added: AddedDiscipline): string[] {
  const problems: string[] = [];
  for (const interaction of repeated(added.chosen.map((c) => c.interaction)))
    problems.push(`${interaction}: more than one ready-made tool is chosen`);
  for (const pick of added.chosen) {
    const entry = added.interactions.find((i) => normalise(i.interaction) === normalise(pick.interaction));
    const candidate = entry?.readyMade.find((c) => normalise(c.name) === normalise(pick.readyMade));
    if (entry === undefined || candidate === undefined) {
      problems.push(`${pick.readyMade} isn't a ready-made candidate for ${pick.interaction}: it can't be chosen`);
      continue;
    }
    const { eligible, failed } = eligibilityOf(candidate);
    if (!eligible)
      problems.push(
        `${candidate.name} fails ${failed.map((k) => CHECK_LABELS[k]).join(", ")}: it can't be chosen; ${entry.interaction} keeps its Agent-built tool`,
      );
  }
  return problems;
}
