// PROTOTYPE (throwaway): candidate B, CircuitJS re-skinned toward the pad, driven from outside.
// Slider and toggle changes edit the circuits/ CircuitJS text and re-import it; readouts are measured
// live from CircuitJS through window.CircuitJS1 (same-origin iframe).
import { CIRCUITS, defaults, professor, buckSeed } from "./pad-native-spice.engine.mjs";

const $ = s => document.querySelector(s);
const RM = matchMedia("(prefers-reduced-motion: reduce)");
const KEY = await fetch("../../circuits/expected.json").then(r => r.json()).catch(() => null);
const FILES = { buck: "buck/circuitjs-steady.txt", scr: "scr/circuitjs.txt", "ce-amp": "ce-amp/circuitjs.txt" };
const TEXT = Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([k, f]) => [k, (await fetch("../../circuits/" + f).then(r => r.text())).trim()])));

// CircuitJS's default junction (dump type 34: name flags Is Rs N Vbreak). Ideal = a near-ideal one.
const DIODE = { real: "34 default 0 1.7143528e-7 0 2 0", ideal: "34 default 0 1e-6 0 0.1 0" };
const MODE_NOTE = {
  buck: { ideal: "Near-ideal diode: CircuitJS's default junction redefined to about 0.07 V.", real: "CircuitJS's own default diode, about 0.8 V at 1 A." },
  scr: { ideal: "Near-ideal thyristor: the SCR's internal junction redefined to about 0.07 V.", real: "CircuitJS's own SCR: default junction, about 0.9 V on-state." },
  "ce-amp": { ideal: "The file's transistor: VBE = 0.70 V at the Q-point, no Early effect.", real: "Adds an assumed 100 V Early voltage to the transistor." },
};

