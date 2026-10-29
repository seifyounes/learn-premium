// Every gate in this Template release. A new gate lands here with its negative controls, and
// template CI proves each one catches its defect before the release ships.
import { BROWSER_GATES } from "./browser.ts";
import { padGate, redHueRule } from "./colour.ts";
import { mhchemCanary } from "./canary.ts";
import { contentContract, katexGate } from "./content.ts";
import { pinnedDefinitionsGate } from "./definitions.ts";
import { drawingGate } from "./drawing.ts";
import { ladderGate } from "./ladder.ts";
import { licencesFileGate, licencesGate } from "./licences.ts";
import { linksOnly } from "./links.ts";
import { liveHeaders, livePrivatePaths, liveRoutes } from "./live.ts";
import { masterRules } from "./master-rules.ts";
import { gearInterferenceGate, kinematicsGate } from "./mechanisms.ts";
import { cpkPalette, moleculeChecks, pubchemCrossCheck, structureGraphite } from "./molecules.ts";
import { nernstGate } from "./nernst.ts";
import { notationGate } from "./notation.ts";
import { renderedPageScan } from "./pages.ts";
import { partChecks } from "./parts.ts";
import { pneumaticCycleGate } from "./pneumatic.ts";
import { noBuildEvidence, noindexGate, noMaterials } from "./private-files.ts";
import { provenanceGate } from "./provenance.ts";
import { pyodideGate } from "./pyodide.ts";
import { simNumbers, timingKeyGate, toolsGate, truthTableGate } from "./sims.ts";
import { sclGate } from "./scl.ts";
import { seriesLimitGate } from "./series.ts";
import { SITTING_GATES } from "./sittings.ts";
import { stateDiagramGate } from "./state-diagram.ts";
import { stateTableGate } from "./state-table.ts";
import { stlGate } from "./stl.ts";
import type { Gate } from "./runner.ts";
import { teachingMethod } from "./teaching.ts";
import { liveVideos } from "./videos.ts";
import { workedNumbers } from "./worked-numbers.ts";

export const GATES: readonly Gate[] = [
  contentContract,
  katexGate,
  notationGate,
  teachingMethod,
  provenanceGate,
  masterRules,
  workedNumbers,
  simNumbers,
  truthTableGate,
  stlGate,
  sclGate,
  pinnedDefinitionsGate,
  ladderGate,
  pneumaticCycleGate,
  timingKeyGate,
  stateTableGate,
  stateDiagramGate,
  drawingGate,
  partChecks,
  kinematicsGate,
  gearInterferenceGate,
  nernstGate,
  seriesLimitGate,
  moleculeChecks,
  structureGraphite,
  pubchemCrossCheck,
  toolsGate,
  renderedPageScan,
  pyodideGate,
  padGate,
  redHueRule,
  cpkPalette,
  linksOnly,
  ...BROWSER_GATES,
  noMaterials,
  noBuildEvidence,
  noindexGate,
  licencesGate,
  licencesFileGate,
  mhchemCanary,
  liveRoutes,
  liveHeaders,
  livePrivatePaths,
  liveVideos,
  ...SITTING_GATES,
];
