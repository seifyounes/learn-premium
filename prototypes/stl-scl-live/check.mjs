// PROTOTYPE (throwaway, ticket #37): the build Gate for the live STL/SCL listings.
//   node check.mjs            -> prints the gate table, writes gate-report.json, exit 1 on any FAIL
// STL: stl.mjs vs awlsim (the oracle), bit for bit: memory, outputs, ACCU1/2, AR1, status word,
//      after every scan and after every statement.
// SCL: scl.mjs vs blind/scl-blind.mjs (second interpreter written blind), every key, every scan.
// Negative controls: planted mutants of the interpreters that the same comparison must catch.
// A check that cannot run counts as FAIL.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realToBits } from './s7core.mjs';
import { STW_BITS } from './stl.mjs';
import { rulings, rulingLine } from './listings/rulings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rel = (...p) => join(HERE, ...p);
const AWLSIM_DIR = process.env.AWLSIM_DIR ||
  'C:/Users/ALAAYO~1/AppData/Local/Temp/claude/D--Claude-Os-crash-course-skill/9b7b15f2-2cac-4015-98e5-74dbc768e84c/scratchpad/r/awlsim';
const TANK = readFileSync(rel('listings/tank.awl'), 'utf8');
const WAREHOUSE = readFileSync(rel('listings/warehouse.scl'), 'utf8');

// ---- STL cases ---------------------------------------------------------------------------
const SETPOINTS = [1000, 3000, 10000, 12000]; // litres, MD 60..72, written by the HMI
const initM = SETPOINTS.map((v, k) => { const b = Buffer.alloc(4); b.writeFloatBE(v); return [60 + 4 * k, [...b]]; });
const scanIn = ({ raw, bipolar = 0, ack = 0, pump = 0 }) => ({ I: [[0, [ack | (bipolar << 1) | (pump << 2)]], [256, [(raw >> 8) & 255, raw & 255]]] });
const RAWS = [-32768, -27649, -27648, -13824, -1, 0, 1, 1000, 6912, 13824, 20000, 25000, 27448, 27449, 27648, 30000, 32511, 32567, 32568, 32767];
const stlCases = [
  ...RAWS.flatMap((raw, i) => [0, 1].map((bipolar) => ({ name: `raw ${raw}, ${bipolar ? 'bipolar' : 'unipolar'}`, init: { M: initM }, scans: [scanIn({ raw, bipolar, pump: (i + bipolar) & 1 })] }))),
  { name: 'alarm latches, then ack clears it', init: { M: initM }, scans: [{ raw: 30000 }, { raw: 10000 }, { raw: 10000, ack: 1 }, { raw: 10000 }].map(scanIn) },
  { name: 'INT wrap latches offset alarm', init: { M: initM }, scans: [{ raw: 32767 }, { raw: 5000 }, { raw: 5000, ack: 1 }].map(scanIn) },
  { name: 'ramp across the set-points', init: { M: initM }, scans: [0, 2000, 5000, 9000, 14000, 19000, 23000, 26000, 27448].map((raw) => scanIn({ raw, pump: 1 })) },
];

// The listing is shown in the STEP 7 editor form; awlsim wants CALL parameters in brackets.
// Line count is preserved so awlsim's line numbers map 1:1 onto the listing.
export function toAwlsim(src) {
  const lines = src.replace(/\r/g, '').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '').trimEnd();
    if (/^\s*CALL\s+FC\s*\d+/i.test(code)) {
      out.push(code + ' (');
      const ps = [];
      while (i + 1 < lines.length) {
        const m = lines[i + 1].replace(/\/\/.*$/, '').trim().match(/^(\w+)\s*:=\s*(.+)$/); if (!m) break;
        ps.push(`\t\t${m[1]} := ${m[2].trim().replace(/^(PI|PQ|I|Q|M)(B|W|D)?(\d)/i, '$1$2 $3')}`); i++;
      }
      ps.forEach((p, k) => out.push(p + (k < ps.length - 1 ? ',' : ' )')));
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n') + '\n' + readFileSync(rel('oracle/fc105.awl'), 'utf8');
}

function runAwlsim(cases) {
  const awl = toAwlsim(TANK);
  mkdirSync(rel('.gate'), { recursive: true }); writeFileSync(rel('.gate/tank.awlsim.awl'), awl);
  const stdout = execFileSync(process.env.PYTHON || 'python', [rel('oracle/awlsim_run.py')], {
    input: JSON.stringify({ awl, cases }), env: { ...process.env, AWLSIM_DIR }, maxBuffer: 1 << 28,
  }).toString();
  return JSON.parse(stdout.split('@@JSON@@')[1]);
}

