// scl-blind.mjs - blind second interpreter for Siemens S7-SCL (STEP 7 V5.x, S7-300/400 dialect).
// Written only from the Siemens manual "S7-SCL V5.3 for S7-300/400" (A5E00324650-01).
// Page references "p.x-y" are the manual's own page numbers.
//
// Policy: where the manual says a result is *undefined* (integer division by 0, array index out of
// range, conversion out of range, FC value never assigned) this interpreter throws an error whose
// message starts "UNDEFINED per manual" instead of inventing a value. Integer overflow is NOT undefined
// on S7 (two's-complement wrap, OK flag := FALSE) and is modelled.

class SclError extends Error {}
const fail = (m) => { throw new SclError(m); };
const undef = (m) => fail('UNDEFINED per manual: ' + m);
const typeErr = (m) => fail('Type error: ' + m);

// ---------------------------------------------------------------- types and numerics
const ELEM = ['BOOL', 'BYTE', 'WORD', 'DWORD', 'INT', 'DINT', 'REAL', 'TIME'];
const T = Object.fromEntries(ELEM.map((k) => [k, { k }]));
const NUM = { INT: 1, DINT: 2, REAL: 3 };                  // implicit order INT > DINT > REAL (p.14-2)
const BIT = { BOOL: 1, BYTE: 2, WORD: 3, DWORD: 4 };       // implicit order BOOL > BYTE > WORD > DWORD
const MASK = { BYTE: 0xff, WORD: 0xffff, DWORD: 0xffffffff };
const RANGE = { INT: [-32768, 32767], DINT: [-2147483648, 2147483647], BYTE: [0, 255], WORD: [0, 65535],
  DWORD: [0, 4294967295], TIME: [-2147483648, 2147483647] };
const inRange = (k, v) => v >= RANGE[k][0] && v <= RANGE[k][1];
const wrap16 = (x) => (x << 16) >> 16;
const tv = (t, v, lit = false) => ({ t, v, lit });   // typed value; lit = untyped constant (p.9-3)

// An untyped integer constant takes the smallest type that holds it (p.9-3).
function litInt(v) {
  v += 0; // no -0
  const k = inRange('INT', v) ? 'INT' : inRange('DINT', v) ? 'DINT' : inRange('DWORD', v) ? 'DWORD' : null;
  if (!k) fail(`integer constant ${v} out of range`);
  return tv(T[k], v, true);
}

let CTX = null;   // program being run
let FR = null;    // active frame (for the OK flag)
const okFalse = () => { if (FR) FR.ok = false; };
function fixInt(k, x) { const w = k === 'INT' ? wrap16(x) : x | 0; if (w !== x) okFalse(); return w; }
function fixReal(x) { const r = Math.fround(x); if (!Number.isFinite(r)) okFalse(); return r; }
const bitLike = (a) => !!BIT[a.t.k] || (a.lit && a.t.k !== 'REAL' && a.v >= 0);

function arith(op, a, b) {
  const ka = a.t.k, kb = b.t.k;
  if (ka === 'TIME' || kb === 'TIME') return timeArith(op, a, b);
  if (!NUM[ka] || !NUM[kb]) typeErr(`'${op}' needs ANY_NUM operands, got ${ka} and ${kb} (p.11-8)`);
  if (op === '**') return tv(T.REAL, fixReal(Math.pow(Math.fround(a.v), Math.fround(b.v))));
  const k = NUM[ka] >= NUM[kb] ? ka : kb, lit = a.lit && b.lit;
  if (k === 'REAL') {
    if (op === 'MOD' || op === 'DIV') typeErr(`${op} is only defined for ANY_INT (p.11-8)`);
    const x = Math.fround(a.v), y = Math.fround(b.v);
    const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y;
    return tv(T.REAL, fixReal(r), lit);
  }
  const x = a.v, y = b.v;
  if ((op === '/' || op === 'DIV' || op === 'MOD') && y === 0) undef(`integer ${op} by zero (p.11-9; OK := FALSE)`);
  const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === 'MOD' ? x % y : Math.trunc(x / y);
  if (lit) return litInt(r);
  if (op === '*' && k === 'DINT') { const w = Math.imul(x, y); if (w !== r) okFalse(); return tv(T.DINT, w); }
  return tv(T[k], fixInt(k, r) + 0);
}

function timeArith(op, a, b) {
  const ka = a.t.k, kb = b.t.k, anyInt = kb === 'INT' || kb === 'DINT';
  if ((op === '+' || op === '-') && ka === 'TIME' && kb === 'TIME') return tv(T.TIME, fixInt('DINT', op === '+' ? a.v + b.v : a.v - b.v));
  if (ka === 'TIME' && anyInt && op === '*') { const w = Math.imul(a.v, b.v); if (w !== a.v * b.v) okFalse(); return tv(T.TIME, w); }
  if (ka === 'TIME' && anyInt && (op === '/' || op === 'DIV')) {
    if (b.v === 0) undef('TIME division by zero');
    return tv(T.TIME, fixInt('DINT', Math.trunc(a.v / b.v)) + 0);
  }
  typeErr(`'${op}' is not defined for ${ka} and ${kb} (p.11-8)`);
}

function compare(op, a, b) {
  const ka = a.t.k, kb = b.t.k;
  let x, y;
  if (NUM[ka] && NUM[kb]) {           // the higher type decides the type of the operation (p.11-12)
    const real = ka === 'REAL' || kb === 'REAL';
    x = real ? Math.fround(a.v) : a.v; y = real ? Math.fround(b.v) : b.v;
  } else if (ka === 'TIME' && kb === 'TIME') { x = a.v; y = b.v; }
  else if (bitLike(a) && bitLike(b)) {
    if (op !== '=' && op !== '<>') typeErr(`only = and <> are allowed for bit data types (p.11-12)`);
    x = +a.v; y = +b.v;
  } else typeErr(`cannot compare ${ka} with ${kb} (p.11-12)`);
  const r = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
  return tv(T.BOOL, r);
}

function logic(op, a, b) {
  if (!bitLike(a) || !bitLike(b)) typeErr(`${op} needs ANY_BIT operands, got ${a.t.k} and ${b.t.k} (p.11-10)`);
  const kinds = [a, b].filter((x) => !x.lit).map((x) => x.t.k).sort((p, q) => BIT[q] - BIT[p]);
  const k = kinds[0] || 'DWORD';
  if (k === 'BOOL') {
    const x = a.lit ? (a.v === 1 ? true : a.v === 0 ? false : typeErr('constant is not BOOL')) : a.v;
    const y = b.lit ? (b.v === 1 ? true : b.v === 0 ? false : typeErr('constant is not BOOL')) : b.v;
    return tv(T.BOOL, op === 'AND' ? x && y : op === 'OR' ? x || y : x !== y);
  }
  for (const c of [a, b]) if (c.lit && c.v > MASK[k]) typeErr(`constant ${c.v} does not fit ${k}`);
  const x = +a.v, y = +b.v;
  const r = op === 'AND' ? x & y : op === 'OR' ? x | y : x ^ y;
  return tv(T[k], (r & MASK[k]) >>> 0, a.lit && b.lit);
}

