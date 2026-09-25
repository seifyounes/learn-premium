/* figure-overlap.mjs — static collision check for every SVG figure builder.

   The browser sweep catches label collisions only on pages that happen to
   render a given figure at a given width. This runs every builder directly and
   measures label-vs-label overlap in viewBox units, so a figure is checked even
   when no page currently embeds it.

   Glyph widths are ESTIMATED (0.54em average advance), so a result within a
   unit or two of the threshold may be off by a glyph; the browser sweep is the
   arbiter. That is accurate enough
   to catch labels printed on top of one another — which is what this is for —
   but do not treat a 1-2 unit result as meaningful.

   Usage:  node .claude/figure-overlap.mjs            (fails on any collision)
           node .claude/figure-overlap.mjs --list     (list every builder)      */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", readFileSync(path.join(ROOT, "js/figures.js"), "utf8"))(win);
const F = win.Figures;

const EM = 0.54;                       // average advance width, in em
const RE = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*text-anchor="([a-z]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g;

function labels(svg) {
  return [...svg.matchAll(RE)].map(m => {
    const x = +m[1], y = +m[2], anchor = m[3], fs = +m[4];
    const txt = m[5].replace(/&[a-z]+;/g, "x");
    const w = txt.length * fs * EM;
    const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    return { txt, left, right: left + w, top: y - fs * 0.80, bottom: y + fs * 0.25, fs };
  });
}

// figures whose opts change the layout enough to be worth checking separately
const CASES = {
  hwWave: [{}, { alpha: 30 }, { alpha: 120 }],
  hwRLWave: [{}, { alpha: 30 }],
  fwWave: [{}, { alpha: 30 }, { alpha: 120 }],
  fwIndWave: [{}, { alpha: 30 }, { alpha: 120 }],
  phaseWave: [{}, { alpha: 30 }, { alpha: 120 }],
  onoffWave: [{}, { n: 3, m: 1 }],
  chopWave: [{}, { D: 0.7 }],
  buckWave: [{}, { D: 0.7 }], boostWave: [{}, { D: 0.7 }], bboostWave: [{}, { D: 0.7 }],
  bboostSource: [{}, { D: 0.7 }],
  hbWaveR: [{}], hbWaveL: [{}], fbWaveR: [{}], fbWaveL: [{}],
  spwm: [{}, { ma: 0.4 }], harmSpectrum: [{}, { full: true }],
};

const names = Object.keys(F).filter(k => k[0] !== "_" && typeof F[k] === "function");
if (process.argv.includes("--list")) { console.log(names.join("\n")); process.exit(0); }

let collisions = 0, checked = 0;
for (const name of names) {
  for (const opts of (CASES[name] || [{}])) {
    let svg;
    try { svg = F[name](opts); } catch (e) { console.log(`THREW ${name}: ${e.message}`); collisions++; continue; }
    const ts = labels(svg);
    checked++;
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 3 && oy > 1) {
        const o = JSON.stringify(opts) === "{}" ? "" : " " + JSON.stringify(opts);
        console.log(`COLLISION ${name}${o}: "${a.txt}" x "${b.txt}"  ${Math.round(ox)}x${Math.round(oy)}`);
        collisions++;
      }
    }
    // every label must also sit inside the viewBox
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const W = +vb[1], H = +vb[2];
    for (const t of ts) {
      if (t.top < 0 || t.bottom > H || t.left < -2 || t.right > W + 2) {
        console.log(`OUTSIDE   ${name}: "${t.txt}" at [${Math.round(t.left)},${Math.round(t.top)}]-[${Math.round(t.right)},${Math.round(t.bottom)}] vs ${W}x${H}`);
        collisions++;
      }
    }
  }
}

console.log(`\n${checked} figure renders checked · ${collisions} problem(s)`);
process.exit(collisions ? 1 : 0);