async function runStlEngine(modUrl, cases) {
  const { parseStl, createCpu, runScan, stwWord } = await import(modUrl);
  const prog = parseStl(TANK);
  return cases.map((c) => {
    const cpu = createCpu();
    for (const [o, d] of c.init.M) d.forEach((b, i) => cpu.mem.write('M', 'B', o + i, b));
    const scans = [];
    for (const s of c.scans) {
      for (const [o, d] of s.I) d.forEach((b, i) => cpu.mem.write(o >= 256 ? 'PI' : 'I', 'B', o + i, b));
      let trace;
      try { trace = runScan(prog, cpu); } catch (e) { scans.push({ error: e.message }); continue; }
      scans.push({
        M: Buffer.from(cpu.mem.bytes('M', 0, 128)).toString('hex'), Q: Buffer.from(cpu.mem.bytes('Q', 0, 16)).toString('hex'),
        ACCU1: cpu.a1 >>> 0, ACCU2: cpu.a2 >>> 0, AR1: cpu.ar1 >>> 0, STW: stwWord(cpu.s), undef: [...cpu.undef],
        steps: trace.map((t) => ({ line: t.line, lastLine: t.lastLine, op: t.op, a1: t.regs.a1 >>> 0, a2: t.regs.a2 >>> 0, ar1: t.regs.ar1 >>> 0, stw: stwWord(t.regs.stw), undef: t.regs.undef })),
      });
    }
    return { name: c.name, scans };
  });
}

// Status-word bits a library block left undefined are masked out of the comparison.
const stwMask = (undef) => STW_BITS.reduce((m, b, i) => (undef.includes(b) ? m & ~(1 << i) : m), 0x1ff);
const h8 = (n) => '16#' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
function compareStl(ours, oracle) {
  const mism = []; let values = 0, steps = 0, skipped = 0;
  ours.forEach((c, ci) => c.scans.forEach((s, si) => {
    const o = oracle[ci].scans[si], where = `${c.name}, scan ${si + 1}`;
    if (s.error) { mism.push(`${where}: engine error ${s.error}`); return; }
    for (let b = 0; b < 128; b++) { values++; if (s.M.substr(2 * b, 2) !== o.M.substr(2 * b, 2)) mism.push(`${where}: MB ${b} = 16#${s.M.substr(2 * b, 2)}, awlsim 16#${o.M.substr(2 * b, 2)}`); }
    for (let b = 0; b < 16; b++) { values++; if (s.Q.substr(2 * b, 2) !== o.Q.substr(2 * b, 2)) mism.push(`${where}: QB ${b} = 16#${s.Q.substr(2 * b, 2)}, awlsim 16#${o.Q.substr(2 * b, 2)}`); }
    for (const k of ['ACCU1', 'ACCU2', 'AR1', 'STW']) {
      values++; const mk = k === 'STW' ? stwMask(s.undef) : 0xffffffff; if (k === 'ACCU1' && s.undef.includes('a1') || k === 'ACCU2' && s.undef.includes('a2')) { skipped++; continue; }
      if (((s[k] & mk) >>> 0) !== ((o[k] & mk) >>> 0)) mism.push(`${where}: ${k} = ${h8(s[k])}, awlsim ${h8(o[k])}`); }
    if (s.steps.length !== o.steps.length) mism.push(`${where}: ${s.steps.length} statements executed, awlsim ${o.steps.length}`);
    s.steps.forEach((t, k) => {
      const a = o.steps[k]; if (!a) return; steps++;
      const [aline, aop, a1, a2, ar1, stw] = a;
      if (t.op === 'BE' ? aline !== -1 : aline - 1 < t.line || aline - 1 > t.lastLine) { mism.push(`${where}: statement ${k + 1} is line ${t.line + 1}, awlsim ran line ${aline}`); return; }
      if (t.op === 'CALL') return; // awlsim reports a CALL before the block body runs; its effects are checked on the next statements
      for (const [n, x, y, key] of [['ACCU1', t.a1, a1, 'a1'], ['ACCU2', t.a2, a2, 'a2'], ['AR1', t.ar1, ar1], ['STW', t.stw, stw]]) {
        if (t.undef.includes(key)) { skipped++; continue; } // left by a library block Siemens does not publish
        const mk = n === 'STW' ? stwMask(t.undef) : 0xffffffff;
        values++; if (((x & mk) >>> 0) !== ((y & mk) >>> 0)) mism.push(`${where}: after line ${t.line + 1} (${t.op}) ${n} = ${h8(x)}, awlsim ${h8(y)}`);
      }
    });
  }));
  return { mism, values, steps, skipped };
}

