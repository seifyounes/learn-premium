// What makes an STL sim's listing and inputs hold together, before anything runs: the listing parses
// as one OB 1, every operand is an absolute address wide enough for its type, the example's values
// set every input, and every value fits its type. The content contract reports each problem.

import { fits, parseAddress, WIDTH_OF, type S7Type } from "../s7/core.ts";
import type { StlModel, TuneRange } from "./engine.ts";
import { ListingError, parseStl } from "./parse.ts";

export function stlProblems(
  model: StlModel,
  start: Readonly<Record<string, number>> | undefined,
  tune: Readonly<Record<string, TuneRange>> | undefined,
  cases: readonly { name: string; scans: readonly Readonly<Record<string, number>>[] }[],
): { path: (string | number)[]; message: string }[] {
  const problems: { path: (string | number)[]; message: string }[] = [];
  const add = (path: (string | number)[], message: string) => problems.push({ path, message });
  try {
    parseStl(model.source);
  } catch (error) {
    if (!(error instanceof ListingError)) throw error;
    add(["model", "source"], error.message);
  }
  const operands = (key: "inputs" | "watch") => {
    for (const [operand, type] of Object.entries(model[key])) {
      const a = parseAddress(operand);
      if (!a) add(["model", key, operand], `"${operand}" isn't an absolute address like I 0.1, MW 20 or PIW 256`);
      else if (a.width !== WIDTH_OF[type])
        add(["model", key, operand], `${operand} is a ${a.width}, which can't hold a ${type}`);
      else if (key === "inputs" && a.area === "Q")
        add(["model", key, operand], `${operand} is an output: a student sets inputs (I) or memory (M)`);
      else if (key === "watch" && a.peripheral)
        add(["model", key, operand], `${operand} is a peripheral input: watch IW ${a.byte} instead`);
    }
  };
  operands("inputs");
  operands("watch");
  if (Object.keys(model.watch).length === 0) add(["model", "watch"], "the watch table shows at least one operand");

  const checkValues = (path: (string | number)[], values: Readonly<Record<string, number>>) => {
    for (const [operand, value] of Object.entries(values)) {
      const type: S7Type | undefined = model.inputs[operand];
      if (!type)
        add(
          [...path, operand],
          `${operand} isn't one of the inputs (${Object.keys(model.inputs).join(", ") || "none"})`,
        );
      else if (!fits(type, value)) add([...path, operand], `${value} doesn't fit ${operand}, a ${type}`);
    }
  };
  if (start) {
    checkValues(["start"], start);
    const missing = Object.keys(model.inputs).filter((operand) => !(operand in start));
    if (missing.length > 0) add(["start"], `the example's values set every input: ${missing.join(", ")} missing`);
  }
  for (const [operand, range] of Object.entries(tune ?? {})) {
    const type = model.inputs[operand];
    if (!type) add(["tune", operand], `${operand} isn't one of the inputs`);
    else if (!fits(type, range.min) || !fits(type, range.max))
      add(["tune", operand], `${operand}'s range leaves ${type}`);
  }
  cases.forEach((c, ci) => c.scans.forEach((scan, si) => checkValues(["cases", ci, "scans", si], scan)));
  return problems;
}
