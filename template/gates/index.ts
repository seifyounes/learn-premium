// Every gate in this Template release. A new gate lands here with its negative controls, and
// template CI proves each one catches its defect before the release ships.
import { contentContract, katexGate } from "./content.ts";
import { renderedPageScan } from "./pages.ts";
import type { Gate } from "./runner.ts";

export const GATES: readonly Gate[] = [contentContract, katexGate, renderedPageScan];
