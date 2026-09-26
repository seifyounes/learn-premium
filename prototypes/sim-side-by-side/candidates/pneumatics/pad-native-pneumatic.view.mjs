// PROTOTYPE (throwaway) view for the pad-native pneumatic simulator.
// Draws ISO 1219 symbols in pad inks and paints the engine's state every frame. It never decides
// anything itself: positions, spools, pressures and events all come from the engine.
import { Sim, CASCADE } from './pad-native-pneumatic.engine.mjs';

const NS = 'http://www.w3.org/2000/svg';
const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
const d = (pts) => 'M' + pts.map((p) => p.join(' ')).join('L');

// ---------------------------------------------------------------- layout (viewBox 730 x 540)
const CYL = {
  A: { x0: 70, x1: 200, cap: 84, rod: 186, tip0: 220, stroke: 80, name: '1A', marks: ['a0', 'a1'] },
  B: { x0: 400, x1: 530, cap: 414, rod: 516, tip0: 550, stroke: 80, name: '2A', marks: ['b0', 'b1'] },
};
const CY_TOP = 44, CY_BOT = 88, CY_MID = 66;
const V52 = { '1V1': { sx: 121, y: 150 }, '2V1': { sx: 441, y: 150 }, '0V1': { sx: 380, y: 420 } };
const V32 = { a0: 80, START: 202, b0: 342, a1: 462, b1: 592 };
const V32_Y = 272;

// Lines by net, authored from the air's source outward so the pressure front draws the right way.
// lv = how many hand-offs from the source (delays the front), sig = signal line (thinner).
const NETS = {
  P: { paths: [[[14, 505], [14, 226], [463, 226], [463, 190]], [[143, 226], [143, 190], 1], [[14, 500], [402, 500], [402, 460], 1]], dots: [[143, 226], [14, 500]] },
  I: { paths: [[[391, 420], [391, 338]], [[391, 338], [30, 338], [30, 170], [55, 170], 1], [[391, 338], [672, 338], 1], [[469, 338], [469, 300], 2], [[599, 338], [599, 300], 2]], dots: [[391, 338], [469, 338], [599, 338]] },
  II: { paths: [[[413, 420], [413, 368]], [[413, 368], [87, 368], [87, 300], 1], [[413, 368], [700, 368], [700, 170], [551, 170], 1], [[349, 368], [349, 300], 2]], dots: [[413, 368], [349, 368]] },
  s_a0: { sig: true, paths: [[[94, 272], [94, 262], [154, 262], [154, 318], [209, 318], [209, 300]]] },
  s_start: { sig: true, paths: [[[216, 272], [216, 258], [290, 258], [290, 440], [314, 440]]] },
  s_a1: { sig: true, paths: [[[476, 272], [476, 246], [375, 246], [375, 170]]] },
  s_b1: { sig: true, paths: [[[606, 272], [606, 258], [540, 258], [540, 440], [490, 440]]] },
  s_b0: { sig: true, paths: [[[356, 272], [356, 246], [231, 246], [231, 170]]] },
  A_cap: { chamber: ['A', -1], paths: [[[132, 150], [132, 118], [84, 118], [84, 88]]] },
  A_rod: { chamber: ['A', 1], paths: [[[154, 150], [154, 118], [186, 118], [186, 88]]] },
  B_cap: { chamber: ['B', -1], paths: [[[452, 150], [452, 118], [414, 118], [414, 88]]] },
  B_rod: { chamber: ['B', 1], paths: [[[474, 150], [474, 118], [516, 118], [516, 88]]] },
};

// ---------------------------------------------------------------- build the circuit SVG
const svg = $('#circuit');
const gNets = el('g', { class: 'nets' }, svg);
const gSym = el('g', { class: 'syms' }, svg);
const gLbl = el('g', { class: 'labels' }, svg);
const refs = { nets: {}, v52: {}, v32: {}, cyl: {}, marks: {} };

