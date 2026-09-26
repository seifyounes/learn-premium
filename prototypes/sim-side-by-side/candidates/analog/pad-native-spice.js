// PROTOTYPE (throwaway): the view for candidate C, "pad-native-spice".
// Engine and numbers: pad-native-spice.engine.mjs, solved by ngspice-WASM in pad-native-spice.worker.mjs.
// Motion: plain Web Animations + one requestAnimationFrame loop (no library): strokes draw, values
// land in hand order, the red ring draws last; current dots replay the solved currents.
import { CIRCUITS, defaults, professor } from "./pad-native-spice.engine.mjs";

const $ = s => document.querySelector(s);
const RM = matchMedia("(prefers-reduced-motion: reduce)");
const KEY = await fetch("../../circuits/expected.json").then(r => r.json()).catch(() => null);
const EASE = "cubic-bezier(.22, 1, .36, 1)";

// ------------------------------------------------------------------ schematics (hand-drawn SVG)
const res = (x, y, dir = "v", n = 6, a = 9, len = 60) => { // zigzag resistor starting at (x,y)
  const s = len / (n * 2); let d = `M${x} ${y}`;
  if (dir === "v") { d += ` l${a} ${s}`; for (let i = 0; i < n - 1; i++) d += ` l${-2 * a * (i % 2 ? -1 : 1)} ${2 * s}`; d += ` l${a * (n % 2 ? -1 : 1)} ${s}`; }
  else { d += ` l${s} ${-a}`; for (let i = 0; i < n - 1; i++) d += ` l${2 * s} ${2 * a * (i % 2 ? -1 : 1)}`; d += ` l${s} ${a * (n % 2 ? 1 : -1)}`; }
  return `<path class="sym" d="${d}"/>`;
};
const lbl = (x, y, t, cls = "", anchor = "start", p = "") => `<text class="lbl ${cls}" x="${x}" y="${y}" text-anchor="${anchor}"${p ? ` data-p="${p}"` : ""}>${t}</text>`;
const dot = (x, y) => `<circle class="node" cx="${x}" cy="${y}" r="3.6"/>`;
const term = (x, y) => `<circle class="term" cx="${x}" cy="${y}" r="5"/>`;

