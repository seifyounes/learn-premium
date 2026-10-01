// Every gate in this Template release. A new gate lands here with its negative controls, and
// template CI proves each one catches its defect before the release ships.
import { padGate, redHueRule } from "./colour.ts";
import { contentContract, katexGate } from "./content.ts";
import { masterRules } from "./master-rules.ts";
import { renderedPageScan } from "./pages.ts";
import { provenanceGate } from "./provenance.ts";
import { simNumbers, toolsGate } from "./sims.ts";
import type { Gate } from "./runner.ts";
import { teachingMethod } from "./teaching.ts";

export const GATES: readonly Gate[] = [
  contentContract,
  katexGate,
  teachingMethod,
  provenanceGate,
  masterRules,
  simNumbers,
  toolsGate,
  renderedPageScan,
  padGate,
  redHueRule,
];