function label(x, y, text, cls = '', anchor = 'start', parent = gLbl) {
  const t = el('text', { x, y, class: `lbl ${cls}`, 'text-anchor': anchor }, parent);
  t.textContent = text;
  return t;
}
function arrow(g, x1, y1, x2, y2, cls = '') {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, h = 7, w = 3.4;
  el('line', { x1, y1, x2: x2 - ux * h * 0.8, y2: y2 - uy * h * 0.8, class: `sym thin flow ${cls}` }, g);
  const bx = x2 - ux * h, by = y2 - uy * h;
  el('path', { d: `M${x2} ${y2}L${bx - uy * w} ${by + ux * w}L${bx + uy * w} ${by - ux * w}Z`, class: `arrowhead ${cls ? 'ah-' + cls : ''}` }, g);
}
function blocked(g, x, yEdge, dir) { // T: port blocked inside a box
  const y2 = yEdge + dir * 8;
  el('line', { x1: x, y1: yEdge, x2: x, y2, class: 'sym thin' }, g);
  el('line', { x1: x - 4, y1: y2, x2: x + 4, y2, class: 'sym thin' }, g);
}
function exhaust(x, y) { // port stub + open triangle to atmosphere
  el('line', { x1: x, y1: y, x2: x, y2: y + 8, class: 'sym thin' }, gSym);
  el('path', { d: `M${x - 5} ${y + 8}L${x + 5} ${y + 8}L${x} ${y + 16}Z`, class: 'sym thin' }, gSym);
}

// nets
for (const [id, n] of Object.entries(NETS)) {
  const g = el('g', { class: `net${n.sig ? ' sig' : ''}`, 'data-net': id }, gNets);
  const base = el('g', {}, g), air = el('g', {}, g), vent = el('g', {}, g);
  for (const p of n.paths) {
    const lv = typeof p[p.length - 1] === 'number' ? p[p.length - 1] : 0;
    const pts = p.filter((q) => Array.isArray(q));
    el('path', { d: d(pts), class: 'base' }, base);
    el('path', { d: d(pts), class: 'air', pathLength: 1, style: `--lv:${lv}` }, air);
    if (n.chamber) el('path', { d: d([...pts].reverse()), class: 'vent' }, vent);
  }
  for (const [x, y] of n.dots || []) el('circle', { cx: x, cy: y, r: 3.6, class: 'dot' }, g);
  refs.nets[id] = g;
}

// supply
el('circle', { cx: 14, cy: 516, r: 10, class: 'sym' }, gSym);
el('path', { d: 'M14 509L19 519L9 519Z', class: 'sym thin' }, gSym);
label(30, 532, '0Z', 'sub');
el('text', { x: 58, y: 532, class: 'pnum' }, gLbl).textContent = '6 bar';

// cylinders
for (const [id, c] of Object.entries(CYL)) {
  const g = el('g', { class: 'cyl' }, gSym);
  const capCh = el('rect', { x: c.x0 + 1, y: CY_TOP + 1, width: 3 + c.stroke, height: CY_BOT - CY_TOP - 2, class: 'chamber' }, g);
  const rodCh = el('rect', { x: c.x0 + 12, y: CY_TOP + 1, width: c.x1 - 1 - (c.x0 + 12), height: CY_BOT - CY_TOP - 2, class: 'chamber' }, g);
  el('rect', { x: c.x0, y: CY_TOP, width: c.x1 - c.x0, height: CY_BOT - CY_TOP, class: 'sym' }, g);
  const piston = el('g', { class: 'piston' }, g);
  el('rect', { x: c.x0 + 12, y: CY_MID - 4, width: c.tip0 - c.x0 - 12, height: 8, class: 'sym-fill' }, piston);
  el('rect', { x: c.x0 + 4, y: CY_TOP + 1.5, width: 8, height: CY_BOT - CY_TOP - 3, fill: 'var(--graphite)' }, piston);
  el('line', { x1: c.tip0, y1: CY_MID - 9, x2: c.tip0, y2: CY_MID + 9, class: 'sym' }, piston);
  label(c.x0 - 8, CY_MID + 6, c.name, '', 'end');
  c.marks.forEach((m, i) => {
    const x = c.tip0 + i * c.stroke;
    const mg = el('g', { class: 'mark' }, gSym);
    el('line', { x1: x, y1: 78, x2: x, y2: 96 }, mg);
    label(x, 118, m, '', 'middle', mg);
    refs.marks[m] = mg;
  });
  refs.cyl[id] = { piston, capCh, rodCh, c };
}