const SCHEMS = {
  buck: {
    W: 660, H: 290,
    body: () => `
      <path class="wire" d="M70 138 V70 H150 M198 70 H300 M380 70 H440 M250 70 V132 M250 166 V230 M440 70 V146 M440 158 V230 M440 70 H540 V116 M540 184 V230 M70 182 V230 H616 M540 70 H616"/>
      <circle class="sym" cx="70" cy="160" r="22"/><path class="sym" d="M70 146 v8 M66 150 h8 M66 171 h8"/>
      <g class="blade" id="blade" style="transform-origin:150px 70px"><path class="sym" d="M150 70 L198 70"/></g>
      <circle class="term" cx="150" cy="70" r="3.8"/><circle class="term" cx="198" cy="70" r="3.8"/>
      <g id="diode"><path class="sym" d="M236 166 H264 L250 140 Z M234 132 H266"/></g>
      <path class="sym" d="M300 70 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0"/>
      <path class="sym" d="M422 146 H458 M422 158 H458"/>
      ${res(540, 116, "v", 6, 9, 68)}
      ${dot(250, 70)}${dot(440, 70)}${dot(250, 230)}${dot(440, 230)}${dot(540, 70)}${dot(540, 230)}
      ${term(616, 70)}${term(616, 230)}
      <path class="flow" data-b="sTop" d="M70 138 V70 H150"/><path class="flow" data-b="sMid" d="M150 70 H198"/><path class="flow" data-b="sSw" d="M198 70 H250"/>
      <path class="flow" data-b="dBot" d="M250 230 V166"/><path class="flow" data-b="dTop" d="M250 132 V70"/>
      <path class="flow" data-b="L" d="M250 70 H440"/>
      <path class="flow" data-b="C1" d="M440 70 V146"/><path class="flow" data-b="C2" d="M440 158 V230"/>
      <path class="flow" data-b="R" d="M440 70 H540 V230"/>
      <path class="flow" data-b="bR" d="M540 230 H440"/><path class="flow" data-b="bL" d="M440 230 H250"/><path class="flow" data-b="bS" d="M250 230 H70 V182"/>
      ${lbl(38, 150, "V", "name", "end")}${lbl(38, 172, "50 V", "val", "end")}
      ${lbl(174, 104, "S", "name", "middle")}
      ${lbl(276, 150, "D", "name")}
      ${lbl(340, 42, "L", "name", "middle")}${lbl(340, 104, "400 µH", "val", "middle")}
      ${lbl(468, 150, "C", "name")}${lbl(468, 172, "100 µF", "val")}
      ${lbl(562, 144, "R", "name")}${lbl(562, 166, "20 Ω", "val", "start", "R")}
      ${lbl(628, 76, "+")}${lbl(628, 156, "v", "name")}${lbl(628, 236, "−")}
      ${lbl(330, 264, "i", "cur", "end")}<path d="M338 258 H372 m-7 -5 l7 5 l-7 5" fill="none" stroke="var(--current)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
    subs: { V: "s", v: "o", i: "L →" },
    flows(s, st) {
      const g = s.gate > .5, iL = s.iL, io = s.vo / st.params.R, iS = g ? iL : 0, iD = g ? 0 : iL;
      return { sTop: iS, sMid: iS, sSw: iS, bS: iS, dBot: iD, dTop: iD, L: iL, bL: iL, C1: iL - io, C2: iL - io, R: io, bR: io };
    },
    scale: 45, // px/s per ampere
    states(svg, s) {
      svg.querySelector("#blade").style.transform = s.gate > .5 ? "rotate(0deg)" : "rotate(-26deg)";
      svg.querySelector("#diode path").classList.toggle("on", s.gate <= .5 && s.iL > .01);
    },
    probe: (s, t) => `t = <b>${(t * 1e6).toFixed(1).padStart(5, " ")} µs</b> · S ${s.gate > .5 ? "<b>on</b>" : "off"} · <span class="i">i<sub>L</sub> = ${s.iL.toFixed(2)} A</span> · v<sub>o</sub> = ${s.vo.toFixed(2)} V`,
  },
  scr: {
    W: 660, H: 290,
    body: () => `
      <path class="wire" d="M80 130 V80 H232 M262 80 H520 V124 M520 186 V230 H80 V180 M520 80 H590 M520 230 H590 M262 88 L284 112 V134"/>
      <circle class="sym" cx="80" cy="155" r="24"/><path class="sym" d="M66 155 c4 -12 10 -12 14 0 s10 12 14 0"/>
      <g id="scr"><path class="sym" d="M232 64 V96 L262 80 Z M262 64 V96"/></g>
      ${res(520, 124, "v", 6, 9, 62)}
      ${dot(520, 80)}${dot(520, 230)}${term(590, 80)}${term(590, 230)}${term(284, 138)}
      <path class="flow" data-b="a" d="M80 130 V80 H232"/><path class="flow" data-b="b" d="M232 80 H262"/><path class="flow" data-b="c" d="M262 80 H520 V230 H80 V180"/>
      ${lbl(44, 150, "v", "name", "end")}${lbl(44, 172, "120 V", "val", "end")}${lbl(44, 192, "60 Hz", "val", "end")}
      ${lbl(247, 50, "T", "name", "middle")}
      ${lbl(298, 144, "gate at α", "val")}
      ${lbl(380, 64, "i", "cur", "end")}<path d="M388 58 H422 m-7 -5 l7 5 l-7 5" fill="none" stroke="var(--current)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      ${lbl(544, 150, "R", "name")}${lbl(544, 172, "10 Ω", "val")}
      ${lbl(604, 86, "+")}${lbl(604, 160, "v", "name")}${lbl(604, 236, "−")}`,
    subs: { v: ["s", "o"], i: "o →" },
    flows: s => ({ a: s.io, b: s.io, c: s.io }),
    scale: 6,
    states(svg, s) { svg.querySelectorAll("#scr path").forEach(p => p.classList.toggle("on", s.io > .05)); },
    probe: (s, t) => `ωt = <b>${(t * 60 * 360).toFixed(0).padStart(3, " ")}°</b> · T ${s.io > .05 ? "<b>on</b>" : "off"} · <span class="i">i<sub>o</sub> = ${s.io.toFixed(2)} A</span> · v<sub>o</sub> = ${s.vo.toFixed(1)} V`,
  },
  "ce-amp": {
    W: 660, H: 350,
    body: () => `
      <path class="wire" d="M200 40 H340 M200 40 V84 M200 146 V200 M60 200 H125 M135 200 H290 M340 40 V76 M340 138 V172 L294 190 M294 210 L340 228 V262 M340 262 H420 V292 M420 304 V330 M340 262 V272 M340 318 V330 H420 M340 172 H450 M460 172 H560"/>
      <path class="sym" d="M292 180 V220"/>
      <path class="sym-fill" d="M340 228 l-15 -1.5 l6 -10 Z"/>
      <circle class="sym" cx="318" cy="200" r="30" style="stroke:var(--pencil);stroke-width:1.4"/>
      ${res(200, 84, "v", 6, 9, 62)}${res(340, 76, "v", 6, 9, 62)}${res(340, 272, "v", 5, 9, 46)}
      <path class="sym" d="M125 184 V216 M135 184 V216 M450 156 V188 M460 156 V188 M404 292 H436 M404 304 H436"/>
      <path class="sym" d="M366 330 H394 M372 337 H388 M377 344 H383"/>
      ${dot(200, 40)}${dot(340, 40)}${dot(200, 200)}${dot(340, 172)}${dot(340, 262)}${dot(380, 330)}
      ${term(60, 200)}${term(560, 172)}${term(270, 40)}
      <path class="flow" data-b="ib" d="M200 40 V200 H292"/>
      <path class="flow" data-b="ic" d="M340 40 V172 L294 190"/>
      <path class="flow" data-b="ie" d="M294 210 L340 228 V330"/>
      ${lbl(270, 24, "+20 V", "val", "middle")}
      ${lbl(178, 110, "R", "name", "end")}${lbl(178, 132, "430 kΩ", "val", "end")}
      ${lbl(362, 104, "R", "name")}${lbl(362, 126, "2.0 kΩ", "val", "start", "RC")}
      ${lbl(362, 292, "R", "name")}${lbl(362, 314, "1 kΩ", "val")}
      ${lbl(448, 290, "C", "name")}${lbl(448, 312, "40 µF", "val")}
      ${lbl(130, 174, "C", "name", "middle")}${lbl(130, 238, "10 µF", "val", "middle")}
      ${lbl(455, 146, "C", "name", "middle")}${lbl(455, 210, "10 µF", "val", "middle")}
      ${lbl(60, 184, "v", "name", "middle")}${lbl(560, 156, "v", "name", "middle")}
      ${lbl(362, 196, "β", "name")}${lbl(362, 218, "= 50", "val", "start", "beta")}
      ${lbl(214, 188, "i", "cur", "start")}<path d="M216 214 H246 m-7 -5 l7 5 l-7 5" fill="none" stroke="var(--current)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
    subs: {},
    flows(s, st, r) { const v = r.values, RC = st.params.RC; return { ib: v.IBQ_uA * 1e-3, ic: v.ICQ_mA - (s.vce - r.waves.VCEQ) / RC * 1e3, ie: v.IEQ_mA }; },
    scale: 26, // px/s per milliampere
    states() {},
    probe: (s, t, st, r) => `t = <b>${(t * 1e6).toFixed(1).padStart(5, " ")} µs</b> · v<sub>CE</sub> = ${s.vce.toFixed(3)} V · <span class="i">i<sub>C</sub> = ${(r.values.ICQ_mA - (s.vce - r.waves.VCEQ) / st.params.RC * 1e3).toFixed(3)} mA</span>`,
  },
};
// Subscripts: rewrite the name labels after insertion (simple, keeps the markup above readable).
function applySubs(svg, id) {
  const subs = { buck: [["V", "s"], ["v", "o"], ["i", "L"]], scr: [["v", "s"], ["v", "o"], ["i", "o"]],
    "ce-amp": [["R", "B"], ["R", "C"], ["R", "E"], ["C", "E"], ["C", "1"], ["C", "2"], ["v", "i"], ["v", "o"], ["i", "B"]] }[id];
  const texts = [...svg.querySelectorAll("text.name, text.cur")];
  const used = new Set();
  for (const [base, sub] of subs) {
    const t = texts.find(x => !used.has(x) && x.textContent === base);
    if (!t) continue; used.add(t);
    const ts = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    ts.setAttribute("baseline-shift", "sub"); ts.setAttribute("font-size", "72%"); ts.textContent = sub;
    t.appendChild(ts);
  }
}

