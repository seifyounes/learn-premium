import { load, win, stats, cmp } from "./measure.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const E = JSON.parse(readFileSync("expected.json", "utf8"))["ce-amp"];
const v = load(process.argv[2]);
const at0 = k => v[k][0]; // .tran starts from the DC operating point
const IB = (20 - at0("v(b)")) / 430e3, IC = (20 - at0("v(c)")) / 2e3, IE = at0("v(e)") / 1e3;
const VCE = at0("v(c)") - at0("v(e)");
const vi = stats(win(v, "v(vi)", 0.5e-3, 1e-3)), vo = stats(win(v, "v(vo)", 0.5e-3, 1e-3));
const ii = stats(win(v, "i(vi)", 0.5e-3, 1e-3));
const Av = -(vo.max - vo.min) / (vi.max - vi.min);
const Zi = (vi.max - vi.min) / (ii.max - ii.min);
const rows = [
  cmp("IBQ (µA)", IB * 1e6, E.IBQ_uA, 2),
  cmp("ICQ (mA)", IC * 1e3, E.ICQ_mA, 2),
  cmp("IEQ (mA)", IE * 1e3, E.IEQ_mA, 2),
  cmp("VCEQ (V) [sheet 17.95 is an arithmetic slip]", VCE, E.VCEQ, 2),
  cmp("Av (course VT=25 mV; SPICE uses 25.85 mV)", Av, E.Av, 6),
  cmp("Zi (Ω)", Zi, E.Zi_ohm, 6),
];
console.table(rows);
writeFileSync(process.argv[3], JSON.stringify(rows));