// 5/2 double-pilot valves
for (const [id, v] of Object.entries(V52)) {
  const { sx, y } = v;
  const g = el('g', { class: 'valve valve52', 'data-valve': id }, gSym);
  const fixedL = sx - 66, fixedR = sx + 110, py = y + 20;
  const pl14 = el('g', {}, g), pl12 = el('g', {}, g);
  const stubL = el('line', { x1: fixedL, y1: py, x2: fixedL, y2: py, class: 'stub' }, pl14);
  const stubR = el('line', { x1: fixedR, y1: py, x2: fixedR, y2: py, class: 'stub' }, pl12);
  const spool = el('g', { class: 'spool' }, g);
  const b14 = el('g', {}, spool), b12 = el('g', {}, spool);
  el('rect', { x: 0, y, width: 44, height: 40, class: 'sym-fill' }, b14);
  arrow(b14, 22, y + 40, 11, y, 'feed');
  arrow(b14, 33, y, 36, y + 40);
  blocked(b14, 8, y + 40, -1);
  el('rect', { x: 44, y, width: 44, height: 40, class: 'sym-fill' }, b12);
  arrow(b12, 66, y + 40, 77, y, 'feed');
  arrow(b12, 55, y, 52, y + 40);
  blocked(b12, 80, y + 40, -1);
  el('path', { d: `M0 ${py}L-12 ${py - 7}L-12 ${py + 7}Z`, class: 'sym-fill' }, spool);
  el('path', { d: `M88 ${py}L100 ${py - 7}L100 ${py + 7}Z`, class: 'sym-fill' }, spool);
  exhaust(sx + 8, y + 40);
  exhaust(sx + 36, y + 40);
  el('text', { x: fixedL + 1, y: py - 6, class: 'pnum' }, gLbl).textContent = '14';
  el('text', { x: fixedR - 1, y: py - 6, class: 'pnum', 'text-anchor': 'end' }, gLbl).textContent = '12';
  refs.v52[id] = { g, spool, b14, b12, stubL, stubR, pl14, pl12, sx, fixedL, fixedR };
}
label(176, 214, '1V1');
label(496, 214, '2V1');
label(500, 486, '0V1');
label(500, 506, 'group valve', 'sub');
label(680, 344, 'I');
label(704, 376, 'II');

// 3/2 NC spring-return valves (roller or push-button)
for (const [id, sx] of Object.entries(V32)) {
  const y = V32_Y;
  const isBtn = id === 'START';
  const g = el('g', { class: `valve valve32${isBtn ? ' start-sym' : ''}`, 'data-valve': id }, gSym);
  const spool = el('g', { class: 'spool' }, g);
  const act = el('g', { class: 'box-act' }, spool);
  el('rect', { x: 0, y, width: 28, height: 28, class: 'sym-fill' }, act);
  arrow(act, 7, y + 28, 14, y, 'feed');
  blocked(act, 21, y + 28, -1);
  const rest = el('g', {}, spool);
  el('rect', { x: 28, y, width: 28, height: 28, class: 'sym-fill' }, rest);
  arrow(rest, 42, y, 49, y + 28);
  blocked(rest, 35, y + 28, -1);
  if (isBtn) {
    el('line', { x1: 0, y1: y + 14, x2: -10, y2: y + 14, class: 'sym' }, spool);
    el('line', { x1: -10, y1: y + 5, x2: -10, y2: y + 23, class: 'sym' }, spool);
  } else {
    el('line', { x1: 0, y1: y + 14, x2: -7, y2: y + 14, class: 'sym' }, spool);
    el('circle', { cx: -12.5, cy: y + 14, r: 5.5, class: 'sym-fill' }, spool);
  }
  el('path', { d: `M56 ${y + 14}L58 ${y + 6}L61 ${y + 22}L64 ${y + 6}L67 ${y + 22}L69 ${y + 14}`, class: 'sym thin' }, spool);
  exhaust(sx + 21, y + 28);
  refs.v32[id] = { g, spool, sx };
}
for (const id of ['a0', 'b0', 'a1', 'b1']) label(V32[id] + 30, 324, id);
label(210, 252, 'START');