// ------------------------------------------------------------------ state
const MODE_NOTE = {
  buck: { ideal: "Ideal switch and ideal diode, as in the lecture (a 0.02 V junction in ngspice).", real: "Real diode: the netlist's junction, about 0.8 V at 1 A. Switch 1 mΩ." },
  scr: { ideal: "Ideal thyristor: fires at α, conducts with ~0.06 V, turns off at zero current.", real: "Real thyristor: about 1 V on-state drop, 10 mA holding current." },
  "ce-amp": { ideal: "The sheet's assumptions: VBE = 0.7 V, VT = 25 mV, β fixed, no Early effect.", real: "Real NPN at 27 °C (VT = 25.85 mV), Early voltage 100 V (assumed)." },
};
const params0 = new URLSearchParams(location.search).get("circuit");
const st = { id: CIRCUITS[params0] ? params0 : "buck", params: null, mode: "ideal", result: null, prev: null, playing: !RM.matches, t: 0, first: true };
st.params = defaults(st.id);

// ------------------------------------------------------------------ worker
const worker = new Worker(new URL("./pad-native-spice.worker.mjs", import.meta.url), { type: "module" });
let lastMs = 0, seq = 0, inflight = null, queued = null, engineReady = false;
function request(reason) {
  const job = { seq: ++seq, id: st.id, p: { ...st.params }, mode: st.mode, reason };
  if (inflight) { queued = job; return; }
  send(job);
}
function send(job) { inflight = job; setBusy(true); worker.postMessage({ seq: job.seq, id: job.id, p: job.p, mode: job.mode }); }
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "ready") { engineReady = true; setBusy(!!inflight); reportWeight(m.workerBytes); return; }
  const job = inflight; inflight = null;
  if (m.ok) lastMs = m.ms;
  if (queued) { const q = queued; queued = null; send(q); } else setBusy(false);
  if (!m.ok) { $("#gapnote").className = "gapnote warn"; $("#gapnote").textContent = "ngspice could not solve this: " + m.error; return; }
  if (job.id !== st.id) return; // circuit changed meanwhile
  render(m.r, job);
};
worker.onerror = (e) => { $("#status-txt").textContent = "Engine failed to load"; $("#gapnote").className = "gapnote warn"; $("#gapnote").textContent = "The ngspice engine did not load: " + (e.message || "unknown error"); };
// First-load weight, measured in this browser: page resources + the worker's (the 20 MB engine).
function reportWeight(workerBytes) {
  const nav = performance.getEntriesByType("navigation")[0]?.transferSize || 0;
  const page = performance.getEntriesByType("resource").reduce((a, e) => a + (e.transferSize || 0), 0);
  const total = nav + page + (workerBytes || 0);
  window.__weightKB = Math.round(total / 1024);
  const el = $("#weight-live");
  if (el) el.textContent = total > 50e3 ? `This visit transferred ${(total / 1048576).toFixed(1)} MB (measured in this browser).` : `This visit came from the browser cache (${Math.round(total / 1024)} KB transferred).`;
}
function setBusy(b) {
  const s = $("#status");
  s.classList.toggle("busy", b && !RM.matches);
  $("#status-txt").textContent = !engineReady ? "Loading ngspice, 20 MB" : b ? "Solving" : `Solved in ${lastMs.toFixed(0)} ms`;
  $("#readout").classList.toggle("busy", b && !!st.result);
}

