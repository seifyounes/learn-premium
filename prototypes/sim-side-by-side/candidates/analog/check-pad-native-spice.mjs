// PROTOTYPE gate for candidate C: runs the page's own engine (pad-native-spice.engine.mjs) through
// ngspice-WASM (eecircuit-engine) in Node and compares with circuits/expected.json.
//   node check-pad-native-spice.mjs
// Prints PASS/FAIL per value and exits 1 on any FAIL.
import { Simulation } from "eecircuit-engine";
import { readFileSync } from "node:fs";
import { CIRCUITS, defaults, solve } from "./pad-native-spice.engine.mjs";

const KEY = JSON.parse(readFileSync(new URL("../../circuits/expected.json", import.meta.url), "utf8"));
const sim = new Simulation();
await sim.start();

let fails = 0, passes = 0;
function row(label, got, want, tolPct, why = "") {
  const err = want === 0 ? Math.abs(got) : (100 * (got - want)) / Math.abs(want);
  const ok = Math.abs(err) <= tolPct;
  ok ? passes++ : fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} got ${fmt(got).padStart(10)}  want ${fmt(want).padStart(10)}  ${(err >= 0 ? "+" : "") + err.toFixed(2)}% (±${tolPct}%)${why ? "  " + why : ""}`);
}
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(5));

// Tolerances. "ideal" = the Professor's idealisations, so values sit on the key; "real" = real
// devices, where the documented physical gap is allowed (see each circuit's notes.md).
const TOL = {
  buck: {
    ideal: { Vo_avg: 0.5, IL_avg: 0.5, dIL: 2, IL_max: 1, IL_min: 3, dVo_pct: 3 },
    real: { Vo_avg: 3, IL_avg: 3, dIL: 5, IL_max: 5, IL_min: 25, dVo_pct: 10 },
  },
  scr: {
    ideal: { Vo_av: 0.5, Io_av: 0.5, Vo_rms: 0.5, Io_rms: 0.5, Po: 0.5, pf: 0.5 },
    real: { Vo_av: 2, Io_av: 2, Vo_rms: 2, Io_rms: 2, Po: 3, pf: 2 },
  },
  "ce-amp": {
    // Av, Zi, r'e: the course's r'e = VT/IE vs the device's gm = IC/VT leaves a 1/β = 2% gap.
    ideal: { IBQ_uA: 0.5, ICQ_mA: 0.5, IEQ_mA: 0.5, VCEQ: 0.5, re_ohm: 3, Av: 3, Zi_ohm: 3, Zo_ohm: 0.5 },
    real: { IBQ_uA: 2, ICQ_mA: 15, IEQ_mA: 15, VCEQ: 15, re_ohm: 15, Av: 15, Zi_ohm: 15, Zo_ohm: 8 },
  },
};

console.log("== 1. Each circuit at the lecture example's values vs circuits/expected.json ==");
for (const id of Object.keys(CIRCUITS)) {
  const c = CIRCUITS[id], p = defaults(id);
  for (const mode of ["ideal", "real"]) {
    const t0 = Date.now();
    const r = await solve(sim, id, p, mode);
    console.log(`-- ${id} / ${mode}  (${r.points} points, ${Date.now() - t0} ms)  gap note: ${r.gap}`);
    for (const q of c.rows) if (q.id in KEY[id]) row(`${id} ${mode} ${q.id}`, r.values[q.id], KEY[id][q.id], TOL[id][mode][q.id]);
  }
}

console.log("\n== 2. Seeded short buck run vs a long unseeded run (proves the seed does not bias values) ==");
for (const [p, mode] of [[{ D: 0.4, R: 20 }, "real"], [{ D: 0.4, R: 20 }, "ideal"], [{ D: 0.7, R: 10 }, "real"], [{ D: 0.3, R: 45 }, "ideal"]]) {
  const short = await solve(sim, "buck", p, mode);
  const net = CIRCUITS.buck.netlist(p, mode).text
    .replace(/ IC=[-\d.e]+/g, "").replace(/\.tran .*/, ".tran 0.2u 40m 0 0.2u");
  sim.setNetList(net);
  const res = await sim.runSim();
  const vecs = Object.fromEntries(res.data.map(d => [d.name.toLowerCase(), d.values]));
  const long = CIRCUITS.buck.measure(vecs, p, mode, { tstop: 40e-3 });
  for (const k of ["Vo_avg", "IL_avg", "IL_max", "IL_min", "dVo_pct"]) row(`buck D=${p.D} R=${p.R} ${mode} ${k}`, short.values[k], long.values[k], k === "IL_min" || k === "dVo_pct" ? 3 : 0.5, "(vs 40 ms run)");
}

console.log("\n== 3. Away from the example: ideal-mode sim vs the Professor's hand formula ==");
for (const p of [{ D: 0.25, R: 10 }, { D: 0.6, R: 20 }, { D: 0.8, R: 12 }]) {
  const r = await solve(sim, "buck", p, "ideal"), h = CIRCUITS.buck.hand(p);
  for (const k of ["Vo_avg", "IL_avg", "dIL"]) row(`buck D=${p.D} R=${p.R} ${k}`, r.values[k], h[k], 1);
}
for (const alpha of [0, 30, 90, 135]) {
  const r = await solve(sim, "scr", { alpha }, "ideal"), h = CIRCUITS.scr.hand({ alpha });
  for (const k of ["Vo_av", "Vo_rms", "Po"]) row(`scr α=${alpha} ${k}`, r.values[k], h[k], 1);
}
for (const p of [{ beta: 100, RC: 2000 }, { beta: 50, RC: 5000 }, { beta: 150, RC: 1000 }]) {
  const r = await solve(sim, "ce-amp", p, "ideal"), h = CIRCUITS["ce-amp"].hand(p);
  for (const k of ["ICQ_mA", "VCEQ"]) row(`ce β=${p.beta} RC=${p.RC} ${k}`, r.values[k], h[k], 0.5);
  row(`ce β=${p.beta} RC=${p.RC} Av`, r.values.Av, h.Av, 100 / (p.beta + 1) + 0.6, "(1/β gap)");
}

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
