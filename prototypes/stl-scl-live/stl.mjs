// PROTOTYPE (throwaway, ticket #37): S7-300 STL interpreter with a per-statement trace.
// Pure module on the shared S7 core. 2-accumulator CPU, the L9-L10 mnemonic subset plus
// FC105/FC106 as built-in blocks. Students tune inputs and step; they never edit the code.
//
//   const prog = parseStl(source);             // STEP 7 source text (ORGANIZATION_BLOCK ... BEGIN ... END_)
//   const cpu = createCpu();                   // registers + byte-addressed memory
//   const trace = runScan(prog, cpu);          // runs one scan, returns one entry per executed statement
//   trace[i] = { pc, line, lastLine, op, arg, regs: {a1, a2, ar1, stw}, writes: [...], jumped }
import { S7Memory, f32, int16, bitsToReal, realToBits, intResult, realStatus, fc105, fc106 } from './s7core.mjs';

export const STW_BITS = ['/FC', 'RLO', 'STA', 'OR', 'OS', 'OV', 'CC0', 'CC1', 'BR']; // bit 0..8

// ---- parsing ----------------------------------------------------------------------------
export function parseStl(source) {
  const src = source.replace(/\r/g, '').split('\n');
  const prog = [], labels = {};
  let inBody = false;
  for (let i = 0; i < src.length; i++) {
    const raw = src[i], code = raw.replace(/\/\/.*$/, '').trim();
    if (/^BEGIN\b/.test(code)) { inBody = true; continue; }
    if (/^END_/.test(code)) { if (inBody) prog.push({ line: i, lastLine: i, op: 'BE', arg: '', implicit: true }); inBody = false; continue; }
    if (!inBody || !code || /^(NETWORK|TITLE\b)/.test(code)) continue;
    let body = code;
    const lm = body.match(/^([A-Za-z_]\w{0,3}):\s*(.*)$/);
    if (lm && !/^[A-Z_]+\s*:=/.test(body)) { labels[lm[1]] = prog.length; body = lm[2]; }
    const [op, ...rest] = body.split(/\s+/);
    const stmt = { line: i, lastLine: i, op: op.toUpperCase(), arg: rest.join(' ') };
    if (stmt.op === 'CALL') { // STEP 7 editor form: one "PARAM :=actual" per following line
      stmt.params = {};
      while (i + 1 < src.length) {
        const pm = src[i + 1].replace(/\/\/.*$/, '').trim().match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/);
        if (!pm) break;
        stmt.params[pm[1].toUpperCase()] = pm[2].trim(); i++; stmt.lastLine = i;
      }
    }
    prog.push(stmt);
  }
  return { prog, labels, lines: src };
}

