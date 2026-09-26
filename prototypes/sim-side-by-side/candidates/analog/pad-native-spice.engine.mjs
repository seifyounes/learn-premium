// PROTOTYPE (throwaway): the engine behind candidate C, "pad-native-spice".
// Pure module, no DOM: builds ngspice netlists from the slider values and the idealisation mode,
// measures the solved vectors, and gives the Professor's hand formulas. The page runs it in a Web
// Worker next to ngspice-WASM (eecircuit-engine); check-pad-native-spice.mjs runs it in Node.
//
// mode "ideal" = the Professor's idealisations; mode "real" = real devices.

const TWO_PI = 2 * Math.PI;
// ngspice's own constants (CONSTboltz / CHARGE), so the "VT = 25 mV" temperature is exact.
const K_OVER_Q = 1.38064852e-23 / 1.6021766208e-19;

// ---------- small numeric helpers (trapezoidal over uneven time steps) ----------
function windowOf(t, y, t0, t1) {
  const ts = [], ys = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= t0 - 1e-12 && t[i] <= t1 + 1e-12) { ts.push(t[i]); ys.push(y[i]); }
  return { ts, ys };
}
function stats({ ts, ys }) {
  let a = 0, s = 0, mx = -Infinity, mn = Infinity;
  for (let i = 0; i < ys.length; i++) { if (ys[i] > mx) mx = ys[i]; if (ys[i] < mn) mn = ys[i]; }
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i] - ts[i - 1];
    a += dt * (ys[i] + ys[i - 1]) / 2;
    s += dt * (ys[i] ** 2 + ys[i - 1] ** 2) / 2;
  }
  const T = ts.at(-1) - ts[0];
  return { avg: a / T, rms: Math.sqrt(s / T), max: mx, min: mn };
}
// Single-bin Fourier projection over a whole number of periods: complex amplitude {re, im}.
function phasor({ ts, ys }, f) {
  let c = 0, s = 0;
  const w = TWO_PI * f;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i] - ts[i - 1];
    c += dt * (ys[i] * Math.cos(w * ts[i]) + ys[i - 1] * Math.cos(w * ts[i - 1])) / 2;
    s += dt * (ys[i] * Math.sin(w * ts[i]) + ys[i - 1] * Math.sin(w * ts[i - 1])) / 2;
  }
  const T = ts.at(-1) - ts[0];
  return { re: 2 * c / T, im: 2 * s / T };
}
const cabs = z => Math.hypot(z.re, z.im);
const cdiv = (a, b) => { const d = b.re ** 2 + b.im ** 2; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const cscale = (a, k) => ({ re: a.re * k, im: a.im * k });

// Downsample a window to at most n points (keeps shape; for plotting only, never for values).
function thin(ts, ys, n, tOffset = 0) {
  const step = Math.max(1, Math.ceil(ts.length / n)), out = [];
  for (let i = 0; i < ts.length; i += step) out.push([ts[i] - tOffset, ys[i]]);
  if (out.at(-1)[0] !== ts.at(-1) - tOffset) out.push([ts.at(-1) - tOffset, ys.at(-1)]);
  return out;
}

// ============================== BUCK ==============================
const BUCK = { Vs: 50, L: 400e-6, C: 100e-6, f: 20e3 };
// Diode junctions: "real" = the circuits/buck netlist's diode (CircuitJS's default, ~0.8 V at 1 A);
// "ideal" = a near-ideal junction (~0.02 V at 1 A) so it behaves as the Professor's ideal diode.
const BUCK_DIODE = {
  ideal: { Is: 1e-6, N: 0.05, text: "D(IS=1e-6 N=0.05 RS=1m)" },
  real: { Is: 1.7143528e-7, N: 2, text: "D(Is=1.7143528e-7 N=2)" },
};

function buckHand({ D, R }) {
  const { Vs, L, f } = BUCK, T = 1 / f;
  const Lmin = (1 - D) * R / (2 * f);
  const Vo = D * Vs, IL = Vo / R, dIL = (Vs - Vo) * D * T / L;
  const Imax = IL + dIL / 2, Imin = IL - dIL / 2;
  const dVo_pct = 100 * (1 - D) / (8 * L * BUCK.C * f * f);
  return { Vo_avg: Vo, IL_avg: IL, dIL, IL_max: Imax, IL_min: Imin, dVo_pct, Lmin, ccm: L >= Lmin };
}

// Seed L and C at the expected steady state, so a short run starts already settled.
export function buckSeed({ D, R }, mode) {
  const { Vs, L, f } = BUCK, T = 1 / f;
  const K = 2 * L * f / R;
  let Vo, IL0;
  if (K >= 1 - D) { // CCM
    Vo = D * Vs;
    if (mode === "real") {
      const d = BUCK_DIODE.real, Iavg = Vo / R;
      const VD = d.N * 0.025865 * Math.log(Iavg / d.Is + 1);
      Vo = D * Vs - (1 - D) * VD;
    }
    const dIL = (Vs - Vo) * D * T / L;
    IL0 = Math.max(0, Vo / R - dIL / 2);
    // vC at the switch-on instant is not its average: integrate the triangular capacitor current
    // over one period and shift the seed so that the period average lands on Vo.
    const n = 400, dt = T / n, Io = Vo / R;
    let v = 0, acc = 0;
    for (let k = 0; k < n; k++) {
      const tm = (k + 0.5) * dt;
      const iL = tm < D * T ? IL0 + dIL * tm / (D * T) : IL0 + dIL - dIL * (tm - D * T) / ((1 - D) * T);
      v += (iL - Io) * dt / BUCK.C;
      acc += v * dt;
    }
    Vo = Vo - acc / T;
  } else { // DCM (ideal-device formula)
    Vo = Vs * 2 / (1 + Math.sqrt(1 + 4 * K / (D * D)));
    IL0 = 0;
  }
  return { Vo, IL0, dcm: K < 1 - D };
}

function buckNetlist(p, mode) {
  const { D, R } = p, T = 1 / BUCK.f, ton = D * T;
  const seed = buckSeed(p, mode);
  const tstop = seed.dcm ? 6e-3 : 3e-3;
  return {
    tstop,
    text: `* buck converter, D = ${D}, R = ${R} ohm, mode = ${mode}
VS vs 0 DC ${BUCK.Vs}
VG gate 0 PULSE(0 5 0 10n 10n ${(ton - 10e-9).toExponential(6)} ${T.toExponential(6)})
S1 vs sw gate 0 SWMOD
.model SWMOD SW(Ron=1m Roff=100Meg Vt=2.5 Vh=0)
D1 0 sw DMOD
.model DMOD ${BUCK_DIODE[mode].text}
L1 sw vo ${BUCK.L} IC=${seed.IL0.toFixed(6)}
C1 vo 0 ${BUCK.C} IC=${seed.Vo.toFixed(6)}
R1 vo 0 ${R}
.tran 0.2u ${tstop} 0 0.2u UIC
.end
`,
  };
}

function buckMeasure(vecs, p, mode, meta) {
  const t = vecs.time, T = 1 / BUCK.f;
  const t1 = meta.tstop, t0 = t1 - 10 * T; // last 10 whole periods
  const vo = stats(windowOf(t, vecs["v(vo)"], t0, t1));
  const il = stats(windowOf(t, vecs["i(l1)"], t0, t1));
  // Output ripple: peak-to-peak within each switching period, after removing the straight line
  // between the period's end points (in true steady state those are equal, so this is plain pp;
  // it stops any leftover slow LC swing of a short run from inflating the 0.1 V ripple).
  let ppSum = 0;
  for (let k = 0; k < 10; k++) {
    const w = windowOf(t, vecs["v(vo)"], t0 + k * T, t0 + (k + 1) * T);
    const a = w.ys[0], b = w.ys.at(-1), ta = w.ts[0], tb = w.ts.at(-1);
    const d = w.ys.map((y, i) => y - (a + (b - a) * (w.ts[i] - ta) / (tb - ta)));
    ppSum += Math.max(...d) - Math.min(...d);
  }
  const values = {
    Vo_avg: vo.avg, IL_avg: il.avg, dIL: il.max - il.min, IL_max: il.max, IL_min: il.min,
    dVo_pct: 100 * (ppSum / 10) / vo.avg,
  };
  const w0 = t1 - 3 * T;
  const wIl = windowOf(t, vecs["i(l1)"], w0, t1), wVo = windowOf(t, vecs["v(vo)"], w0, t1), wG = windowOf(t, vecs["v(gate)"], w0, t1);
  return {
    values,
    waves: {
      span: 3 * T,
      iL: thin(wIl.ts, wIl.ys, 480, w0),
      vo: thin(wVo.ts, wVo.ys, 480, w0),
      gate: thin(wG.ts, wG.ys.map(v => (v > 2.5 ? 1 : 0)), 480, w0),
    },
  };
}

function buckGap(p, mode, v) {
  const h = buckHand(p);
  if (!h.ccm) return `DCM: L is below Lmin = ${(h.Lmin * 1e6).toFixed(0)} µH, so iL touches zero each period and the Professor's CCM formulas no longer hold.`;
  if (mode === "ideal") return `Near-ideal diode (about 0.02 V) and 1 mΩ switch: Vo sits within 0.1% of D·Vs.`;
  return `Real diode drops about 0.8 V in the off-time, so Vo ≈ D·Vs − (1 − D)·VD, about ${(h.Vo_avg - v.Vo_avg).toFixed(2)} V below D·Vs.`;
}

// ============================== SCR ==============================
const SCR = { Vm: 120 * Math.SQRT2, f: 60, R: 10, Vrms: 120 };
const SCR_DIODE = {
  ideal: "D(IS=1n N=0.1 RS=1m)", // about 0.06 V at 15 A: the ideal thyristor
  real: "D(IS=1e-12 N=1.5 RS=5m)", // about 1 V: a realistic thyristor drop
};

function scrHand({ alpha }) {
  const a = alpha * Math.PI / 180, { Vm, R, Vrms } = SCR;
  const Vo_av = Vm / TWO_PI * (1 + Math.cos(a));
  const Vo_rms = Vm / 2 * Math.sqrt(Math.max(0, 1 - a / Math.PI + Math.sin(2 * a) / TWO_PI));
  const Po = Vo_rms ** 2 / R, Io_rms = Vo_rms / R;
  return { Vo_av, Io_av: Vo_av / R, Vo_rms, Io_rms, Po, pf: Io_rms > 0 ? Po / (Vrms * Io_rms) : 0 };
}

function scrNetlist({ alpha }, mode) {
  const tper = 1 / SCR.f, tdel = alpha / 360 / SCR.f, tstop = 3 * tper;
  return {
    tstop,
    text: `* half-wave SCR rectifier, R load, alpha = ${alpha} deg, mode = ${mode}
VS vs 0 SIN(0 ${SCR.Vm} ${SCR.f} 0 0 0)
S1 vs a1 ctl 0 SWSCR
D1 a1 a2 DSCR
VIT a2 vo DC 0
R1 vo 0 ${SCR.R}
VG gp 0 PULSE(0 5 ${tdel.toExponential(6)} 1u 1u 0.5m ${tper.toExponential(8)})
BCT cr 0 V = u(v(gp) - 2.5) + u(i(VIT) - 0.01)
RCT cr ctl 1k
CCT ctl 0 1n
.model SWSCR SW(VT=0.5 VH=0.1 RON=1m ROFF=1G)
.model DSCR ${SCR_DIODE[mode]}
.tran 10u ${tstop.toExponential(8)} 0 10u
.end
`,
  };
}

function scrMeasure(vecs, p, mode, meta) {
  const t = vecs.time, tper = 1 / SCR.f, t0 = tper, t1 = 3 * tper; // two whole cycles
  const vo = stats(windowOf(t, vecs["v(vo)"], t0, t1));
  const io = stats(windowOf(t, vecs["i(vit)"], t0, t1));
  const vs = stats(windowOf(t, vecs["v(vs)"], t0, t1));
  // Load power = <vo·io> over the window.
  const w = windowOf(t, vecs["v(vo)"], t0, t1), wi = windowOf(t, vecs["i(vit)"], t0, t1);
  const P = stats({ ts: w.ts, ys: w.ys.map((v, i) => v * wi.ys[i]) }).avg;
  const values = { Vo_av: vo.avg, Io_av: io.avg, Vo_rms: vo.rms, Io_rms: io.rms, Po: P, pf: io.rms > 1e-9 ? P / (vs.rms * io.rms) : 0 };
  const a = windowOf(t, vecs["v(vs)"], tper, 2 * tper), b = windowOf(t, vecs["v(vo)"], tper, 2 * tper), c = windowOf(t, vecs["i(vit)"], tper, 2 * tper);
  return { values, waves: { span: tper, vs: thin(a.ts, a.ys, 420, tper), vo: thin(b.ts, b.ys, 420, tper), io: thin(c.ts, c.ys, 420, tper) } };
}

function scrGap(p, mode, v) {
  if (mode === "ideal") return `Near-ideal thyristor (about 0.06 V on-state): every value within 0.2% of the Professor's formula.`;
  const h = scrHand(p);
  return `Real thyristor drops about 1 V while it conducts, so Vo,av reads ${(h.Vo_av - v.Vo_av).toFixed(2)} V (${(100 * (h.Vo_av - v.Vo_av) / (h.Vo_av || 1)).toFixed(1)}%) under the formula.`;
}

// ============================== CE AMP ==============================
const CE = { VCC: 20, RB: 430e3, RE: 1e3, VBE: 0.7, VT: 0.025, fin: 10e3, fz: 15e3, vin: 2e-3, itest: 10e-6 };

function ceHand({ beta, RC }) {
  const { VCC, RB, RE, VBE, VT } = CE;
  const IB = (VCC - VBE) / (RB + (beta + 1) * RE);
  const IC = beta * IB, IE = (beta + 1) * IB;
  const VCE = VCC - IC * RC - IE * RE;
  const re = VT / IE;
  const Zi = 1 / (1 / RB + 1 / (beta * re));
  return { IBQ_uA: IB * 1e6, ICQ_mA: IC * 1e3, IEQ_mA: IE * 1e3, VCEQ: VCE, re_ohm: re, Av: -RC / re, Zi_ohm: Zi, Zo_ohm: RC, saturated: VCE < 0.2 };
}

function ceModel(p, mode) {
  if (mode === "ideal") {
    // The Professor's assumptions: VT = 25 mV (ngspice at 16.96 °C) and VBE = 0.700 V exactly at the
    // hand-analysis collector current, no Early effect.
    const Tk = CE.VT / K_OVER_Q, Tc = Tk - 273.15;
    const IS = (ceHand(p).ICQ_mA * 1e-3) / Math.exp(CE.VBE / CE.VT);
    return { model: `NPN(IS=${IS.toExponential(6)} BF=${p.beta})`, options: `.options temp=${Tc.toFixed(4)} tnom=${Tc.toFixed(4)}` };
  }
  // Real device: 27 °C (VT = 25.85 mV), the circuits/ce-amp junction (IS = 3.5e-15), and an
  // Early voltage of 100 V (a typical small-signal NPN; assumed, not from the sheet).
  return { model: `NPN(IS=3.5e-15 BF=${p.beta} VAF=100)`, options: "" };
}

function ceNetlist(p, mode) {
  const m = ceModel(p, mode);
  return {
    tstop: 1e-3,
    text: `* CE amplifier, fixed bias, bypassed emitter; beta = ${p.beta}, RC = ${p.RC} ohm, mode = ${mode}
VCC vcc 0 DC ${CE.VCC}
VI vi 0 DC 0 SIN(0 ${CE.vin} ${CE.fin})
C1 vi b 10u
RB vcc b ${CE.RB}
RC vcc c ${p.RC}
Q1 c b e QNPN
RE e 0 ${CE.RE}
CE e 0 40u
C2 c vo 10u
RPROBE vo 0 10Meg
* output test current at 15 kHz: Zo = vo(15k) / it(15k), separated from the 10 kHz signal by Fourier projection
IT 0 vo DC 0 SIN(0 ${CE.itest} ${CE.fz})
.model QNPN ${m.model}
${m.options}
.tran 0.2u 1m 0 0.2u
.end
`,
  };
}

function ceMeasure(vecs, p, mode) {
  const t = vecs.time, at0 = k => vecs[k][0]; // .tran starts from the DC operating point
  const vb = at0("v(b)"), vc = at0("v(c)"), ve = at0("v(e)");
  const IB = (CE.VCC - vb) / CE.RB - 0; // RB current = base current at DC (C1 blocks DC)
  const IC = (CE.VCC - vc) / p.RC, IE = ve / CE.RE;
  const W = [0.6e-3, 1e-3]; // 4 cycles of 10 kHz, 6 cycles of 15 kHz
  const P = (name, f) => phasor(windowOf(t, vecs[name], W[0], W[1]), f);
  const vi = P("v(vi)", CE.fin), vo = P("v(vo)", CE.fin), vbA = P("v(b)", CE.fin), veA = P("v(e)", CE.fin), vcA = P("v(c)", CE.fin);
  const iin = cscale(P("i(vi)", CE.fin), -1); // current delivered by the source into C1
  const Avc = cdiv(vo, vi), Av = Math.sign(Avc.re) * cabs(Avc);
  const Zi = cabs(cdiv(vi, iin));
  const vo15 = P("v(vo)", CE.fz), Zo = cabs(vo15) / CE.itest;
  // r'e seen by the signal: vbe / ie, with ie = ic + ib (ic through RC, ib = iin minus the RB branch)
  const vbe = { re: vbA.re - veA.re, im: vbA.im - veA.im };
  const ic = cscale(vcA, -1 / p.RC), ib = cadd(iin, cscale(vbA, -1 / CE.RB));
  const re = cabs(vbe) / cabs(cadd(ic, ib));
  const values = { IBQ_uA: IB * 1e6, ICQ_mA: IC * 1e3, IEQ_mA: IE * 1e3, VCEQ: vc - ve, re_ohm: re, Av, Zi_ohm: Zi, Zo_ohm: Zo };
  const T = 1 / CE.fin, w = windowOf(t, vecs["v(c)"], 1e-3 - 2 * T, 1e-3), we = windowOf(t, vecs["v(e)"], 1e-3 - 2 * T, 1e-3);
  const vce = w.ys.map((v, i) => v - we.ys[i]);
  return { values, waves: { span: 2 * T, vce: thin(w.ts, vce, 400, 1e-3 - 2 * T), VCEQ: vc - ve, VBE: vb - ve } };
}

function ceGap(p, mode, v) {
  const h = ceHand(p);
  if (h.saturated) return `Saturated: the hand formula gives VCE = ${h.VCEQ.toFixed(2)} V, but a real collector cannot fall below about 0.2 V; the small-signal key no longer applies.`;
  if (mode === "ideal") return `Left after the idealisation: the course takes r'e = VT/IE but the transistor's gain follows IC, so Av and Zi read about 1/β (${(100 / (p.beta + 1)).toFixed(1)}%) off.`;
  const dIC = 100 * (v.ICQ_mA / h.ICQ_mA - 1), ro = 100 / (v.ICQ_mA * 1e-3);
  return `Real NPN at 27 °C with a 100 V Early voltage (assumed): IC is ${dIC >= 0 ? "+" : ""}${dIC.toFixed(0)}% off the hand value (effective β grows with VCE), and ro ≈ ${(ro / 1000).toFixed(0)} kΩ shunts RC, pulling Zo down.`;
}

// ============================== registry ==============================
export const CIRCUITS = {
  buck: {
    id: "buck", title: "Buck converter", source: "Lecture Example 2", answer: "Vo_avg",
    given: "Vs = 50 V · L = 400 µH · C = 100 µF · f = 20 kHz",
    params: [
      { id: "D", label: "Duty cycle D", sym: "D", min: 0.1, max: 0.9, step: 0.05, value: 0.4, fmt: v => v.toFixed(2), unit: "" },
      { id: "R", label: "Load R", sym: "R", min: 5, max: 50, step: 1, value: 20, fmt: v => v.toFixed(0), unit: "Ω" },
    ],
    rows: [
      { id: "Vo_avg", sym: "V<sub>o</sub>", unit: "V", dp: 2 },
      { id: "IL_avg", sym: "I<sub>L</sub>", unit: "A", dp: 3 },
      { id: "dIL", sym: "Δi<sub>L</sub>", unit: "A", dp: 3 },
      { id: "IL_max", sym: "I<sub>max</sub>", unit: "A", dp: 3 },
      { id: "IL_min", sym: "I<sub>min</sub>", unit: "A", dp: 3 },
      { id: "dVo_pct", sym: "ΔV<sub>o</sub>/V<sub>o</sub>", unit: "%", dp: 2 },
    ],
    hand: buckHand, netlist: buckNetlist, measure: buckMeasure, gap: buckGap,
    isKeyPoint: p => p.D === 0.4 && p.R === 20,
  },
  scr: {
    id: "scr", title: "Half-wave SCR rectifier", source: "Lecture Example 5", answer: "Vo_av",
    given: "120 V rms · 60 Hz · R = 10 Ω",
    params: [{ id: "alpha", label: "Firing angle <span class=\"gk\">α</span>", sym: "α", min: 0, max: 165, step: 5, value: 60, fmt: v => v.toFixed(0), unit: "°" }],
    rows: [
      { id: "Vo_av", sym: "V<sub>o,av</sub>", unit: "V", dp: 2 },
      { id: "Io_av", sym: "I<sub>o,av</sub>", unit: "A", dp: 3 },
      { id: "Vo_rms", sym: "V<sub>o,rms</sub>", unit: "V", dp: 2 },
      { id: "Io_rms", sym: "I<sub>o,rms</sub>", unit: "A", dp: 3 },
      { id: "Po", sym: "P<sub>o</sub>", unit: "W", dp: 1 },
      { id: "pf", sym: "pf", unit: "", dp: 3 },
    ],
    hand: scrHand, netlist: scrNetlist, measure: scrMeasure, gap: scrGap,
    isKeyPoint: p => p.alpha === 60,
  },
  "ce-amp": {
    id: "ce-amp", title: "CE amplifier", source: "Sheet 5, circuit (i)", answer: "Av",
    given: "VCC = 20 V · RB = 430 kΩ · RE = 1 kΩ bypassed",
    params: [
      { id: "beta", label: "Current gain <span class=\"gk\">β</span>", sym: "β", min: 20, max: 200, step: 5, value: 50, fmt: v => v.toFixed(0), unit: "" },
      { id: "RC", label: "Collector RC", sym: "R<sub>C</sub>", min: 500, max: 10000, step: 100, value: 2000, fmt: v => (v / 1000).toFixed(1), unit: "kΩ" },
    ],
    rows: [
      { id: "IBQ_uA", sym: "I<sub>BQ</sub>", unit: "µA", dp: 2 },
      { id: "ICQ_mA", sym: "I<sub>CQ</sub>", unit: "mA", dp: 3 },
      { id: "IEQ_mA", sym: "I<sub>EQ</sub>", unit: "mA", dp: 3 },
      { id: "VCEQ", sym: "V<sub>CEQ</sub>", unit: "V", dp: 2 },
      { id: "re_ohm", sym: "r′<sub>e</sub>", unit: "Ω", dp: 2 },
      { id: "Av", sym: "A<sub>v</sub>", unit: "", dp: 1 },
      { id: "Zi_ohm", sym: "Z<sub>i</sub>", unit: "Ω", dp: 0 },
      { id: "Zo_ohm", sym: "Z<sub>o</sub>", unit: "Ω", dp: 0 },
    ],
    hand: ceHand, netlist: ceNetlist, measure: ceMeasure, gap: ceGap,
    isKeyPoint: p => p.beta === 50 && p.RC === 2000,
  },
};

export function defaults(id) { return Object.fromEntries(CIRCUITS[id].params.map(q => [q.id, q.value])); }

// The Professor's column: his key at the example's own values, the hand formula elsewhere.
export function professor(id, p, key) {
  const c = CIRCUITS[id], h = c.hand(p);
  if (key && c.isKeyPoint(p)) return { values: { ...h, ...pick(key, c.rows.map(r => r.id)) }, from: "key" };
  return { values: h, from: "formula" };
}
function pick(o, ks) { return Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]])); }

// Run one solve on an eecircuit-engine Simulation instance.
export async function solve(sim, id, p, mode) {
  const c = CIRCUITS[id];
  const net = c.netlist(p, mode);
  sim.setNetList(net.text);
  const res = await sim.runSim();
  const vecs = {};
  for (const d of res.data) vecs[d.name.toLowerCase()] = d.values;
  if (!vecs.time) throw new Error("ngspice returned no transient: " + (sim.getError?.() ?? []).join(" "));
  const m = c.measure(vecs, p, mode, net);
  return { ...m, gap: c.gap(p, mode, m.values), points: res.numPoints };
}