function unary(op, a) {
  const k = a.t.k;
  if (op === 'NOT') {
    if (k === 'BOOL') return tv(T.BOOL, !a.v);
    if (MASK[k]) return tv(a.t, (~a.v & MASK[k]) >>> 0);
    typeErr(`NOT needs ANY_BIT, got ${k} (p.11-10)`);
  }
  if (!NUM[k] && k !== 'TIME') typeErr(`unary ${op} needs ANY_NUM or TIME, got ${k} (p.11-8)`);
  if (op === '+') return a;
  if (k === 'REAL') return tv(T.REAL, -a.v, a.lit);
  if (a.lit) return litInt(0 - a.v);
  return tv(a.t, fixInt(k === 'TIME' ? 'DINT' : k, 0 - a.v));
}

const ARITH = new Set(['+', '-', '*', '/', '**', 'MOD', 'DIV']), CMP = new Set(['<', '>', '<=', '>=', '=', '<>']);
function binary(op, a, b) {
  if (ARITH.has(op)) return arith(op, a, b);
  if (CMP.has(op)) return compare(op, a, b);
  return logic(op, a, b);
}

// A condition is BOOL, or an arithmetic expression that is TRUE when <> 0 (p.12-13).
function cond(x) {
  if (x.t.k === 'BOOL') return x.v;
  if (NUM[x.t.k]) return x.v !== 0;
  typeErr(`condition must be BOOL, got ${x.t.k} (p.12-13)`);
}

function sameType(a, b) {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  if (T[a.k]) return true;
  if (a.k === 'ARRAY') return a.dims.length === b.dims.length && a.dims.every((d, i) => d[0] === b.dims[i][0] && d[1] === b.dims[i][1]) && sameType(a.of, b.of);
  if (a.k === 'FB') return a.def === b.def;
  return a.fields.length === b.fields.length && a.fields.every((f, i) => f.key === b.fields[i].key && sameType(f.type, b.fields[i].type));
}

// Assignment conversion: only the implicit class-A widenings of p.14-2 are allowed.
function conv(x, t) {
  const k = t.k, s = x.t.k;
  if (!T[k]) {
    if (!sameType(x.t, t)) typeErr(`cannot assign ${s} to ${k}: complex assignments need identical types (p.12-3, 12-5)`);
    return clone(x.v);
  }
  if (s === k) return x.v;
  if (x.lit && s !== 'REAL') {
    const v = x.v;
    if (k === 'REAL') return Math.fround(v);
    if (k === 'BOOL' && (v === 0 || v === 1)) return v === 1;
    if (RANGE[k] && k !== 'TIME' && inRange(k, v)) return v;
    typeErr(`constant ${v} does not fit ${k}`);
  }
  if (NUM[s] && NUM[k] && NUM[s] < NUM[k]) return k === 'REAL' ? Math.fround(x.v) : x.v;
  if (BIT[s] && BIT[k] && BIT[s] < BIT[k]) return s === 'BOOL' ? (x.v ? 1 : 0) : x.v;
  typeErr(`no implicit conversion from ${s} to ${k} (p.14-2); use an explicit conversion function`);
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') { const o = Object.create(null); for (const k in v) o[k] = clone(v[k]); return o; }
  return v;
}
function copyInto(dst, src) { for (const k of Object.keys(src)) { if (src[k] && typeof src[k] === 'object') copyInto(dst[k], src[k]); else dst[k] = src[k]; } }
function write(ref, v) { if (T[ref.type.k]) ref.obj[ref.key] = v; else copyInto(ref.obj[ref.key], v); }

// ---------------------------------------------------------------- standard functions (chapter 14)
function numArg(a) { if (!NUM[a.t.k]) typeErr(`numeric argument expected, got ${a.t.k} (p.14-9)`); return a; }
const r1 = (f) => (a) => tv(T.REAL, fixReal(f(Math.fround(numArg(a).v))));
function rne(x) { const f = Math.floor(x), d = x - f; return (d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1) + 0; }
function toRange(k, v, what) { if (!Number.isFinite(v) || !inRange(k, v)) undef(`${what}: ${v} outside ${k} range (p.14-4; OK := FALSE)`); return v; }
const cv = (from, to, f) => (a) => tv(T[to], f(conv(a, T[from])));
const STD = {
  SQRT: r1(Math.sqrt), SQR: r1((x) => x * x), EXP: r1(Math.exp), EXPD: r1((x) => 10 ** x), LN: r1(Math.log), LOG: r1(Math.log10),
  SIN: r1(Math.sin), COS: r1(Math.cos), TAN: r1(Math.tan), ASIN: r1(Math.asin), ACOS: r1(Math.acos), ATAN: r1(Math.atan),
  ABS: (a) => { numArg(a); if (a.t.k === 'REAL') return tv(T.REAL, Math.abs(a.v), a.lit); if (a.lit) return litInt(Math.abs(a.v)); return tv(a.t, fixInt(a.t.k, Math.abs(a.v))); },
  INT_TO_REAL: cv('INT', 'REAL', Math.fround), DINT_TO_REAL: cv('DINT', 'REAL', Math.fround), INT_TO_DINT: cv('INT', 'DINT', (v) => v),
  DINT_TO_INT: cv('DINT', 'INT', (v) => toRange('INT', v, 'DINT_TO_INT')),
  REAL_TO_INT: cv('REAL', 'INT', (v) => toRange('INT', rne(v), 'REAL_TO_INT')),
  REAL_TO_DINT: cv('REAL', 'DINT', (v) => toRange('DINT', rne(v), 'REAL_TO_DINT')),
  ROUND: cv('REAL', 'DINT', (v) => toRange('DINT', rne(v), 'ROUND')),
  TRUNC: cv('REAL', 'DINT', (v) => toRange('DINT', Math.trunc(v) + 0, 'TRUNC')),
  WORD_TO_INT: cv('WORD', 'INT', wrap16), INT_TO_WORD: cv('INT', 'WORD', (v) => v & 0xffff),
  DWORD_TO_DINT: cv('DWORD', 'DINT', (v) => v | 0), DINT_TO_DWORD: cv('DINT', 'DWORD', (v) => v >>> 0),
  BYTE_TO_WORD: cv('BYTE', 'WORD', (v) => v), WORD_TO_BYTE: cv('WORD', 'BYTE', (v) => v & 0xff),
  BOOL_TO_BYTE: cv('BOOL', 'BYTE', (v) => (v ? 1 : 0)), BYTE_TO_BOOL: cv('BYTE', 'BOOL', (v) => (v & 1) === 1),
  TIME_TO_DINT: cv('TIME', 'DINT', (v) => v), DINT_TO_TIME: cv('DINT', 'TIME', (v) => v),
};

// ---------------------------------------------------------------- lexer
const isIdStart = (c) => /[A-Za-z_]/.test(c || '');
const isIdChar = (c) => /[A-Za-z0-9_]/.test(c || '');
const isDig = (c) => c >= '0' && c <= '9';
const PREFIX = { B: 'BYTE', BYTE: 'BYTE', W: 'WORD', WORD: 'WORD', DW: 'DWORD', DWORD: 'DWORD', INT: 'INT', DINT: 'DINT', L: 'DINT', REAL: 'REAL', BOOL: 'BOOL' };
const TIME_UNIT = { D: 86400000, H: 3600000, M: 60000, S: 1000, MS: 1 };

