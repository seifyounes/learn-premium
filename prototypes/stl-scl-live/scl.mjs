// PROTOTYPE (throwaway, ticket #37): S7-SCL interpreter with a per-statement trace.
// Pure module on the shared S7 core: lexer, recursive-descent parser, tree-walker.
// INT/DINT wrap at 16/32 bits, REAL is float32 after every operation, FB statics persist.
//
// Contract shared with the blind oracle (blind/scl-blind.mjs):
//   runScl(source, { block, scans }) -> one flat object per scan (outputs, in/outs, statics,
//   every global DB variable as "DB.path"), arrays "a[i]" / "a[i,j]", structs ".member".
// For the page: createScl(source, { block }) -> { scan(inputs) -> { trace, values }, values() }.
import { f32, wrapInt, wrapDint, roundHalfEven } from './s7core.mjs';

// ---- lexer ------------------------------------------------------------------------------
const KW = new Set(('FUNCTION FUNCTION_BLOCK END_FUNCTION END_FUNCTION_BLOCK TYPE END_TYPE STRUCT END_STRUCT DATA_BLOCK ' +
  'END_DATA_BLOCK VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_TEMP VAR VAR_STAT CONST END_CONST END_VAR BEGIN IF THEN ELSIF ' +
  'ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT CONTINUE RETURN AND ' +
  'OR XOR NOT MOD ARRAY TRUE FALSE TITLE VERSION').split(' '));