// ---- SCL sequences -----------------------------------------------------------------------
const storeCycle = (item) => [{ store_req: true, item_id: item, arrived: false }, {}, { arrived: true }, { store_req: false, arrived: false }, {}];
const sclSequences = [
  { name: 'happy path: one pallet', scans: [{}, ...storeCycle(101), {}] },
  { name: 'held and repeated requests', scans: [{ store_req: true, item_id: 7 }, {}, {}, { store_req: false }, { store_req: true }, { arrived: true }, {}, { store_req: false, arrived: false }, {}, { store_req: true, item_id: 8 }, {}, { arrived: true }, { arrived: false }, {}] },
  { name: 'full rack -> ERROR, reset, ERROR again', scans: [...[1, 2, 3, 4, 5, 6].flatMap((k) => storeCycle(200 + k)), { store_req: true, item_id: 999 }, {}, {}, { reset: true, store_req: false }, { reset: false }, { store_req: true }, {}, {}] },
  { name: 'crane never arrives -> watchdog ERROR', scans: [{ store_req: true, item_id: 55 }, ...Array.from({ length: 24 }, () => ({})), { reset: true }, { reset: false, store_req: false }] },
  { name: 'reset outside ERROR does nothing', scans: [{ reset: true }, { reset: false, store_req: true, item_id: 3 }, { reset: true }, { arrived: true }, {}] },
];
const bitsOf = (v) => (typeof v === 'number' && !Number.isInteger(v) ? '16#' + realToBits(v).toString(16).toUpperCase().padStart(8, '0') : JSON.stringify(v));
async function runSclEngine(modUrl, seqs) {
  const { runScl } = await import(modUrl);
  return seqs.map((q) => { try { return runScl(WAREHOUSE, { block: 'Warehouse', scans: q.scans }); } catch (e) { return { error: e.message }; } });
}
function sameValue(a, b) {
  return Object.is(a, b); // numbers: same value incl. -0.0 and NaN; a REAL is compared as its exact float32
}
function compareScl(ours, theirs) {
  const mism = []; let values = 0;
  ours.forEach((run, qi) => {
    const name = sclSequences[qi].name, other = theirs[qi];
    if (run.error || other.error) { mism.push(`${name}: ${run.error ? 'scl.mjs error: ' + run.error : ''}${other.error ? ' oracle error: ' + other.error : ''}`); return; }
    run.forEach((vals, si) => {
      const o = other[si] || {}; const keys = new Set([...Object.keys(vals), ...Object.keys(o)]);
      for (const k of keys) {
        values++;
        if (!(k in vals) || !(k in o)) mism.push(`${name}, scan ${si + 1}: key ${k} only in ${k in vals ? 'scl.mjs' : 'the oracle'}`);
        else if (!sameValue(vals[k], o[k])) mism.push(`${name}, scan ${si + 1}: ${k} = ${bitsOf(vals[k])}, oracle ${bitsOf(o[k])}`);
      }
    });
  });
  return { mism, values };
}

