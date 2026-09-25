// PROTOTYPE: fold all gate results + downsampled ngspice waveforms into one file the page reads.
import { readFileSync, writeFileSync } from "node:fs";
import { load, win } from "./measure.mjs";
const J = p => JSON.parse(readFileSync(p, "utf8"));
const wave = (file, name, t0, t1, n = 400) => {
  const { ts, ys } = win(load(file), name, t0, t1);
  const step = Math.max(1, Math.floor(ts.length / n));
  return ts.filter((_, i) => i % step === 0).map((t, i) => [+(t - t0).toPrecision(6), +ys[i * step].toPrecision(5)]);
};
const out = {
  expected: J("expected.json"),
  circuitjs: J("results/circuitjs.json"),
  spice: {
    buck: J("results/buck-spice-check.json"),
    scr: J("results/scr-spice-check.json"),
    "ce-amp": J("results/ce-amp-spice-check.json"),
    "ce-amp-vt25": J("results/ce-amp-vt25-check.json"),
  },
  logic: J("results/logic-digitaljs.json"),
  waves: {
    buck: { iL: wave("results/buck-spice.json", "i(l1)", 0.0398, 0.04), vo: wave("results/buck-spice.json", "v(vo)", 0.0398, 0.04) },
    scr: { vs: wave("results/scr-spice.json", "v(vs)", 0.05, 0.05 + 2 / 60), vo: wave("results/scr-spice.json", "v(vo)", 0.05, 0.05 + 2 / 60) },
    "ce-amp": { vi: wave("results/ce-amp-spice.json", "v(vi)", 0.8e-3, 1e-3), vo: wave("results/ce-amp-spice.json", "v(vo)", 0.8e-3, 1e-3) },
  },
  texts: Object.fromEntries(["buck", "scr", "ce-amp", "logic"].map(k => [k, readFileSync(`authored/${k}/circuitjs${k === "buck" ? "-steady" : ""}.txt`, "utf8")])),
  netlists: Object.fromEntries(["buck", "scr", "ce-amp"].map(k => [k, readFileSync(`authored/${k}/circuit.cir`, "utf8")])),
  digitaljs: J("authored/logic/digitaljs.json"),
};
writeFileSync("results/summary.json", JSON.stringify(out));
console.log("summary.json", JSON.stringify(out).length, "bytes");
