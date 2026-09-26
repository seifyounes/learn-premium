// PROTOTYPE gate: runs the pad-native FSM engine in Node against the hand-written answer key
// (expected.json, from machine.md) and prints PASS/FAIL per value.
//   node candidates/fsm/check-pad-native-fsm.mjs
import { readFileSync } from "node:fs";
import { DETECTOR_101 } from "./machine-101.mjs";
import { createMachine, sopText, evalSOP } from "./pad-native-fsm.engine.mjs";

const key = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
const M = createMachine(DETECTOR_101); // throws if incomplete or non-deterministic
let pass = 0, fail = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${JSON.stringify(got)}${ok ? "" : `  expected ${JSON.stringify(want)}`}`);
};
console.log("PASS  machine is complete and deterministic (4 states x 2 inputs)"); pass++;

console.log("\n-- state table --");
for (const row of M.stateTable()) {
  const k = key.stateTable[row.state];
  check(`${row.state} next on X=0`, row.next["0"], k.X0);
  check(`${row.state} next on X=1`, row.next["1"], k.X1);
  check(`${row.state} Z`, row.out.Z, k.Z);
  check(`${row.state} code`, row.code, key.encoding[row.state]);
}

console.log("\n-- encoded table with D excitation --");
const enc = M.encodedTable();
for (const want of key.encodedTable) {
  const r = enc.find((e) => e.q.concat(e.x).join("") === want.Q1Q0X);
  check(`Q1Q0X=${want.Q1Q0X} -> Q1+Q0+`, r.qNext.join(""), want.next);
  check(`Q1Q0X=${want.Q1Q0X} -> D1D0`, `${r.excite.D1}${r.excite.D0}`, want.D1D0);
  check(`Q1Q0X=${want.Q1Q0X} -> Z`, r.out.Z, want.Z);
}

console.log("\n-- minimal excitation / output equations --");
const eq = M.equations();
for (const [name, text] of Object.entries(key.equations)) check(`${name} =`, sopText(eq[name].vars, eq[name].terms), text);
// the derived equations must reproduce the encoded table exactly
let eqOk = true;
for (const r of enc) {
  const v = r.q.concat(r.x);
  if (evalSOP(eq.D1.terms, v) !== r.excite.D1 || evalSOP(eq.D0.terms, v) !== r.excite.D0 || evalSOP(eq.Z.terms, r.q) !== r.out.Z) eqOk = false;
}
check("equations reproduce all 8 encoded rows", eqOk, true);

console.log("\n-- test sequence X = " + key.test.X.join(" ") + " --");
const tr = M.trace(key.test.X);
check("present state per period", tr.periods.map((p) => p.state), key.test.presentStatePerPeriod);
check("Z per period (Moore, lags one clock)", tr.periods.map((p) => p.out.Z), key.test.zPerPeriod);
check("state after each edge", tr.periods.map((p) => p.next), key.test.stateAfterEachEdge);
check("Z after each edge", tr.periods.map((p) => M.output(p.next).Z), key.test.zAfterEachEdge);

console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