// START hit area in the circuit (tap or hold, like the real button)
const hit = el('rect', { x: 146, y: 230, width: 132, height: 92, class: 'hit', tabindex: -1, 'aria-hidden': 'true' }, svg);

// ---------------------------------------------------------------- displacement-step diagram
const dsd = $('#dsd');
const DS = { gl: 62, gr: 20, H: 170, rows: { A: [56, 82], B: [100, 126], G: [146, 164] } };
let dsX = () => 0;
const dsRefs = {};
const KEY = {
  A: [[1, 0], [2, 1], [4, 1], [5, 0]],
  B: [[1, 0], [2, 0], [3, 1], [4, 0], [5, 0]],
  G: [[1, 0], [1, 1], [3, 1], [3, 0], [5, 0]],
};
const SIGNALS = ['START', 'a1', 'b1', 'b0', 'a0'];
function buildDsd() {
  dsd.replaceChildren();
  const W = Math.max(300, dsd.clientWidth);
  dsd.setAttribute('viewBox', `0 0 ${W} ${DS.H}`);
  const span = (W - DS.gl - DS.gr) / 4;
  dsX = (ph) => DS.gl + (ph - 1) * span;
  const g = el('g', {}, dsd);
  for (let k = 1; k <= 5; k++) {
    const x = dsX(k);
    el('line', { x1: x, y1: 34, x2: x, y2: DS.H - 4, class: 'rule' }, g);
    const sb = el('g', { class: 'sbox' }, g);
    el('rect', { x: x - 12, y: 4, width: 24, height: 24 }, sb);
    el('text', { x, y: 21, 'text-anchor': 'middle' }, sb).textContent = k;
    el('path', { d: `M${x + 4} ${8}l3 4l7-9`, class: 'tick', pathLength: 1 }, sb);
    dsRefs['s' + k] = sb;
    const s = el('text', { x: k === 5 ? x - 4 : x + 4, y: 43, class: 't-sig', 'text-anchor': k === 5 ? 'end' : 'start' }, g);
    s.textContent = SIGNALS[k - 1];
  }
  for (const [row, [y1, y0]] of Object.entries(DS.rows)) {
    el('line', { x1: DS.gl, y1, x2: dsX(5), y2: y1, class: 'rule lvl' }, g);
    el('line', { x1: DS.gl, y1: y0, x2: dsX(5), y2: y0, class: 'rule lvl' }, g);
    const name = row === 'G' ? 'Line' : row;
    el('text', { x: 4, y: (y1 + y0) / 2 + 5, class: 't-lbl' }, g).textContent = name;
    el('text', { x: DS.gl - 8, y: y1 + 4, class: 't-lvl', 'text-anchor': 'end' }, g).textContent = row === 'G' ? 'I' : '1';
    el('text', { x: DS.gl - 8, y: y0 + 4, class: 't-lvl', 'text-anchor': 'end' }, g).textContent = row === 'G' ? 'II' : '0';
    el('path', { d: d(KEY[row].map(([ph, v]) => [dsX(ph), v ? y1 : y0])), class: 'key' }, g);
  }
  for (const row of ['A', 'B', 'G']) {
    dsRefs['ghost' + row] = el('path', { class: 'ghost' }, g);
    dsRefs['live' + row] = el('path', { class: row === 'G' ? 'live air' : 'live' }, g);
  }
  dsRefs.tipA = el('circle', { r: 3.4, class: 'tip' }, g);
  dsRefs.tipB = el('circle', { r: 3.4, class: 'tip' }, g);
}
const dsY = (row, v) => { const [y1, y0] = DS.rows[row]; return y0 + (y1 - y0) * v; };
const dsPath = (pts, row) => (pts.length ? d(pts.map(([ph, v]) => [dsX(ph).toFixed(1), dsY(row, v).toFixed(1)])) : '');

// ---------------------------------------------------------------- simulation state + loop
const sim = new Sim(CASCADE);
let playing = true, speed = 0.5, stepTarget = null, last = performance.now();
let ends = 0, live = null, ghost = { A: [], B: [], G: [] }, conflictCount = 0, startPressT = null;

