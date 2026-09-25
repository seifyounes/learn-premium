import { load, win, stats, cmp } from "./measure.mjs";
import { writeFileSync } from "node:fs";
const E = JSON.parse((await import("node:fs")).readFileSync("expected.json", "utf8")).buck;
const v = load(process.argv[2]);
const vo = stats(win(v, "v(vo)", 0.035, 0.040)), il = stats(win(v, "i(l1)", 0.035, 0.040));
const dvoPct = (100 * (vo.max - vo.min)) / vo.avg;
// Ideal-switch/ideal-diode key vs a real diode: Vo = D*Vs - (1-D)*Vf is the physics-expected shift.
const rows = [
  cmp("Vo avg (V)", vo.avg, E.Vo_avg, 3),
  cmp("IL avg (A)", il.avg, E.IL_avg, 3),
  cmp("ΔIL (A)", il.max - il.min, E.dIL, 5),
  cmp("IL max (A)", il.max, E.IL_max, 5),
  cmp("IL min (A)", il.min, E.IL_min, 25),
  cmp("ΔVo/Vo (%)", dvoPct, E.dVo_pct, 10),
];
console.table(rows);
writeFileSync(process.argv[3], JSON.stringify(rows));