// ---- mutants -----------------------------------------------------------------------------
const MUTANTS = [
  { id: 'stl-compare-ands-rlo', lang: 'STL', file: 'stl.mjs', title: 'STL compare ANDs into an open logic string instead of writing RLO',
    edits: [['/* GATE-MUTANT:cmp */ s.RLO = r;', "s.RLO = s['/FC'] ? s.RLO & r : r;"]] },
  { id: 'stl-int-no-wrap', lang: 'STL', file: 'stl.mjs', title: '+I/-I keep the exact sum: no 16-bit wrap, no OV',
    edits: [['/* GATE-MUTANT:int16 */', 'return void (cpu.a1 = fn(int16(cpu.a2), int16(cpu.a1)) >>> 0, s.OV = 0);']] },
  { id: 'scl-real-float64', lang: 'SCL', file: 'scl.mjs', title: 'SCL REAL arithmetic kept in float64 (no float32 rounding)',
    edits: [['/* GATE-MUTANT:real-in */ f32(a.v), y = f32(b.v)', 'a.v, y = b.v'], ['/* GATE-MUTANT:real */ f32(r)', 'r']] },
  { id: 'scl-exit-ignored', lang: 'SCL', file: 'scl.mjs', title: 'SCL EXIT ignored: the loop runs on',
    edits: [['/* GATE-MUTANT:exit */ throw EXIT;', 'break;']] },
];
function plantMutant(m) {
  const dir = rel('.gate', 'mutants', m.id); mkdirSync(join(dir, 'listings'), { recursive: true });
  for (const f of ['s7core.mjs', 'stl.mjs', 'scl.mjs']) copyFileSync(rel(f), join(dir, f));
  let src = readFileSync(rel(m.file), 'utf8');
  for (const [from, to] of m.edits) { if (!src.includes(from)) return null; src = src.replace(from, to); } // marker gone: cannot plant
  writeFileSync(join(dir, m.file), src);
  return pathToFileURL(join(dir, m.file)).href;
}

// ---- run ---------------------------------------------------------------------------------
const checks = [], controls = [];
const add = (c) => { checks.push(c); return c; };

let awl = null, awlErr = null;
try { if (!existsSync(join(AWLSIM_DIR, 'awlsim'))) throw new Error(`awlsim not found at ${AWLSIM_DIR} (set AWLSIM_DIR)`); awl = runAwlsim(stlCases); } catch (e) { awlErr = e.message.split('\n')[0]; }
if (awl) {
  const ours = await runStlEngine(pathToFileURL(rel('stl.mjs')).href, stlCases);
  const r = compareStl(ours, awl);
  add({ id: 'stl-awlsim', lang: 'STL', title: 'stl.mjs agrees with awlsim bit for bit', result: r.mism.length ? 'FAIL' : 'PASS',
    compared: `${stlCases.length} input cases (${RAWS.length} raw levels x unipolar/bipolar, pump on/off, 3 multi-scan sequences), ${stlCases.reduce((n, c) => n + c.scans.length, 0)} scans, ${r.steps} statements; MB 0-127, QB 0-15, ACCU1, ACCU2, AR1 and status word after every scan and ACCU1/2, AR1, status word after every statement: ${r.values} 8-to-32-bit patterns (${r.skipped} accumulator values, and status bits, left undefined by the FC105 call were not compared)`,
    mismatches: r.mism.slice(0, 8), mismatchCount: r.mism.length });
} else add({ id: 'stl-awlsim', lang: 'STL', title: 'stl.mjs agrees with awlsim bit for bit', result: 'NOT RUN', compared: 'awlsim could not run', mismatches: [awlErr], mismatchCount: 1 });

const blindPath = rel('blind', 'scl-blind.mjs');
let blind = null;
if (existsSync(blindPath)) {
  blind = await runSclEngine(pathToFileURL(blindPath).href, sclSequences);
  const ours = await runSclEngine(pathToFileURL(rel('scl.mjs')).href, sclSequences);
  const r = compareScl(ours, blind);
  add({ id: 'scl-blind', lang: 'SCL', title: 'scl.mjs agrees with the blind interpreter', result: r.mism.length ? 'FAIL' : 'PASS',
    compared: `${sclSequences.length} scan sequences, ${sclSequences.reduce((n, q) => n + q.scans.length, 0)} scans; every output, static and "Rack" DB value after every scan (REAL bit for bit): ${r.values} values`,
    mismatches: r.mism.slice(0, 8), mismatchCount: r.mism.length });
} else add({ id: 'scl-blind', lang: 'SCL', title: 'scl.mjs agrees with the blind interpreter', result: 'NOT RUN', compared: 'blind/scl-blind.mjs is missing', mismatches: ['blind/scl-blind.mjs not found: a check that did not run counts as failed'], mismatchCount: 1 });