function phaseNow() {
  let frac = 0;
  for (const c of ['A', 'B']) {
    const { x, v } = sim.cyl[c];
    if (v > 0) frac = Math.max(frac, x);
    if (v < 0) frac = Math.max(frac, 1 - x);
  }
  return Math.min(5, 1 + ends + frac);
}
function sampleNow() {
  const ph = phaseNow();
  return { A: [ph, sim.cyl.A.x], B: [ph, sim.cyl.B.x], G: [ph, sim.pressure.I ? 1 : 0] };
}
function pushSample() {
  const s = sampleNow();
  for (const r of ['A', 'B', 'G']) {
    const arr = live[r], lastPt = arr[arr.length - 1];
    if (!lastPt || lastPt[0] !== s[r][0] || lastPt[1] !== s[r][1]) arr.push(s[r]);
  }
}
function newCycle() {
  if (live && live.A.length > 1) ghost = live;
  live = { A: [], B: [], G: [] };
  ends = 0;
  live.A.push([1, sim.cyl.A.x]); live.B.push([1, sim.cyl.B.x]); live.G.push([1, 0]);
}

// ---- words for what just happened
const FEEDS = { a0: ['II', 'START'], a1: ['I', '2V1 pilot 14 (B+)'], b1: ['I', '0V1 pilot 12 (switch to line II)'], b0: ['II', '1V1 pilot 12 (A−)'] };
const MOVE = { 'A+': 'A+ : 1V1 feeds A’s cap end.', 'B+': 'B+ : 2V1 feeds B’s cap end.', 'B-': 'B− : 2V1 feeds B’s rod end.', 'A-': 'A− : 1V1 feeds A’s rod end.' };
function describe(events) {
  const out = [];
  for (const e of events) {
    switch (e.kind) {
      case 'reset': out.push('At rest. Line II holds both cylinders home; a0 is made and waits for START.'); break;
      case 'input': out.push(e.on ? (sim.limits.a0 && sim.pressure.II ? 'START pressed: with a0 made, line II air reaches 0V1 pilot 14.' : 'START pressed (no effect until a0 is made on line II).') : 'START released.'); break;
      case 'pilot': out.push(e.valve === '0V1' ? `0V1 pilot ${e.to} gets air: switching to line ${e.to === '14' ? 'I' : 'II'}.` : `${e.valve} pilot ${e.to} gets air: spool shifts.`); break;
      case 'shift':
        if (e.valve === '0V1') {
          const on = e.to === '14' ? 'I' : 'II', off = on === 'I' ? 'II' : 'I';
          let s = `Line ${on} is live, line ${off} exhausts.`;
          if (on === 'II' && sim.limits.a1) s += ' a1 is still made, but line I is dead, so 2V1 pilot 14 drops: no overlap.';
          if (on === 'I' && sim.limits.b0) s += ' b0 is still made, but line II is dead, so 1V1 pilot 12 drops: no overlap.';
          out.push(s);
        }
        break;
      case 'move': out.push(MOVE[e.cyl + e.dir]); break;
      case 'end': break;
      case 'limit':
        if (e.on) {
          const [line, to] = FEEDS[e.id];
          out.push(sim.pressure[line] ? `${e.id} made: line ${line} air passes it to ${to}.` : `${e.id} made, but line ${line} is dead: no signal.`);
        }
        break;
      case 'conflict': conflictCount++; out.push(`Signal conflict at ${e.valve}: both pilots live.`); break;
    }
  }
  return out.join(' ');
}

const logEl = $('#log'), capEl = $('#caption');
function handle(events) {
  if (!events || !events.length) return;
  for (const e of events) {
    if (e.kind === 'end') ends++;
    if (e.kind === 'line' && e.net === 'I' && e.on && (ends >= 4 || !live)) newCycle();
  }
  pushSample();
  const text = describe(events);
  if (!text) return;
  const minor = events.every((e) => (e.kind === 'input' && !e.on) || e.kind === 'line' || e.kind === 'limit' && !e.on);
  if (!minor) capEl.replaceChildren(Object.assign(document.createElement('span'), { className: 'land', textContent: text }));
  const li = document.createElement('li');
  li.innerHTML = `<span class="qty">${sim.t.toFixed(2)}</span><span></span>`;
  li.lastChild.textContent = text;
  logEl.prepend(li);
  while (logEl.children.length > 40) logEl.lastChild.remove();
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing || stepTarget !== null) {
    let target = sim.t + dt * speed;
    if (stepTarget !== null) target = Math.min(target, stepTarget);
    let ev;
    while ((ev = sim.step(target))) handle(ev);
    sim.advanceTo(target);
    if (stepTarget !== null && sim.t >= stepTarget - 1e-9) stepTarget = null;
  }
  render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- render