// ------------------------------------------------------------------ mount a circuit
function mount(id) {
  st.id = id; st.params = defaults(id); st.result = null; st.prev = null; st.t = 0;
  const c = CIRCUITS[id];
  document.querySelectorAll("#picker button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
  $("#given").innerHTML = `<span class="label">Given</span><span class="qty">${c.given}</span><span class="src">${c.source}</span>`;
  $("#mode-note").textContent = MODE_NOTE[id][st.mode];
  // schematic
  const S = SCHEMS[id];
  $("#schem").innerHTML = `<svg class="schem" viewBox="0 0 ${S.W} ${S.H}" role="img" aria-label="${c.title} schematic, with current shown as moving dots">${S.body()}</svg>`;
  const svg = $("#schem svg");
  applySubs(svg, id);
  flows = [...svg.querySelectorAll(".flow")].map(el => ({ el, b: el.dataset.b, off: 0 }));
  fitSchem();
  drawIn(svg);
  // sliders
  $("#sliders").innerHTML = c.params.map(q => `
    <div class="ctl"><div class="ctl-head"><label class="label" for="p-${q.id}">${q.label}</label>
      <span class="ctl-val" id="v-${q.id}">${q.fmt(st.params[q.id])}<small>${unitTxt(q)}</small></span></div>
      <input class="range" type="range" id="p-${q.id}" min="${q.min}" max="${q.max}" step="${q.step}" value="${st.params[q.id]}">
      <div class="ticks" aria-hidden="true"><span>${q.fmt(q.min)}</span><span>example ${q.fmt(q.value)}</span><span>${q.fmt(q.max)}</span></div></div>`).join("");
  for (const q of c.params) {
    const el = $(`#p-${q.id}`);
    el.addEventListener("input", () => {
      st.params[q.id] = +el.value;
      $(`#v-${q.id}`).innerHTML = `${q.fmt(+el.value)}<small>${unitTxt(q)}</small>`;
      const lv = $(`#schem [data-p="${q.id}"]`);
      if (lv) lv.textContent = q.id === "beta" ? `= ${el.value}` : `${q.fmt(+el.value)} ${q.unit}`;
      syncReset(); request("slider");
    });
  }
  syncReset();
  // table skeleton, in hand order
  $("#readout tbody").innerHTML = c.rows.map(r => `<tr data-r="${r.id}"><td class="q">${r.sym}</td><td class="num sim"><span class="v">…</span><span class="u">${r.unit}</span></td><td class="num prof"><span class="v"></span><span class="u">${r.unit}</span></td><td class="gap"></td></tr>`).join("");
  $("#table-title").textContent = c.title;
  $("#gapnote").textContent = ""; $("#plots").innerHTML = ""; $("#probe").textContent = "";
  st.first = true;
  request("mount");
}
const unitTxt = q => !q.unit ? "" : q.unit === "°" ? "°" : " " + q.unit;
function mountLabels() {
  for (const q of CIRCUITS[st.id].params) { const lv = $(`#schem [data-p="${q.id}"]`); if (lv) lv.textContent = q.id === "beta" ? `= ${st.params[q.id]}` : `${q.fmt(st.params[q.id])} ${q.unit}`; }
}
function syncReset() {
  const c = CIRCUITS[st.id];
  $("#reset").hidden = c.isKeyPoint(st.params);
}

// Pencil stroke draw-in, along the writing order of the markup.
function drawIn(svg) {
  if (RM.matches) return;
  const els = [...svg.querySelectorAll(".wire, .sym")];
  els.forEach((el, i) => {
    let len = 0; try { len = el.getTotalLength(); } catch { return; }
    if (!len) return;
    el.style.strokeDasharray = `${len} ${len}`;
    const a = el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 520 + Math.min(len, 600) * .4, delay: i * 38, easing: "cubic-bezier(.45,0,.55,1)", fill: "backwards" });
    a.onfinish = () => { el.style.strokeDasharray = ""; };
  });
  const t0 = els.length * 38 + 200;
  svg.querySelectorAll(".lbl, .node, .term, .sym-fill").forEach((el, i) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: t0 + i * 14, easing: EASE, fill: "backwards" }));
  svg.querySelectorAll(".flow").forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: t0 + 300, fill: "backwards" }));
}

