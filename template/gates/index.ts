// Every gate in this Template release. A new gate lands here with its negative controls, and
// template CI proves each one catches its defect before the release ships.
import { BROWSER_GATES } from "./browser.ts";
import { padGate, redHueRule } from "./colour.ts";
import { contentContract, katexGate } from "./content.ts";
import { drawingGate } from "./drawing.ts";
import { licencesFileGate, licencesGate } from "./licences.ts";
import { liveHeaders, livePrivatePaths, liveRoutes } from "./live.ts";
import { masterRules } from "./master-rules.ts";
import { renderedPageScan } from "./pages.ts";
import { noBuildEvidence, noindexGate, noMaterials } from "./private-files.ts";
import { provenanceGate } from "./provenance.ts";
import { pyodideGate } from "./pyodide.ts";
import { simNumbers, toolsGate, truthTableGate } from "./sims.ts";
import { stlGate } from "./stl.ts";
import type { Gate } from "./runner.ts";
import { teachingMethod } from "./teaching.ts";

export const GATES: readonly Gate[] = [
  contentContract,
  katexGate,
  teachingMethod,
  provenanceGate,
  masterRules,
  simNumbers,
  truthTableGate,
  stlGate,
  drawingGate,
  toolsGate,
  renderedPageScan,
  pyodideGate,
  padGate,
  redHueRule,
  ...BROWSER_GATES,
  noMaterials,
  noBuildEvidence,
  noindexGate,
  licencesGate,
  licencesFileGate,
  liveRoutes,
  liveHeaders,
  livePrivatePaths,
];
