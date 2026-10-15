// A sim builder's `ramp`, built into a Module wave of the wave tests: its tool assignment (under the
// intake's Mathematics), the content file, the builder's stored hand-back, and the template's
// inventory that lists it. A wave with a sim job in it must name the job in its assignment.
import { privateFolderOf } from "../scripts/intake/create.ts";
import type { ToolInventory } from "../scripts/wave/assign.ts";
import { run as runWave } from "../scripts/wave/cli.ts";
import { materialsOf } from "./fixture-courses.ts";
import { jsonInput, writeFiles } from "./helpers.ts";

export const RAMP_FILE = "content/modules/01-m01/sims/ramp.json";

/** The template's inventory of Module 01 with `ramp` in it: live, or (once it fell back) a step-through. */
export const rampInventory = (live: boolean): ToolInventory => ({
  module: "01-m01",
  worked: [],
  tools: [
    {
      name: "ramp",
      entry: "modules/01-m01/sims/ramp.json",
      collection: "sims",
      kind: "tangent",
      worked: null,
      live,
      counts: null,
    },
  ],
  problems: [],
});

/** Assigns `ramp` to Module 01's wave `waveId`, writes its file and stores the builder's hand-back. */
export function builtRamp(project: string, waveId: string, live: boolean): ToolInventory {
  const inventory = rampInventory(live);
  const run = (args: string[]) => {
    const { code, stdout } = runWave([...args, "--project", project, "--holder", "session-a", "--wave", waveId], {
      verifier: { verify: () => ({ green: true, problems: [] }), rulings: () => [], inventory: () => inventory },
    });
    if (code !== 0) throw new Error(`wave ${args[0]} failed (${code}): ${stdout}`);
  };
  const assignment = {
    module: "01",
    worked: [],
    tools: [{ name: "ramp", worked: null, discipline: "Mathematics", interaction: "function plot", tool: "tangent" }],
  };
  run(["assign", "--input", jsonInput(assignment)]);
  writeFiles(project, { [RAMP_FILE]: "{}\n" });
  writeFiles(privateFolderOf(materialsOf(project)), {
    "waves/01/builders/ramp.json": JSON.stringify({
      handback: "learn-premium sim builder v1",
      module: "01",
      name: "ramp",
      tool: "tangent",
      figure: { file: "L01.pdf", page: 1, box: null, label: null },
      files: [RAMP_FILE],
      counts: { parts: 0, nets: 0 },
      assumptions: [],
      unreadables: [],
      selfCheck: { ran: ["gates run --point job"], passed: true, notes: null },
    }),
  });
  run(["handback", "--name", "ramp"]);
  return inventory;
}
