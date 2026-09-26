// PROTOTYPE gate: runs the pneumatic engine in Node against the answer key in circuit.md.
// node candidates/pneumatics/check-pad-native-pneumatic.mjs
import { CASCADE, NAIVE, Sim, runCycle, movements, conflicts, stepTable } from './pad-native-pneumatic.engine.mjs';

// Answer key (mirrors circuit.md "Expected cycle" and "Expected displacement-step diagram").
const KEY = {
  sequence: ['A+', 'B+', 'B-', 'A-'],
  steps: [ // step 1..5
    { A: 0, B: 0 }, { A: 1, B: 0 }, { A: 1, B: 1 }, { A: 1, B: 0 }, { A: 0, B: 0 },
  ],
  rest: { valves: { '1V1': '12', '2V1': '12', '0V1': '12' }, x: { A: 0, B: 0 } },
  groupDuring: { 'A+': 'I', 'B+': 'I', 'B-': 'II', 'A-': 'II' },
};

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. Rest state is self-consistent (nothing moves, nothing pending, no conflict).
{
  const sim = new Sim(CASCADE);
  check('rest: valves 1V1/2V1/0V1 on 12', same(sim.snapshot().valves, KEY.rest.valves), JSON.stringify(sim.snapshot().valves));
  check('rest: A and B retracted, still', sim.cyl.A.x === 0 && sim.cyl.B.x === 0 && sim.cyl.A.v === 0 && sim.cyl.B.v === 0);
  check('rest: idle until START', sim.nextEventTime() === Infinity);
  check('rest: line II live, line I dead', sim.pressure.II && !sim.pressure.I);
  check('rest: a0 and b0 made', sim.limits.a0 && sim.limits.b0 && !sim.limits.a1 && !sim.limits.b1);
}

// 2. One START tap runs A+ B+ B- A- once, without a signal conflict, and returns to rest.
const sim = runCycle(CASCADE);
const mv = movements(sim.trace);
check('sequence is A+ B+ B- A-', same(mv.map((m) => m.m), KEY.sequence), mv.map((m) => m.m).join(' '));
check('no signal conflict on any double-pilot valve', conflicts(sim.trace).length === 0, JSON.stringify(conflicts(sim.trace)));
const table = stepTable(sim.trace);
KEY.steps.forEach((row, i) => {
  const got = table[i] ?? {};
  check(`displacement-step diagram, step ${i + 1}: A=${row.A} B=${row.B}`, got.A === row.A && got.B === row.B, `got A=${got.A} B=${got.B}`);
});
check('exactly 5 step boundaries', table.length === 5, `got ${table.length}`);
check('back at rest: valves', same(sim.snapshot().valves, KEY.rest.valves), JSON.stringify(sim.snapshot().valves));
check('back at rest: A and B home and still', sim.cyl.A.x === 0 && sim.cyl.B.x === 0 && sim.cyl.A.v === 0 && sim.cyl.B.v === 0);
check('back at rest: idle', sim.nextEventTime() === Infinity);

// 3. Each movement happens with the right group line live.
{
  const s = new Sim(CASCADE);
  s.scheduleInput(0.2, 'START', true); s.scheduleInput(0.5, 'START', false);
  const seen = {};
  for (let g = 0; g < 500; g++) {
    const ev = s.step(30); if (!ev) break;
    for (const e of ev) if (e.kind === 'move') seen[e.cyl + e.dir] = s.pressure.I ? 'I' : s.pressure.II ? 'II' : '-';
  }
  for (const [m, grp] of Object.entries(KEY.groupDuring)) check(`${m} runs on group line ${grp}`, seen[m] === grp, `got ${seen[m]}`);
}

// 4. Holding START repeats the cycle; releasing stops it at rest.
{
  const s = new Sim(CASCADE);
  s.scheduleInput(0.2, 'START', true);
  s.scheduleInput(4.5, 'START', false); // released during cycle 2
  s.advanceTo(40);
  const m = movements(s.trace).map((x) => x.m).join(' ');
  check('START held: cycle repeats, then stops at rest', m === 'A+ B+ B- A- A+ B+ B- A-' && s.nextEventTime() === Infinity && s.cyl.A.x === 0, m);
}

// 5. The conflict check bites: the naive wiring must be caught.
{
  const n = runCycle(NAIVE, { tMax: 10 });
  const c = conflicts(n.trace);
  check('naive wiring is flagged (conflict detector works)', c.length > 0, c.map((x) => `${x.valve}@${x.t.toFixed(2)}s`).join(', '));
}

// 6. Cycle time is plausible and pistons stay in 0..1.
{
  const ts = sim.trace.map((r) => r.t);
  const inRange = sim.trace.every((r) => Object.values(r.snap.x).every((x) => x >= 0 && x <= 1));
  check('pistons stay within stroke', inRange);
  const dur = Math.max(...ts) - 0.2;
  check('cycle time = strokes + 6 spool shifts', Math.abs(dur - (1.0 + 0.9 + 0.7 + 0.8 + 6 * 0.04)) < 1e-6, `${dur.toFixed(3)} s`);
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