// ---------------------------------------------------------------- circuit text editing
const lines = t => t.split("\n");
function editLine(text, test, fn) { return lines(text).map(l => (test(l) ? fn(l.split(" ")).join(" ") : l)).join("\n"); }
function buildText(id, p, mode) {
  let t = TEXT[id];
  const [head, ...rest] = lines(t);
  if (id === "buck") {
    const seed = buckSeed(p, mode);
    t = editLine(t, l => l.startsWith("v 192 208"), a => (a[a.length - 1] = String(p.D), a));
    t = editLine(t, l => l.startsWith("r 512 96"), a => (a[6] = String(p.R), a));
    t = editLine(t, l => l.startsWith("l 288 96"), a => (a[7] = a[8] = seed.IL0.toFixed(4), a));
    t = editLine(t, l => l.startsWith("c 416 96"), a => (a[7] = a[8] = seed.Vo.toFixed(4), a));
  } else if (id === "scr") {
    const ph = (2 * Math.PI - p.alpha * Math.PI / 180) % (2 * Math.PI);
    t = editLine(t, l => l.startsWith("v 352 176"), a => (a[10] = String(ph), a));
    t = t.replace("gate pulse at alpha = 60 deg", `gate pulse at alpha = ${p.alpha} deg`);
  } else {
    t = editLine(t, l => l.startsWith("t 256 208"), a => (a[9] = String(p.beta), a));
    t = editLine(t, l => l.startsWith("r 304 64 304 160"), a => (a[6] = String(p.RC), a));
    t = editLine(t, l => l.startsWith("32 ce-npn"), a => (a[12] = mode === "real" ? "0.01" : "0", a));
  }
  const [h2, ...body] = lines(t);
  return [h2, id === "ce-amp" ? null : DIODE[mode], ...body].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- live measurement
// Each circuit: which elements to read, the averaging window, and how to turn samples into values.
const MEAS = {
  buck: {
    W: 10 / 20e3, settle: 5 / 20e3,
    pick: els => ({ L: els.find(e => e.getType() === "InductorElm") }),
    sample: (api, E) => ({ vo: api.getNodeVoltage("vo"), iL: E.L.getCurrent() }),
    summarize(S) {
      const vo = stats(S, "vo"), il = stats(S, "iL"), T = 1 / 20e3;
      let pp = 0, n = 0;
      for (let k = 0; k < 10; k++) { const seg = S.filter(s => s.t >= S[0].t + k * T && s.t < S[0].t + (k + 1) * T); if (seg.length > 3) { const v = seg.map(s => s.vo); pp += Math.max(...v) - Math.min(...v); n++; } }
      return { Vo_avg: vo.avg, IL_avg: il.avg, dIL: il.max - il.min, IL_max: il.max, IL_min: il.min, dVo_pct: 100 * (pp / n) / vo.avg };
    },
  },
  scr: {
    W: 1 / 60, settle: 0.2 / 60,
    pick: els => ({ R: els.find(e => e.getType() === "ResistorElm"), VS: els.find(e => /Voltage|AC/.test(e.getType())) }),
    sample: (api, E) => { const vo = E.R.getVoltageDiff(); return { vo, io: vo / 10, vs: E.VS.getVoltageDiff() }; },
    summarize(S) {
      const vo = stats(S, "vo"), io = stats(S, "io"), vs = stats(S, "vs");
      const P = stats(S.map(s => ({ t: s.t, p: s.vo * s.io })), "p").avg;
      return { Vo_av: vo.avg, Io_av: io.avg, Vo_rms: vo.rms, Io_rms: io.rms, Po: P, pf: P / (vs.rms * io.rms) };
    },
  },
  "ce-amp": {
    W: 5e-4, settle: 3e-4,
    pick(els) { const R = els.filter(e => e.getType() === "ResistorElm"), V = els.filter(e => e.getType() === "VoltageElm" || e.getType() === "ACVoltageElm"); return { RB: R[0], RC: R[1], RE: R[2], RP: R[3], VI: V[V.length - 1] }; },
    sample: (api, E) => ({ vrb: E.RB.getVoltageDiff(), vrc: E.RC.getVoltageDiff(), vre: E.RE.getVoltageDiff(), vo: E.RP.getVoltageDiff(), vi: E.VI.getVoltageDiff(), ii: E.VI.getCurrent() }),
    summarize(S, p) {
      const m = k => stats(S, k), vrb = m("vrb").avg, vrc = m("vrc").avg, vre = m("vre").avg, vo = m("vo"), vi = m("vi"), ii = m("ii");
      const corr = S.reduce((a, s) => a + (s.vo - vo.avg) * (s.vi - vi.avg), 0);
      const IC = vrc / p.RC;
      return { IBQ_uA: vrb / 430e3 * 1e6, ICQ_mA: IC * 1e3, IEQ_mA: vre / 1e3 * 1e3, VCEQ: 20 - vrc - vre, re_ohm: NaN,
        Av: Math.sign(corr) * (vo.max - vo.min) / (vi.max - vi.min), Zi_ohm: (vi.max - vi.min) / (ii.max - ii.min), Zo_ohm: NaN };
    },
  },
};
function stats(S, k) {
  let a = 0, s2 = 0, mx = -Infinity, mn = Infinity;
  for (let i = 0; i < S.length; i++) { const y = S[i][k]; if (y > mx) mx = y; if (y < mn) mn = y; if (i) { const dt = S[i].t - S[i - 1].t, y0 = S[i - 1][k]; a += dt * (y + y0) / 2; s2 += dt * (y * y + y0 * y0) / 2; } }
  const T = S.at(-1).t - S[0].t;
  return { avg: a / T, rms: Math.sqrt(s2 / T), max: mx, min: mn };
}

// ---------------------------------------------------------------- state + iframe
const q = new URLSearchParams(location.search).get("circuit");
const st = { id: CIRCUITS[q] ? q : "buck", params: null, mode: "ideal", api: null, E: null, S: [], t0: 0, gen: 0, windows: 0 };
const frame = $("#cjs");
const CJS_URL = "../../vendor/circuitjs/circuitjs.html?hideSidebar=true&hideMenu=true&editable=false&whiteBackground=true&hideInfoBox=true&mouseWheelEdit=false&neutralColor=%233D433C";
function waitApi() {
  return new Promise(res => { const iv = setInterval(() => { const a = frame.contentWindow?.CircuitJS1; if (a) { clearInterval(iv); res(a); } }, 100); });
}
async function load() {
  const text = buildText(st.id, st.params, st.mode);
  if (!st.api) {
    frame.src = CJS_URL + "&cct=" + encodeURIComponent(text);
    st.api = await waitApi();
    st.api.ontimestep = onStep;
  } else st.api.importCircuit(text, false);
  st.gen++; st.S = []; st.windows = 0; st.E = null; st.t0 = null;
  setStatus("Settling");
  $("#readout").classList.add("busy");
}
function onStep(api) {
  const M = MEAS[st.id];
  if (!st.E) { try { st.E = M.pick(api.getElements()); if (Object.values(st.E).some(x => !x)) { st.E = null; return; } } catch { st.E = null; return; } }
  const t = api.getTime();
  if (st.t0 == null || t < st.t0) st.t0 = t;
  if (t - st.t0 < M.settle) return;
  st.S.push({ t, ...M.sample(api, st.E) });
  if (st.S.at(-1).t - st.S[0].t >= M.W) {
    const v = M.summarize(st.S, st.params);
    st.S = [];
    st.windows++;
    show(v);
  }
}

// ---------------------------------------------------------------- view
function fmt(v, dp) { if (!Number.isFinite(v)) return "—"; const s = Math.abs(v) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : v.toFixed(dp); return s.replace("-", "−"); }
function setStatus(txt, busy = true) { $("#status-txt").textContent = txt; $("#status").classList.toggle("busy", busy && !RM.matches); }
function show(v) {
  const c = CIRCUITS[st.id], P = professor(st.id, st.params, KEY?.[st.id]);
  $("#prof-h").innerHTML = `Professor<span class="th-sub">${P.from === "key" ? "his key" : "hand formula"}</span>`;
  for (const row of c.rows) {
    const tr = $(`#readout tr[data-r="${row.id}"]`), sv = v[row.id], pv = P.values[row.id];
    tr.querySelector(".sim .v").textContent = fmt(sv, row.dp);
    tr.querySelector(".prof .v").textContent = fmt(pv, row.dp);
    const g = Number.isFinite(sv) && Math.abs(pv) > 1e-9 ? 100 * (sv - pv) / Math.abs(pv) : NaN;
    tr.querySelector(".gap").textContent = Number.isFinite(g) ? `${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)}%` : "—";
  }
  $("#readout").classList.remove("busy");
  setStatus(`Live, window ${st.windows}`, false);
  if (st.windows === 1) ring(c.answer);
  gapNote(v);
  window.__lastB = { id: st.id, mode: st.mode, params: { ...st.params }, values: v };
}
function gapNote(v) {
  const h = CIRCUITS[st.id].hand(st.params), g = $("#gapnote");
  let txt = "", warn = false;
  if (st.id === "buck") {
    if (!h.ccm) { warn = true; txt = `DCM: L is below Lmin = ${(h.Lmin * 1e6).toFixed(0)} µH, so the Professor's CCM formulas no longer hold.`; }
    else txt = st.mode === "ideal" ? `Near-ideal diode: Vo sits ${(h.Vo_avg - v.Vo_avg).toFixed(2)} V under D·Vs (its 0.07 V drop over the off-time).` : `CircuitJS's diode drops about 0.8 V in the off-time: Vo ≈ D·Vs − (1 − D)·VD, ${(h.Vo_avg - v.Vo_avg).toFixed(2)} V under the key.`;
  } else if (st.id === "scr") {
    txt = st.mode === "ideal" ? `Near-ideal thyristor: Vo,av within ${Math.abs(100 * (v.Vo_av - h.Vo_av) / h.Vo_av).toFixed(1)}% of (Vm/2π)(1 + cos α).` : `CircuitJS's SCR drops about 0.9 V while it conducts, so Vo,av reads ${(h.Vo_av - v.Vo_av).toFixed(2)} V under the formula.`;
  } else {
    if (h.saturated) { warn = true; txt = `Saturated: the hand formula gives VCE = ${h.VCEQ.toFixed(2)} V; a real collector cannot go below about 0.2 V.`; }
    else txt = st.mode === "ideal" ? `Left after the idealisation: CircuitJS fixes VT at 25.9 mV (27 °C) and the gain follows IC, so Av and Zi read about 5% off the course's 25 mV / IE key.` : `CircuitJS with an assumed 100 V Early voltage: IC reads ${(100 * (v.ICQ_mA / h.ICQ_mA - 1)).toFixed(1)}% and Av ${(100 * (v.Av / h.Av - 1)).toFixed(1)}% off the hand values (VT is still 25.9 mV).`;
  }
  g.className = "gapnote" + (warn ? " warn" : ""); g.innerHTML = (warn ? "<b>Watch out.</b> " : "") + txt;
}
function ring(rowId) {
  document.querySelectorAll(".ring").forEach(n => n.remove());
  const td = $(`#readout tr[data-r="${rowId}"] .sim`); if (!td) return;
  td.insertAdjacentHTML("beforeend", `<svg class="ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" d="M12 25 C 8 10, 40 3, 62 4.5 C 88 6, 98 14, 95 24 C 92 34, 64 38, 42 36.5 C 18 35, 3 29, 8 18 C 11 12, 18 9, 24 7.5"/></svg>`);
  if (!RM.matches) { const p = td.querySelector(".ring path"); p.style.strokeDasharray = "1 1"; p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 520, easing: "cubic-bezier(.37,0,.63,1)", fill: "backwards" }); }
}
const unitTxt = q => !q.unit ? "" : q.unit === "°" ? "°" : " " + q.unit;
const HINTS = {
  buck: "Live CircuitJS: green is higher voltage, the yellow dots are current. Scopes: vo on R, iL. It runs at about 1 ms of circuit time per second.",
  scr: "Live CircuitJS: the SCR fires once per cycle at α. Scopes: vo on R and the source vs.",
  "ce-amp": "Live CircuitJS, starting from its DC operating point. Scopes: vi and vo (inverted, about 155× larger).",
};
function mount(id) {
  st.id = id; st.params = defaults(id);
  const c = CIRCUITS[id];
  document.querySelectorAll("#picker button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
  $("#given").innerHTML = `<span class="label">Given</span><span class="qty">${c.given}</span><span class="src">${c.source}</span>`;
  $("#mode-note").textContent = MODE_NOTE[id][st.mode];
  $("#hint").textContent = HINTS[id];
  $("#table-title").textContent = c.title;
  $("#sliders").innerHTML = c.params.map(q => `
    <div class="ctl"><div class="ctl-head"><label class="label" for="p-${q.id}">${q.label}</label>
      <span class="ctl-val" id="v-${q.id}">${q.fmt(st.params[q.id])}<small>${unitTxt(q)}</small></span></div>
      <input class="range" type="range" id="p-${q.id}" min="${q.min}" max="${q.max}" step="${q.step}" value="${st.params[q.id]}">
      <div class="ticks" aria-hidden="true"><span>${q.fmt(q.min)}</span><span>example ${q.fmt(q.value)}</span><span>${q.fmt(q.max)}</span></div></div>`).join("");
  for (const q of c.params) {
    const el = $(`#p-${q.id}`);
    el.addEventListener("input", () => { st.params[q.id] = +el.value; $(`#v-${q.id}`).innerHTML = `${q.fmt(+el.value)}<small>${unitTxt(q)}</small>`; $("#reset").hidden = c.isKeyPoint(st.params); });
    el.addEventListener("change", () => load()); // re-import on release: CircuitJS restarts the run each time
  }
  $("#reset").hidden = true;
  $("#readout tbody").innerHTML = c.rows.map(r => `<tr data-r="${r.id}"><td class="q">${r.sym}</td><td class="num sim"><span class="v">…</span><span class="u">${r.unit}</span></td><td class="num prof"><span class="v"></span><span class="u">${r.unit}</span></td><td class="gap"></td></tr>`).join("");
  $("#gapnote").textContent = "";
  load();
}
$("#picker").addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.dataset.id !== st.id) mount(b.dataset.id); });
$("#mode").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.dataset.mode === st.mode) return;
  st.mode = b.dataset.mode;
  document.querySelectorAll("#mode button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  $("#mode-note").textContent = MODE_NOTE[st.id][st.mode];
  load();
});
$("#reset").addEventListener("click", () => {
  const c = CIRCUITS[st.id]; st.params = defaults(st.id);
  for (const q of c.params) { $(`#p-${q.id}`).value = q.value; $(`#v-${q.id}`).innerHTML = `${q.fmt(q.value)}<small>${unitTxt(q)}</small>`; }
  $("#reset").hidden = true; load();
});
mount(st.id);