{ // hand-written expectations, read off the listing: the state after each scan
  const expected = {
    'happy path: one pallet': '0 1 2 3 0 0 0',
    'full rack -> ERROR, reset, ERROR again': [...Array(6)].map(() => '1 2 3 0 0').join(' ') + ' 1 9 9 0 0 1 9 9',
    'crane never arrives -> watchdog ERROR': '1 ' + Array(21).fill(2).join(' ') + ' 9 9 9 0 0', // MOVE counts 21 scans (> 20), then ERROR
  };
  const ours = await runSclEngine(pathToFileURL(rel('scl.mjs')).href, sclSequences);
  const bad = [];
  sclSequences.forEach((q, i) => { if (!expected[q.name]) return; const got = ours[i].error ? ours[i].error : ours[i].map((v) => v.state).join(' '); if (got !== expected[q.name]) bad.push(`${q.name}: states ${got}, expected ${expected[q.name]}`); });
  add({ id: 'scl-hand', lang: 'SCL', title: 'scl.mjs follows the hand-written state walk', result: bad.length ? 'FAIL' : 'PASS',
    compared: `state after every scan in ${Object.keys(expected).length} sequences, written by hand from the listing`, mismatches: bad, mismatchCount: bad.length });
}

{ // the ruled lines exist in the listing they rule on
  const lines = TANK.split('\n'); const bad = rulings.filter((r) => rulingLine(lines, r) < 0);
  add({ id: 'rulings-anchored', lang: 'STL', title: 'Every ruling sits on a line of its listing', result: bad.length ? 'FAIL' : 'PASS',
    compared: `${rulings.length} rulings (${rulings.filter((r) => r.demo).length} marked demo)`, mismatches: bad.map((r) => `ruling ${r.id}: anchor not found`), mismatchCount: bad.length });
}

for (const m of MUTANTS) {
  const url = plantMutant(m); let caught = null, first = null, ran = true;
  if (!url) { ran = false; first = 'marker not found in ' + m.file; }
  else if (m.lang === 'STL') {
    if (!awl) { ran = false; first = 'awlsim did not run'; }
    else { const r = compareStl(await runStlEngine(url, stlCases), awl); caught = r.mism.length > 0; first = r.mism[0] || 'no difference found'; }
  } else if (!blind) { ran = false; first = 'blind/scl-blind.mjs is missing'; }
  else { const r = compareScl(await runSclEngine(url, sclSequences), blind); caught = r.mism.length > 0; first = r.mism[0] || 'no difference found'; }
  controls.push({ id: m.id, lang: m.lang, title: m.title, planted: m.edits.map(([f, t]) => `${m.file}: ${f}  ->  ${t}`).join('; '), result: !ran ? 'NOT RUN' : caught ? 'PASS' : 'FAIL', caught: !!caught, firstMismatch: first });
}

let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE }).toString().trim(); } catch {}
// The report is tied to the exact sources it checked: a hash over the engines, listings and oracle files.
const SOURCES = ['s7core.mjs', 'stl.mjs', 'scl.mjs', 'listings/tank.awl', 'listings/warehouse.scl', 'listings/rulings.mjs', 'oracle/fc105.awl', 'oracle/awlsim_run.py', 'check.mjs', 'blind/scl-blind.mjs'];
const hash = createHash('sha256'); for (const f of SOURCES) hash.update(f + '\0' + (existsSync(rel(f)) ? readFileSync(rel(f)) : 'missing') + '\0');
const sourcesSha = hash.digest('hex').slice(0, 12);
const all = [...checks, ...controls];
const report = {
  gate: 'stl-scl-live prototype gate (ticket #37)', commit, sourcesSha, sources: SOURCES, ranAt: new Date().toISOString(),
  result: all.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
  oracles: { stl: `awlsim (GPL-2.0-or-later, run from ${AWLSIM_DIR.includes('scratchpad') ? 'a local clone' : AWLSIM_DIR}), with FC105 written in STL from Siemens' formula`, scl: 'blind/scl-blind.mjs, a second interpreter written without seeing scl.mjs' },
  checks, negativeControls: controls,
};
writeFileSync(rel('gate-report.json'), JSON.stringify(report, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nGate: ${report.gate}   sources ${sourcesSha} (on top of ${commit})\n`);
console.log(pad('RESULT', 9) + pad('CHECK', 64) + 'DETAIL');
for (const c of checks) console.log(pad(c.result, 9) + pad(c.title, 64) + (c.mismatchCount ? `${c.mismatchCount} mismatches, first: ${c.mismatches[0]}` : c.compared.slice(0, 90)));
console.log('\nNegative controls (the gate must catch each):');
for (const c of controls) console.log(pad(c.result, 9) + pad(c.title, 64) + (c.result === 'PASS' ? 'caught: ' : '') + c.firstMismatch);
console.log(`\nGate ${report.result}. Report: gate-report.json\n`);
process.exitCode = report.result === 'PASS' ? 0 : 1;
