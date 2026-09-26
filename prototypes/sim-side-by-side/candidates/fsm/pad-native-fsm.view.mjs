// PROTOTYPE (throwaway): the view for the pad-native FSM. It renders only what the engine returns.
import { DETECTOR_101 } from "./machine-101.mjs";
import { createMachine, evalSOP } from "./pad-native-fsm.engine.mjs";

const M = createMachine(DETECTOR_101);
const SVGNS = "http://www.w3.org/2000/svg";
const RM = matchMedia("(prefers-reduced-motion: reduce)");
const still = () => RM.matches;
const $ = (id) => document.getElementById(id);

// ---------- pre-laid-out geometry (stands in for a build-time elkjs/dagre pass) ----------
const R = 38;
const POS = { S0: [125, 235], S1: [285, 115], S2: [285, 345], S3: [445, 235] };
const LOOP = { S0: 180, S1: 270 };                    // direction a self-loop points, degrees
const BEND = { "S0>S1": -24, "S1>S2": 0, "S2>S0": -24, "S3>S1": 24, "S2>S3": 30, "S3>S2": 30 };
const RESET_ANGLE = 240;

// ---------- state ----------
const S = { state: M.model.init, x: 0, hist: [], gen: 0, auto: null, playing: false };
const running = new Set();
let travel = null;