// Labels stay >= 13 px on screen whatever the schematic's scale; values hide on narrow screens.
function fitSchem() {
  const svg = $("#schem svg"); if (!svg) return;
  const S = SCHEMS[st.id], k = svg.clientWidth / S.W || 1;
  svg.querySelectorAll(".lbl").forEach(t => t.setAttribute("font-size", Math.max(15, 13.5 / k).toFixed(1)));
  svg.querySelectorAll(".lbl.val").forEach(t => t.style.display = k < .72 ? "none" : "");
  svg.querySelectorAll(".flow").forEach(t => t.setAttribute("stroke-width", Math.max(5, 4.5 / k).toFixed(1)));
}

// ------------------------------------------------------------------ render a solve
function fmt(v, dp) { if (!Number.isFinite(v)) return "—"; const s = Math.abs(v) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : v.toFixed(dp); return s.replace("-", "−"); }
function render(r, job) {
  const c = CIRCUITS[st.id];
  st.prev = st.result; st.result = r;
  const P = professor(st.id, st.params, KEY?.[st.id]);
  $("#prof-h").innerHTML = `Professor<span class="th-sub">${P.from === "key" ? "his key" : "hand formula"}</span>`;
  const land = job.reason !== "slider";
  const cells = { sim: [], prof: [], gap: [] };
  for (const row of c.rows) {
    const tr = $(`#readout tr[data-r="${row.id}"]`);
    const sv = r.values[row.id], pv = P.values[row.id];
    tr.querySelector(".sim .v").textContent = fmt(sv, row.dp);
    tr.querySelector(".prof .v").textContent = fmt(pv, row.dp);
    const g = Math.abs(pv) > 1e-9 ? 100 * (sv - pv) / Math.abs(pv) : NaN;
    tr.querySelector(".gap").textContent = Number.isFinite(g) ? `${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)}%` : "—";
    cells.sim.push(tr.querySelector(".sim .v")); cells.prof.push(tr.querySelector(".prof .v")); cells.gap.push(tr.querySelector(".gap"));
  }
  // gap note
  const gn = $("#gapnote"), warn = /^(DCM|Saturated)/.test(r.gap);
  gn.className = "gapnote" + (warn ? " warn" : "");
  gn.innerHTML = (warn ? "<b>Watch out.</b> " : "") + r.gap;
  // hand order: ngspice column top to bottom, then the Professor's, then the gaps; ring last
  if (land && !RM.matches) {
    const order = [...cells.sim, ...cells.prof, ...cells.gap];
    order.forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(-2px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: i * 30, easing: EASE, fill: "backwards" }));
    ring(c.answer, order.length * 30 + 200, st.first);
  } else ring(c.answer, 0, false);
  st.first = false;
  drawPlots(land && !RM.matches);
}

function ring(rowId, delay, animate) {
  document.querySelectorAll(".ring").forEach(n => n.remove());
  const td = $(`#readout tr[data-r="${rowId}"] .sim`); if (!td) return;
  td.insertAdjacentHTML("beforeend", `<svg class="ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" d="M12 25 C 8 10, 40 3, 62 4.5 C 88 6, 98 14, 95 24 C 92 34, 64 38, 42 36.5 C 18 35, 3 29, 8 18 C 11 12, 18 9, 24 7.5"/></svg>`);
  const p = td.querySelector(".ring path");
  td.setAttribute("title", "The answer the question asks for");
  if (animate && !RM.matches) {
    p.style.strokeDasharray = "1 1";
    p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 520, delay, easing: "cubic-bezier(.37,0,.63,1)", fill: "backwards" });
  }
}