const roA = $('#ro-a'), roB = $('#ro-b'), roG = $('#ro-g'), roC = $('#ro-c'), roT = $('#ro-t'), moveEl = $('#move');
const stepBs = [...document.querySelectorAll('#steps b')];
const MOVES = ['A+', 'B+', 'B−', 'A−'];
function cylText(c) {
  const { x, v } = sim.cyl[c];
  return `${x.toFixed(2)} · ${v > 0 ? 'extending' : v < 0 ? 'retracting' : x >= 1 ? 'out' : 'home'}`;
}
function render() {
  const t = sim.t;
  svg.classList.toggle('paused', !(playing || stepTarget !== null));
  for (const [id, g] of Object.entries(refs.nets)) {
    const n = NETS[id];
    g.classList.toggle('on', !!sim.pressure[id]);
    let vent = false;
    if (n.chamber) { const [c, dir] = n.chamber; vent = !!sim.vented[id] && Math.sign(sim.cyl[c].v) === dir; }
    g.classList.toggle('vent', vent);
  }
  for (const [id, r] of Object.entries(refs.v52)) {
    const s = sim.spool(id, t);
    const tx = r.sx - 44 + 44 * s;
    r.spool.setAttribute('transform', `translate(${tx.toFixed(2)} 0)`);
    r.stubL.setAttribute('x2', (tx - 12).toFixed(2));
    r.stubR.setAttribute('x1', (tx + 100).toFixed(2));
    r.b14.classList.toggle('box-live', s >= 0.5);
    r.b12.classList.toggle('box-live', s < 0.5);
    r.g.classList.add('live');
    r.pl14.classList.toggle('pilot-on', sim._pilot(id, '14'));
    r.pl12.classList.toggle('pilot-on', sim._pilot(id, '12'));
  }
  for (const [id, r] of Object.entries(refs.v32)) {
    const made = !!sim.limits[id];
    r.spool.style.transform = `translateX(${made ? r.sx : r.sx - 28}px)`;
    const inNet = sim.portNet[`${id}.1`];
    r.g.classList.toggle('live', made && !!sim.pressure[inNet]);
    r.spool.firstChild.classList.add('box-live');
    if (id === 'START') r.g.classList.toggle('pressed', !!sim.inputs.START);
  }
  for (const [id, r] of Object.entries(refs.cyl)) {
    const x = sim.cyl[id].x, c = r.c, s = x * c.stroke;
    r.piston.setAttribute('transform', `translate(${s.toFixed(2)} 0)`);
    const capW = 3 + c.stroke, capK = (3 + s) / capW, ox = c.x0 + 1;
    r.capCh.setAttribute('transform', `translate(${ox} 0) scale(${capK.toFixed(4)} 1) translate(${-ox} 0)`);
    const rodW = c.x1 - 1 - (c.x0 + 12), rodK = (rodW - s) / rodW, oxr = c.x1 - 1;
    r.rodCh.setAttribute('transform', `translate(${oxr} 0) scale(${rodK.toFixed(4)} 1) translate(${-oxr} 0)`);
    r.capCh.classList.toggle('on', !!sim.pressure[`${id}_cap`]);
    r.rodCh.classList.toggle('on', !!sim.pressure[`${id}_rod`]);
  }
  for (const [m, g] of Object.entries(refs.marks)) g.classList.toggle('made', !!sim.limits[m]);

  // diagram
  const tip = sampleNow();
  for (const r of ['A', 'B', 'G']) {
    dsRefs['live' + r].setAttribute('d', dsPath([...live[r], tip[r]], r));
    dsRefs['ghost' + r].setAttribute('d', dsPath(ghost[r], r));
  }
  for (const c of ['A', 'B']) {
    dsRefs['tip' + c].setAttribute('cx', dsX(tip[c][0]).toFixed(1));
    dsRefs['tip' + c].setAttribute('cy', dsY(c, tip[c][1]).toFixed(1));
  }
  const ph = tip.A[0], moving = sim.cyl.A.v !== 0 || sim.cyl.B.v !== 0;
  const cur = Math.floor(ph + 1e-9);
  for (let k = 1; k <= 5; k++) {
    dsRefs['s' + k].classList.toggle('cur', k === cur);
    dsRefs['s' + k].classList.toggle('done', k < cur);
  }

  // panel
  const movingIdx = moving ? ends : -1;
  stepBs.forEach((b, i) => { b.classList.toggle('cur', i === movingIdx); b.classList.toggle('done', i < ends && i !== movingIdx); });
  moveEl.textContent = moving ? MOVES[ends] ?? '' : ends >= 4 ? 'done' : ends === 0 ? 'rest' : 'wait';
  roA.textContent = cylText('A');
  roB.textContent = cylText('B');
  roG.textContent = sim.pressure.I ? 'I (A+ B+)' : sim.pressure.II ? 'II (B− A−)' : '—';
  roC.textContent = String(conflictCount);
  roT.textContent = `${t.toFixed(2)} s`;
}