function lex(src) {
  const toks = []; let i = 0, line = 1;
  const push = (t) => { t.line = line; toks.push(t); };
  const readWhile = (re) => { const s = i; while (i < src.length && re.test(src[i])) i++; return src.slice(s, i); };
  function readNumber() {
    let s = readWhile(/[0-9_]/);
    if (src[i] === '#') { i++; const base = +s.replace(/_/g, ''); const d = readWhile(/[0-9A-Fa-f_]/).replace(/_/g, ''); const v = parseInt(d, base); if (![2, 8, 16].includes(base) || Number.isNaN(v)) fail(`line ${line}: bad based number`); return { v, real: false }; }
    let real = false;
    if (src[i] === '.' && isDig(src[i + 1])) { i++; s += '.' + readWhile(/[0-9_]/); real = true; }
    if (/[eE]/.test(src[i] || '') && (isDig(src[i + 1]) || (/[+-]/.test(src[i + 1]) && isDig(src[i + 2])))) { s += src[i++]; if (/[+-]/.test(src[i])) s += src[i++]; s += readWhile(/[0-9]/); real = true; }
    return { v: Number(s.replace(/_/g, '')), real };
  }
  function timeLit() {
    const text = readWhile(/[-0-9A-Za-z_.]/); let rest = text, sign = 1, ms = 0;
    if (rest[0] === '-') { sign = -1; rest = rest.slice(1); }
    const re = /^(\d+(?:\.\d+)?)(MS|D|H|M|S)_?/i; let m, n = 0;
    while (rest && (m = re.exec(rest))) { ms += parseFloat(m[1]) * TIME_UNIT[m[2].toUpperCase()]; rest = rest.slice(m[0].length); n++; }
    if (rest || !n) fail(`line ${line}: bad TIME constant T#${text}`);
    ms = Math.round(ms) * sign;                                         // sub-ms fractions: rounded (manual silent)
    return tv(T.TIME, Math.max(-2147483647, Math.min(2147483647, ms)) + 0); // clamp to limit (p.7-4)
  }
  function typedLit(P) {
    const k = PREFIX[P];
    if (P === 'B' && src[i] === '(') { const m = /^\((\d+),(\d+)\)/.exec(src.slice(i).replace(/\s/g, '')); if (!m) fail(`line ${line}: bad B#(..)`); i = src.indexOf(')', i) + 1; return tv(T.WORD, (+m[1] << 8) | +m[2]); }
    let sign = 1; if (src[i] === '-' || src[i] === '+') { if (src[i] === '-') sign = -1; i++; }
    let v;
    if (k === 'BOOL' && isIdStart(src[i])) { const w = readWhile(/[A-Za-z]/).toUpperCase(); if (w !== 'TRUE' && w !== 'FALSE') fail(`line ${line}: bad BOOL#`); return tv(T.BOOL, w === 'TRUE'); }
    const n = readNumber(); v = sign * n.v;
    if (k === 'REAL') return tv(T.REAL, Math.fround(v));
    if (n.real) fail(`line ${line}: ${P}# needs an integer`);
    if (k === 'BOOL') { if (v !== 0 && v !== 1) fail(`line ${line}: bad BOOL#`); return tv(T.BOOL, v === 1); }
    if (!inRange(k, v)) fail(`line ${line}: ${P}#${v} out of range for ${k}`);
    return tv(T[k], v + 0);
  }
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '(' && src[i + 1] === '*') {       // block comments nest by default (p.5-15)
      let depth = 0;
      do { if (src.startsWith('(*', i)) { depth++; i += 2; } else if (src.startsWith('*)', i)) { depth--; i += 2; } else { if (src[i] === '\n') line++; i++; } } while (depth > 0 && i < src.length);
      continue;
    }
    if (c === '{') { while (i < src.length && src[i] !== '}') { if (src[i] === '\n') line++; i++; } i++; continue; } // attributes/pragmas
    if (c === "'") { let s = ''; i++; while (i < src.length && src[i] !== "'") { if (src[i] === '$') { s += src[i + 1]; i += 2; } else s += src[i++]; } i++; push({ t: 'str', v: s }); continue; }
    if (c === '"') { const e = src.indexOf('"', i + 1); if (e < 0) fail(`line ${line}: unterminated symbol`); const v = src.slice(i + 1, e); i = e + 1; push({ t: 'id', v, up: v.toUpperCase(), q: true }); continue; }
    if (c === '#' && isIdStart(src[i + 1])) { i++; const v = readWhile(/[A-Za-z0-9_]/); push({ t: 'id', v, up: v.toUpperCase(), h: true }); continue; }
    if (isDig(c)) { const n = readNumber(); push({ t: 'num', tv: n.real ? tv(T.REAL, Math.fround(n.v), true) : litInt(n.v) }); continue; }
    if (isIdStart(c)) {
      const v = readWhile(/[A-Za-z0-9_]/), P = v.toUpperCase();
      if (src[i] === '#') {
        i++;
        if (P === 'T' || P === 'TIME') { push({ t: 'num', tv: timeLit() }); continue; }
        if (PREFIX[P]) { push({ t: 'num', tv: typedLit(P) }); continue; }
        fail(`line ${line}: unsupported constant prefix ${v}#`);
      }
      push({ t: 'id', v, up: P }); continue;
    }
    const two = src.slice(i, i + 2);
    if ([':=', '=>', '<=', '>=', '<>', '**', '..'].includes(two)) { push({ t: 'sym', v: two }); i += 2; continue; }
    if ('+-*/=<>()[],;:.&'.includes(c)) { push({ t: 'sym', v: c }); i++; continue; }
    fail(`line ${line}: unexpected character '${c}'`);
  }
  push({ t: 'eof' });
  return toks;
}

// ---------------------------------------------------------------- parser
const KW = new Set(('AND OR XOR NOT MOD DIV IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE ' +
  'REPEAT UNTIL END_REPEAT EXIT CONTINUE RETURN GOTO BEGIN VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR_STATIC END_VAR ' +
  'CONST END_CONST LABEL END_LABEL TYPE END_TYPE STRUCT END_STRUCT ARRAY DATA_BLOCK END_DATA_BLOCK FUNCTION END_FUNCTION ' +
  'FUNCTION_BLOCK END_FUNCTION_BLOCK PROGRAM END_PROGRAM ORGANIZATION_BLOCK END_ORGANIZATION_BLOCK TRUE FALSE VOID AT').split(' '));
const STOP = new Set(['END_IF', 'ELSIF', 'ELSE', 'END_CASE', 'END_FOR', 'END_WHILE', 'UNTIL', 'END_REPEAT', 'END_FUNCTION',
  'END_FUNCTION_BLOCK', 'END_PROGRAM', 'END_ORGANIZATION_BLOCK', 'END_DATA_BLOCK']);