// ---------- helpers ----------
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const f = (n) => Math.round(n * 10) / 10;
const pt = (c, deg, d) => [c[0] + d * Math.cos((deg * Math.PI) / 180), c[1] + d * Math.sin((deg * Math.PI) / 180)];
const toward = (a, b, d) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [a[0] + ((b[0] - a[0]) / L) * d, a[1] + ((b[1] - a[1]) / L) * d]; };
const anim = (node, frames, opts) => {
  if (still() || !node.animate) return null;
  const a = node.animate(frames, { fill: "none", easing: "cubic-bezier(.22,1,.36,1)", ...opts });
  running.add(a); a.finished.then(() => running.delete(a), () => running.delete(a));
  return a;
};
const finishAll = () => { if (travel) travel.finish(); for (const a of [...running]) { try { a.finish(); } catch { /* already done */ } } running.clear(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sub = (name) => name.replace(/^([A-Z])(\d)$/, "$1<sub>$2</sub>");

// ---------- diagram ----------
const svg = $("diagram");
const edgeEls = {};
const stateEls = {};
let trail, token;

function edgeGeometry(t) {
  const a = POS[t.from], b = POS[t.to];
  if (t.from === t.to) {
    const th = LOOP[t.from];
    const s = pt(a, th - 24, R), e = pt(a, th + 24, R + 1.5);
    const c1 = pt(a, th - 36, R + 64), c2 = pt(a, th + 36, R + 64);
    const lab = pt(a, th, R + 60);
    return { d: `M${f(s[0])} ${f(s[1])}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(e[0])} ${f(e[1])}`, lab };
  }
  const key = `${t.from}>${t.to}`, bend = BEND[key] ?? 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c = [mid[0] + nx * bend * 2, mid[1] + ny * bend * 2];
  const s = toward(a, c, R), e = toward(b, c, R + 1.5);
  const side = bend === 0 ? 1 : Math.sign(bend);
  const onCurve = [(s[0] + 2 * c[0] + e[0]) / 4, (s[1] + 2 * c[1] + e[1]) / 4];
  const lab = [onCurve[0] + nx * side * 17, onCurve[1] + ny * side * 17];
  return { d: `M${f(s[0])} ${f(s[1])}Q${f(c[0])} ${f(c[1])} ${f(e[0])} ${f(e[1])}`, lab };
}

function buildDiagram() {
  const defs = el("defs", {}, svg);
  for (const [id, ink] of [["ah-pencil", "var(--pencil)"], ["ah-graphite", "var(--graphite)"]]) {
    const m = el("marker", { id, viewBox: "0 0 12 12", refX: "10.5", refY: "6", markerWidth: "13", markerHeight: "13", markerUnits: "userSpaceOnUse", orient: "auto" }, defs);
    el("path", { d: "M2.5 2 10.5 6 2.5 10", fill: "none", stroke: ink, "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }, m);
  }
  const gEdges = el("g", {}, svg);
  // reset arrow into the initial state
  const s0 = POS[M.model.init];
  const ra = pt(s0, RESET_ANGLE, R + 60), rb = pt(s0, RESET_ANGLE, R + 1.5);
  el("path", { class: "reset-arrow", d: `M${f(ra[0])} ${f(ra[1])}L${f(rb[0])} ${f(rb[1])}`, "marker-end": "url(#ah-pencil)" }, gEdges);
  const rt = pt(s0, RESET_ANGLE, R + 74);
  el("text", { class: "reset-text", x: f(rt[0]), y: f(rt[1]), "text-anchor": "middle" }, gEdges).textContent = "reset";

  for (const t of M.edges) {
    const g = el("g", { class: "edge", "data-edge": t.id }, gEdges);
    const { d, lab } = edgeGeometry(t);
    el("path", { class: "hit", d }, g);
    el("path", { class: "line", d, "marker-end": "url(#ah-pencil)" }, g);
    el("text", { x: f(lab[0]), y: f(lab[1]) }, g).textContent = String(t.when.X);
    edgeEls[t.id] = g;
  }
  trail = el("path", { class: "trail" }, svg);
  for (const st of M.model.states) {
    const [x, y] = POS[st.id];
    const g = el("g", { class: "state", "data-state": st.id, transform: `translate(${x} ${y})` }, svg);
    el("circle", { class: "ring", r: R + 7 }, g);
    el("circle", { class: "body", r: R }, g);
    el("text", { class: "sname", y: -3 }, g).textContent = st.id;
    el("line", { class: "divider", x1: -25, x2: 25, y1: 5.5, y2: 5.5 }, g);
    el("text", { class: "sout", y: 26 }, g).textContent = `Z=${st.out.Z}`;
    if (st.out.Z) g.classList.add("zhigh");
    stateEls[st.id] = g;
  }
  token = el("circle", { class: "token", r: 8 }, svg);
}

function armedEdge() { return M.edgeId(M.transitionFor(S.state, { X: S.x })); }

function renderDiagram(landing = false) {
  const armed = armedEdge();
  for (const [id, g] of Object.entries(edgeEls)) {
    const on = id === armed;
    g.classList.toggle("armed", on);
    g.querySelector(".line").setAttribute("marker-end", on ? "url(#ah-graphite)" : "url(#ah-pencil)");
  }
  for (const [id, g] of Object.entries(stateEls)) g.classList.toggle("current", id === S.state);
  if (landing) {
    const ring = stateEls[S.state].querySelector(".ring");
    const C = 2 * Math.PI * (R + 7);
    ring.style.strokeDasharray = `${C}`;
    const a = anim(ring, [{ strokeDashoffset: C }, { strokeDashoffset: 0 }], { duration: 380, easing: "cubic-bezier(.45,0,.55,1)" });
    if (a) a.finished.then(() => { ring.style.strokeDasharray = ""; }, () => {});
    else ring.style.strokeDasharray = "";
    const armedLine = edgeEls[armed].querySelector(".line");
    anim(armedLine, [{ opacity: 0.5 }, { opacity: 1 }], { duration: 220, delay: 160 });
  }
}

function travelAlong(path, ms) {
  return new Promise((resolve) => {
    if (still()) { resolve(); return; }
    const L = path.getTotalLength();
    const t0 = performance.now();
    let raf = 0, done = false;
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const place = (k) => { const p = path.getPointAtLength(L * ease(k)); token.setAttribute("transform", `translate(${f(p.x)} ${f(p.y)})`); };
    const end = () => { if (done) return; done = true; cancelAnimationFrame(raf); token.style.opacity = 0; travel = null; resolve(); };
    const frame = (now) => { const k = Math.min(1, (now - t0) / ms); place(k); if (k < 1) raf = requestAnimationFrame(frame); else end(); };
    place(0); token.style.opacity = 1;
    travel = { finish: end };
    raf = requestAnimationFrame(frame);
    setTimeout(end, ms + 120); // rAF pauses in hidden tabs; the state must still land
    // trail: the taken arrow inks in behind the token, then fades
    trail.setAttribute("d", path.getAttribute("d"));
    trail.style.strokeDasharray = `${L}`;
    trail.style.opacity = 1;
    const a = anim(trail, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: ms, easing: "cubic-bezier(.65,0,.35,1)" });
    const fade = () => { const b = anim(trail, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 80 }); const off = () => { trail.style.opacity = 0; }; if (b) b.finished.then(off, off); else off(); };
    if (a) a.finished.then(fade, () => { trail.style.opacity = 0; }); else trail.style.opacity = 0;
  });
}

// ---------- status ----------
function renderStatus(landing = false) {
  const st = M.stateById[S.state];
  const z = M.output(S.state).Z;
  $("st-period").textContent = S.hist.length + 1;
  $("st-state").textContent = S.state;
  $("st-meaning").textContent = st.meaning;
  $("st-code").textContent = M.codes[S.state].split("").join(" ");
  const lamp = $("st-z");
  lamp.textContent = z;
  lamp.classList.toggle("on", !!z);
  if (landing) ["st-period", "st-state", "st-code", "st-z"].forEach((id, i) =>
    anim($(id), [{ opacity: 0, transform: "translateY(-3px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: i * 30 }));
}

// ---------- tables ----------
function renderStateTable() {
  const rows = M.stateTable();
  const head = `<thead><tr><th>Present</th><th>Q1 Q0</th><th>Next<span class="q">X = 0</span></th><th>Next<span class="q">X = 1</span></th><th>Z</th></tr></thead>`;
  const body = rows.map((r) => {
    const cur = r.state === S.state;
    const cells = ["0", "1"].map((xv) => {
      const t = M.transitionFor(r.state, { X: Number(xv) });
      const take = cur && Number(xv) === S.x;
      return `<td class="peekable${take ? " take" : ""}" data-edge="${M.edgeId(t)}">${r.next[xv]}</td>`;
    }).join("");
    return `<tr class="${cur ? "cur" : ""}"><td class="st">${r.state}</td><td>${r.code.split("").join(" ")}</td>${cells}<td class="grp">${r.out.Z}</td></tr>`;
  }).join("");
  $("tbl-st").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderEncoded() {
  const rows = M.encodedTable();
  const code = M.codes[S.state];
  const head = `<thead><tr><th>Q1</th><th>Q0</th><th>X</th><th class="grp">Q1<span class="q">next</span></th><th>Q0<span class="q">next</span></th><th class="grp">D1</th><th>D0</th><th class="grp">Z</th></tr></thead>`;
  const body = rows.map((r) => {
    const cur = r.q.join("") === code && r.x[0] === S.x;
    return `<tr class="${cur ? "cur" : ""}"><td>${r.q[0]}</td><td>${r.q[1]}</td><td>${r.x[0]}</td><td class="grp">${r.qNext[0]}</td><td>${r.qNext[1]}</td><td class="grp${cur ? " take" : ""}">${r.excite.D1}</td><td class="${cur ? "take" : ""}">${r.excite.D0}</td><td class="grp">${r.out.Z}</td></tr>`;
  }).join("");
  $("tbl-enc").innerHTML = head + `<tbody>${body}</tbody>`;
}

const EQ = M.equations();
function renderEquations() {
  const q = M.codes[S.state].split("").map(Number);
  const vals = { D1: q.concat(S.x), D0: q.concat(S.x), Z: q };
  $("eqs").innerHTML = ["D1", "D0", "Z"].map((name) => {
    const { vars, terms } = EQ[name];
    const v = vals[name];
    const expr = terms.map((t) => {
      const lits = t.map((b, i) => (b === null ? null : b ? sub(vars[i]) : `<span class="ov">${sub(vars[i])}</span>`)).filter(Boolean).join("·") || "1";
      return `<span class="t${evalSOP([t], v) ? " on" : ""}">${lits}</span>`;
    }).join(" + ");
    const out = evalSOP(terms, v);
    return `<div class="eq"><span class="n">${sub(name)}</span><span>=</span><span class="expr">${expr}</span><span class="val${out ? " on" : ""}" aria-label="${name} is ${out}">${out}</span></div>`;
  }).join("");
}

function renderTables() { renderStateTable(); renderEncoded(); renderEquations(); }

// ---------- timing strip ----------
const PW = 54, ROWH = 32, TOP = 22, SHIFT_X = 9;
const ROWS = ["CLK", "X", "STATE", "Z"];
const rowTop = (i) => TOP + i * ROWH;
function renderTimingLabels() {
  const s = $("timing-labels");
  s.setAttribute("height", TOP + ROWS.length * ROWH + 4);
  s.innerHTML = "";
  ROWS.forEach((r, i) => { el("text", { class: "tl-label", x: 2, y: rowTop(i) + ROWH / 2 }, s).textContent = r; });
}
function renderTiming(animateNew = false) {
  const s = $("timing");
  const periods = S.hist.map((h) => ({ ...h })).concat([{ state: S.state, x: S.x, z: M.output(S.state).Z, open: true }]);
  const scroller = $("timing-scroll");
  const W = Math.max(periods.length * PW + 14, scroller.clientWidth);
  const H = TOP + ROWS.length * ROWH + 4;
  s.setAttribute("width", W); s.setAttribute("height", H); s.setAttribute("viewBox", `0 0 ${W} ${H}`);
  s.innerHTML = "";
  let newest = null;
  periods.forEach((p, i) => {
    const x0 = i * PW, x1 = x0 + PW, prev = periods[i - 1], next = periods[i + 1];
    const g = el("g", { class: p.open ? "tl-open" : "" }, s);
    if (p.open) {
      el("rect", { class: "tl-now", x: x0, y: 0, width: PW, height: H }, g);
      el("text", { class: "tl-now-text", x: x0 + PW / 2, y: 13 }, g).textContent = "NOW";
    } else {
      el("text", { class: "tl-num", x: x0 + PW / 2, y: 13 }, g).textContent = i + 1;
    }
    if (i > 0) el("line", { class: "tl-guide", x1: x0, x2: x0, y1: TOP - 4, y2: H }, g);
    // CLK
    let y = rowTop(0), hi = y + 7, lo = y + ROWH - 9;
    el("path", { class: "tl-wave", d: i === 0 ? `M${x0} ${hi}H${x0 + PW / 2}V${lo}H${x1}` : `M${x0} ${lo}V${hi}H${x0 + PW / 2}V${lo}H${x1}` }, g);
    if (i > 0) el("path", { class: "tl-edge", d: `M${x0 - 4} ${(hi + lo) / 2 + 3}L${x0} ${(hi + lo) / 2 - 2}L${x0 + 4} ${(hi + lo) / 2 + 3}` }, g);
    // X (changes a little after the edge, sampled at the next edge)
    y = rowTop(1); hi = y + 7; lo = y + ROWH - 9;
    const xs = i === 0 ? 0 : x0 + SHIFT_X, xe = p.open ? x1 : x1 + SHIFT_X;
    const xy = p.x ? hi : lo;
    if (p.x) el("rect", { class: "tl-high", x: xs, y: hi, width: xe - xs, height: lo - hi }, g);
    const xFrom = prev && prev.x !== p.x ? `M${xs} ${prev.x ? hi : lo}V${xy}` : `M${xs} ${xy}`;
    el("path", { class: "tl-wave", d: `${xFrom}H${xe}` }, g);
    // STATE bus
    y = rowTop(2); const top = y + 6, bot = y + ROWH - 8, mid = (top + bot) / 2;
    const cin = !prev || prev.state !== p.state, cout = !next || next.state !== p.state;
    const lt = cin ? x0 + 5 : x0, rt = cout ? x1 - 5 : x1;
    const bus = `M${lt} ${top}H${rt}` + (cout ? `L${x1} ${mid}L${rt} ${bot}` : `M${x1} ${bot}`) + `H${lt}` + (cin ? `L${x0} ${mid}L${lt} ${top}` : "");
    el("path", { class: "tl-bus", d: bus }, g);
    if (cin) {
      let run = 1; while (periods[i + run] && periods[i + run].state === p.state) run++;
      el("text", { class: "tl-bus-text", x: x0 + (run * PW) / 2, y: mid }, g).textContent = p.state;
    }
    // Z (Moore: changes with the state, right at the edge)
    y = rowTop(3); hi = y + 7; lo = y + ROWH - 9;
    const zy = p.z ? hi : lo;
    if (p.z) el("rect", { class: "tl-high", x: x0, y: hi, width: PW, height: lo - hi }, g);
    el("path", { class: "tl-wave", d: `${prev && prev.z !== p.z ? `M${x0} ${prev.z ? hi : lo}V${zy}` : `M${x0} ${zy}`}H${x1}` }, g);
    if (p.open) newest = g;
  });
  $("timing-count").textContent = S.hist.length === 1 ? "1 clock edge" : `${S.hist.length} clock edges`;
  if (animateNew && newest && S.hist.length) anim(newest, [{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }], { duration: 280 });
  scroller.scrollTo({ left: scroller.scrollWidth, behavior: still() || !animateNew ? "auto" : "smooth" });
}

// ---------- actions ----------
function renderAll(landing = false) {
  renderDiagram(landing);
  renderStatus(landing);
  renderTables();
}

function setX(v, fromUser = true) {
  if (fromUser) stopPlay();
  S.x = v;
  document.querySelectorAll(".xseg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.x) === v)));
  if (!travel) renderDiagram(false);
  renderTables();
  renderTiming(false);
}

function doClock() {
  finishAll();
  renderAll(false);                                   // snap any interrupted motion to its end
  const from = S.state;
  const step = M.step(from, { X: S.x });
  S.hist.push({ state: from, x: S.x, z: M.output(from).Z });
  S.state = step.next;
  const gen = ++S.gen;
  renderTiming(true);
  if (still()) { renderAll(false); return; }
  // departure: the old state lets go, the arrow is inked by the travelling token, then values land
  stateEls[from].classList.remove("current");
  for (const g of Object.values(edgeEls)) { g.classList.remove("armed"); g.querySelector(".line").setAttribute("marker-end", "url(#ah-pencil)"); }
  const path = edgeEls[step.edge].querySelector(".line");
  travelAlong(path, from === step.next ? 560 : 480).then(() => { if (gen === S.gen) renderAll(true); });
}

function reset() {
  finishAll();
  S.state = M.model.init; S.hist = []; S.gen++;
  renderAll(false); renderTiming(false);
}

function stopAuto() { if (S.auto) { clearInterval(S.auto); S.auto = null; } $("auto").setAttribute("aria-pressed", "false"); }
function stopPlay() { S.playing = false; $("play").setAttribute("aria-pressed", "false"); }

async function play() {
  if (S.playing) { stopPlay(); return; }
  stopAuto(); reset(); setX(0, false);
  S.playing = true; $("play").setAttribute("aria-pressed", "true");
  const run = S.playId = (S.playId || 0) + 1;
  const live = () => S.playing && run === S.playId;
  for (const x of M.model.test.X) {
    await wait(380); if (!live()) return;
    setX(x, false);
    await wait(620); if (!live()) return;
    doClock();
  }
  await wait(600);
  if (live()) stopPlay();
}

// ---------- wiring ----------
buildDiagram();
renderTimingLabels();
renderAll(false);
renderTiming(false);

document.querySelectorAll(".xseg button").forEach((b) => b.addEventListener("click", () => setX(Number(b.dataset.x))));
$("clock").addEventListener("click", () => { stopPlay(); doClock(); });
$("auto").addEventListener("click", () => {
  if (S.auto) { stopAuto(); return; }
  stopPlay();
  S.auto = setInterval(doClock, 1300);
  $("auto").setAttribute("aria-pressed", "true");
  doClock();
});
$("play").addEventListener("click", play);
$("reset").addEventListener("click", () => { stopAuto(); stopPlay(); reset(); });

for (const tab of document.querySelectorAll(".tabs [role=tab]")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tabs [role=tab]")) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on)); t.setAttribute("aria-pressed", String(on));
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
  });
}

// hovering a next-state cell shows its arrow
const peek = (e, on) => { const td = e.target.closest?.("td[data-edge]"); if (td && edgeEls[td.dataset.edge]) edgeEls[td.dataset.edge].classList.toggle("peek", on); };
$("tbl-st").addEventListener("pointerover", (e) => peek(e, true));
$("tbl-st").addEventListener("pointerout", (e) => peek(e, false));

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "0" || e.key === "1") setX(Number(e.key));
  else if (e.key === "x" || e.key === "X") setX(S.x ? 0 : 1);
  else if (e.key === "c" || e.key === "C") { stopPlay(); doClock(); }
});
addEventListener("resize", () => renderTiming(false));

// QA only: ?seq=10101 pre-clocks a sequence (used for screenshots), window.__fsm for console checks
const seq = new URLSearchParams(location.search).get("seq");
if (seq && /^[01]+$/.test(seq)) { for (const c of seq) { setX(Number(c), false); doClock(); } if (/[01]$/.test(seq)) setX(Number(new URLSearchParams(location.search).get("x") ?? S.x), false); }
window.__fsm = { M, S, doClock, setX, reset };
