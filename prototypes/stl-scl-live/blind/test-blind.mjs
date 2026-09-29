// test-blind.mjs - self-written SCL programs run through scl-blind.mjs.  Run: node test-blind.mjs
import { runScl } from './scl-blind.mjs';

let pass = 0, failed = 0;
function eq(name, got, want) {
  const ok = Object.is(got, want) || (typeof want === 'number' && typeof got === 'number' && got === want);
  if (ok) pass++; else { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function near(name, got, want, tol) { if (Math.abs(got - want) <= tol) pass++; else { failed++; console.log(`FAIL ${name}: got ${got} want ~${want}`); } }
function throws(name, fn, re) {
  try { fn(); failed++; console.log(`FAIL ${name}: no error`); }
  catch (e) { if (re.test(e.message)) pass++; else { failed++; console.log(`FAIL ${name}: wrong error: ${e.message}`); } }
}
const f = Math.fround;

// ------------------------------------------------------------------ 1. state machine over scans
const SORTER = `
FUNCTION_BLOCK "Sorter"
TITLE = Sorter state machine
// block comment line
VAR_INPUT
  start : BOOL;
  part  : INT;     (* weight in grams (* nested *) *)
  reset : BOOL;
END_VAR
VAR_OUTPUT
  state : INT := 0;
  bin   : INT;
  busy  : BOOL;
END_VAR
VAR_STATIC
  ticks  : INT;
  sorted : ARRAY[1..3] OF INT;
END_VAR
CONST
  IDLE := 0; WEIGH := 1; MOVE := 2; DONE := 3;
END_CONST
BEGIN
IF #reset THEN #state := IDLE; #busy := FALSE; RETURN; END_IF;
CASE #state OF
  IDLE: IF #start THEN #state := WEIGH; #busy := TRUE; END_IF;
  WEIGH:
    CASE #part OF
      0..99: #bin := 1;
      100..499, 600: #bin := 2;
    ELSE
      #bin := 3;
    END_CASE;
    #ticks := 0; #state := MOVE;
  MOVE:
    #ticks := #ticks + 1;
    IF #ticks >= #bin THEN #state := DONE; END_IF;
  DONE:
    #sorted[#bin] := #sorted[#bin] + 1; #busy := FALSE; #state := IDLE;
ELSE:
  #state := IDLE;
END_CASE;
END_FUNCTION_BLOCK
`;
{
  const scans = [{ start: true, part: 250 }, {}, {}, {}, {}, { start: false }, { start: true, part: 700 }, {}, {}, {}, {}, {}, { reset: true }];
  const r = runScl(SORTER, { block: 'Sorter', scans });
  eq('sm states', r.map((x) => x.state).join(','), '1,2,2,3,0,0,1,2,2,2,3,0,0');
  eq('sm busy s1', r[0].busy, true);
  eq('sm bin s2', r[1].bin, 2);
  eq('sm sorted after s5', r[4]['sorted[2]'], 1);
  eq('sm bin s8', r[7].bin, 3);
  eq('sm sorted[3] after s12', r[11]['sorted[3]'], 1);
  eq('sm ticks s11', r[10].ticks, 3);
  eq('sm keys', Object.keys(r[0]).join(','), 'state,bin,busy,ticks,sorted[1],sorted[2],sorted[3]');
}

// ------------------------------------------------------------------ 2. feed-forward net, sigmoid via EXP
const NET = `
FUNCTION "Sigmoid" : REAL
VAR_INPUT x : REAL; END_VAR
BEGIN
  "Sigmoid" := 1.0 / (1.0 + EXP(-x));
END_FUNCTION

FUNCTION_BLOCK "Net"
VAR_INPUT in : ARRAY[1..3] OF REAL; END_VAR
VAR_OUTPUT y : REAL; END_VAR
VAR
  w1 : ARRAY[1..2, 1..3] OF REAL := 0.5, -0.25, 0.1, 2(0.3), -0.7;
  b1 : ARRAY[1..2] OF REAL := [2(0.1)];
  w2 : ARRAY[1..2] OF REAL := 1.5, -2.0;
  b2 : REAL := 0.05;
  h  : ARRAY[1..2] OF REAL;
END_VAR
VAR_TEMP i, j : INT; s : REAL; END_VAR
BEGIN
FOR i := 1 TO 2 DO
  s := b1[i];
  FOR j := 1 TO 3 DO s := s + w1[i, j] * in[j]; END_FOR;
  h[i] := "Sigmoid"(x := s);
END_FOR;
s := b2;
FOR i := 2 TO 1 BY -1 DO s := s + w2[i] * h[i]; END_FOR;
y := "Sigmoid"(x := s);
END_FUNCTION_BLOCK
`;
{
  const inputs = [[1, 0.5, -1], [0.2, 0.9, 3.25]];
  const r = runScl(NET, { block: 'Net', scans: inputs.map((v) => ({ 'in[1]': v[0], 'in[2]': v[1], 'in[3]': v[2] })) });
  const W1 = [[0.5, -0.25, 0.1], [0.3, 0.3, -0.7]], B1 = [0.1, 0.1], W2 = [1.5, -2.0], B2 = 0.05;
  const sig32 = (x) => f(f(1) / f(f(1) + f(Math.exp(f(-x)))));
  const sig64 = (x) => 1 / (1 + Math.exp(-x));
  inputs.forEach((inp, n) => {
    const x = inp.map(f); const h32 = [], h64 = [];
    for (let i = 0; i < 2; i++) {
      let s = f(B1[i]), s64 = B1[i];
      for (let j = 0; j < 3; j++) { s = f(s + f(f(W1[i][j]) * x[j])); s64 += W1[i][j] * inp[j]; }
      h32.push(sig32(s)); h64.push(sig64(s64));
    }
    let s = f(B2), s64 = B2;
    for (let i = 1; i >= 0; i--) { s = f(s + f(f(W2[i]) * h32[i])); s64 += W2[i] * h64[i]; }
    eq(`net y float32 exact #${n}`, r[n].y, sig32(s));
    near(`net y vs float64 #${n}`, r[n].y, sig64(s64), 1e-6);
    eq(`net h[1] #${n}`, r[n]['h[1]'], h32[0]);
    eq(`net y is float32 #${n}`, Math.fround(r[n].y), r[n].y);
  });
  eq('net w1[2,2] from repetition factor', r[0]['w1[2,2]'], f(0.3));
  eq('net w1[2,3]', r[0]['w1[2,3]'], f(-0.7));
  eq('net b1[2] bracketed repetition', r[0]['b1[2]'], f(0.1));
}

// ------------------------------------------------------------------ 3. in-place sort through VAR_IN_OUT
const SORT = `
FUNCTION "SortArr" : VOID
VAR_IN_OUT data : ARRAY[1..8] OF INT; END_VAR
VAR_OUTPUT swaps : INT; END_VAR
VAR_TEMP i, t, last : INT; swapped : BOOL; END_VAR
BEGIN
swaps := 0; last := 8;
REPEAT
  swapped := FALSE;
  FOR i := 1 TO last - 1 DO
    IF data[i] > data[i + 1] THEN
      t := data[i]; data[i] := data[i + 1]; data[i + 1] := t;
      swapped := TRUE; swaps := swaps + 1;
    END_IF;
  END_FOR;
  last := last - 1;
UNTIL NOT swapped
END_REPEAT;
END_FUNCTION

FUNCTION_BLOCK "SortTest"
VAR_INPUT go : BOOL; END_VAR
VAR_OUTPUT n : INT := -1; END_VAR
VAR vals : ARRAY[1..8] OF INT := 5, -3, 12, 0, 7, 7, -32768, 32767; END_VAR
BEGIN
IF go THEN "SortArr"(data := vals, swaps => n); END_IF;
END_FUNCTION_BLOCK
`;
{
  const init = [5, -3, 12, 0, 7, 7, -32768, 32767];
  let inv = 0; for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if (init[i] > init[j]) inv++;
  const r = runScl(SORT, { block: 'SortTest', scans: [{ go: false }, { go: true }, {}] });
  eq('sort untouched scan 1', [1, 2, 3, 4, 5, 6, 7, 8].map((i) => r[0][`vals[${i}]`]).join(','), init.join(','));
  eq('sort n before', r[0].n, -1);
  eq('sort sorted', [1, 2, 3, 4, 5, 6, 7, 8].map((i) => r[1][`vals[${i}]`]).join(','), [...init].sort((a, b) => a - b).join(','));
  eq('sort swaps = inversions', r[1].n, inv);
  eq('sort second pass 0 swaps', r[2].n, 0);
}

// ------------------------------------------------------------------ 4. 3-D DB array of UDT, search with EXIT
const RACK = `
TYPE "Slot"
STRUCT
  id   : INT;
  load : REAL := 0.0;
  used : BOOL;
END_STRUCT
END_TYPE

DATA_BLOCK "Rack"
TITLE = storage rack
VERSION : 0.1
STRUCT
  cell : ARRAY[1..2, 1..3, 1..4] OF "Slot";
  hits : INT;
END_STRUCT;
BEGIN
  cell[1,2,3].id := 17;
  cell[2,1,4].id := 42;
  cell[2,3,2].id := 42;
END_DATA_BLOCK

FUNCTION_BLOCK "Finder"
VAR_INPUT target : INT; END_VAR
VAR_OUTPUT found : BOOL; x, y, z : INT; visited : DINT; END_VAR
VAR_TEMP i, j, k : INT; END_VAR
BEGIN
found := FALSE; x := 0; y := 0; z := 0; visited := 0;
FOR i := 1 TO 2 DO
  FOR j := 1 TO 3 DO
    FOR k := 1 TO 4 DO
      visited := visited + 1;
      IF "Rack".cell[i, j, k].id = target THEN
        found := TRUE; x := i; y := j; z := k;
        EXIT;
      END_IF;
    END_FOR;
    IF found THEN EXIT; END_IF;
  END_FOR;
  IF found THEN EXIT; END_IF;
END_FOR;
IF found THEN
  "Rack".cell[x, y, z].used := TRUE;
  "Rack".cell[x, y, z].load := "Rack".cell[x, y, z].load + 2.5;
  Rack.hits := Rack.hits + 1;
END_IF;
END_FUNCTION_BLOCK
`;
{
  const r = runScl(RACK, { block: 'Finder', scans: [{ target: 42 }, {}, { target: 17 }, { target: 99 }] });
  eq('rack found', r[0].found, true);
  eq('rack xyz', [r[0].x, r[0].y, r[0].z].join(','), '2,1,4');
  eq('rack visited', r[0].visited, 16);
  eq('rack used', r[0]['Rack.cell[2,1,4].used'], true);
  eq('rack load 2 scans', r[1]['Rack.cell[2,1,4].load'], 5);
  eq('rack hits', r[1]['Rack.hits'], 2);
  eq('rack 17', [r[2].x, r[2].y, r[2].z, r[2].visited].join(','), '1,2,3,7');
  eq('rack miss', r[3].found, false);
  eq('rack miss visited', r[3].visited, 24);
  eq('rack other 42 untouched', r[3]['Rack.cell[2,3,2].used'], false);
  eq('rack DB key count', Object.keys(r[0]).filter((k) => k.startsWith('Rack.')).length, 24 * 3 + 1);
}

// ------------------------------------------------------------------ 5. numerics
const NUMS = `
FUNCTION_BLOCK "Num"
VAR_INPUT a : INT; r : REAL; d : DINT; END_VAR
VAR_OUTPUT
  wrapI : INT; okAfter : BOOL; wrapD : DINT; negMin : INT;
  rti1, rti2, rti3, rti4 : INT; rnd, trc : DINT;
  m1, m2, dv, sl : INT;
  p1, p2, f, g : REAL; mixed : DINT; t : TIME; c1 : BOOL; wh : INT; w : WORD; nb : BYTE; k : INT;
END_VAR
BEGIN
OK := TRUE;
wrapI := a + 1;
okAfter := OK;
wrapD := d * 2;
negMin := -a - 1;
negMin := -negMin;
rti1 := REAL_TO_INT(2.5); rti2 := REAL_TO_INT(3.5); rti3 := REAL_TO_INT(-2.5); rti4 := REAL_TO_INT(r);
rnd := ROUND(-1.5); trc := TRUNC(-3.7);
m1 := -7 MOD 2; m2 := (a - 32767 - 7) MOD 3; dv := -7 / 2; sl := 7 DIV 2;
p1 := -2 ** 2; p2 := 2.0 ** 0.5;
f := 0.1 + 0.2;
g := d;
mixed := a + 40000;
t := T#1s + T#500ms * 2 - TIME#1.5S / 3;
c1 := NOT (a > 5) OR a = 32767;
wh := 0;
WHILE wh < 10 DO wh := wh + 3; IF wh = 6 THEN CONTINUE; END_IF; END_WHILE;
w := W#16#00F0 OR 16#000F;
nb := NOT B#16#0F;
k := a * -1;
END_FUNCTION_BLOCK
`;
{
  const [o] = runScl(NUMS, { block: 'Num', scans: [{ a: 32767, r: -0.5, d: 1500000000 }] });
  eq('INT wrap', o.wrapI, -32768);
  eq('OK after overflow', o.okAfter, false);
  eq('DINT wrap', o.wrapD, (1500000000 * 2) | 0);
  eq('-(-32768) wraps', o.negMin, -32768);
  eq('REAL_TO_INT 2.5', o.rti1, 2); eq('REAL_TO_INT 3.5', o.rti2, 4); eq('REAL_TO_INT -2.5', o.rti3, -2); eq('REAL_TO_INT -0.5', o.rti4, 0);
  eq('ROUND -1.5', o.rnd, -2); eq('TRUNC -3.7', o.trc, -3);
  eq('-7 MOD 2', o.m1, -1); eq('-7 MOD 3', o.m2, -1); eq('-7 / 2', o.dv, -3); eq('7 DIV 2', o.sl, 3);
  eq('-2**2', o.p1, -4); eq('2.0**0.5', o.p2, f(Math.SQRT2));
  eq('0.1+0.2 float32', o.f, f(f(0.1) + f(0.2)));
  eq('DINT->REAL implicit', o.g, f(1500000000));
  eq('INT + 40000 is DINT', o.mixed, 72767);
  eq('TIME arithmetic', o.t, 1500);
  eq('precedence NOT/=/OR', o.c1, true);
  eq('WHILE/CONTINUE', o.wh, 12);
  eq('WORD OR', o.w, 255); eq('NOT BYTE', o.nb, 0xf0);
  eq('a * -1 (signed constant)', o.k, -32767);
}

// ------------------------------------------------------------------ 6. local FB instance, elementary in/out copy-back
const INST = `
FUNCTION_BLOCK "Acc"
VAR_INPUT add : INT; END_VAR
VAR_IN_OUT total : INT; END_VAR
VAR_OUTPUT calls : INT; END_VAR
BEGIN calls := calls + 1; total := total + add; END_FUNCTION_BLOCK
FUNCTION_BLOCK "Main"
VAR_INPUT k : INT; END_VAR
VAR acc1 : "Acc"; sum : INT; n : INT; END_VAR
BEGIN acc1(add := k, total := sum); n := acc1.calls; END_FUNCTION_BLOCK
`;
{
  const r = runScl(INST, { block: 'Main', scans: [{ k: 5 }, { k: 7 }, {}] });
  eq('instance sums', r.map((x) => x.sum).join(','), '5,12,19');
  eq('instance calls', r[2].n, 3);
  eq('instance flattened', r[2]['acc1.calls'], 3);
}

// ------------------------------------------------------------------ 7. errors the manual demands
const wrap = (decl, body, extra = '') => `${extra}\nFUNCTION_BLOCK FB1\nVAR_INPUT a : INT; r : REAL; END_VAR\nVAR x : INT; arr : ARRAY[1..3] OF INT; END_VAR\n${decl}\nBEGIN\n${body}\nEND_FUNCTION_BLOCK`;
const run1 = (src, s = [{ a: 0 }]) => runScl(src, { block: 'FB1', scans: s });
throws('REAL to INT implicit', () => run1(wrap('', 'x := r;')), /implicit conversion/);
throws('a * -b', () => run1(wrap('', 'x := a * -a;')), /follow each other/);
throws('DINT_TO_INT range', () => run1(wrap('', 'x := DINT_TO_INT(INT_TO_DINT(a) + 40000);')), /UNDEFINED/);
throws('index range', () => run1(wrap('', 'x := arr[a];')), /UNDEFINED.*outside/);
throws('int div by 0', () => run1(wrap('', 'x := 5 / a;')), /UNDEFINED.*by zero/);
throws('VAR_TEMP init', () => run1(wrap('VAR_TEMP q : INT := 3; END_VAR', 'x := q;')), /cannot be initialised/);
throws('FC param missing', () => run1(wrap('', 'x := F(p := 1);', 'FUNCTION F : INT\nVAR_INPUT p, q : INT; END_VAR\nBEGIN F := p + q; END_FUNCTION')), /must be supplied/);
throws('FC value unassigned', () => run1(wrap('', 'x := F(p := 1);', 'FUNCTION F : INT\nVAR_INPUT p : INT; END_VAR\nBEGIN IF p > 5 THEN F := p; END_IF; END_FUNCTION')), /UNDEFINED.*without assigning/);
throws('MOD on REAL', () => run1(wrap('', 'r := r MOD 2.0;')), /ANY_INT/);
throws('arith on BOOL', () => run1(wrap('VAR b : BOOL; END_VAR', 'x := b + 1;')), /ANY_NUM/);
throws('INT const too big', () => run1(wrap('', 'x := 40000;')), /does not fit/);
throws('INT + 40000 into INT', () => run1(wrap('', 'x := a + 40000;')), /DINT to INT/);
throws('endless FOR', () => run1(wrap('', 'FOR x := 32760 TO 32767 DO arr[1] := 0; END_FOR;')), /loop iterations/);

// ------------------------------------------------------------------ 8. dialect odds and ends
const MISC = `
TYPE UDT5 STRUCT a : INT := 5; w : WORD := W#16#FFAA; p : WORD := B#(25,25); dd : DINT; END_STRUCT END_TYPE
DATA_BLOCK "D2" UDT5
BEGIN
  a := -4; dd := L#-70000;
END_DATA_BLOCK
FUNCTION Twice : DINT
VAR_INPUT v : DINT; END_VAR
BEGIN Twice := v * 2; END_FUNCTION
FUNCTION_BLOCK FB9
TITLE = 'misc'
VERSION : '1.0'
AUTHOR : Seif
KNOW_HOW_PROTECT
{ S7_m_c := 'true' }
VAR_INPUT n : INT; END_VAR
VAR_OUTPUT
  m : ARRAY[1..2, 1..2] OF REAL := [[1.5, 2.5], [3.5, 4.5]];
  #FOR : INT;
  tw : DINT; big : DINT; okBig : BOOL; cnt : INT; rep : INT; q : BOOL;
END_VAR
CONST LIM := 2 * 5 + 10 * 4; LOW := -3; END_CONST
BEGIN
#FOR := LIM;
tw := Twice(n);
OK := TRUE;
big := DINT#2000000000 * 2;
okBig := OK;
cnt := 0;
WHILE TRUE DO cnt := cnt + 1; IF cnt >= 4 THEN EXIT; END_IF; END_WHILE;
rep := 0;
REPEAT rep := rep + 1; IF rep = 2 THEN CONTINUE; END_IF; UNTIL rep >= 3 END_REPEAT;
CASE n OF LOW..-1: q := TRUE; ELSE q := FALSE; END_CASE;
m[2, 1] := m[2, 1] * 2;
END_FUNCTION_BLOCK
`;
{
  const r = runScl(MISC, { block: 'fb9', scans: [{ n: -2 }, { n: 7 }] });
  eq('#FOR escape + CONST folding', r[0].FOR, 50);
  eq('positional FC call', r[1].tw, 14);
  eq('DINT mul wrap', r[0].big, (4000000000) | 0); eq('DINT mul OK', r[0].okBig, false);
  eq('WHILE EXIT', r[0].cnt, 4); eq('REPEAT CONTINUE', r[0].rep, 3);
  eq('CASE const range', r[0].q, true); eq('CASE else', r[1].q, false);
  eq('nested bracket init + statics persist', r[1]['m[2,1]'], 14);
  eq('m[1,2]', r[0]['m[1,2]'], 2.5);
  eq('DB from UDT + BEGIN', r[0]['D2.a'], -4);
  eq('L# constant', r[0]['D2.dd'], -70000); eq('W# constant', r[0]['D2.w'], 0xffaa); eq('B#(25,25)', r[0]['D2.p'], 0x1919);
}
throws('too many init values', () => run1(wrap('VAR z : ARRAY[1..2] OF INT := 3(1); END_VAR', 'x := 0;')), /initial values/);
throws('list init', () => run1(wrap('VAR p, q : INT := 1; END_VAR', 'x := 0;')), /variable list/);

console.log(`${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
