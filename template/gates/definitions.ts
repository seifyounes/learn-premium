// The pinned-definitions gate, per job: the Professor's definitions a live sim's numbers are read by
// (the settling band, the rise time's limits) come from the Course style sheet. The style sheet must
// pin every definition such a sim's engine works to, and the sim's independent recompute must say it
// worked to exactly those: a recompute read by another definition would check the engine against
// other numbers than the sheet prints. Every finding blocks.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import { readPinned, STYLE_SHEET_FILE as STYLE_SHEET } from "../src/content/style-sheet.ts";
import { DEFINITION_NAMES, definitionProblems, type PinnedDefinitions } from "../src/sims/definitions.ts";
import { isLive, KINDS, type LiveSim } from "../src/sims/kinds.ts";
import { courseCopy, courseFiles } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, readSim, recomputeLogEntry } from "./sims.ts";

export { readPinned };

/** A live sim whose engine works to pinned definitions, with the definitions it names. */
const worksToDefinitions = (s: LiveSim) => KINDS[s.kind].definitions ?? [];

export const pinnedDefinitionsGate: Gate = {
  id: "pinned-definitions",
  checks:
    "every definition a live sim's numbers are read by (settling band, rise limits) is pinned in the Course style sheet, and its independent recompute worked to exactly the pinned one",
  points: ["job", "deploy"],
  async run(input) {
    const files = courseFiles(input);
    const coverage = {
      modules: files.filter((f) => f.collection === "modules").length,
      sims: 0,
      definitions: 0,
    };
    const findings: Finding[] = [];
    const style = readPinned(input.contentDir);
    for (const file of files.filter((f) => f.collection === "sims")) {
      const { sim: s } = readSim(file);
      // A sim the contract can't read is the number gate's to report.
      if (!s || !isLive(s)) continue;
      const names = worksToDefinitions(s);
      if (names.length === 0) continue;
      coverage.sims += 1;
      const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
      if ("problem" in style) {
        block(style.problem);
        continue;
      }
      const unpinned = names.filter((n) => style.pinned?.[n] === undefined);
      for (const name of unpinned)
        block(
          `the Course style sheet pins no ${DEFINITION_NAMES[name]} definition, which a ${s.kind} sim's numbers are read by: pin the Professor's in ${STYLE_SHEET}`,
        );
      if (unpinned.length > 0 || !style.pinned) continue;
      const logEntry = recomputeLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry));
      const logPath = join(input.contentDir, logEntry);
      // A missing or unreadable log is the number gate's to report; this gate reads only its definitions.
      let logged: PinnedDefinitions | undefined;
      try {
        logged = (JSON.parse(readFileSync(logPath, "utf8")) as { definitions?: PinnedDefinitions }).definitions;
      } catch {
        continue;
      }
      coverage.definitions += names.length;
      definitionProblems(names, logged, style.pinned).forEach((p) => block(`${logEntry}: ${p}`));
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a recompute that worked to another settling band than the Course style sheet pins",
      plant: (good, scratch) =>
        plantInDefinedSim(good, scratch, ({ contentDir, logEntry }) =>
          editJson(join(contentDir, logEntry), (log) => ({
            ...log,
            definitions: { ...(log.definitions as object), settlingTime: { band: 0.05 } },
          })),
        ),
    },
    {
      defect: "a recompute log that doesn't say which definitions it worked to",
      plant: (good, scratch) =>
        plantInDefinedSim(good, scratch, ({ contentDir, logEntry }) =>
          editJson(join(contentDir, logEntry), (log) => {
            delete log.definitions;
            return log;
          }),
        ),
    },
    {
      defect: "a Course style sheet that pins no settling-time definition",
      plant: (good, scratch) =>
        plantInDefinedSim(good, scratch, ({ contentDir }) => {
          const path = join(contentDir, STYLE_SHEET);
          const sheet = readStructured(readFileSync(path, "utf8"), STYLE_SHEET, () => {}) as {
            pinned?: Record<string, unknown>;
          };
          delete sheet.pinned?.settlingTime;
          writeFileSync(path, stringify(sheet));
        }),
    },
  ],
};

function editJson(path: string, edit: (data: Record<string, unknown>) => Record<string, unknown>) {
  writeFileSync(path, JSON.stringify(edit(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)));
}

/**
 * A scratch copy of the Course with `plant` run on its first live sim whose engine works to pinned
 * definitions. Throws when there is none, so a control can't silently check nothing.
 */
function plantInDefinedSim(
  good: GateInput,
  scratch: string,
  plant: (site: { contentDir: string; logEntry: string }) => void,
): GateInput {
  const copy = courseCopy(good, scratch);
  for (const file of courseFiles(copy).filter((f) => f.collection === "sims")) {
    const { sim: s } = readSim(file);
    if (!s || !isLive(s) || worksToDefinitions(s).length === 0) continue;
    plant({ contentDir: copy.contentDir, logEntry: recomputeLogEntry(moduleOf(file.entry) ?? "", nameOf(file.entry)) });
    return copy;
  }
  throw new Error(`no live sim working to pinned definitions in ${good.contentDir} to plant a negative control in`);
}
