// PROTOTYPE: run an ngspice netlist through the ngspice-WASM engine and dump vectors as JSON.
import { Simulation } from "eecircuit-engine";
import { readFileSync, writeFileSync } from "node:fs";

const [, , netPath, outPath] = process.argv;
const sim = new Simulation();
await sim.start();
sim.setNetList(readFileSync(netPath, "utf8"));
const t0 = Date.now();
const res = await sim.runSim();
const ms = Date.now() - t0;
const vecs = {};
for (const d of res.data) vecs[d.name.toLowerCase()] = d.values;
console.error(`${netPath}: ${res.numPoints} points, ${res.variableNames.length} vectors, ${ms} ms`);
console.error("vectors:", Object.keys(vecs).join(", "));
const errs = sim.getError?.() ?? [];
if (errs.length) console.error("ngspice errors:", errs.join("\n"));
writeFileSync(outPath, JSON.stringify({ dataType: res.dataType, numPoints: res.numPoints, ms, vecs }));
process.exit(0);