export function lex(src) {
  const toks = [];
  const re = /(\s+)|(\/\/[^\n]*|\(\*[\s\S]*?\*\)|\{[\s\S]*?\})|(T#[\dhmsHMS_]+)|(16#[0-9A-Fa-f_]+|2#[01_]+|L#[+-]?\d+)|(\d+\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)|(\d+)|("[^"]*")|('[^']*')|(#?[A-Za-z_]\w*)|(:=|<>|<=|>=|\*\*|\.\.|[-+*/=<>()[\],;:.&])/y;
  let i = 0, line = 0;
  while (i < src.length) {
    re.lastIndex = i; const m = re.exec(src);
    if (!m) throw new Error(`SCL lex error on line ${line + 1} near "${src.slice(i, i + 12)}"`);
    const at = line; line += (m[0].match(/\n/g) || []).length; i = re.lastIndex;
    if (m[1] || m[2]) continue;
    if (m[3]) toks.push({ t: 'num', v: parseTime(m[3]), ty: 'TIME', line: at });
    else if (m[4]) { const s = m[4].replace(/_/g, ''); toks.push({ t: 'num', v: s.startsWith('16#') ? parseInt(s.slice(3), 16) : s.startsWith('2#') ? parseInt(s.slice(2), 2) : +s.slice(2), ty: 'ANYINT', line: at }); }
    else if (m[5]) toks.push({ t: 'num', v: f32(+m[5]), ty: 'REAL', line: at });
    else if (m[6]) toks.push({ t: 'num', v: +m[6], ty: 'ANYINT', line: at });
    else if (m[7]) toks.push({ t: 'id', v: m[7].slice(1, -1), quoted: true, line: at });
    else if (m[8]) toks.push({ t: 'str', v: m[8], line: at });
    else if (m[9]) { const u = m[9].toUpperCase(); toks.push(!m[9].startsWith('#') && KW.has(u) ? { t: 'kw', v: u, line: at } : { t: 'id', v: m[9].replace(/^#/, ''), line: at }); }
    else toks.push({ t: 'op', v: m[10], line: at });
  }
  toks.push({ t: 'eof', v: '', line });
  return toks;
}
function parseTime(s) {
  let ms = 0; const re = /(\d+)(ms|h|m|s)/gi; let m;
  for (const t = s.slice(2).replace(/_/g, ''); (m = re.exec(t));) ms += +m[1] * { h: 3600000, m: 60000, s: 1000, ms: 1 }[m[2].toLowerCase()];
  return ms;
}

// ---- parser -----------------------------------------------------------------------------
export function parseScl(src) {
  const T = lex(src); let p = 0;
  const peek = (v) => (T[p].t === 'kw' || T[p].t === 'op') && T[p].v === v;
  const next = () => T[p++];
  const eat = (v) => { if (!peek(v)) throw new Error(`SCL line ${T[p].line + 1}: expected ${v}, found "${T[p].v}"`); return next(); };
  const opt = (v) => (peek(v) ? next() : null);
  const name = () => { const t = next(); if (t.t !== 'id' && t.t !== 'kw') throw new Error(`SCL line ${t.line + 1}: expected a name`); return t.v; };
  const unit = { types: {}, dbs: {}, blocks: {} };

  function type() {
    if (opt('ARRAY')) {
      eat('['); const dims = [];
      do { const lo = expr(); eat('..'); dims.push([lo, expr()]); } while (opt(','));
      eat(']'); eat('OF'); return { kind: 'array', dims, of: type() };
    }
    if (opt('STRUCT')) { const fields = decls(['END_STRUCT']); eat('END_STRUCT'); opt(';'); return { kind: 'struct', fields }; }
    const t = next(); return { kind: 'named', name: t.quoted ? t.v : t.v.toUpperCase() };
  }
  function init() {
    if (opt('[')) { const items = []; if (!peek(']')) do items.push(init()); while (opt(',')); eat(']'); return { list: items }; }
    return expr();
  }
  function decls(ends) {
    const out = [];
    while (!ends.some(peek)) {
      const names = [name()]; while (opt(',')) names.push(name());
      eat(':'); const ty = type(); const iv = opt(':=') ? init() : null; opt(';');
      for (const n of names) out.push({ name: n, ty, iv });
    }
    return out;
  }
  // expressions: OR < XOR < AND < comparison < + - < * / MOD < ** < unary
  const bin = (sub, ops) => () => { let l = sub(); while (ops.some(peek)) { const op = next().v; l = { op: op === '&' ? 'AND' : op, l, r: sub() }; } return l; };
  function primary() {
    const t = next();
    if (t.t === 'num') return { num: t.v, ty: t.ty };
    if (t.v === 'TRUE' || t.v === 'FALSE') return { num: t.v === 'TRUE', ty: 'BOOL' };
    if (t.v === '(') { const e = expr(); eat(')'); return e; }
    if (t.v === '-' || t.v === '+') { const e = unary(); return t.v === '-' ? { un: '-', e } : e; }
    if (t.v === 'NOT') return { un: 'NOT', e: unary() };
    if (t.t !== 'id') throw new Error(`SCL line ${t.line + 1}: unexpected "${t.v}"`);
    if (peek('(')) {
      next(); const args = [];
      if (!peek(')')) do { if (T[p].t === 'id' && T[p + 1].v === ':=') { const n = next().v; next(); args.push({ n, e: expr() }); } else args.push({ e: expr() }); } while (opt(','));
      eat(')'); return { call: t.v, args };
    }
    const ref = { ref: [t.v], line: t.line };
    for (;;) {
      if (opt('[')) { const ix = []; do ix.push(expr()); while (opt(',')); eat(']'); ref.ref.push({ ix }); }
      else if (peek('.') && T[p + 1].t !== 'num') { next(); ref.ref.push(name()); }
      else break;
    }
    return ref;
  }
  const unary = () => primary();
  const power = bin(unary, ['**']), mul = bin(power, ['*', '/', 'MOD']), add = bin(mul, ['+', '-']);
  const cmp = bin(add, ['=', '<>', '<', '>', '<=', '>=']), and = bin(cmp, ['AND', '&']), xor = bin(and, ['XOR']);
  const expr = bin(xor, ['OR']);

  function stmts(ends) {
    const out = [];
    while (!ends.some(peek)) { if (opt(';')) continue; out.push(stmt()); }
    return out;
  }
  function caseLabel() { const a = expr(); return opt('..') ? { lo: a, hi: expr() } : { lo: a, hi: a }; }
  const atCaseLabel = () => {
    let q = p; if (T[q].v === '-') q++;
    return T[q].t === 'num' && [':', '..', ','].includes(T[q + 1].v) && T[q + 1].t === 'op';
  };
  function stmt() {
    const line = T[p].line;
    if (opt('IF')) {
      const arms = []; let c = expr(); eat('THEN'); arms.push({ c, line, b: stmts(['ELSIF', 'ELSE', 'END_IF']) });
      while (peek('ELSIF')) { const l = next().line; c = expr(); eat('THEN'); arms.push({ c, line: l, b: stmts(['ELSIF', 'ELSE', 'END_IF']) }); }
      let els = null; if (peek('ELSE')) { const l = next().line; els = { line: l, b: stmts(['END_IF']) }; }
      const end = eat('END_IF').line; opt(';'); return { k: 'if', line, end, arms, els };
    }
    if (opt('CASE')) {
      const sel = expr(); eat('OF'); const arms = [];
      while (!peek('ELSE') && !peek('END_CASE')) {
        const l = T[p].line; const labels = [caseLabel()]; while (opt(',')) labels.push(caseLabel()); eat(':');
        const body = []; while (!peek('ELSE') && !peek('END_CASE') && !atCaseLabel()) { if (opt(';')) continue; body.push(stmt()); }
        arms.push({ labels, line: l, body });
      }
      let els = null; if (peek('ELSE')) { const l = next().line; els = { line: l, b: stmts(['END_CASE']) }; }
      const end = eat('END_CASE').line; opt(';'); return { k: 'case', line, end, sel, arms, els };
    }
    if (opt('FOR')) {
      const v = primary(); eat(':='); const from = expr(); eat('TO'); const to = expr(); const by = opt('BY') ? expr() : { num: 1, ty: 'ANYINT' };
      eat('DO'); const body = stmts(['END_FOR']); const end = eat('END_FOR').line; opt(';'); return { k: 'for', line, end, v, from, to, by, body };
    }
    if (opt('WHILE')) { const c = expr(); eat('DO'); const body = stmts(['END_WHILE']); const end = eat('END_WHILE').line; opt(';'); return { k: 'while', line, end, c, body }; }
    if (opt('REPEAT')) { const body = stmts(['UNTIL']); eat('UNTIL'); const c = expr(); opt(';'); const end = eat('END_REPEAT').line; opt(';'); return { k: 'repeat', line, end, c, body }; }
    if (opt('EXIT')) { opt(';'); return { k: 'exit', line, end: line }; }
    if (opt('CONTINUE')) { opt(';'); return { k: 'continue', line, end: line }; }
    if (opt('RETURN')) { opt(';'); return { k: 'return', line, end: line }; }
    const lhs = primary();
    if (lhs.call) { const end = T[p - 1].line; opt(';'); return { k: 'call', line, end, e: lhs }; }
    eat(':='); const rhs = expr(); const end = T[p - 1].line; opt(';');
    return { k: 'assign', line, end, lhs, rhs };
  }
  const skipAttrs = () => {
    for (;;) {
      if (peek('TITLE') || peek('VERSION')) { next(); opt('='); opt(':'); next(); opt(';'); continue; }
      if (T[p].t === 'kw' && ['NON_RETAIN'].includes(T[p].v)) { next(); continue; }
      break;
    }
  };
  while (T[p].t !== 'eof') {
    if (opt('TYPE')) { const n = name(); skipAttrs(); opt(':'); unit.types[n] = type(); opt(';'); eat('END_TYPE'); continue; }
    if (opt('DATA_BLOCK')) {
      const n = name(); skipAttrs(); const d = [];
      if (opt('STRUCT')) { d.push(...decls(['END_STRUCT'])); eat('END_STRUCT'); opt(';'); }
      while (peek('VAR')) { next(); d.push(...decls(['END_VAR'])); eat('END_VAR'); }
      const init = []; if (opt('BEGIN')) init.push(...stmts(['END_DATA_BLOCK']));
      eat('END_DATA_BLOCK'); unit.dbs[n] = { decls: d, init }; continue;
    }
    const kind = next().v;
    if (kind !== 'FUNCTION' && kind !== 'FUNCTION_BLOCK') throw new Error(`SCL line ${T[p - 1].line + 1}: unexpected "${kind}" at top level`);
    const n = name(); const ret = kind === 'FUNCTION' && opt(':') ? type() : null;
    const secs = []; const consts = [];
    for (;;) {
      skipAttrs();
      if (opt('CONST')) { while (!peek('END_CONST')) { const cn = name(); eat(':='); consts.push({ name: cn, iv: expr() }); opt(';'); } eat('END_CONST'); continue; }
      if (T[p].t === 'kw' && /^VAR/.test(T[p].v)) { const sk = next().v; const d = decls(['END_VAR']); eat('END_VAR'); secs.push({ kind: sk === 'VAR_STAT' ? 'VAR' : sk, d }); continue; }
      break;
    }
    eat('BEGIN'); const body = stmts(['END_FUNCTION', 'END_FUNCTION_BLOCK']); next();
    unit.blocks[n] = { kind, name: n, ret, secs, consts, body };
  }
  return unit;
}

// ---- values -----------------------------------------------------------------------------
const INT_TYPES = { INT: 16, DINT: 32, WORD: 16, DWORD: 32, BYTE: 8, USINT: 8, UINT: 16, SINT: 8, UDINT: 32, TIME: 32 };
const SIGNED = new Set(['INT', 'DINT', 'SINT', 'TIME']);
export function coerce(v, ty) {
  if (ty === 'REAL' || ty === 'LREAL') return f32(Number(v));
  if (ty === 'BOOL') return !!v;
  const bits = INT_TYPES[ty]; if (!bits) return v;
  let x = Math.trunc(Number(v));
  if (ty === 'INT') return wrapInt(x);
  if (bits === 32) return SIGNED.has(ty) ? wrapDint(x) : Number(BigInt.asUintN(32, BigInt(x)));
  x &= (1 << bits) - 1; return SIGNED.has(ty) && x >= 1 << (bits - 1) ? x - (1 << bits) : x;
}

const EXIT = { exit: 1 }, CONTINUE = { cont: 1 }, RETURN = { ret: 1 };

class Runtime {
  constructor(unit) { this.u = unit; this.dbs = {}; this.steps = 0; this.trace = null; }
  resolve(ty) { return ty.kind === 'named' && this.u.types[ty.name] ? this.resolve(this.u.types[ty.name]) : ty; }
  make(ty, iv, env) {
    ty = this.resolve(ty);
    if (ty.kind === 'array') {
      const dims = ty.dims.map(([lo, hi]) => [this.ev(lo, env).v, this.ev(hi, env).v]);
      const n = dims.reduce((a, [lo, hi]) => a * (hi - lo + 1), 1);
      const flat = []; const walk = (x) => (x && x.list ? x.list.forEach(walk) : flat.push(x)); if (iv) walk(iv);
      return { arr: true, dims, data: Array.from({ length: n }, (_, i) => this.make(ty.of, flat[i] ?? null, env)) };
    }
    if (ty.kind === 'struct') { const f = {}; for (const d of ty.fields) f[d.name] = this.make(d.ty, d.iv, env); return { struct: true, f }; }
    const s = ty.name;
    return { s, v: coerce(iv ? this.ev(iv, env).v : 0, s) };
  }
  db(n) {
    if (!this.dbs[n]) {
      const def = this.u.dbs[n], o = {};
      for (const d of def.decls) o[d.name] = this.make(d.ty, d.iv, { vars: o, consts: {} });
      this.dbs[n] = { struct: true, f: o };
      this.exec(def.init, { vars: o, consts: {}, block: null });
    }
    return this.dbs[n];
  }
  lookup(ref, env) {
    const [head, ...rest] = ref.ref;
    let cur = env.vars[head], path = head;
    if (cur === undefined && this.u.dbs[head]) cur = this.db(head);
    if (cur === undefined && env.consts[head]) return { s: env.consts[head].t, v: env.consts[head].v, ro: true, path };
    if (cur === undefined) throw new Error(`unknown variable ${head}`);
    for (const r of rest) {
      if (typeof r === 'string') { cur = cur.f[r]; path += '.' + r; if (!cur) throw new Error(`no member ${path}`); }
      else {
        const ix = r.ix.map((e) => this.ev(e, env).v); let off = 0;
        cur.dims.forEach(([lo, hi], k) => { if (ix[k] < lo || ix[k] > hi) throw new Error(`index ${path}[${ix.join(',')}] outside ${lo}..${hi}`); off = off * (hi - lo + 1) + (ix[k] - lo); });
        cur = cur.data[off]; path += `[${ix.join(',')}]`;
      }
    }
    return Object.assign(cur, { path });
  }
  arith(op, a, b) {
    const rank = (t) => (t === 'REAL' || t === 'LREAL' ? 3 : t === 'DINT' || t === 'DWORD' || t === 'TIME' ? 2 : t === 'ANYINT' ? 0 : 1);
    const t = rank(a.t) >= rank(b.t) ? a.t : b.t;
    if (t === 'REAL' || t === 'LREAL') {
      const x = /* GATE-MUTANT:real-in */ f32(a.v), y = f32(b.v);
      const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : op === '**' ? Math.pow(x, y) : NaN;
      return { v: /* GATE-MUTANT:real */ f32(r), t: 'REAL' };
    }
    let r;
    switch (op) {
      case '+': r = a.v + b.v; break; case '-': r = a.v - b.v; break; case '*': r = a.v * b.v; break;
      case '/': r = b.v === 0 ? 0 : Math.trunc(a.v / b.v); break; case 'MOD': r = b.v === 0 ? 0 : a.v % b.v; break;
      case '**': return { v: f32(Math.pow(a.v, b.v)), t: 'REAL' };
    }
    return t === 'ANYINT' ? { v: r, t } : { v: coerce(r, t), t };
  }
  ev(e, env) {
    if (e.num !== undefined) return { v: e.num, t: e.ty };
    if (e.un === '-') { const x = this.ev(e.e, env); return x.t === 'ANYINT' ? { v: -x.v, t: x.t } : { v: coerce(-x.v, x.t), t: x.t }; }
    if (e.un === 'NOT') { const x = this.ev(e.e, env); return x.t === 'BOOL' ? { v: !x.v, t: 'BOOL' } : { v: coerce(~x.v, x.t), t: x.t }; }
    if (e.call) return this.call(e.call, e.args, env);
    if (e.ref) { const s = this.lookup(e, env); return { v: s.v, t: s.s }; }
    const a = this.ev(e.l, env);
    if (e.op === 'AND' && a.t === 'BOOL') return { v: !!a.v && !!this.ev(e.r, env).v, t: 'BOOL' };
    if (e.op === 'OR' && a.t === 'BOOL') { const b = this.ev(e.r, env); return { v: !!a.v || !!b.v, t: 'BOOL' }; }
    const b = this.ev(e.r, env);
    switch (e.op) {
      case 'XOR': return { v: !!a.v !== !!b.v, t: 'BOOL' };
      case '=': return { v: a.v === b.v, t: 'BOOL' }; case '<>': return { v: a.v !== b.v, t: 'BOOL' };
      case '<': return { v: a.v < b.v, t: 'BOOL' }; case '>': return { v: a.v > b.v, t: 'BOOL' };
      case '<=': return { v: a.v <= b.v, t: 'BOOL' }; case '>=': return { v: a.v >= b.v, t: 'BOOL' };
    }
    return this.arith(e.op, a, b);
  }
  call(name, args, env) {
    const x = () => this.ev(args[0].e, env);
    const R = (fn) => ({ v: f32(fn(f32(x().v))), t: 'REAL' });
    switch (name.toUpperCase()) {
      case 'SQRT': return R(Math.sqrt); case 'SQR': return R((v) => v * v); case 'EXP': return R(Math.exp);
      case 'LN': return R(Math.log); case 'SIN': return R(Math.sin); case 'COS': return R(Math.cos);
      case 'ACOS': return R(Math.acos); case 'ASIN': return R(Math.asin); case 'ATAN': return R(Math.atan);
      case 'ABS': { const a = x(); return { v: a.t === 'REAL' ? Math.abs(a.v) : coerce(Math.abs(a.v), a.t), t: a.t }; }
      case 'INT_TO_REAL': case 'DINT_TO_REAL': return R((v) => v);
      case 'INT_TO_DINT': return { v: x().v | 0, t: 'DINT' };
      case 'DINT_TO_INT': return { v: coerce(x().v, 'INT'), t: 'INT' };
      case 'REAL_TO_INT': case 'ROUND': return { v: coerce(roundHalfEven(x().v), name.toUpperCase() === 'ROUND' ? 'DINT' : 'INT'), t: name.toUpperCase() === 'ROUND' ? 'DINT' : 'INT' };
      case 'REAL_TO_DINT': return { v: coerce(roundHalfEven(x().v), 'DINT'), t: 'DINT' };
      case 'TRUNC': return { v: coerce(Math.trunc(x().v), 'DINT'), t: 'DINT' };
    }
    if (this.u.blocks[name]?.kind === 'FUNCTION') return this.callFC(name, args, env);
    throw new Error('unknown function ' + name);
  }
  callFC(name, args, env) {
    const b = this.u.blocks[name], vars = {}, e2 = { vars, consts: {}, block: b };
    for (const c of b.consts) e2.consts[c.name] = this.ev(c.iv, e2);
    for (const s of b.secs) for (const d of s.d) vars[d.name] = this.make(d.ty, d.iv, e2);
    vars[name] = this.make(b.ret, null, e2);
    const ins = b.secs.filter((s) => s.kind === 'VAR_INPUT').flatMap((s) => s.d);
    args.forEach((a, i) => { const slot = vars[a.n || ins[i].name]; slot.v = coerce(this.ev(a.e, env).v, slot.s); });
    const saved = this.trace; this.trace = null; // a called FC runs as one step of its caller
    try { this.exec(b.body, e2); } catch (e) { if (e !== RETURN) throw e; } finally { this.trace = saved; }
    return { v: vars[name].v, t: vars[name].s };
  }
  // trace helpers: every executed statement adds one event with the variables it wrote
  event(s, extra) { if (!this.trace) return null; const ev = { line: s.line, end: s.end, kind: s.k, writes: [], ...extra }; this.trace.push(ev); return ev; }
  store(slot, v, ev) {
    const before = slot.v; slot.v = coerce(v, slot.s);
    if (ev) ev.writes.push({ path: slot.path, before, after: slot.v, type: slot.s });
  }
  exec(list, env) {
    for (const s of list) {
      if (++this.steps > 200000) throw new Error('step limit (endless loop?)');
      switch (s.k) {
        case 'assign': {
          const r = this.ev(s.rhs, env), ev = this.event(s);
          this.store(this.lookup(s.lhs, env), r.v, ev); break;
        }
        case 'call': this.event(s); this.ev(s.e, env); break;
        case 'if': {
          let taken = null;
          for (const [i, arm] of s.arms.entries()) {
            const c = !!this.ev(arm.c, env).v; this.event({ ...s, line: arm.line, end: arm.line }, { cond: c, arm: i });
            if (c) { taken = arm.b; break; }
          }
          if (!taken && s.els) { this.event({ ...s, line: s.els.line, end: s.els.line }, { arm: 'else' }); taken = s.els.b; }
          if (taken) this.exec(taken, env);
          break;
        }
        case 'case': {
          const v = this.ev(s.sel, env).v;
          const arm = s.arms.find((a) => a.labels.some((l) => v >= this.ev(l.lo, env).v && v <= this.ev(l.hi, env).v));
          this.event(s, { selector: v });
          if (arm) { this.event({ ...s, k: 'case-arm', line: arm.line, end: arm.line }, { selector: v }); this.exec(arm.body, env); }
          else if (s.els) { this.event({ ...s, k: 'case-arm', line: s.els.line, end: s.els.line }, { selector: v, arm: 'else' }); this.exec(s.els.b, env); }
          break;
        }
        case 'for': {
          const slot = this.lookup(s.v, env), to = this.ev(s.to, env).v, by = this.ev(s.by, env).v;
          this.store(slot, this.ev(s.from, env).v, this.event(s, { phase: 'init' }));
          try {
            while (by > 0 ? slot.v <= to : slot.v >= to) {
              if (++this.steps > 200000) throw new Error('step limit');
              try { this.exec(s.body, env); } catch (e) { if (e !== CONTINUE) throw e; }
              this.store(slot, slot.v + by, this.event({ ...s, line: s.end, end: s.end }, { phase: 'next' }));
            }
          } catch (e) { if (e !== EXIT) throw e; }
          break;
        }
        case 'while': try {
          while (this.event(s, {}), this.ev(s.c, env).v) { if (++this.steps > 200000) throw new Error('step limit'); try { this.exec(s.body, env); } catch (e) { if (e !== CONTINUE) throw e; } }
        } catch (e) { if (e !== EXIT) throw e; } break;
        case 'repeat': try {
          do { try { this.exec(s.body, env); } catch (e) { if (e !== CONTINUE) throw e; } this.event({ ...s, line: s.end - 1 }, {}); } while (!this.ev(s.c, env).v);
        } catch (e) { if (e !== EXIT) throw e; } break;
        case 'exit': this.event(s); /* GATE-MUTANT:exit */ throw EXIT;
        case 'continue': this.event(s); throw CONTINUE;
        case 'return': this.event(s); throw RETURN;
      }
    }
  }
}

// ---- flatten for the contract -----------------------------------------------------------
function flatten(slot, path, out) {
  if (slot.arr) {
    const idx = slot.dims.map(([lo]) => lo);
    for (const cell of slot.data) {
      flatten(cell, `${path}[${idx.join(',')}]`, out);
      for (let k = idx.length - 1; k >= 0; k--) { if (++idx[k] <= slot.dims[k][1]) break; idx[k] = slot.dims[k][0]; }
    }
  } else if (slot.struct) for (const [k, v] of Object.entries(slot.f)) flatten(v, `${path}.${k}`, out);
  else out[path] = slot.v;
  return out;
}

export function createScl(source, { block }) {
  const unit = parseScl(source), rt = new Runtime(unit), b = unit.blocks[block];
  if (!b || b.kind !== 'FUNCTION_BLOCK') throw new Error(`no FUNCTION_BLOCK ${block}`);
  const vars = {}, env = { vars, consts: {}, block: b };
  for (const c of b.consts) env.consts[c.name] = rt.ev(c.iv, env);
  for (const s of b.secs) if (s.kind !== 'VAR_TEMP') for (const d of s.d) vars[d.name] = rt.make(d.ty, d.iv, env);
  for (const n of Object.keys(unit.dbs)) rt.db(n);
  const kinds = {}; for (const s of b.secs) for (const d of s.d) kinds[d.name] = s.kind;
  const values = () => {
    const out = {};
    for (const s of b.secs) if (['VAR_OUTPUT', 'VAR_IN_OUT', 'VAR'].includes(s.kind)) for (const d of s.d) flatten(vars[d.name], d.name, out);
    for (const n of Object.keys(unit.dbs)) for (const [k, v] of Object.entries(rt.dbs[n].f)) flatten(v, `${n}.${k}`, out);
    return out;
  };
  return {
    unit, kinds, values,
    inputs: () => Object.fromEntries(b.secs.filter((s) => s.kind === 'VAR_INPUT').flatMap((s) => s.d.map((d) => [d.name, vars[d.name].v]))),
    scan(inputs = {}) {
      for (const s of b.secs) if (s.kind === 'VAR_TEMP') for (const d of s.d) vars[d.name] = rt.make(d.ty, d.iv, env);
      for (const [k, v] of Object.entries(inputs)) { if (!vars[k]) throw new Error('no input ' + k); vars[k].v = coerce(v, vars[k].s); }
      rt.trace = []; rt.steps = 0;
      try { rt.exec(b.body, env); } catch (e) { if (e !== RETURN) throw e; }
      const trace = rt.trace; rt.trace = null;
      return { trace, values: values() };
    },
  };
}

export function runScl(source, { block, scans }) {
  const fb = createScl(source, { block });
  return scans.map((inp) => fb.scan(inp).values);
}
