// PROTOTYPE: ngspice-WASM in a Web Worker, so a solve never freezes the page.
import { Simulation } from "../../node_modules/eecircuit-engine/dist/eecircuit-engine.mjs";
import { solve } from "./pad-native-spice.engine.mjs";

let sim;
const ready = (async () => {
  sim = new Simulation();
  await sim.start();
  const bytes = performance.getEntriesByType("resource").reduce((a, e) => a + (e.transferSize || 0), 0);
  postMessage({ type: "ready", workerBytes: bytes });
})();

onmessage = async (e) => {
  const job = e.data;
  try {
    await ready;
    const t0 = performance.now();
    const r = await solve(sim, job.id, job.p, job.mode);
    postMessage({ type: "result", seq: job.seq, ok: true, r, ms: performance.now() - t0 });
  } catch (err) {
    postMessage({ type: "result", seq: job.seq, ok: false, error: String(err?.message ?? err) });
  }
};