// ------------------------------------------------------------------ plots on the pad's own grid
function nice(lo, hi, n = 5) {
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), cands = [];
  for (const m of [1, 2, 2.5, 5]) for (const k of [mag, mag * 10, mag * 100]) cands.push(m * k);
  cands.sort((a, b) => a - b);
  for (const step of cands) {
    if (step < raw * 0.999) continue;
    const a = Math.floor(lo / step + 1e-9) * step;
    if (a + n * step >= hi - 1e-12) return { lo: a, hi: a + n * step, step };
  }
  return { lo, hi, step: (hi - lo) / n };
}
const tickTxt = (v, step) => { const dp = (String(+step.toPrecision(3)).split(".")[1] || "").length; return (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(Math.min(dp, 4)).replace("-", "−"); };

function plot({ key, width, rows = 8, series, ghosts = [], y, x, hlines = [], vlines = [], marks = "", name, band }) {
  const H = rows * 20, L = 60, R = 16, T = 20, B = 40, W = Math.max(280, Math.floor(width / 20) * 20), PW = W - L - R, PH = H;
  const X = t => L + PW * (t - x.lo) / (x.hi - x.lo), Y = v => T + PH - PH * (v - y.lo) / (y.hi - y.lo);
  let g = "";
  for (let gx = 0; gx <= W; gx += 20) g += `<line class="${gx % 100 === 0 ? "gm" : "gf"}" x1="${gx}" y1="0" x2="${gx}" y2="${H + T + B}"/>`;
  for (let gy = 0; gy <= H + T + B; gy += 20) g += `<line class="${gy % 100 === 0 ? "gm" : "gf"}" x1="0" y1="${gy}" x2="${W}" y2="${gy}"/>`;
  let ax = `<line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + PH}"/><line class="axis" x1="${L}" y1="${T + PH}" x2="${L + PW}" y2="${T + PH}"/>`;
  for (let v = y.lo; v <= y.hi + y.step / 2; v += y.step) ax += `<line class="axis" x1="${L - 5}" x2="${L}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4.5}" text-anchor="end">${tickTxt(v, y.step)}</text>`;
  for (const tk of x.ticks) ax += `<line class="axis" x1="${X(tk.v)}" x2="${X(tk.v)}" y1="${T + PH}" y2="${T + PH + 5}"/><text x="${X(tk.v)}" y="${T + PH + 20}" text-anchor="middle">${tk.t}</text>`;
  ax += `<text class="name" x="${L + PW}" y="${T + PH + 36}" text-anchor="end" style="fill:var(--print)">${x.title}</text>`;
  const pts = p => p.map(([t, v]) => `${X(t).toFixed(1)},${Y(Math.max(y.lo - y.step, Math.min(y.hi + y.step, v))).toFixed(1)}`).join(" ");
  const clip = `<clipPath id="c-${key}"><rect x="${L}" y="${T - 2}" width="${PW}" height="${PH + 4}"/></clipPath>`;
  let body = "";
  if (band) body += band(X, Y, T, PH);
  for (const h of hlines) body += `<line x1="${L}" x2="${L + PW}" y1="${Y(h.v)}" y2="${Y(h.v)}" stroke="${h.color || "var(--pencil)"}" stroke-width="1.2" stroke-dasharray="1 4" stroke-linecap="round"/>`;
  for (const gp of ghosts) body += `<polyline class="ghost" points="${pts(gp)}"/>`;
  for (const s of series) body += `<polyline class="tr${s.draw ? " draw" : ""}" points="${pts(s.pts)}" stroke="${s.color}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} style="stroke-width:${s.w || 2}"/>`;
  for (const vl of vlines) body += `<line x1="${X(vl.v)}" x2="${X(vl.v)}" y1="${T}" y2="${T + PH}" stroke="var(--pencil)" stroke-width="1.2"/><text class="knock" x="${X(vl.v) + 6}" y="${T + PH - 10}">${vl.t}</text>`;
  let lab = "";
  for (const h of hlines) if (h.t) lab += `<text class="knock" x="${L + PW - 6}" y="${Y(h.v) - 7}" text-anchor="end">${h.t}</text>`;
  lab += `<text class="name knock" x="${L + 8}" y="${T + 16}" style="fill:${name.color}">${name.t}</text>`;
  const cursor = `<line class="cursor" data-cur="${key}" x1="${L}" x2="${L}" y1="${T}" y2="${T + PH}"/>`;
  return { html: `<svg class="plot" id="plot-${key}" width="${W}" height="${H + T + B}" viewBox="0 0 ${W} ${H + T + B}" role="img" aria-label="${name.aria}">${clip}${g}${ax}<g clip-path="url(#c-${key})">${body}</g>${marks ? marks(X, Y) : ""}${lab}${cursor}</svg>`, X, key };
}
let cursors = [];
function drawPlots(draw) {
  const r = st.result; if (!r) return;
  const box = $("#plots"), width = box.clientWidth || 600, pv = st.prev && st.prev.waves;
  const same = st.prev && st.prev.__id === st.id; r.__id = st.id;
  let out = [];
  if (st.id === "buck") {
    const w = r.waves, span = w.span * 1e6, xs = { lo: 0, hi: span, title: "t  (µs)", ticks: [0, 25, 50, 75, 100, 125, 150].map(v => ({ v, t: v })) };
    const us = p => p.map(([t, v]) => [t * 1e6, v]);
    const iy = nice(Math.min(0, ...w.iL.map(p => p[1])), Math.max(...w.iL.map(p => p[1])) * 1.05, 4);
    const band = (X, Y, T, PH) => { let s = ""; let on = null; for (const [t, g] of us(w.gate)) { if (g && on === null) on = t; if (!g && on !== null) { s += `<line x1="${X(on)}" x2="${X(t)}" y1="${T + PH - 3}" y2="${T + PH - 3}" stroke="var(--graphite)" stroke-width="4"/>`; on = null; } } if (on !== null) s += `<line x1="${X(on)}" x2="${X(span)}" y1="${T + PH - 3}" y2="${T + PH - 3}" stroke="var(--graphite)" stroke-width="4"/>`; return s; };
    out.push(plot({ key: "il", width, rows: 8, x: xs, y: iy, band, series: [{ pts: us(w.iL), color: "var(--current)", draw }], ghosts: same && pv ? [us(pv.iL)] : [],
      hlines: [{ v: r.values.IL_avg, t: `I_L = ${r.values.IL_avg.toFixed(3)} A` }],
      name: { t: "i_L  (A) · bar under the trace: S on", color: "var(--current)", aria: "Inductor current over three switching periods" } }));
    const vy = nice(Math.min(...w.vo.map(p => p[1])), Math.max(...w.vo.map(p => p[1])), 4);
    out.push(plot({ key: "vo", width, rows: 6, x: xs, y: vy, series: [{ pts: us(w.vo), color: "var(--graphite)", draw }], ghosts: same && pv && Math.abs(pv.vo[0][1] - w.vo[0][1]) < 3 * vy.step ? [us(pv.vo)] : [],
      hlines: [{ v: r.values.Vo_avg, t: `V_o = ${r.values.Vo_avg.toFixed(2)} V` }],
      name: { t: "v_o  (V), ripple", color: "var(--graphite)", aria: "Output voltage ripple over three switching periods" } }));
    $("#plot-title").textContent = "Waveforms: last 3 of 60 solved periods";
  } else if (st.id === "scr") {
    const w = r.waves, deg = p => p.map(([t, v]) => [t * 60 * 360, v]);
    const xs = { lo: 0, hi: 360, title: "ωt  (degrees)", ticks: [0, 90, 180, 270, 360].map(v => ({ v, t: v + "°" })) };
    const yy = { lo: -200, hi: 200, step: 100 };
    out.push(plot({ key: "vo", width, rows: 10, x: xs, y: yy,
      series: [{ pts: deg(w.vs), color: "var(--pencil)", dash: "5 5", w: 1.5 }, { pts: deg(w.vo), color: "var(--graphite)", draw, w: 2.4 }],
      ghosts: same && pv ? [deg(pv.vo)] : [],
      hlines: [{ v: r.values.Vo_av, t: `V_o,av = ${r.values.Vo_av.toFixed(1)} V` }, { v: 0 }],
      vlines: [{ v: st.params.alpha, t: `α = ${st.params.alpha}°` }],
      name: { t: "v_o  (V) · dashed: v_s", color: "var(--graphite)", aria: "Output voltage and source voltage over one cycle" } }));
    $("#plot-title").textContent = "Waveform: one cycle, steady state";
  } else {
    const w = r.waves, us = p => p.map(([t, v]) => [t * 1e6, v]);
    const xs = { lo: 0, hi: 200, title: "t  (µs)", ticks: [0, 50, 100, 150, 200].map(v => ({ v, t: v })) };
    const ys = w.vce.map(p => p[1]), yy = nice(Math.min(...ys), Math.max(...ys), 4);
    const two = width >= 700, w1 = two ? Math.floor((width - 14) * 0.63) : width, w2 = two ? width - 14 - w1 : width;
    out.push(plot({ key: "vce", width: w1, rows: 8, x: xs, y: yy, series: [{ pts: us(w.vce), color: "var(--graphite)", draw }],
      ghosts: same && pv && Math.abs(pv.VCEQ - w.VCEQ) < 2 * yy.step ? [us(pv.vce)] : [],
      hlines: [{ v: w.VCEQ, t: `V_CEQ = ${w.VCEQ.toFixed(2)} V` }],
      name: { t: "v_CE  (V)", color: "var(--graphite)", aria: "Collector-emitter voltage over two signal periods" } }));
    // DC load line with the Q-point: filled = ngspice, open ring = hand analysis
    const p = st.params, RC = p.RC, beta = p.beta, h = CIRCUITS["ce-amp"].hand(p);
    const icMax = 20 / (RC + 1000 * (beta + 1) / beta) * 1e3, ly = nice(0, Math.max(icMax, r.values.ICQ_mA) * 1.1, 4);
    const lx = { lo: 0, hi: 20, title: "V_CE  (V)", ticks: [0, 5, 10, 15, 20].map(v => ({ v, t: v })) };
    const marks = (X, Y) => `<circle cx="${X(Math.max(0, h.VCEQ))}" cy="${Y(h.ICQ_mA)}" r="7" fill="none" stroke="var(--pencil)" stroke-width="1.5"/><circle cx="${X(r.values.VCEQ)}" cy="${Y(r.values.ICQ_mA)}" r="4.5" fill="var(--graphite)"/><text class="knock" x="${X(r.values.VCEQ) + 10}" y="${Y(r.values.ICQ_mA) - 10}">Q</text>`;
    out.push(plot({ key: "ll", width: w2, rows: 8, x: lx, y: ly, series: [{ pts: [[0, icMax], [20, 0]], color: "var(--pencil)", w: 1.5 }], marks,
      name: { t: "DC load line: i_C (mA) · ring = hand Q", color: "var(--graphite)", aria: "DC load line with the Q-point" } }));
    $("#plot-title").textContent = "Waveform and Q-point";
    box.innerHTML = `<div class="plot-row${two ? " two" : ""}">${out.map(o => `<div>${o.html}</div>`).join("")}</div>`;
    finishPlots(out, draw); return;
  }
  box.innerHTML = out.map(o => o.html).join("");
  finishPlots(out, draw);
}
function finishPlots(out, draw) {
  document.querySelectorAll(".plot text").forEach(t => { t.innerHTML = t.innerHTML.replace(/([A-Za-z])_([A-Za-z,]+)/g, (m, a, b) => `${a}<tspan baseline-shift="sub" font-size="75%">${b}</tspan>`); });
  cursors = out.map(o => ({ el: document.querySelector(`[data-cur="${o.key}"]`), X: o.X }));
  if (draw) document.querySelectorAll(".plot .tr.draw").forEach(pl => {
    let len = 0; try { len = pl.getTotalLength(); } catch { return; }
    pl.style.strokeDasharray = `${len} ${len}`;
    pl.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, easing: "cubic-bezier(.45,0,.55,1)", fill: "backwards" }).onfinish = () => { pl.style.strokeDasharray = ""; };
  });
}

