// PROTOTYPE (throwaway): checks control-core.engine.mjs in Node against the answer key.
// Key values at K = 4 come from python-control 0.10.2 (research note, section 5, and system.md).
// Run: node candidates/control/check-control-core.mjs
import { PLANT, horizon, analyse, closedLoop, closedLoopPoles, stepResponse, stepInfo, secondOrder, margins, breakPoints, gainNearest, rootLocus } from './control-core.engine.mjs';

let fails = 0;
const check = (name, got, want, tol) => {
  const ok = Number.isFinite(want) ? Math.abs(got - want) <= tol : got === want;
  if (!ok) fails++;
  const fmt = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toPrecision(8) : String(v)) : v);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} got ${String(fmt(got)).padEnd(14)} want ${fmt(want)}${Number.isFinite(want) ? ` ± ${tol}` : ''}`);
};

const K = 4;
const cl = closedLoop(PLANT, K);
console.log(`Closed loop at K = 4: T(s) = ${cl.num.join(' ')} / ${cl.den.join(' ')}`);
check('T(s) numerator', cl.num.length === 1 && cl.num[0] === 4 ? 'ok' : 'bad', 'ok');
check('T(s) denominator s^2 + 2s + 4', JSON.stringify(cl.den), JSON.stringify([1, 2, 4]));

const p = closedLoopPoles(PLANT, K);
check('pole 1 real', p[0][0], -1, 1e-6);
check('pole 1 imag', p[0][1], 1.732051, 1e-6);
check('pole 2 real', p[1][0], -1, 1e-6);
check('pole 2 imag', p[1][1], -1.732051, 1e-6);

const so = secondOrder(cl.den);
check('omega_n (rad/s)', so.wn, 2, 1e-12);
check('zeta', so.zeta, 0.5, 1e-12);
check('overshoot, formula (%)', so.osPct, 16.30, 0.005);
check('Ts textbook 4/(zeta wn) (s)', so.tsTextbook, 4.0, 1e-9);

const info = stepInfo(stepResponse(cl, { tEnd: 12, dt: 1e-3 }));
check('overshoot, simulated step (%)', info.osPct, 16.30, 0.005);
check('overshoot vs python-control 16.303353', info.osPct, 16.303353, 1e-4);
check('peak time (s), python-control 1.8138', info.tPeak, 1.8138, 2e-3);
check('2 % settling (s), python-control 4.0382', info.ts, 4.0382, 2e-3);

const m = margins(PLANT, K);
check('phase margin (deg)', m.pmDeg, 51.83, 0.005);
check('phase margin vs python-control 51.827292', m.pmDeg, 51.827292, 1e-4);
check('gain crossover (rad/s)', m.wgc, 1.5723, 5e-5);
check('gain margin', m.gmDb, Infinity);

// Beyond the key: the root locus and the drag-to-K inverse.
const bp = breakPoints(PLANT);
check('break-away point s', bp[0]?.s, -1, 1e-9);
check('break-away gain K', bp[0]?.K, 1, 1e-9);
check('drag inverse: pole at -1+1.732j gives K', gainNearest(PLANT, [-1, 1.7320508]), 4, 1e-3);
check('drag inverse: pole at -1.5 (real) gives K', gainNearest(PLANT, [-1.5, 0]), 0.75, 1e-3);
const rl = rootLocus(PLANT, [0.5, 1, 4, 9]);
check('locus branch count', rl.length, 2, 0);
check('locus at K=9: imag part 2.828427', Math.abs(rl[0][3].im), Math.sqrt(8), 1e-9);

// python-control reference at other gains (scratch run, 2026-09-26).
for (const [k, os, pm] of [[2, 4.321392, 65.530199], [8, 30.501009, 38.668282], [16, 44.434422, 28.020176]]) {
  const t = closedLoop(PLANT, k);
  check(`K=${k} overshoot (%)`, stepInfo(stepResponse(t, { tEnd: 12, dt: 1e-3 })).osPct, os, 1e-3);
  check(`K=${k} phase margin (deg)`, margins(PLANT, k).pmDeg, pm, 1e-4);
}

// Overdamped edge: the page's adaptive horizon must still find the settling time.
check('K=1 (critically damped) 2 % settling (s), python-control 5.834', analyse(PLANT, 1, horizon(PLANT, 1, 8)).info.ts, 5.834, 2e-3);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
