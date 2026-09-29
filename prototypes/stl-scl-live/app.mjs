// PROTOTYPE (throwaway, ticket #37): the page shell. A thin DOM layer over the pure modules;
// nothing flows back into them. build.mjs inlines this with the modules into dist/stl-scl-live.html.
import { S7Memory, formatReal, bitsToReal, int16, hex } from './s7core.mjs';
import { parseStl, createCpu, runScan, STW_BITS } from './stl.mjs';
import { createScl } from './scl.mjs';
import { rulings, rulingLine } from './listings/rulings.mjs';

/* global LISTINGS, GATE_REPORT */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };
const minus = (s) => String(s).replace(/^-/, '−');
const intText = (v) => minus(v.toLocaleString('en-US').replace(/,/g, ' '));

// ---- shared display state -----------------------------------------------------------------
let realMode = 'short';
const realText = (x) => minus(formatReal(x, realMode));
const onRealMode = [];
function setRealMode(m) {
  realMode = m;
  document.querySelectorAll('[data-realmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.realmode === m)));
  onRealMode.forEach((f) => f());
}

// ---- listing renderer (shared by both cards) ---------------------------------------------
function renderListing(box, text, lang, marks = {}) {
  const ol = el('ol', { class: 'code', 'aria-label': `${lang} listing` });
  text.replace(/\r/g, '').split('\n').forEach((line, i) => {
    if (i === text.split('\n').length - 1 && !line) return;
    const m = line.match(/^(.*?)(\/\/.*)?$/);
    const li = el('li', { 'data-line': i },
      el('span', { class: 'ln', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'src' }, highlight(m[1] || '', lang), m[2] ? el('span', { class: 'cm' }, m[2]) : null));
    if (marks[i]) { li.classList.add('ruled'); li.title = marks[i]; }
    ol.append(li);
  });
  box.replaceChildren(ol);
  return ol;
}
function highlight(code, lang) {
  const frag = document.createDocumentFragment();
  const re = lang === 'STL'
    ? /(^\s*[A-Z_]\w{0,3}:)|(\b(?:ORGANIZATION_BLOCK|END_ORGANIZATION_BLOCK|BEGIN|NETWORK|TITLE)\b)|(^\s*(?:[A-Z]{1,4}\b|[-+*/][IRD]|[<>=]{1,2}[IRD]|=|[<>]=?[IRD]))/g
    : /(\b(?:TYPE|END_TYPE|STRUCT|END_STRUCT|DATA_BLOCK|END_DATA_BLOCK|FUNCTION_BLOCK|END_FUNCTION_BLOCK|VAR_INPUT|VAR_OUTPUT|VAR_TEMP|VAR|END_VAR|BEGIN|CASE|OF|END_CASE|IF|THEN|ELSIF|ELSE|END_IF|FOR|TO|DO|END_FOR|EXIT|AND|NOT|OR|ARRAY|TRUE|FALSE)\b)|("[^"]*")|(#\w+)/g;
  let last = 0, m;
  while ((m = re.exec(code))) {
    if (m.index > last) frag.append(code.slice(last, m.index));
    frag.append(el('span', { class: lang === 'STL' ? (m[1] ? 'lbl' : m[2] ? 'kw' : 'op') : m[1] ? 'kw' : m[2] ? 'gl' : 'var' }, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(code.slice(last));
  return frag;
}
function markLines(ol, from, to, box) {
  ol.querySelectorAll('li.cur').forEach((l) => l.classList.remove('cur', 'cur-first'));
  if (from == null) return;
  for (let i = from; i <= to; i++) { const li = ol.children[i]; if (li) li.classList.add('cur'); }
  const first = ol.children[from]; if (!first) return;
  first.classList.add('cur-first');
  const top = first.offsetTop - box.clientHeight * 0.35; // keep the current line in the upper third, inside its box only
  box.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---- small printed widgets ---------------------------------------------------------------
const field = (label, ...kids) => el('div', { class: 'field' }, el('span', { class: 'label' }, label), ...kids);
const seg = (name, options, value, onPick) => {
  const g = el('div', { class: 'seg', role: 'group', 'aria-label': name });
  for (const [v, text] of options) g.append(el('button', { type: 'button', 'aria-pressed': String(v === value), 'data-v': String(v), onclick: () => { g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); onPick(v); } }, text));
  g.set = (v) => g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  return g;
};
const bitBox = (name, v, changed, undef) => el('div', { class: `bit${v && !undef ? ' on' : ''}${changed ? ' changed' : ''}${undef ? ' undef' : ''}`, title: undef ? `${name}: left by the library block (not published)` : `${name} = ${v}` },
  el('span', { class: 'bit-name' }, name), el('span', { class: 'bit-val' }, undef ? '?' : String(v)));
const tick = () => svg('<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const cross = () => svg('<svg class="xmark" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');

// ====================================================================================
// STL card
// ====================================================================================
const SETPOINTS = [1000, 3000, 10000, 12000];
const STL_GLOSS = {
  L: 'Load: ACCU 1 moves down to ACCU 2, the operand goes into ACCU 1. No status bits change.',
  T: 'Transfer ACCU 1 to the operand. No status bits change.',
  '+I': 'Add ACCU 2 and ACCU 1 as 16-bit INT. The sum lands in ACCU 1-L; CC 1, CC 0, OV (and OS) report it.',
  '+R': 'Add ACCU 2 and ACCU 1 as float32 REAL; result in ACCU 1.', '-R': 'ACCU 2 minus ACCU 1 as float32 REAL; result in ACCU 1.',
  '*R': 'Multiply ACCU 2 by ACCU 1 as float32 REAL; result in ACCU 1.', '/R': 'Divide ACCU 2 by ACCU 1 as float32 REAL; result in ACCU 1.',
  SQR: 'Square ACCU 1 (REAL).', SQRT: 'Square root of ACCU 1 (REAL).', ACOS: 'Arc cosine of ACCU 1, in radians (REAL).',
  ABS: 'Clear the sign bit of ACCU 1: the absolute value of a REAL.', ITD: 'Sign-extend the INT in ACCU 1-L to a 32-bit DINT.', DTR: 'Convert the DINT in ACCU 1 to a float32 REAL.',
  A: 'AND the bit into the RLO. With /FC = 0 this is a first check: the bit simply becomes the RLO.', AN: 'AND NOT: the inverted bit goes into the RLO.',
  O: 'OR the bit into the RLO (a first check if /FC = 0).', '=': 'Write the RLO to the bit. Ends the logic string: /FC = 0.',
  S: 'If RLO = 1, set the bit to 1. It stays 1 until something resets it.', R: 'If RLO = 1, reset the bit to 0.',
  '>R': 'Compare ACCU 2 > ACCU 1 as REAL. The result becomes the RLO outright, even with a logic string open.', '<>I': 'Compare ACCU 2 <> ACCU 1 as INT; the result is the new RLO.',
  '>=I': 'Compare ACCU 2 >= ACCU 1 as INT; the result is the new RLO.', JCN: 'Jump if RLO = 0. Either way RLO becomes 1 and /FC 0.',
  LOOP: 'Count ACCU 1-L down by one and jump back while it is not 0.', LAR1: 'Load a pointer into address register 1.',
  '+AR1': 'Add an offset to AR 1: step to the next set-point.', CALL: 'Call FC105 SCALE (library block, built into the engine from Siemens’ formula).',
  BE: 'End of OB 1. OS, OR and /FC clear, STA = 1. The scan is over.', NOP: 'No operation.',
};
const hintOf = (op, arg, h) => { // what type ACCU 1 holds after the statement, for display only
  const a = arg.replace(/\s+/g, '');
  if (op === 'L') return /^P#/.test(a) ? 'PTR' : /^MD/.test(a) || /^[+-]?\d*\.\d/.test(a) || /e[+-]?\d+$/i.test(a) ? 'REAL' : /^L#/.test(a) ? 'DINT' : 'INT';
  if (['+R', '-R', '*R', '/R', 'SQR', 'SQRT', 'ACOS', 'ABS', 'DTR', 'EXP', 'LN'].includes(op)) return 'REAL';
  if (op === 'ITD') return 'DINT';
  if (['+I', '-I', 'LOOP'].includes(op)) return 'INT';
  return h;
};
function accuText(v, hint) {
  if (hint === 'REAL') return realText(bitsToReal(v));
  if (hint === 'DINT') return intText(v | 0);
  if (hint === 'PTR') return `P#${v >>> 3}.${v & 7}`;
  return intText(int16(v));
}

function stlCard(root) {
  const src = LISTINGS.tank, prog = parseStl(src);
  const ruled = {}; for (const r of rulings.filter((x) => x.listing === 'tank')) ruled[rulingLine(prog.lines, r)] = r;
  const S = { raw: 13824, bipolar: 0, pump: 0, ack: 0, cpu: null, scan: 0, trace: null, idx: -1, pre: null, hints: [] };

  const codeBox = el('div', { class: 'code-box', tabindex: '0', 'aria-label': 'STL listing, scrolls on its own' });
  const ol = renderListing(codeBox, src, 'STL', Object.fromEntries(Object.entries(ruled).map(([k, r]) => [k, (r.demo ? 'Demo ruling: ' : 'Ruling: ') + r.professor])));

  // inputs
  const rawNum = el('input', { type: 'number', min: -32768, max: 32767, step: 1, value: S.raw, class: 'num', 'aria-label': 'PIW 256 raw value' });
  const rawRange = el('input', { type: 'range', min: -32768, max: 32767, step: 1, value: S.raw, 'aria-label': 'PIW 256 raw value slider' });
  const setRaw = (v) => { v = Math.max(-32768, Math.min(32767, Math.round(+v || 0))); S.raw = v; rawNum.value = v; rawRange.value = v; pctOut.textContent = rawPct(); };
  const rawPct = () => `${minus((S.raw / 27648 * 100).toFixed(1))} % of 27 648`;
  const pctOut = el('span', { class: 'qty muted-qty' }, rawPct());
  rawNum.addEventListener('change', () => setRaw(rawNum.value)); rawRange.addEventListener('input', () => setRaw(rawRange.value));
  const bip = seg('Transmitter polarity', [[0, 'Unipolar'], [1, 'Bipolar']], 0, (v) => { S.bipolar = v; });
  const pump = el('button', { type: 'button', class: 'btn toggle', 'aria-pressed': 'false', onclick: () => { S.pump ^= 1; pump.setAttribute('aria-pressed', String(!!S.pump)); } }, 'I 0.2 pump');
  const ack = el('button', { type: 'button', class: 'btn toggle', 'aria-pressed': 'false', onclick: () => { S.ack ^= 1; ack.setAttribute('aria-pressed', String(!!S.ack)); } }, 'I 0.0 ack');
  const inputs = el('div', { class: 'inputs' },
    field('PIW 256 · level transmitter', el('div', { class: 'raw-row' }, rawNum, pctOut), rawRange,
      el('div', { class: 'scale-ticks qty', 'aria-hidden': 'true' }, el('span', {}, '−32 768'), el('span', {}, '0'), el('span', {}, '27 648'))),
    el('div', { class: 'inputs-row' }, field('I 0.1 · polarity', bip), field('Other inputs', el('div', { class: 'btn-row' }, pump, ack))),
    el('p', { class: 'note' }, 'Inputs are read when a scan starts. Set-points MD 60–72 come from the HMI: 1 000, 3 000, 10 000 and 12 000 l.'));

  // controls
  const stepBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => step() }, 'Step');
  const runBtn = el('button', { type: 'button', class: 'btn', onclick: () => runToEnd() }, 'Run scan');
  const resetBtn = el('button', { type: 'button', class: 'btn', onclick: () => reset() }, 'Reset');
  const counter = el('div', { class: 'counter qty', 'aria-live': 'polite' });
  const controls = el('div', { class: 'controls' }, stepBtn, runBtn, resetBtn, counter);

  // trace
  const stmt = el('div', { class: 'stmt' }), regs = el('div', { class: 'regs' }), bits = el('div', { class: 'bits' }), writes = el('div', { class: 'writes' }), ruling = el('div', { class: 'ruling-slot' });
  const trace = el('section', { class: 'box trace', 'aria-label': 'Trace' }, el('span', { class: 'label box-label' }, 'Trace'), stmt, ruling, regs, bits, writes);

  // result
  const resLabel = el('span', { class: 'label box-label' }, 'Result');
  const tank = el('div', { class: 'tank' }), result = el('div', { class: 'result' });
  const resultBox = el('section', { class: 'box result-box', 'aria-label': 'Result' }, resLabel, el('div', { class: 'result-grid' }, tank, result));

  const drive = el('section', { class: 'box-print drive', 'aria-label': 'Drive the program' });
  root.append(el('div', { class: 'run-grid' }, el('div', { class: 'code-col' }, codeBox, legend()), drive, controls, trace, resultBox));

  function reset() {
    S.cpu = createCpu(new S7Memory());
    SETPOINTS.forEach((v, k) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); S.cpu.mem.write('M', 'D', 60 + 4 * k, b.getUint32(0)); });
    S.scan = 0; S.trace = null; S.idx = -1; S.pre = S.cpu.mem.clone(); render();
  }
  function startScan() {
    const m = S.cpu.mem; m.write('PI', 'W', 256, S.raw & 0xffff); m.write('I', 'X', 0, S.ack, 0); m.write('I', 'X', 0, S.bipolar, 1); m.write('I', 'X', 0, S.pump, 2);
    S.pre = m.clone(); S.trace = runScan(prog, S.cpu); S.scan++; S.idx = -1;
    let h1 = 'INT', h2 = 'INT'; S.hints = S.trace.map((t) => { if (t.op === 'L') h2 = h1; h1 = hintOf(t.op, t.arg, h1); return [h1, h2]; });
  }
  function step() { if (!S.trace || S.idx >= S.trace.length - 1) startScan(); S.idx++; render(); }
  function runToEnd() { if (!S.trace || S.idx >= S.trace.length - 1) startScan(); S.idx = S.trace.length - 1; render(); }
  function stepUntil(pred) { if (!S.trace || S.idx >= S.trace.length - 1) startScan(); while (S.idx < S.trace.length - 1 && !pred(S.trace[S.idx + 1])) S.idx++; render(); }
  function memAt() { // memory as of the current statement: pre-scan image + writes so far
    const m = S.pre.clone(); if (!S.trace) return m;
    for (let k = 0; k <= S.idx; k++) for (const w of S.trace[k].writes) m.write(w.area, w.size, w.byte, w.after, w.bit);
    return m;
  }
  const scanDone = () => S.trace && S.idx === S.trace.length - 1;

  function render() {
    const t = S.trace && S.idx >= 0 ? S.trace[S.idx] : null;
    markLines(ol, t ? t.line : null, t ? t.lastLine : null, codeBox);
    counter.textContent = !S.trace ? `Scan ${S.scan + 1} not started` : `Scan ${S.scan} · statement ${S.idx + 1} of ${S.trace.length}${scanDone() ? ' · done' : ''}`;
    stepBtn.textContent = !S.trace || scanDone() ? (S.scan ? 'Step next scan' : 'Step') : 'Step';
    runBtn.textContent = S.trace && !scanDone() ? 'Finish scan' : 'Run scan';
    // statement
    if (!t) stmt.replaceChildren(el('p', { class: 'stmt-empty' }, S.trace ? 'Press Step to run the first statement.' : 'Press Step to start a scan with the inputs above, or Run scan to run it whole.'));
    else stmt.replaceChildren(
      el('div', { class: 'stmt-head' }, el('span', { class: 'step-no qty' }, String(t.line + 1)), el('code', { class: 'stmt-code' }, t.op + (t.arg && t.op !== 'CALL' ? ' ' + t.arg.replace(/\s+/g, ' ') : t.op === 'CALL' ? ' ' + t.arg + ' (SCALE)' : '')),
        t.jumped != null ? el('span', { class: 'jump qty' }, `jumps to line ${S.trace[S.idx + 1] ? S.trace[S.idx + 1].line + 1 : '?'}`) : null),
      el('p', { class: 'gloss' }, STL_GLOSS[t.op] || ''));
    // ruling on this line
    ruling.replaceChildren();
    const r = t && ruled[t.line];
    if (r) {
      const ctx = { params: t.call?.params, out: t.call?.out, stw: t.regs.stw };
      if (r.applies(ctx)) {
        const ans = r.examAnswer(ctx);
        const s7now = t.call ? `Real S7 here: OUT = ${realText(t.call.out.OUT)} m, RET_VAL = W#16#${hex(t.call.out.RET_VAL, 4)}.` : `Real S7 here: ACCU 1-L = ${intText(int16(t.regs.a1))}, OV = 1, OS = 1, and the next line runs.`;
        ruling.replaceChildren(el('div', { class: 'ruling' },
          el('div', { class: 'ruling-head' }, el('span', { class: 'label' }, 'Demo ruling'), el('span', { class: 'demo-note' }, 'Written for this prototype: no real ruling exists yet.')),
          el('div', { class: 'answer exam' }, el('span', { class: 'label' }, 'Exam answer · Professor'),
            el('p', { class: 'exam-val' }, ans.kind === 'real' ? [ans.label, ' = ', el('span', { class: 'qty' }, realText(ans.value))] : [ans.label, ' ', ans.value]),
            el('p', { class: 'exam-why' }, r.professor)),
          el('p', { class: 'redpen' }, svg('<svg class="pen-mark" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15c3-1 5-4 7-8 1 3 3 5 7 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
            el('strong', {}, 'What a real S7 does. '), r.s7, ' ', el('span', { class: 'qty-inline' }, s7now))));
      }
    }
    // registers
    if (t) {
      const [h1, h2] = S.hints[S.idx], u = t.regs.undef;
      const reg = (name, v, hint, isUndef) => el('div', { class: 'reg' }, el('span', { class: 'label' }, name),
        isUndef ? el('span', { class: 'reg-val undef' }, 'left by FC105') : [el('span', { class: 'reg-val qty' }, accuText(v, hint)), el('span', { class: 'reg-hex qty' }, `16#${hex(v)} · ${hint}`)]);
      regs.replaceChildren(reg('ACCU 1', t.regs.a1, h1, u.includes('a1')), reg('ACCU 2', t.regs.a2, h2, u.includes('a2')), reg('AR 1', t.regs.ar1, 'PTR', false));
      const prev = S.idx > 0 ? S.trace[S.idx - 1].regs.stw : null;
      bits.replaceChildren(...['RLO', '/FC', 'STA', 'OR', 'OV', 'OS', 'CC1', 'CC0', 'BR'].map((b) => bitBox(b, t.regs.stw[b], prev && prev[b] !== t.regs.stw[b], u.includes(b))));
    } else { regs.replaceChildren(); bits.replaceChildren(); }
    // memory writes: this statement, then everything changed so far this scan
    writes.replaceChildren();
    if (S.trace && S.idx >= 0) {
      const last = new Map(); for (let k = 0; k <= S.idx; k++) for (const w of S.trace[k].writes) last.set(w.addr, { ...w, first: last.get(w.addr)?.first ?? w.before, at: k });
      const fmt = (w, v) => (w.size === 'X' ? String(v) : w.size === 'D' ? realText(bitsToReal(v)) : intText(int16(v)));
      const rows = [...last.values()].sort((a, b) => b.at - a.at).map((w) => el('tr', { class: w.at === S.idx ? 'now' : '' },
        el('th', { scope: 'row', class: 'qty' }, w.addr), el('td', { class: 'qty' }, fmt(w, w.after)), el('td', { class: 'qty hexcell' }, w.size === 'X' ? '' : `16#${hex(w.after, w.size === 'D' ? 8 : 4)}`)));
      writes.append(el('span', { class: 'label' }, `Memory written this scan (${last.size})`),
        rows.length ? el('div', { class: 'table-scroll' }, el('table', { class: 'readout mem' }, el('tbody', {}, rows))) : el('p', { class: 'note' }, 'Nothing written yet.'));
    }
    renderResult();
  }
  function renderResult() {
    const m = memAt(), R = (a) => bitsToReal(m.read('M', 'D', a)), bit = (area, byte, b) => m.read(area, 'X', byte, b);
    const h = R(24), A = R(28), V = R(32), band = int16(m.read('M', 'W', 36)), ret = m.read('M', 'W', 22), corr = int16(m.read('M', 'W', 20));
    resLabel.textContent = !S.trace ? 'Result: no scan yet' : S.idx === S.trace.length - 1 ? `Result after scan ${S.scan}` : `Memory as of statement ${S.idx + 1} (scan ${S.scan} running)`;
    const hc = Math.max(0, Math.min(2, Number.isFinite(h) ? h : 0));
    // tank cross-section: r = 1 m drawn as 64 px; the wetted segment up to h
    const r = 64, cx = 80, cy = 80, yl = cy + r - hc * r;
    const half = Math.sqrt(Math.max(0, r * r - (yl - cy) ** 2)), large = yl < cy ? 1 : 0;
    const seg = hc <= 0 ? '' : hc >= 2 ? `<circle cx="${cx}" cy="${cy}" r="${r}" class="liquid"/>` : `<path class="liquid" d="M${cx - half} ${yl} A${r} ${r} 0 ${large} 0 ${cx + half} ${yl} Z"/>`;
    tank.replaceChildren(svg(`<svg viewBox="0 0 160 172" role="img" aria-label="Tank cross-section filled to ${hc.toFixed(2)} m">
      ${seg}<circle cx="${cx}" cy="${cy}" r="${r}" class="shell"/>
      ${hc > 0 && hc < 2 ? `<line x1="${cx - half}" y1="${yl}" x2="${cx + half}" y2="${yl}" class="surface"/>` : ''}
      <line x1="${cx + r + 8}" y1="${cy + r}" x2="${cx + r + 8}" y2="${yl}" class="dim"/><line x1="${cx + r + 4}" y1="${cy + r}" x2="${cx + r + 12}" y2="${cy + r}" class="dim"/><line x1="${cx + r + 4}" y1="${yl}" x2="${cx + r + 12}" y2="${yl}" class="dim"/>
      <text x="${cx}" y="166" class="tank-cap">r 1.0 m · L 4.0 m</text></svg>`));
    const alarm = (addr, name, on) => el('li', { class: on ? 'on' : '' }, el('span', { class: 'lamp', 'aria-hidden': 'true' }), el('span', { class: 'qty addr' }, addr), el('span', {}, name), el('span', { class: 'sr' }, on ? ' (on)' : ' (off)'));
    result.replaceChildren(
      el('div', { class: 'answer vol' }, el('span', { class: 'label' }, 'Volume V · MD 32'), el('p', { class: 'vol-val' }, el('span', { class: 'qty big' }, realText(V)), ' l')),
      el('table', { class: 'readout res' }, el('tbody', {},
        el('tr', {}, el('th', { scope: 'row' }, 'Corrected raw · MW 20'), el('td', { class: 'qty' }, intText(corr))),
        el('tr', {}, el('th', { scope: 'row' }, 'Level h · MD 24'), el('td', { class: 'qty' }, `${realText(h)} m`)),
        el('tr', {}, el('th', { scope: 'row' }, 'FC105 RET_VAL · MW 22'), el('td', { class: 'qty' }, `W#16#${hex(ret, 4)}`)),
        el('tr', {}, el('th', { scope: 'row' }, 'Wetted area · MD 28'), el('td', { class: 'qty' }, `${realText(A)} m²`)),
        el('tr', {}, el('th', { scope: 'row' }, 'Level band · MW 36'), el('td', { class: 'qty' }, `${band} of 4`)))),
      el('ul', { class: 'alarms' }, alarm('M 1.0', 'Level signal out of range', bit('M', 1, 0)), alarm('M 1.1', 'Above high-high', bit('M', 1, 1)),
        alarm('M 1.2', 'Offset overflow', bit('M', 1, 2)), alarm('Q 4.1', 'Common alarm lamp', bit('Q', 4, 1)), alarm('Q 4.0', 'High-volume lamp', bit('Q', 4, 0))));
  }
  onRealMode.push(render);
  reset();
  return {
    drive, inputs, reset, step, runToEnd, stepUntil, setRaw, setBipolar: (v) => { S.bipolar = v; bip.set(v); },
    setAck: (v) => { S.ack = v; ack.setAttribute('aria-pressed', String(!!v)); }, setPump: (v) => { S.pump = v; pump.setAttribute('aria-pressed', String(!!v)); },
    lineOf: (needle) => prog.lines.findIndex((l) => l.includes(needle)),
  };
}

// ====================================================================================
// SCL card
// ====================================================================================
const STATES = { 0: 'IDLE', 1: 'SEARCH', 2: 'MOVE', 3: 'STORE', 9: 'ERROR' };
function sclCard(root) {
  const src = LISTINGS.warehouse;
  const S = { fb: null, trace: null, idx: -1, pre: null, scan: 0, temps: {}, auto: null, inputs: { store_req: false, item_id: 101, arrived: false, reset: false } };
  const codeBox = el('div', { class: 'code-box', tabindex: '0', 'aria-label': 'SCL listing, scrolls on its own' });
  const ol = renderListing(codeBox, src, 'SCL');

  const tog = (name, label) => {
    const b = el('button', { type: 'button', class: 'btn toggle', 'aria-pressed': 'false', onclick: () => { S.inputs[name] = !S.inputs[name]; b.setAttribute('aria-pressed', String(S.inputs[name])); } }, label);
    b.set = (v) => { S.inputs[name] = v; b.setAttribute('aria-pressed', String(v)); }; return b;
  };
  const reqB = tog('store_req', 'store_req'), arrB = tog('arrived', 'arrived'), rstB = tog('reset', 'reset');
  const item = el('input', { type: 'number', class: 'num', value: 101, min: -32768, max: 32767, 'aria-label': 'item_id' });
  item.addEventListener('change', () => { S.inputs.item_id = Math.round(+item.value || 0); });
  const inputs = el('div', { class: 'inputs' },
    el('div', { class: 'inputs-row' }, field('Inputs · press to hold on', el('div', { class: 'btn-row' }, reqB, arrB, rstB)), field('item_id', item)),
    el('p', { class: 'note' }, 'The FB reads its inputs when a scan starts; a held button stays on for every scan.'));

  const stepB = el('button', { type: 'button', class: 'btn primary', onclick: () => stepStmt() }, 'Step statement');
  const scanB = el('button', { type: 'button', class: 'btn', onclick: () => stepScan() }, 'Step scan');
  const autoB = el('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: () => toggleAuto() }, 'Run scans');
  const resetB = el('button', { type: 'button', class: 'btn', onclick: () => reset() }, 'Reset');
  const counter = el('div', { class: 'counter qty', 'aria-live': 'polite' });
  const controls = el('div', { class: 'controls' }, stepB, scanB, autoB, resetB, counter);

  const stmt = el('div', { class: 'stmt' }), diagram = el('div', { class: 'diagram' }), vars = el('div', { class: 'vars' }), rack = el('div', { class: 'rack' });
  const drive = el('section', { class: 'box-print drive', 'aria-label': 'Drive the program' });
  root.append(el('div', { class: 'run-grid' }, el('div', { class: 'code-col' }, codeBox), drive, controls,
    el('section', { class: 'box trace', 'aria-label': 'Trace' }, el('span', { class: 'label box-label' }, 'Trace'), stmt, diagram, vars),
    el('section', { class: 'box result-box', 'aria-label': 'Rack' }, el('span', { class: 'label box-label' }, 'The rack · DB "Rack"'), rack)));

  function reset() {
    stopAuto(); S.fb = createScl(src, { block: 'Warehouse' });
    for (const sec of S.fb.unit.blocks.Warehouse.secs) for (const d of sec.d) if (d.ty.name === 'REAL') REALS.add(d.name); S.trace = null; S.idx = -1; S.scan = 0; S.pre = S.fb.values(); S.temps = {}; render(); }
  function startScan() { S.pre = S.fb.values(); const r = S.fb.scan({ ...S.inputs }); S.trace = r.trace; S.idx = -1; S.scan++; S.temps = {}; }
  const done = () => S.trace && S.idx >= S.trace.length - 1;
  function stepStmt() { stopAuto(); if (!S.trace || done()) startScan(); S.idx = Math.min(S.idx + 1, S.trace.length - 1); render(); }
  function stepScan() { if (!S.trace || done()) startScan(); S.idx = S.trace.length - 1; render(); }
  function stopAuto() { if (S.auto) { clearInterval(S.auto); S.auto = null; autoB.setAttribute('aria-pressed', 'false'); autoB.textContent = 'Run scans'; } }
  function toggleAuto() { if (S.auto) return stopAuto(); autoB.setAttribute('aria-pressed', 'true'); autoB.textContent = 'Pause'; stepScan(); S.auto = setInterval(stepScan, 600); }
  function valuesAt() {
    const v = { ...S.pre }; const temps = {};
    if (S.trace) for (let k = 0; k <= S.idx; k++) for (const w of S.trace[k].writes) { if (w.path in v) v[w.path] = w.after; else temps[w.path] = w.after; }
    return { v, temps };
  }
  const REALS = new Set(); // declared REAL variables, so 50.0 shows as a REAL, not as 50
  const show = (x, k) => (typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : REALS.has(k) ? realText(x) : intText(x));

  function render() {
    const t = S.trace && S.idx >= 0 ? S.trace[S.idx] : null;
    markLines(ol, t ? t.line : null, t ? t.end : null, codeBox);
    counter.textContent = !S.trace ? `Scan ${S.scan + 1} not started` : `Scan ${S.scan} · statement ${S.idx + 1} of ${S.trace.length}${done() ? ' · done' : ''}`;
    const { v, temps } = valuesAt();
    // statement
    if (!t) stmt.replaceChildren(el('p', { class: 'stmt-empty' }, 'Step statement walks one scan line by line; Step scan runs a whole scan of the FB.'));
    else {
      const text = LISTINGS.warehouse.split('\n')[t.line].replace(/\/\/.*$/, '').trim();
      const gloss = t.kind === 'case' ? `CASE on #state = ${t.selector} (${STATES[t.selector] || 'no branch'}).`
        : t.kind === 'case-arm' ? `Branch ${t.arm === 'else' ? 'ELSE' : t.selector + ':'} runs.`
        : t.kind === 'if' ? (t.arm === 'else' ? 'No condition held: the ELSE branch runs.' : `Condition is ${t.cond ? 'TRUE: this branch runs.' : 'FALSE.'}`)
        : t.kind === 'for' ? (t.phase === 'init' ? `FOR starts at ${t.writes[0]?.path} = ${t.writes[0]?.after}.` : `Next pass: ${t.writes[0]?.path} = ${t.writes[0]?.after}; the loop goes on while it is within the bound.`)
        : t.kind === 'exit' ? 'EXIT leaves the innermost loop only.' : t.writes.length ? t.writes.map((w) => `${w.path} := ${show(w.after, w.path)}`).join(', ') : '';
      stmt.replaceChildren(el('div', { class: 'stmt-head' }, el('span', { class: 'step-no qty' }, String(t.line + 1)), el('code', { class: 'stmt-code' }, text)), el('p', { class: 'gloss' }, gloss));
    }
    // state diagram
    const st = v.state;
    const node = (id, x, y) => `<g class="node${st === id ? ' cur' : ''}"><rect x="${x - 32}" y="${y - 15}" width="64" height="30"/><text x="${x}" y="${y + 4}">${STATES[id]}</text></g>`;
    const lbl = (x, y, t, a = 'middle') => `<text x="${x}" y="${y}" text-anchor="${a}" class="edge-lbl">${t}</text>`;
    diagram.replaceChildren(svg(`<svg viewBox="0 0 380 162" role="img" aria-label="State machine, current state ${STATES[st] || st}">
      <defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8" fill="none" class="arrow-head"/></marker></defs>
      <path class="edge" d="M72 30H106" marker-end="url(#ah)"/><path class="edge" d="M172 30H206" marker-end="url(#ah)"/><path class="edge" d="M272 30H306" marker-end="url(#ah)"/>
      <path class="edge" d="M338 45V150H20V47" marker-end="url(#ah)"/><path class="edge" d="M158 110H44V47" marker-end="url(#ah)"/>
      <path class="edge dashed" d="M150 45L179 93" marker-end="url(#ah)"/><path class="edge dashed" d="M230 45L201 93" marker-end="url(#ah)"/>
      ${node(0, 40, 30)}${node(1, 140, 30)}${node(2, 240, 30)}${node(3, 338, 30)}${node(9, 190, 110)}
      ${lbl(89, 62, 'request')}${lbl(190, 62, 'slot')}${lbl(290, 62, 'arrived')}${lbl(154, 86, 'full', 'end')}${lbl(226, 86, 'watchdog', 'start')}
      ${lbl(100, 104, 'reset')}${lbl(190, 144, 'stored')}</svg>`));
    // variables
    const row = (name, val, kind, changed) => el('tr', { class: changed ? 'now' : '' }, el('th', { scope: 'row' }, el('span', { class: 'qty' }, name), el('span', { class: 'kind' }, kind)), el('td', { class: 'qty' }, val));
    const changed = new Set(t ? t.writes.map((w) => w.path) : []);
    const kinds = S.fb.kinds;
    const inst = Object.keys(v).filter((k) => !k.startsWith('Rack.'));
    vars.replaceChildren(el('span', { class: 'label' }, 'Instance and temporaries'), el('div', { class: 'table-scroll' }, el('table', { class: 'readout vars-t' }, el('tbody', {},
      row('state', `${v.state} · ${STATES[v.state] || '?'}`, 'static', changed.has('state')),
      ...Object.entries(S.inputs).map(([k, x]) => row(k, show(x), 'input', false)),
      ...inst.filter((k) => k !== 'state').map((k) => row(k, show(v[k], k), kinds[k] === 'VAR_OUTPUT' ? 'output' : 'static', changed.has(k))),
      ...['lvl', 'col', 'found'].map((k) => row(k, k in temps ? show(temps[k]) : '—', 'temp', changed.has(k)))))));
    // rack
    const tgt = [v.target_lvl, v.target_col], busy = v.busy;
    const cells = [];
    for (const lvl of [2, 1]) for (let col = 1; col <= 3; col++) {
      const occ = v[`Rack.slot[${lvl},${col}].occupied`], id = v[`Rack.slot[${lvl},${col}].item_id`];
      const isT = busy && (v.state === 2 || v.state === 3) && tgt[0] === lvl && tgt[1] === col;
      cells.push(el('div', { class: `slot${occ ? ' occ' : ''}${isT ? ' target' : ''}` }, el('span', { class: 'slot-ix qty' }, `[${lvl},${col}]`), el('span', { class: 'slot-v qty' }, occ ? `item ${id}` : 'free')));
    }
    rack.replaceChildren(el('div', { class: 'rack-grid' }, cells),
      el('table', { class: 'readout rack-t' }, el('tbody', {},
        el('tr', {}, el('th', { scope: 'row' }, 'Rack.stored'), el('td', { class: 'qty' }, intText(v['Rack.stored']))),
        el('tr', {}, el('th', { scope: 'row' }, 'fill_pct'), el('td', { class: 'qty' }, `${realText(v.fill_pct)} %`)),
        el('tr', {}, el('th', { scope: 'row' }, 'Outputs'), el('td', { class: 'flags' }, ['busy', 'done', 'error'].map((k) => el('span', { class: `flag${v[k] ? ' on' : ''}` }, k, el('span', { class: 'sr' }, v[k] ? ' on' : ' off'))))))));
  }
  onRealMode.push(render);
  reset();
  const set = { store_req: reqB, arrived: arrB, reset: rstB };
  return {
    drive, inputs, reset, stepStmt, stepScan, setInput: (k, x) => { if (k === 'item_id') { S.inputs.item_id = x; item.value = x; } else set[k].set(x); },
    fill: (n) => { stopAuto(); for (let k = 1; k <= n; k++) for (const s of [{ store_req: true, item_id: 200 + k }, {}, { arrived: true }, { store_req: false, arrived: false }]) { Object.assign(S.inputs, s); startScan(); } S.idx = S.trace.length - 1; reqB.set(false); arrB.set(false); item.value = 200 + n; S.inputs.item_id = 200 + n; render(); },
    stepUntilLine: (pred) => { stopAuto(); if (!S.trace || done()) startScan(); const lines = LISTINGS.warehouse.split('\n'); while (S.idx < S.trace.length - 1 && !pred(lines[S.trace[S.idx + 1].line])) S.idx++; S.idx = Math.min(S.idx + 1, S.trace.length - 1); render(); },
  };
}

// ====================================================================================
// Walkthroughs: each tab resets to a known state; each step is a real button.
// ====================================================================================
function driveBox(root, freePlay, scenarios) {
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Free play or a guided walkthrough' }), body = el('div', { class: 'drive-body', role: 'tabpanel' });
  root.append(tabs, body);
  const open = (i) => {
    tabs.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    if (i === 0) { body.replaceChildren(freePlay); return; }
    const sc = scenarios[i - 1]; let at = 0;
    const list = el('ol', { class: 'walk-steps' });
    const paint = () => list.querySelectorAll('li').forEach((li, k) => { li.className = k < at ? 'done' : k === at ? 'next' : ''; li.querySelector('button').className = k === at ? 'btn primary' : 'btn'; });
    sc.steps.forEach(([label, act], k) => list.append(el('li', {}, el('button', { type: 'button', class: 'btn', onclick: () => { act(); at = k + 1; paint(); } }, el('span', { class: 'walk-no qty' }, String(k + 1)), el('span', { class: 'walk-label' }, label), tick()))));
    body.replaceChildren(el('p', { class: 'walk-desc' }, sc.desc), el('p', { class: 'walk-watch' }, el('strong', {}, 'Watch '), sc.watch), list);
    paint();
  };
  ['Free play', ...scenarios.map((sc) => sc.name)].forEach((name, i) => tabs.append(el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => open(i) }, name)));
  open(0);
}
const legend = () => el('p', { class: 'legend' }, svg('<svg class="ring-key" viewBox="0 0 34 22" aria-hidden="true"><path d="M5 12c0-6 9-9 16-8 7 1 10 5 8 9-2 5-11 7-17 5-5-2-7-4-6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'),
  'A red ring on a line number: the Owner has ruled on that line. Both rulings here are demos.');

// ====================================================================================
// Gate report panel (embedded at build from gate-report.json)
// ====================================================================================
function gatePanel(root, rep) {
  const mark = (res) => el('span', { class: `res res-${res.replace(' ', '-').toLowerCase()}` }, res === 'PASS' ? tick() : cross(), res);
  root.append(
    el('p', { class: 'gate-meta' }, 'Ran ', el('span', { class: 'qty' }, rep.ranAt.replace('T', ' ').slice(0, 16)), ' UTC over sources ', el('span', { class: 'qty' }, rep.sourcesSha), ' (branch base ', el('span', { class: 'qty' }, rep.commit), ')', '. Overall: ', mark(rep.result), '. A check that did not run counts as failed.'),
    el('div', { class: 'table-scroll' }, el('table', { class: 'gate-t' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Result'), el('th', { scope: 'col' }, 'Check'), el('th', { scope: 'col' }, 'What it compared'))),
      el('tbody', {}, rep.checks.map((c) => el('tr', {}, el('td', {}, mark(c.result)), el('td', {}, el('span', { class: 'lang qty' }, c.lang), ' ', c.title),
        el('td', { class: 'cmp' }, c.compared, c.mismatchCount ? el('span', { class: 'mism' }, ` First mismatch: ${c.mismatches[0]}`) : null)))))),
    el('h3', { class: 'sub' }, 'Negative controls: planted mutants the gate must catch'),
    el('div', { class: 'table-scroll' }, el('table', { class: 'gate-t' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Caught'), el('th', { scope: 'col' }, 'Planted defect'), el('th', { scope: 'col' }, 'First difference the gate saw'))),
      el('tbody', {}, rep.negativeControls.map((c) => el('tr', {}, el('td', {}, mark(c.result)), el('td', {}, el('span', { class: 'lang qty' }, c.lang), ' ', c.title),
        el('td', { class: 'cmp qty-small' }, c.firstMismatch)))))),
    el('p', { class: 'note' }, 'Oracles: STL ', rep.oracles.stl, '. SCL ', rep.oracles.scl, '.'));
}

// ====================================================================================
// boot
// ====================================================================================
document.querySelectorAll('[data-realmode]').forEach((b) => b.addEventListener('click', () => setRealMode(b.dataset.realmode)));
const stl = stlCard($('#stl-run'));
const scl = sclCard($('#scl-run'));
stl.runToEnd(); // open on a finished first scan, so the result box shows a real volume
const callLine = LISTINGS.tank.split('\n').findIndex((l) => l.includes('CALL  FC   105'));
driveBox(stl.drive, stl.inputs, [
  { name: 'Sensor over range: FC105 clamps', desc: 'The transmitter reads 30 000, past the nominal 27 648. FC105 has to decide what level that is.',
    watch: 'the CALL line: the engine clamps like a real S7, and the demo ruling shows the Professor’s answer beside it.',
    steps: [['Reset the tank', () => { stl.reset(); stl.setBipolar(0); stl.setAck(0); stl.setPump(0); stl.setRaw(13824); }],
      ['Set PIW 256 to 30 000', () => stl.setRaw(30000)],
      ['Step to the FC105 call', () => stl.stepUntil((t) => t.line === callLine)],
      ['Step over the call', () => stl.step()],
      ['Finish the scan', () => stl.runToEnd()]] },
  { name: 'INT wrap sets OV', desc: 'The module sends 32 767, its overflow code. The listing adds a +200 zero-point offset in INT.',
    watch: 'the +I line wraps to a negative number and sets OV and OS; FC105 then reads an empty tank, and M 1.2 latches.',
    steps: [['Reset the tank', () => { stl.reset(); stl.setBipolar(0); stl.setAck(0); stl.setPump(0); stl.setRaw(13824); }],
      ['Set PIW 256 to 32 767', () => stl.setRaw(32767)],
      ['Step to the +I', () => stl.stepUntil((t) => t.op === '+I')],
      ['Step the +I', () => stl.step()],
      ['Finish the scan', () => stl.runToEnd()],
      ['Acknowledge with I 0.0 and run a normal scan', () => { stl.setRaw(13824); stl.setAck(1); stl.runToEnd(); stl.setAck(0); }]] },
]);
driveBox(scl.drive, scl.inputs, [
  { name: 'Warehouse full → ERROR', desc: 'Six pallets fill the 2 × 3 rack. A seventh request has nowhere to go.',
    watch: 'the SEARCH scan: both FOR loops run to the end without EXIT, found stays FALSE, and the state jumps to ERROR until reset.',
    steps: [['Reset the rack', () => scl.reset()],
      ['Store six pallets (24 scans)', () => scl.fill(6)],
      ['Press store_req for a 7th pallet', () => { scl.setInput('item_id', 207); scl.setInput('store_req', true); scl.stepScan(); }],
      ['Step the SEARCH scan to its last IF #found', () => scl.stepUntilLine((l) => l === '        IF #found THEN')],
      ['Finish the scan', () => scl.stepScan()],
      ['Press reset and step a scan', () => { scl.setInput('store_req', false); scl.setInput('reset', true); scl.stepScan(); scl.setInput('reset', false); }]] },
  { name: 'A held request stores one pallet', desc: 'The operator keeps store_req pressed. The FB reacts to the rising edge only.',
    watch: '#last_req: after the pallet is stored the FB goes back to IDLE and waits, although store_req is still on.',
    steps: [['Reset the rack', () => scl.reset()],
      ['Press and hold store_req', () => { scl.setInput('item_id', 42); scl.setInput('store_req', true); scl.stepScan(); }],
      ['Step a scan (SEARCH)', () => scl.stepScan()],
      ['Crane arrives: step a scan', () => { scl.setInput('arrived', true); scl.stepScan(); }],
      ['Step a scan (STORE)', () => { scl.setInput('arrived', false); scl.stepScan(); }],
      ['Step two more scans, still holding', () => { scl.stepScan(); scl.stepScan(); }]] },
]);
gatePanel($('#gate-report'), GATE_REPORT);
{
  const g = GATE_REPORT, cell = $('#tb-gate');
  cell.replaceChildren(el('span', { class: `res res-${g.result.toLowerCase()}` }, g.result === 'PASS' ? tick() : cross(), g.result));
}
