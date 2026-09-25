import { load, win, stats, cmp } from "./measure.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const E = JSON.parse(readFileSync("expected.json", "utf8")).scr;
const v = load(process.argv[2]);
const t0 = 0.05, t1 = 0.1; // exactly 3 cycles at 60 Hz
const vo = stats(win(v, "v(vo)", t0, t1)), io = stats(win(v, "i(vit)", t0, t1)), vs = stats(win(v, "v(vs)", t0, t1));
const P = stats(win(v, "v(pout)", t0, t1)).avg;
const rows = [
  cmp("Vo-av (V)", vo.avg, E.Vo_av, 2),
  cmp("Io-av (A)", io.avg, E.Io_av, 2),
  cmp("Vo-rms (V)", vo.rms, E.Vo_rms, 2),
  cmp("Io-rms (A)", io.rms, E.Io_rms, 2),
  cmp("Po (W)", P, E.Po, 2),
  cmp("pf [slide prints 0.6]", P / (vs.rms * io.rms), E.pf, 2),
];
console.table(rows);
// Latch sanity: output must be ~0 before α each cycle and follow vs after it.
const w = win(v, "v(vo)", 0.05, 0.05 + 1 / 60), vsw = win(v, "v(vs)", 0.05, 0.05 + 1 / 60);
const firstOn = w.ts.find((t, i) => w.ys[i] > 1);
console.log("first conduction in cycle at", (((firstOn - 0.05) * 60 * 360)).toFixed(1), "deg (α = 60)");
writeFileSync(process.argv[3], JSON.stringify(rows));