// ------------------------------------------------------------------ playback (real solved waveforms, slowed down)
let flows = [], last = 0, probeT = 0;
const REAL_SPAN = { buck: 4.5, scr: 3.2, "ce-amp": 3 }; // seconds of screen time per displayed span
function sampleAt(w, key, t) {
  const a = w[key]; if (!a) return 0;
  let lo = 0, hi = a.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m][0] <= t) lo = m; else hi = m; }
  const [t0, v0] = a[lo], [t1, v1] = a[hi];
  return t1 === t0 ? v0 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
}
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  const r = st.result;
  if (r && flows.length) {
    const w = r.waves, S = SCHEMS[st.id];
    if (st.playing) st.t = (st.t + dt * w.span / REAL_SPAN[st.id]) % w.span;
    const s = st.id === "buck" ? { iL: sampleAt(w, "iL", st.t), vo: sampleAt(w, "vo", st.t), gate: sampleAt(w, "gate", st.t) }
      : st.id === "scr" ? { vs: sampleAt(w, "vs", st.t), vo: sampleAt(w, "vo", st.t), io: sampleAt(w, "io", st.t) }
      : { vce: sampleAt(w, "vce", st.t) };
    const I = S.flows(s, st, r), svg = $("#schem svg");
    for (const f of flows) {
      const i = I[f.b] ?? 0;
      if (st.playing) f.off -= i * S.scale * dt;
      f.el.style.strokeDashoffset = f.off.toFixed(2);
      f.el.style.opacity = Math.abs(i) * S.scale < 0.4 ? "0" : "1";
    }
    S.states(svg, s);
    for (const c of cursors) if (c.el) { const x = c.X(st.id === "scr" ? st.t * 60 * 360 : st.t * 1e6); c.el.setAttribute("x1", x); c.el.setAttribute("x2", x); }
    if (now - probeT > 90) { probeT = now; $("#probe").innerHTML = S.probe(s, st.t, st, r); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setPlaying(p) {
  st.playing = p;
  $("#play").setAttribute("aria-label", p ? "Pause playback" : "Play playback");
  $("#play-txt").textContent = p ? "Pause" : "Play";
  $("#play-icon").innerHTML = p ? `<path d="M5 3v10M11 3v10"/>` : `<path d="M5 3l8 5-8 5z" stroke-linejoin="round"/>`;
}

// ------------------------------------------------------------------ wiring
$("#picker").addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.dataset.id !== st.id) mount(b.dataset.id); });
$("#mode").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.dataset.mode === st.mode) return;
  st.mode = b.dataset.mode;
  document.querySelectorAll("#mode button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  $("#mode-note").textContent = MODE_NOTE[st.id][st.mode];
  request("mode");
});
$("#reset").addEventListener("click", () => {
  const c = CIRCUITS[st.id]; st.params = defaults(st.id);
  for (const q of c.params) { $(`#p-${q.id}`).value = q.value; $(`#v-${q.id}`).innerHTML = `${q.fmt(q.value)}<small>${unitTxt(q)}</small>`; }
  syncReset(); mountLabels(); request("reset");
});
$("#play").addEventListener("click", () => setPlaying(!st.playing));
let plotW = 0;
new ResizeObserver(() => { const w = $("#plots").clientWidth; if (w !== plotW) { plotW = w; drawPlots(false); } }).observe($("#plots"));
new ResizeObserver(() => fitSchem()).observe($("#schem"));
setPlaying(st.playing);
mount(st.id);