// ---------------------------------------------------------------- controls
const startBtn = $('#start'), playBtn = $('#play'), stepBtn = $('#step');
function press() {
  if (sim.inputs.START) return;
  startPressT = sim.t;
  sim.scheduled = sim.scheduled.filter((s) => s.input !== 'START');
  handle(sim.setInput('START', true));
  startBtn.setAttribute('aria-pressed', 'true');
}
function release() {
  if (startPressT === null) return;
  // a real tap is short; hold the valve at least 0.3 s of machine time so the pilot sees it
  const at = Math.max(sim.t, startPressT + 0.3);
  startPressT = null;
  if (at <= sim.t) handle(sim.setInput('START', false));
  else sim.scheduleInput(at, 'START', false);
  startBtn.setAttribute('aria-pressed', 'false');
}
for (const target of [startBtn, hit]) {
  target.addEventListener('pointerdown', (e) => { e.preventDefault(); target.setPointerCapture?.(e.pointerId); press(); });
  target.addEventListener('pointerup', release);
  target.addEventListener('pointercancel', release);
  target.addEventListener('contextmenu', (e) => e.preventDefault());
}
startBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
startBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release(); } });

function setPlaying(p) {
  playing = p;
  playBtn.textContent = p ? 'Pause' : 'Run';
  playBtn.setAttribute('aria-pressed', String(!p));
}
playBtn.addEventListener('click', () => { stepTarget = null; setPlaying(!playing); });
function stepOnce() {
  setPlaying(false);
  const tn = sim.nextEventTime();
  if (tn === Infinity) {
    capEl.replaceChildren(Object.assign(document.createElement('span'), { className: 'land', textContent: 'Nothing is pending: the machine waits at rest. Press START, then Next event.' }));
    return;
  }
  stepTarget = tn;
}
stepBtn.addEventListener('click', stepOnce);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' && !e.target.closest('input,select,textarea')) { e.preventDefault(); stepOnce(); }
});
$('#reset').addEventListener('click', () => {
  sim.reset(); stepTarget = null; ends = 0; live = null; ghost = { A: [], B: [], G: [] }; conflictCount = 0; startPressT = null;
  startBtn.setAttribute('aria-pressed', 'false');
  logEl.replaceChildren();
  newCycle();
  handle([{ kind: 'reset' }]);
});
for (const b of document.querySelectorAll('#speed button')) {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    for (const o of document.querySelectorAll('#speed button')) o.setAttribute('aria-pressed', String(o === b));
  });
}

// ---------------------------------------------------------------- boot
buildDsd();
newCycle();
handle([{ kind: 'reset' }]);
new ResizeObserver(() => buildDsd()).observe(dsd);
requestAnimationFrame(frame);