const LEVELS = [['OR'], ['XOR'], ['AND', '&'], ['=', '<>'], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', 'MOD', 'DIV']]; // p.11-2
const UNSUPPORTED_TYPES = ['STRING', 'CHAR', 'S5TIME', 'DATE', 'TIME_OF_DAY', 'TOD', 'DATE_AND_TIME', 'DT', 'POINTER', 'ANY', 'TIMER', 'COUNTER', 'BLOCK_DB', 'BLOCK_FB', 'BLOCK_FC', 'BLOCK_SDB'];
const SECTIONS = { VAR_INPUT: 'input', VAR_OUTPUT: 'output', VAR_IN_OUT: 'inout', VAR_TEMP: 'temp', VAR: 'stat', VAR_STATIC: 'stat' };

class Parser {
  constructor(toks) { this.toks = toks; this.p = 0; this.loops = 0; }
  peek(o = 0) { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
  next() { return this.toks[this.p++]; }
  err(m) { fail(`line ${this.peek().line}: ${m}`); }
  kwTok(t) { return t.t === 'id' && !t.q && !t.h; }
  isKw(w, o = 0) { const t = this.peek(o); return this.kwTok(t) && t.up === w; }
  acceptKw(w) { if (this.isKw(w)) return this.next(); return null; }
  expectKw(w) { return this.acceptKw(w) || this.err(`${w} expected`); }
  isSym(s, o = 0) { const t = this.peek(o); return t.t === 'sym' && t.v === s; }
  acceptSym(s) { if (this.isSym(s)) return this.next(); return null; }
  expectSym(s) { return this.acceptSym(s) || this.err(`'${s}' expected, found '${this.peek().v ?? this.peek().t}'`); }
  ident() { const t = this.next(); if (t.t !== 'id' || (this.kwTok(t) && KW.has(t.up))) { this.p--; this.err('identifier expected'); } return t; }

  program() {
    const units = [];
    while (this.peek().t !== 'eof') {
      if (this.acceptKw('TYPE')) units.push(this.udt());
      else if (this.acceptKw('DATA_BLOCK')) units.push(this.db());
      else if (this.acceptKw('FUNCTION_BLOCK') || this.acceptKw('PROGRAM')) units.push(this.logic('FB'));
      else if (this.acceptKw('FUNCTION')) units.push(this.logic('FC'));
      else if (this.acceptKw('ORGANIZATION_BLOCK')) units.push(this.logic('OB'));
      else this.err('TYPE, DATA_BLOCK, FUNCTION, FUNCTION_BLOCK or ORGANIZATION_BLOCK expected');
    }
    return units;
  }
  attrs() { // TITLE = ... (rest of line), VERSION/AUTHOR/NAME/FAMILY : x, KNOW_HOW_PROTECT (p.6-5)
    for (;;) {
      if (this.isKw('TITLE')) { this.next(); const eq = this.expectSym('='); while (this.peek().t !== 'eof' && this.peek().line === eq.line) this.next(); }
      else if (['VERSION', 'AUTHOR', 'NAME', 'FAMILY'].includes(this.peek().up) && this.isSym(':', 1)) { this.next(); this.next(); this.next(); }
      else if (this.isKw('KNOW_HOW_PROTECT')) this.next();
      else return;
    }
  }
  udt() {
    const name = this.ident().v; this.acceptSym(':'); this.attrs();
    const type = this.type(); this.acceptSym(';'); this.expectKw('END_TYPE');
    return { kind: 'UDT', name, typeAst: type };
  }
  db() {
    const name = this.ident().v; this.attrs();
    let typeAst;
    if (this.isKw('STRUCT')) typeAst = this.type();
    else if (this.acceptKw('VAR')) typeAst = { k: 'STRUCT', fields: this.varList('END_VAR', 'stat') };
    else typeAst = { k: 'REF', name: this.ident().v };
    this.acceptSym(';'); this.expectKw('BEGIN');
    const body = this.stmts(); this.expectKw('END_DATA_BLOCK');
    return { kind: 'DB', name, typeAst, body };
  }
  logic(kind) {
    const name = this.ident().v; let retAst = null;
    if (kind === 'FC') { this.expectSym(':'); if (!this.acceptKw('VOID')) retAst = this.type(); }
    this.attrs();
    const def = { kind, name, key: name.toLowerCase(), retAst, decls: [], constAsts: [] };
    for (;;) {
      const t = this.peek();
      if (this.kwTok(t) && SECTIONS[t.up]) { this.next(); def.decls.push(...this.varList('END_VAR', SECTIONS[t.up])); }
      else if (this.acceptKw('CONST')) {
        while (!this.acceptKw('END_CONST')) { const n = this.ident().v; this.expectSym(':='); def.constAsts.push([n, this.expr()]); this.expectSym(';'); }
      } else if (this.acceptKw('LABEL')) { while (!this.acceptKw('END_LABEL')) this.next(); }
      else break;
    }
    this.acceptKw('BEGIN');                      // BEGIN is optional in logic blocks (p.6-12)
    def.body = this.stmts();
    const end = { FB: ['END_FUNCTION_BLOCK', 'END_PROGRAM'], FC: ['END_FUNCTION'], OB: ['END_ORGANIZATION_BLOCK'] }[kind];
    if (!end.some((w) => this.acceptKw(w))) this.err(`${end[0]} expected`);
    return def;
  }
  varList(endKw, sec) {
    const out = [];
    while (!this.acceptKw(endKw)) {
      const names = [this.ident()];
      while (this.acceptSym(',')) names.push(this.ident());
      if (this.isKw('AT')) this.err('AT views are not supported');
      this.expectSym(':');
      const typeAst = this.type(); let init = null;
      if (this.acceptSym(':=')) {
        if (names.length > 1) this.err('initialisation of a variable list is not possible (p.8-3)');
        init = this.initList();
      }
      this.expectSym(';');
      for (const n of names) out.push({ name: n.v, key: n.v.toLowerCase(), sec, typeAst, init, line: n.line });
    }
    return out;
  }
  type() {
    const t = this.next();
    if (t.t !== 'id') { this.p--; this.err('data type expected'); }
    if (!t.q && T[t.up]) return { k: t.up };
    if (!t.q && t.up === 'ARRAY') {
      this.expectSym('['); const dims = [];
      do { const lo = this.expr(); this.expectSym('..'); dims.push([lo, this.expr()]); } while (this.acceptSym(','));
      this.expectSym(']'); this.expectKw('OF');
      return { k: 'ARRAY', dims, of: this.type() };
    }
    if (!t.q && t.up === 'STRUCT') return { k: 'STRUCT', fields: this.varList('END_STRUCT', 'field') };
    if (!t.q && UNSUPPORTED_TYPES.includes(t.up)) { this.p--; this.err(`data type ${t.v} is outside the supported subset`); }
    return { k: 'REF', name: t.v };
  }
  // Array initialisation list with repetition factors n(list) (p.8-4). Brackets: one optional pair per
  // the manual; nested brackets are accepted and flattened (see notes).
  initList() { return this.initItems(); }
  initItems() {
    const items = [];
    do {
      if (this.acceptSym('[')) { items.push(...this.initItems()); this.expectSym(']'); continue; }
      const t = this.peek();
      if (t.t === 'num' && t.tv.lit && t.tv.t.k !== 'REAL' && this.isSym('(', 1)) {
        this.next(); this.next(); const sub = this.initItems(); this.expectSym(')');
        items.push({ rep: t.tv.v, items: sub });
      } else items.push({ expr: this.expr() });
    } while (this.acceptSym(','));
    return items;
  }

  stmts(inCase = false) {
    const out = [];
    for (;;) {
      const t = this.peek();
      if (t.t === 'eof') this.err('unexpected end of source');
      if (this.kwTok(t) && STOP.has(t.up)) return out;
      if (inCase && this.caseLabelAhead()) return out;
      if (this.acceptSym(';')) continue;
      out.push(this.stmt());
    }
  }
  caseLabelAhead() {
    const t = this.peek();
    if (t.t === 'num') return true;
    if ((this.isSym('-') || this.isSym('+')) && this.peek(1).t === 'num') return true;
    return t.t === 'id' && !(this.kwTok(t) && KW.has(t.up)) && (this.isSym(':', 1) || this.isSym(',', 1) || this.isSym('..', 1));
  }
  loopBody(endKw) { this.loops++; const b = this.stmts(); this.loops--; this.expectKw(endKw); this.acceptSym(';'); return b; }
  stmt() {
    const t = this.peek(), line = t.line;
    if (this.acceptKw('IF')) {
      const arms = [];
      do { const c = this.expr(); this.expectKw('THEN'); arms.push([c, this.stmts()]); } while (this.acceptKw('ELSIF'));
      const els = this.acceptKw('ELSE') ? this.stmts() : null;
      this.expectKw('END_IF'); this.acceptSym(';');
      return { k: 'if', arms, els, line };
    }
    if (this.acceptKw('CASE')) {
      const sel = this.expr(); this.expectKw('OF'); const arms = [];
      while (!this.isKw('ELSE') && !this.isKw('END_CASE')) {
        const labels = [];
        do { const lo = this.expr(); labels.push(this.acceptSym('..') ? [lo, this.expr()] : [lo, lo]); } while (this.acceptSym(','));
        this.expectSym(':');
        arms.push({ labels, body: this.stmts(true) });
      }
      let els = null;
      if (this.acceptKw('ELSE')) { this.acceptSym(':'); els = this.stmts(); }
      this.expectKw('END_CASE'); this.acceptSym(';');
      return { k: 'case', sel, arms, els, line };
    }
    if (this.acceptKw('FOR')) {
      const v = this.varPath(); this.expectSym(':='); const from = this.expr(); this.expectKw('TO'); const to = this.expr();
      const by = this.acceptKw('BY') ? this.expr() : null; this.expectKw('DO');
      return { k: 'for', v, from, to, by, body: this.loopBody('END_FOR'), line };
    }
    if (this.acceptKw('WHILE')) { const c = this.expr(); this.expectKw('DO'); return { k: 'while', c, body: this.loopBody('END_WHILE'), line }; }
    if (this.acceptKw('REPEAT')) {
      this.loops++; const body = this.stmts(); this.loops--;
      this.expectKw('UNTIL'); const c = this.expr(); this.expectKw('END_REPEAT'); this.acceptSym(';');
      return { k: 'repeat', c, body, line };
    }
    for (const w of ['EXIT', 'CONTINUE', 'RETURN']) {
      if (this.acceptKw(w)) {
        if (w !== 'RETURN' && !this.loops) this.err(`${w} outside a loop`);
        this.expectSym(';'); return { k: w.toLowerCase(), line };
      }
    }
    if (this.isKw('GOTO')) this.err('GOTO is outside the supported subset');
    if (t.t === 'id' && this.isSym('(', 1)) { const call = this.call(); this.expectSym(';'); return { k: 'call', call, line }; }
    const lhs = this.varPath();
    if (this.isSym('(')) this.err('global-instance calls (FB.DB(...)) are outside the supported subset');
    this.expectSym(':='); const rhs = this.expr(); this.expectSym(';');
    return { k: 'assign', lhs, rhs, line };
  }
  varPath() {
    const t = this.ident(), path = [];
    for (;;) {
      if (this.isSym('.') && this.peek(1).t === 'id') { this.next(); path.push({ m: this.next().v }); }
      else if (this.acceptSym('[')) { const ix = [this.expr()]; while (this.acceptSym(',')) ix.push(this.expr()); this.expectSym(']'); path.push({ ix }); }
      else return { k: 'var', name: t.v, h: !!t.h, path, line: t.line };
    }
  }
  call() {
    const name = this.next().v, args = [];
    this.expectSym('(');
    if (!this.acceptSym(')')) {
      do {
        if (this.peek().t === 'id' && (this.isSym(':=', 1) || this.isSym('=>', 1))) { const n = this.next().v; const op = this.next().v; args.push({ name: n, op, expr: this.expr() }); }
        else args.push({ expr: this.expr() });
      } while (this.acceptSym(','));
      this.expectSym(')');
    }
    return { k: 'call', name, args, line: this.peek().line };
  }
  expr() { return this.bin(0, false); }
  matchOp(ops) {
    const t = this.peek();
    if (t.t === 'sym' && ops.includes(t.v)) { this.next(); return t.v === '&' ? 'AND' : t.v; }
    if (this.kwTok(t) && ops.includes(t.up)) { this.next(); return t.up; }
    return null;
  }
  // strict: operand directly follows an arithmetic operator; "a * -b" is invalid, a*(-b) is fine (p.11-6).
  // A signed numeric constant is still allowed there because the sign is part of the constant (p.9-7).
  bin(lv, strict) {
    if (lv === LEVELS.length) return this.unary(strict);
    let a = this.bin(lv + 1, strict);
    for (;;) {
      const op = this.matchOp(LEVELS[lv]);
      if (!op) return a;
      a = { k: 'bin', op, a, b: this.bin(lv + 1, lv >= 5) };
    }
  }
  unary(strict) {
    if (this.isSym('-') || this.isSym('+')) {
      if (strict && this.peek(1).t !== 'num') this.err('arithmetic operators must not follow each other directly (p.11-6); write a*(-b)');
      const op = this.next().v;
      return { k: 'un', op, e: this.unary(true) };
    }
    if (this.acceptKw('NOT')) return { k: 'un', op: 'NOT', e: this.unary(false) };
    return this.pow();
  }
  pow() { // ** has precedence 2, above unary minus (3): -2**2 = -(2**2); same-precedence ops associate left (p.11-5)
    let a = this.primary();
    while (this.acceptSym('**')) {
      let b;
      if (this.isSym('-') || this.isSym('+')) {
        if (this.peek(1).t !== 'num') this.err('arithmetic operators must not follow each other directly (p.11-6)');
        b = { k: 'un', op: this.next().v, e: this.primary() };
      } else b = this.primary();
      a = { k: 'bin', op: '**', a, b };
    }
    return a;
  }
  primary() {
    const t = this.peek();
    if (t.t === 'num') { this.next(); return { k: 'lit', tv: t.tv }; }
    if (this.acceptKw('TRUE')) return { k: 'lit', tv: tv(T.BOOL, true) };
    if (this.acceptKw('FALSE')) return { k: 'lit', tv: tv(T.BOOL, false) };
    if (this.acceptSym('(')) { const e = this.expr(); this.expectSym(')'); return e; }
    if (t.t === 'str') this.err('string constants cannot be used in expressions (p.9-11)');
    if (t.t === 'id' && this.isSym('(', 1)) return this.call();
    return this.varPath();
  }
}

// ---------------------------------------------------------------- linking: types, constants, values
const TIMER_FB = (name) => mkStruct([['IN', 'BOOL'], ['PT', 'TIME'], ['Q', 'BOOL'], ['ET', 'TIME']].map(([n, k]) => ({ name: n, key: n.toLowerCase(), type: T[k] })), { k: 'FB', def: { name, builtin: true } });
function mkStruct(fields, base = { k: 'STRUCT' }) { return { ...base, fields, map: new Map(fields.map((f) => [f.key, f])) }; }

function withFrame(fr, f) { const prev = FR; FR = fr; try { return f(); } finally { FR = prev; } }
const constFrame = (env) => ({ vars: new Map(), consts: env.consts, ok: true });
function evalConst(e, env) { const fr = constFrame(env); return withFrame(fr, () => evalExpr(e, fr)); }
function constInt(e, env) { const x = evalConst(e, env); if (x.t.k !== 'INT' && x.t.k !== 'DINT') typeErr('integer constant expected'); return x.v; }

function resolveType(t, env) {
  if (T[t.k]) return T[t.k];
  if (t.k === 'ARRAY') {
    if (t.dims.length > 6) fail('an ARRAY has at most 6 dimensions (p.7-9)');
    const dims = t.dims.map(([lo, hi]) => {
      const a = constInt(lo, env), b = constInt(hi, env);
      if (a > b || !inRange('INT', a) || !inRange('INT', b)) fail(`bad array bounds [${a}..${b}] (p.7-9)`);
      return [a, b];
    });
    return { k: 'ARRAY', dims, of: resolveType(t.of, env) };
  }
  if (t.k === 'STRUCT') return mkStruct(t.fields.map((f) => ({ name: f.name, key: f.key, type: resolveType(f.typeAst, env), init: f.init, env })));
  const key = t.name.toLowerCase();
  if (CTX.udts.has(key)) {
    const u = CTX.udts.get(key);
    if (u.type === 'busy') fail(`recursive UDT ${u.name}`);
    if (!u.type) { u.type = 'busy'; const r = resolveType(u.typeAst, { consts: new Map() }); if (r.k !== 'STRUCT') fail(`UDT ${u.name} must be a STRUCT (p.7-14)`); u.type = r; }
    return u.type;
  }
  if (CTX.fbs.has(key)) { const d = CTX.fbs.get(key); prepare(d); return d.instType; }
  if (['ton', 'tof', 'tp'].includes(key)) return TIMER_FB(t.name.toUpperCase());
  fail(`unknown data type ${t.name}`);
}

function prepare(def) {
  if (def.ready === true) return;
  if (def.ready === 'busy') fail(`recursive block ${def.name}`);
  def.ready = 'busy';
  def.consts = new Map(); const env = { consts: def.consts };
  for (const [n, e] of def.constAsts) def.consts.set(n.toLowerCase(), evalConst(e, env));
  for (const k of ['input', 'output', 'inout', 'temp', 'stat']) def[k] = [];
  for (const d of def.decls) {
    let sec = d.sec;
    if (def.kind !== 'FB' && sec === 'stat') sec = 'temp';            // FC VAR goes to the temp area (p.6-10)
    const x = { ...d, type: resolveType(d.typeAst, env), env };
    if (x.init) {
      const where = `line ${d.line}: ${d.name}: `;
      if (sec === 'temp') fail(where + 'temporary variables cannot be initialised (p.8-12)');
      if (def.kind !== 'FB') fail(where + 'only FB parameters can be initialised (p.8-13)');
      if (sec === 'inout' && !T[x.type.k]) fail(where + 'in/out parameters can only be initialised if elementary (p.8-3)');
    }
    if (x.type.k === 'FB' && (def.kind !== 'FB' || sec !== 'stat')) fail(`line ${d.line}: instance ${d.name} must be declared in VAR of an FB (p.15-40)`);
    def[sec].push(x);
  }
  def.params = new Map([...def.input, ...def.output, ...def.inout].map((d) => [d.key, d]));
  if (def.retAst) { def.ret = resolveType(def.retAst, env); if (!T[def.ret.k]) fail('function type must be elementary here (p.6-16)'); }
  def.instType = mkStruct([...def.input, ...def.output, ...def.inout, ...def.stat], { k: 'FB', def });
  def.ready = true;
}

function makeValue(t) {
  if (t.k === 'BOOL') return false;
  if (T[t.k]) return 0;
  if (t.k === 'ARRAY') {
    const mk = (d) => { const [lo, hi] = t.dims[d]; const a = new Array(hi - lo + 1); for (let i = 0; i < a.length; i++) a[i] = d + 1 < t.dims.length ? mk(d + 1) : makeValue(t.of); return a; };
    return mk(0);
  }
  const o = Object.create(null);
  for (const f of t.fields) { o[f.key] = makeValue(f.type); if (f.init) applyInit(o, f); }
  return o;
}
function expandInit(items, env) {
  const out = [];
  for (const it of items) {
    if (it.rep === undefined) { out.push(evalConst(it.expr, env)); continue; }
    const sub = expandInit(it.items, env);
    for (let i = 0; i < it.rep; i++) out.push(...sub);
  }
  return out;
}
function leafSlots(arr, depth, out = []) { if (depth === 1) arr.forEach((_, i) => out.push([arr, i])); else arr.forEach((s) => leafSlots(s, depth - 1, out)); return out; }
function applyInit(obj, f) {
  const vals = expandInit(f.init, f.env), t = f.type;
  if (T[t.k]) {
    if (vals.length !== 1 || f.init[0].rep !== undefined) fail(`${f.name}: exactly one initial value expected`);
    obj[f.key] = conv(vals[0], t); return;
  }
  if (t.k === 'ARRAY' && T[t.of.k]) {                // row by row (p.7-10), last index fastest
    const slots = leafSlots(obj[f.key], t.dims.length);
    if (vals.length > slots.length) fail(`${f.name}: ${vals.length} initial values for ${slots.length} elements`);
    vals.forEach((x, i) => { const [a, j] = slots[i]; a[j] = conv(x, t.of); });
    return;
  }
  fail(`${f.name}: a ${t.k} cannot be initialised with a value list`);
}

// ---------------------------------------------------------------- execution
function resolve(e, fr) {
  const key = e.name.toLowerCase();
  let ref = fr.vars.get(key);
  if (!ref) {
    if (!e.h && fr.consts.has(key)) { if (e.path.length) fail(`constant ${e.name} has no components`); return { c: fr.consts.get(key) }; }
    if (!e.h && CTX.dbs.has(key)) { const db = CTX.dbs.get(key); ref = { type: db.type, obj: db, key: 'value' }; }
    else fail(`unknown identifier ${e.name}`);
  }
  for (const st of e.path) {
    const cur = ref.obj[ref.key], t = ref.type;
    if (st.m !== undefined) {
      if (!t.map) fail(`${e.name}: '.${st.m}' applied to a ${t.k}`);
      const f = t.map.get(st.m.toLowerCase());
      if (!f) fail(`${e.name}: no component ${st.m}`);
      ref = { type: f.type, obj: cur, key: f.key };
      continue;
    }
    if (t.k !== 'ARRAY') fail(`${e.name}: index applied to a ${t.k}`);
    if (st.ix.length > t.dims.length) fail(`${e.name}: too many indices`);
    let arr = cur, last;
    st.ix.forEach((x, i) => {
      const iv = evalExpr(x, fr);
      if (iv.t.k !== 'INT') typeErr(`array index must be INT (p.12-5), got ${iv.t.k}`);
      const [lo, hi] = t.dims[i];
      if (iv.v < lo || iv.v > hi) undef(`index ${iv.v} outside [${lo}..${hi}] of ${e.name} (p.4-19 "Monitor array limits")`);
      if (i < st.ix.length - 1) arr = arr[iv.v - lo]; else last = iv.v - lo;
    });
    const rest = t.dims.slice(st.ix.length);  // omitted right-hand indexes address a sub-array (p.12-5)
    ref = { type: rest.length ? { k: 'ARRAY', dims: rest, of: t.of } : t.of, obj: arr, key: last };
  }
  return ref;
}

function evalExpr(e, fr) {
  switch (e.k) {
    case 'lit': return e.tv;
    case 'var': {
      const r = resolve(e, fr);
      if (r.c) return r.c;
      const v = r.obj[r.key];
      if (v === undefined) undef(`function value ${e.name} read before it was assigned (p.12-35)`);
      return tv(r.type, v);
    }
    case 'un': return unary(e.op, evalExpr(e.e, fr));
    case 'bin': { const a = evalExpr(e.a, fr), b = evalExpr(e.b, fr); return binary(e.op, a, b); } // no short-circuit
    case 'call': {
      const key = e.name.toLowerCase();
      if (CTX.fcs.has(key)) { const r = callFC(CTX.fcs.get(key), e, fr); if (!r) fail(`VOID function ${e.name} used in an expression (p.11-4)`); return r; }
      const f = STD[e.name.toUpperCase()];
      if (!f) fail(`unknown function ${e.name}`);
      if (e.args.length !== 1 || (e.args[0].name && e.args[0].name.toUpperCase() !== 'IN')) fail(`${e.name} takes exactly one parameter IN (p.14-3)`);
      return f(evalExpr(e.args[0].expr, fr));
    }
  }
  fail(`bad expression ${e.k}`);
}

function namedArgs(def, e) {
  const given = new Map();
  if (e.args.length && e.args.every((a) => !a.name)) {
    if (e.args.length !== 1 || def.input.length !== 1 || def.output.length || def.inout.length) fail(`${def.name}: parameters must be assigned by name (p.12-37)`);
    given.set(def.input[0].key, { op: ':=', expr: e.args[0].expr });
    return given;
  }
  for (const a of e.args) {
    if (!a.name) fail(`${def.name}: mixed positional and named parameters`);
    const k = a.name.toLowerCase();
    if (given.has(k)) fail(`${def.name}: parameter ${a.name} assigned twice`);
    if (!def.params.has(k)) fail(`${def.name} has no parameter ${a.name}`);
    given.set(k, a);
  }
  return given;
}

function callFC(def, e, fr) {
  prepare(def);
  if (def.kind !== 'FC') fail(`${def.name} is not a function`);
  const given = namedArgs(def, e), tmp = Object.create(null), nf = { vars: new Map(), consts: def.consts, ok: true };
  const need = (d) => given.get(d.key) || fail(`${def.name}: every FC parameter must be supplied, ${d.name} is missing (p.12-37)`);
  for (const d of def.input) {
    const a = need(d);
    if (a.op !== ':=') fail(`${d.name}: input parameters are assigned with :=`);
    tmp[d.key] = conv(evalExpr(a.expr, fr), d.type);
    nf.vars.set(d.key, { type: d.type, obj: tmp, key: d.key });
  }
  for (const d of [...def.output, ...def.inout]) {    // outputs and in/outs refer to the actual variable
    const a = need(d);
    if (d.sec === 'inout' && a.op !== ':=') fail(`${d.name}: in/out parameters are assigned with :=`);
    if (a.expr.k !== 'var') fail(`${d.name}: actual parameter must be a variable (p.12-39)`);
    const r = resolve(a.expr, fr);
    if (r.c) fail(`${d.name}: a constant cannot be an output/in-out actual parameter`);
    if (!sameType(r.type, d.type)) typeErr(`${def.name}.${d.name}: formal ${d.type.k} and actual ${r.type.k} must match (p.12-37)`);
    nf.vars.set(d.key, { type: d.type, obj: r.obj, key: r.key });
  }
  for (const d of def.temp) { tmp[d.key] = makeValue(d.type); nf.vars.set(d.key, { type: d.type, obj: tmp, key: d.key }); }
  if (def.ret) nf.vars.set(def.key, { type: def.ret, obj: tmp, key: '$ret' });
  nf.vars.set('ok', { type: T.BOOL, obj: nf, key: 'ok' });
  withFrame(nf, () => execBlock(def.body, nf));
  if (!def.ret) return null;
  if (tmp.$ret === undefined) undef(`function ${def.name} returned without assigning its value (p.12-35)`);
  return tv(def.ret, tmp.$ret);
}

function runFB(def, inst) {
  const nf = { vars: new Map(), consts: def.consts, ok: true }, tmp = Object.create(null);
  for (const d of def.instType.fields) nf.vars.set(d.key, { type: d.type, obj: inst, key: d.key });
  for (const d of def.temp) { tmp[d.key] = makeValue(d.type); nf.vars.set(d.key, { type: d.type, obj: tmp, key: d.key }); } // temps: see notes
  nf.vars.set('ok', { type: T.BOOL, obj: nf, key: 'ok' });
  withFrame(nf, () => execBlock(def.body, nf));
}

function callInstance(ref, e, fr) {               // local instance call, e.g. MOTOR(X1 := 5)  (p.12-29)
  const def = ref.type.def, inst = ref.obj[ref.key];
  if (def.builtin) fail(`calling ${def.name} is outside the supported subset`);
  const post = [];
  for (const a of e.args) {
    if (!a.name) fail(`${def.name}: FB parameters must be assigned by name`);
    const k = a.name.toLowerCase(), d = def.params.get(k);
    if (!d || d.sec === 'output' || a.op !== ':=') fail(`${def.name}.${a.name}: output assignments are not possible in FB calls (p.12-30)`);
    if (d.sec === 'input') { write({ type: d.type, obj: inst, key: k }, conv(evalExpr(a.expr, fr), d.type)); continue; }
    if (a.expr.k !== 'var') fail(`${d.name}: in/out actual parameter must be a variable (p.12-31)`);
    const r = resolve(a.expr, fr);
    if (r.c || !sameType(r.type, d.type)) typeErr(`${def.name}.${d.name}: actual parameter type must match`);
    inst[k] = r.obj[r.key];                    // elementary: copy in; complex: the same object (a pointer)
    if (T[d.type.k]) post.push([k, r]);
  }
  runFB(def, inst);
  for (const [k, r] of post) r.obj[r.key] = inst[k];     // elementary in/out copied back (p.12-31)
}

const LOOP_LIMIT = 1e6; // per scan; a real CPU would hit the cycle-time watchdog
function tick() { if (++CTX.steps > LOOP_LIMIT) fail(`more than ${LOOP_LIMIT} loop iterations in one scan (cycle-time watchdog)`); }

function execBlock(stmts, fr) { for (const s of stmts) { const r = exec(s, fr); if (r) return r; } return null; }
function exec(s, fr) {
  try { return execInner(s, fr); } catch (err) {
    if (err instanceof SclError && !err.tagged) { err.message = `line ${s.line}: ${err.message}`; err.tagged = true; }
    throw err;
  }
}
function execInner(s, fr) {
  switch (s.k) {
    case 'assign': {
      const ref = resolve(s.lhs, fr);
      if (ref.c) fail(`cannot assign to constant ${s.lhs.name}`);
      write(ref, conv(evalExpr(s.rhs, fr), ref.type));
      return null;
    }
    case 'call': {
      const e = s.call, key = e.name.toLowerCase(), local = fr.vars.get(key);
      if (local && local.type.k === 'FB') { callInstance(local, e, fr); return null; }
      if (CTX.fcs.has(key)) { callFC(CTX.fcs.get(key), e, fr); return null; }
      evalExpr(e, fr); return null;
    }
    case 'if':
      for (const [c, body] of s.arms) if (cond(evalExpr(c, fr))) return execBlock(body, fr);
      return s.els ? execBlock(s.els, fr) : null;
    case 'case': {
      const sel = evalExpr(s.sel, fr);
      if (sel.t.k !== 'INT' && sel.t.k !== 'DINT') typeErr(`CASE selector must be an integer (p.12-16), got ${sel.t.k}`);
      if (!s.table) {                               // labels are constants (p.12-17); each value only once
        s.table = s.arms.map((a) => a.labels.map(([lo, hi]) => [constInt(lo, fr), constInt(hi, fr)]));
        const seen = [];
        for (const [lo, hi] of s.table.flat()) { if (seen.some(([a, b]) => lo <= b && a <= hi)) fail('CASE value occurs more than once (p.12-17)'); seen.push([lo, hi]); }
      }
      for (let i = 0; i < s.arms.length; i++) if (s.table[i].some(([lo, hi]) => sel.v >= lo && sel.v <= hi)) return execBlock(s.arms[i].body, fr);
      return s.els ? execBlock(s.els, fr) : null;
    }
    case 'for': {
      const ref = resolve(s.v, fr), k = ref.type && ref.type.k;
      if (ref.c || s.v.path.length || (k !== 'INT' && k !== 'DINT')) typeErr('FOR control variable must be a simple INT or DINT variable (p.12-18)');
      write(ref, conv(evalExpr(s.from, fr), ref.type));
      const end = conv(evalExpr(s.to, fr), ref.type);           // evaluated once (p.12-19)
      const step = s.by ? conv(evalExpr(s.by, fr), ref.type) : 1;
      for (;;) {
        const i = ref.obj[ref.key];
        if (step >= 0 ? i > end : i < end) return null;
        tick();
        const r = execBlock(s.body, fr);
        if (r === 'EXIT') return null;
        if (r === 'RETURN') return r;
        ref.obj[ref.key] = fixInt(k, ref.obj[ref.key] + step);
      }
    }
    case 'while':
      while (cond(evalExpr(s.c, fr))) { tick(); const r = execBlock(s.body, fr); if (r === 'EXIT') break; if (r === 'RETURN') return r; }
      return null;
    case 'repeat':
      for (;;) {
        tick(); const r = execBlock(s.body, fr);
        if (r === 'EXIT') break; if (r === 'RETURN') return r;
        if (cond(evalExpr(s.c, fr))) break;
      }
      return null;
    case 'exit': return 'EXIT';
    case 'continue': return 'CONTINUE';
    case 'return': return 'RETURN';
  }
  fail(`bad statement ${s.k}`);
}

// ---------------------------------------------------------------- results
function flatten(p, t, v, out) {
  if (T[t.k]) { out[p] = v; return; }
  if (t.k === 'ARRAY') {
    const rec = (d, a, idx) => a.forEach((x, i) => {
      const ix = [...idx, t.dims[d][0] + i];
      if (d + 1 < t.dims.length) rec(d + 1, x, ix); else flatten(`${p}[${ix.join(',')}]`, t.of, x, out);
    });
    rec(0, v, []); return;
  }
  for (const f of t.fields) flatten(`${p}.${f.name}`, f.type, v[f.key], out);
}

function fromJs(v, t, name) {
  const k = t.k;
  if (k === 'BOOL') { if (typeof v === 'boolean') return v; if (v === 0 || v === 1) return v === 1; }
  else if (k === 'REAL') { if (typeof v === 'number') return Math.fround(v); }
  else if (RANGE[k]) { if (Number.isInteger(v) && inRange(k, v)) return v + 0; }
  fail(`scan value ${JSON.stringify(v)} is not a valid ${k} for ${name}`);
}

export function runScl(source, { block, scans }) {
  const units = new Parser(lex(source)).program();
  CTX = { udts: new Map(), fbs: new Map(), fcs: new Map(), dbs: new Map(), obs: new Map(), steps: 0 };
  const seen = new Set();
  for (const u of units) {
    const key = u.name.toLowerCase();
    if (seen.has(key)) fail(`block name ${u.name} used twice`);
    seen.add(key);
    ({ UDT: CTX.udts, FB: CTX.fbs, FC: CTX.fcs, DB: CTX.dbs, OB: CTX.obs })[u.kind].set(key, u);
  }
  for (const d of [...CTX.fbs.values(), ...CTX.fcs.values()]) prepare(d);
  for (const db of CTX.dbs.values()) {            // DB: declared initial values, then the BEGIN assignments
    db.type = resolveType(db.typeAst, { consts: new Map() });
    if (db.type.k !== 'STRUCT') fail(`DATA_BLOCK ${db.name} must be a STRUCT or a UDT`);
    db.value = makeValue(db.type);
    const fr = { vars: new Map(db.type.fields.map((f) => [f.key, { type: f.type, obj: db.value, key: f.key }])), consts: new Map(), ok: true };
    withFrame(fr, () => execBlock(db.body, fr));
  }
  const def = CTX.fbs.get(String(block).toLowerCase()) || fail(`FUNCTION_BLOCK ${block} not found`);
  const inst = makeValue(def.instType), results = [];
  const topFrame = { vars: new Map(def.instType.fields.map((d) => [d.key, { type: d.type, obj: inst, key: d.key }])), consts: def.consts, ok: true };
  for (const scan of scans) {
    for (const [name, val] of Object.entries(scan || {})) {
      const p = new Parser(lex(name)), e = p.varPath();
      if (p.peek().t !== 'eof') fail(`bad input key ${name}`);
      const d = def.params.get(e.name.toLowerCase());
      if (!d || d.sec === 'output') fail(`${name} is not a VAR_INPUT or VAR_IN_OUT of ${def.name}`);
      const r = withFrame(topFrame, () => resolve(e, topFrame));
      if (!T[r.type.k]) fail(`${name}: give complex inputs element by element, e.g. "${e.name}[1]"`);
      r.obj[r.key] = fromJs(val, r.type, name);
    }
    CTX.steps = 0;
    runFB(def, inst);
    const out = {};
    for (const d of [...def.output, ...def.inout, ...def.stat]) flatten(d.name, d.type, inst[d.key], out);
    for (const db of CTX.dbs.values()) flatten(db.name, db.type, db.value, out);
    results.push(out);
  }
  return results;
}