// ---- operands ---------------------------------------------------------------------------
const AREA = { I: 'I', Q: 'Q', M: 'M', PI: 'PI', PQ: 'PQ', E: 'I', A: 'Q' };
export function parseAddr(tok) {
  const m = tok.replace(/\s+/g, '').match(/^(PI|PQ|I|Q|M)(B|W|D)?(\d+)(?:\.(\d))?$/i);
  if (!m) return null;
  const [, area, size, byte, bit] = m;
  return { area: AREA[area.toUpperCase()], size: size ? size.toUpperCase() : 'X', byte: +byte, bit: bit === undefined ? 0 : +bit };
}
export function literal(tok) {
  const t = tok.replace(/\s+/g, '');
  if (/^[+-]?\d+$/.test(t)) { const v = +t; if (v < -32768 || v > 32767) throw new Error('INT constant out of range: ' + t); return v & 0xffff; }
  if (/^L#[+-]?\d+$/i.test(t)) return +t.slice(2) >>> 0;
  if (/^W#16#[0-9A-F]+$/i.test(t)) return parseInt(t.slice(5), 16) & 0xffff;
  if (/^DW#16#[0-9A-F]+$/i.test(t)) return parseInt(t.slice(6), 16) >>> 0;
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(t)) return realToBits(f32(+t)); // REAL literal
  return null;
}
const addrName = (a) => (a.size === 'X' ? `${a.area} ${a.byte}.${a.bit}` : `${a.area === 'PI' ? 'PI' : a.area}${a.size} ${a.byte}`);

// ---- CPU --------------------------------------------------------------------------------
export function createCpu(mem = new S7Memory()) {
  return { mem, a1: 0, a2: 0, ar1: 0, undef: [], s: { '/FC': 0, RLO: 0, STA: 0, OR: 0, OS: 0, OV: 0, CC0: 0, CC1: 0, BR: 0 } };
}
export const stwWord = (s) => STW_BITS.reduce((w, b, i) => w | (s[b] << i), 0);
// Status bits each instruction writes (manual status-word tables). Used to track which bits a
// library block left behind and the program has not yet overwritten ("undefined" in the trace).
const MATH = ['CC1', 'CC0', 'OV', 'OS'], LOGIC = ['OR', 'STA', 'RLO', '/FC'];
function bitsWritten(op) {
  if (/^(==|<>|>=|<=|>|<)[IDR]$/.test(op)) return [...MATH, ...LOGIC];
  if (/^[-+*/][IDR]$/.test(op) || ['SQR', 'SQRT', 'EXP', 'LN', 'SIN', 'COS', 'ACOS'].includes(op)) return MATH;
  if (['A', 'AN', 'O', 'JC', 'JCN'].includes(op)) return LOGIC;
  if (['=', 'S', 'R'].includes(op)) return ['OR', 'STA', '/FC'];
  if (op === 'BE' || op === 'CALL') return ['OS', 'OR', 'STA', '/FC'];
  return [];
}

// Built-in library blocks called with CALL FC n (the TI-S7 converting blocks).
const LIBRARY = {
  105: { name: 'SCALE', fn: (p) => fc105(p.IN, p.HI_LIM, p.LO_LIM, p.BIPOLAR), in: { IN: 'INT', HI_LIM: 'REAL', LO_LIM: 'REAL', BIPOLAR: 'BOOL' }, out: { OUT: 'REAL', RET_VAL: 'WORD' } },
  106: { name: 'UNSCALE', fn: (p) => fc106(p.IN, p.HI_LIM, p.LO_LIM, p.BIPOLAR), in: { IN: 'REAL', HI_LIM: 'REAL', LO_LIM: 'REAL', BIPOLAR: 'BOOL' }, out: { OUT: 'INT', RET_VAL: 'WORD' } },
};

// Runs one scan of the program; returns the per-statement trace.
export function runScan(program, cpu, { maxSteps = 20000 } = {}) {
  const { prog, labels } = program, s = cpu.s, mem = cpu.mem, trace = [];
  // The operating system calls OB 1 afresh each scan: accumulators, AR1 and the status word start
  // at 0 (as awlsim does; the manual does not say what a real CPU leaves there).
  cpu.a1 = 0; cpu.a2 = 0; cpu.ar1 = 0; cpu.undef = []; for (const b of STW_BITS) s[b] = 0;
  let pc = 0, steps = 0, writes;
  const read = (a) => mem.read(a.area, a.size, a.byte, a.bit);
  const write = (a, v) => {
    const before = read(a); mem.write(a.area, a.size, a.byte, v, a.bit);
    writes.push({ addr: addrName(a), area: a.area, size: a.size, byte: a.byte, bit: a.bit, before, after: read(a) });
  };
  const operand = (arg) => {
    const ind = arg.replace(/\s+/g, '').match(/^(M)(B|W|D)\[AR1,P#(\d+)\.(\d)\]$/i); // area-internal register-indirect
    if (ind) { const bitAddr = cpu.ar1 + (+ind[3] << 3) + +ind[4]; return { area: 'M', size: ind[2].toUpperCase(), byte: bitAddr >> 3, bit: bitAddr & 7 }; }
    const a = parseAddr(arg); if (!a) throw new Error('bad operand ' + arg); return a;
  };
  const bitOf = (arg) => {
    const k = arg.trim().toUpperCase();
    if (k === 'OV') return s.OV; if (k === 'OS') return s.OS; if (k === 'BR') return s.BR;
    return read(operand(arg));
  };
  const logic = (v, kind) => { // A / AN / O: first check when /FC = 0
    s.STA = v; const t = kind === 'AN' ? 1 - v : v;
    if (!s['/FC']) { s.RLO = t; s.OR = 0; } else if (kind === 'O') { s.RLO = s.RLO | t; s.OR = 0; } else s.RLO = s.RLO & t;
    s['/FC'] = 1;
  };
  const endString = () => { s['/FC'] = 0; s.OR = 0; s.STA = s.RLO; };
  const setOv = (ov) => { s.OV = ov; if (ov) s.OS = 1; };
  const int16op = (fn) => { /* GATE-MUTANT:int16 */
    const r = intResult(fn(int16(cpu.a2), int16(cpu.a1)), 16);
    cpu.a1 = ((cpu.a1 & 0xffff0000) | (r.value & 0xffff)) >>> 0; s.CC1 = r.cc1; s.CC0 = r.cc0; setOv(r.ov);
  };
  const mulI = () => { // *I: 32-bit product in ACCU 1; OV if outside INT
    const p = int16(cpu.a2) * int16(cpu.a1), r = intResult(p, 16);
    cpu.a1 = p >>> 0; s.CC1 = r.cc1; s.CC0 = r.cc0; setOv(r.ov);
  };
  const dintop = (fn) => { const r = intResult(fn(cpu.a2 | 0, cpu.a1 | 0), 32); cpu.a1 = r.value >>> 0; s.CC1 = r.cc1; s.CC0 = r.cc0; setOv(r.ov); };
  const realRes = (r) => { r = f32(r); cpu.a1 = realToBits(r); const st = realStatus(r); s.CC1 = st.cc1; s.CC0 = st.cc0; setOv(st.ov); };
  const realop = (fn) => realRes(fn(bitsToReal(cpu.a2), bitsToReal(cpu.a1)));
  const realun = (fn) => realRes(fn(bitsToReal(cpu.a1)));
  const cmp = (a, b) => { // compare: RLO written outright, /FC = 1, OR = 0, OV = 0 (manual 2.2-2.4)
    const unordered = Number.isNaN(a) || Number.isNaN(b);
    return (test) => {
      const r = unordered ? 0 : +test(a, b);
      /* GATE-MUTANT:cmp */ s.RLO = r;
      s['/FC'] = 1; s.OR = 0; s.STA = r;
      if (unordered) { s.CC1 = 1; s.CC0 = 1; setOv(1); } else { s.OV = 0; [s.CC1, s.CC0] = a > b ? [1, 0] : a < b ? [0, 1] : [0, 0]; }
    };
  };
  const CMP = { '==': (a, b) => a === b, '<>': (a, b) => a !== b, '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };
  const jump = (label) => { if (!(label in labels)) throw new Error('no label ' + label); return labels[label]; };

  while (pc < prog.length) {
    if (++steps > maxSteps) throw new Error('step limit');
    const st = prog[pc], { op, arg } = st; writes = [];
    let next = pc + 1;
    const cm = op.match(/^(==|<>|>=|<=|>|<)(I|D|R)$/);
    if (cm) {
      const conv = cm[2] === 'I' ? int16 : cm[2] === 'D' ? (x) => x | 0 : bitsToReal;
      cmp(conv(cpu.a2), conv(cpu.a1))(CMP[cm[1]]);
    } else switch (op) {
      case 'L': {
        cpu.a2 = cpu.a1; // ACCU 1 -> ACCU 2 carries "undefined"
        cpu.undef = cpu.undef.filter((k) => k !== 'a1' && k !== 'a2').concat(cpu.undef.includes('a1') ? ['a2'] : []);

        const lit = literal(arg);
        if (lit !== null) cpu.a1 = lit;
        else if (/^P#/i.test(arg)) { const m = arg.match(/^P#(\d+)\.(\d)$/i); cpu.a1 = (+m[1] << 3) + +m[2]; }
        else cpu.a1 = read(operand(arg)) >>> 0;
        break;
      }
      case 'T': { const a = operand(arg); write(a, a.size === 'B' ? cpu.a1 & 0xff : a.size === 'W' ? cpu.a1 & 0xffff : cpu.a1); break; }
      case '+I': int16op((a, b) => a + b); break;
      case '-I': int16op((a, b) => a - b); break;
      case '*I': mulI(); break;
      case '+D': dintop((a, b) => a + b); break;
      case '-D': dintop((a, b) => a - b); break;
      case '*D': dintop((a, b) => Number(BigInt(a) * BigInt(b))); break;
      case '+R': realop((a, b) => a + b); break;
      case '-R': realop((a, b) => a - b); break;
      case '*R': realop((a, b) => a * b); break;
      case '/R': realop((a, b) => a / b); break;
      case 'SQR': realun((x) => x * x); break;
      case 'SQRT': realun(Math.sqrt); break;
      case 'EXP': realun(Math.exp); break;
      case 'LN': realun(Math.log); break;
      case 'SIN': realun(Math.sin); break;
      case 'COS': realun(Math.cos); break;
      case 'ACOS': realun(Math.acos); break;
      case 'ABS': cpu.a1 = (cpu.a1 & 0x7fffffff) >>> 0; break;
      case 'ITD': cpu.a1 = int16(cpu.a1) >>> 0; break;
      case 'DTR': cpu.a1 = realToBits(f32(cpu.a1 | 0)); break;
      case 'A': case 'AN': case 'O': logic(bitOf(arg), op); break;
      case '=': write(operand(arg), s.RLO); endString(); break;
      case 'S': if (s.RLO) write(operand(arg), 1); endString(); break;
      case 'R': if (s.RLO) write(operand(arg), 0); endString(); break;
      case 'JU': next = jump(arg); break;
      case 'JC': case 'JCN': {
        const take = op === 'JC' ? s.RLO : 1 - s.RLO;
        s['/FC'] = 0; s.RLO = 1; s.STA = 1; s.OR = 0;
        if (take) next = jump(arg);
        break;
      }
      case 'LOOP': {
        const c = (int16(cpu.a1) - 1) & 0xffff; cpu.a1 = ((cpu.a1 & 0xffff0000) | c) >>> 0;
        if (c !== 0) next = jump(arg);
        break;
      }
      case 'LAR1': { const m = arg.match(/^P#(\d+)\.(\d)$/i); cpu.ar1 = m ? (+m[1] << 3) + +m[2] : cpu.a1; break; }
      case '+AR1': { const m = arg.match(/^P#(\d+)\.(\d)$/i); cpu.ar1 = (cpu.ar1 + (+m[1] << 3) + +m[2]) & 0xffffff; break; }
      case 'NOP': break;
      case 'BE': s.OS = 0; s.OR = 0; s.STA = 1; s['/FC'] = 0; next = prog.length; break; // block end (manual 10.2)
      case 'CALL': callLibrary(st, cpu, read, write); break;
      default: throw new Error(`unknown instruction ${op} (line ${st.line + 1})`);
    }
    if (cpu.undef.length && op !== 'CALL') { const w = bitsWritten(op); cpu.undef = cpu.undef.filter((k) => !w.includes(k)); }
    trace.push({ pc, line: st.line, lastLine: st.lastLine, op, arg, regs: { a1: cpu.a1, a2: cpu.a2, ar1: cpu.ar1, stw: { ...s }, undef: [...cpu.undef] }, writes, jumped: next !== pc + 1 ? next : null, call: st.op === 'CALL' ? cpu.lastCall : undefined });
    pc = next;
  }
  return trace;
}

function callLibrary(st, cpu, read, write) {
  const n = +(st.arg.match(/^FC\s*(\d+)$/i) || [])[1], blk = LIBRARY[n];
  if (!blk) throw new Error('unknown block ' + st.arg);
  const p = {};
  for (const [name, ty] of Object.entries(blk.in)) {
    const actual = st.params[name]; if (actual === undefined) throw new Error(`FC${n}: missing ${name}`);
    const lit = literal(actual), raw = lit !== null ? lit : read(parseAddr(actual));
    p[name] = ty === 'REAL' ? bitsToReal(raw) : ty === 'INT' ? int16(raw) : raw;
  }
  const r = blk.fn(p);
  for (const [name, ty] of Object.entries(blk.out)) {
    const a = parseAddr(st.params[name]);
    write(a, ty === 'REAL' ? realToBits(r[name]) : r[name] & 0xffff);
  }
  // CALL and the block's own BE: OS = 0, OR = 0, STA = 1, /FC = 0 (manual 10.2, 13.x). RLO, CC, OV and
  // BR (= ENO) depend on the library block's internals, which Siemens does not publish: left unchanged.
  // ACCU 1/2 hold whatever the library block left there: undefined until the program loads over them.
  const s = cpu.s; s['/FC'] = 0; s.OR = 0; s.OS = 0; s.STA = 1;
  cpu.undef = ['a1', 'a2', 'RLO', 'CC1', 'CC0', 'OV', 'BR']; cpu.lastCall = { block: `FC${n} ${blk.name}`, params: p, out: r };

}
