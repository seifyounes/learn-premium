// The Agent-built sim kinds this template ships, each with its engine. A kind's engine is a pure
// function of the model and the inputs students tune; the number gate runs it in Node, and the
// page runs the same code for the student.
import type { z } from "astro/zod";
import type { sim } from "../content/contract.ts";
import * as control from "./control/engine.ts";
import {
  DEFINITION_NAMES,
  pinnedFor,
  type AllPinned,
  type DefinitionName,
  type PinnedDefinitions,
} from "./definitions.ts";
import * as gradientDescent from "./gradient-descent/engine.ts";
import * as logic from "./logic/engine.ts";
import * as planeWall from "./plane-wall/engine.ts";
import * as scl from "./scl/engine.ts";
import * as stl from "./stl/engine.ts";
import * as tangent from "./tangent/engine.ts";
import type { Inputs } from "./tuning.ts";

export type Sim = z.output<typeof sim>;
export type SimKind = Sim["kind"];
type SimOf<K extends SimKind> = Extract<Sim, { kind: K }>;

interface Kind<K extends SimKind> {
  /** Every number the engine gives for the model at `inputs`, by the name sheets and recompute logs use. */
  quantities(
    model: SimOf<K>["model"],
    inputs: NonNullable<SimOf<K>["start"]>,
    /** The pinned definitions, for a kind that names them in `definitions`. */
    definitions?: AllPinned,
  ): Record<string, number>;
  /**
   * The gate that checks its numbers three ways: `sim-numbers` at the sheet's printed precision,
   * or `truth-table` bit for bit, every row of it; an STL listing is checked by `stl`, bit for bit
   * against awlsim after every statement, and an SCL listing by `scl`, against the blind
   * interpreter on every scan.
   */
  checkedBy: "sim-numbers" | "truth-table" | "stl" | "scl";
  /** The Professor's definitions its engine works to, pinned in the Course style sheet. */
  definitions?: readonly DefinitionName[];
}

export const KINDS: { [K in SimKind]: Kind<K> } = {
  "gradient-descent": {
    quantities: (model, inputs) => gradientDescent.quantities(gradientDescent.descend(model, inputs)),
    checkedBy: "sim-numbers",
  },
  logic: {
    quantities: (model) => logic.quantities(model),
    checkedBy: "truth-table",
  },
  tangent: { quantities: tangent.quantities, checkedBy: "sim-numbers" },
  "plane-wall": { quantities: planeWall.quantities, checkedBy: "sim-numbers" },
  stl: { quantities: stl.quantities, checkedBy: "stl" },
  scl: { quantities: scl.quantities, checkedBy: "scl" },
  control: { quantities: control.quantities, checkedBy: "sim-numbers", definitions: ["settlingTime", "riseTime"] },
};

/**
 * The pinned definitions a sim's engine works to, from the Course style sheet. Throws, naming it,
 * when the style sheet doesn't pin one the kind needs: the engine has nothing to read its numbers by.
 */
export function definitionsFor(s: Sim, pinned: PinnedDefinitions | undefined): AllPinned {
  const found = pinnedFor(KINDS[s.kind].definitions ?? [], pinned);
  if ("missing" in found)
    throw new Error(
      `the Course style sheet pins no ${DEFINITION_NAMES[found.missing]} definition, which a ${s.kind} sim's engine works to`,
    );
  // A kind is handed only the definitions it names; the rest it never reads.
  return found.definitions as AllPinned;
}

/** A sim an independent recompute checks, which ships live: it opens on `start`, tuned over `tune`. */
export type LiveSim = Sim & { start: NonNullable<Sim["start"]>; tune: NonNullable<Sim["tune"]> };

/**
 * Whether the sim ships live. One no recompute can check ships as its step-through instead, and so
 * does an STL listing whose instruction the interpreter lacks (it names its Gate gap).
 */
export const isLive = (s: Sim): s is LiveSim =>
  s.recompute === "independent" &&
  s.start !== undefined &&
  s.tune !== undefined &&
  !(s.kind === "stl" && s.gateGap !== undefined);

/**
 * Runs a sim's engine at `inputs` (the example's values by default), by the definitions the Course
 * style sheet pins. Throws when it doesn't pin one the kind works to.
 */
export function engineQuantities(
  s: LiveSim,
  inputs: Inputs = s.start,
  pinned?: PinnedDefinitions,
): Record<string, number> {
  switch (s.kind) {
    case "gradient-descent":
      return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs });
    case "logic":
      return KINDS[s.kind].quantities(s.model, s.start);
    case "tangent":
      return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs });
    case "plane-wall":
      return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs });
    case "stl":
      return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs });
    case "scl":
      return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs });
    case "control":
      return KINDS[s.kind].quantities(s.model, { ...s.start, ...inputs }, definitionsFor(s, pinned));
  }
}

/** A sim drawn as a schematic by the layout core: its model and the Layout hints read off its figure. */
export type SchematicSim = Extract<Sim, { layout: unknown }>;
export const isSchematic = (s: Sim): s is SchematicSim => "layout" in s;
