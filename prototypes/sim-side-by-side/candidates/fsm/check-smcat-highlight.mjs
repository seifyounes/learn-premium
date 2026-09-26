// PROTOTYPE gate for the smcat candidate: (1) the agent-written smcat source, parsed by
// state-machine-cat itself, has exactly the state table in expected.json; (2) the page's tiny engine
// clocks the test sequence to the expected states and Z.
//   node candidates/fsm/check-smcat-highlight.mjs
import { readFileSync } from "node:fs";
import smcat from "state-machine-cat";
import { init, next, z } from "./smcat-highlight.engine.mjs";
const key = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
const sc = smcat.render(readFileSync(new URL("./machine-101.smcat", import.meta.url), "utf8"), { outputType: "scjson" });
let pass = 0, fail = 0;
const check = (what, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${JSON.stringify(got)}${ok ? "" : `  expected ${JSON.stringify(want)}`}`); };
check("smcat initial state", sc.initial, "S0");
for (const [s, row] of Object.entries(key.stateTable)) {
  const st = sc.states.find((x) => x.id === s);
  for (const x of ["0", "1"]) check(`smcat ${s} on ${x}`, st.transitions.find((t) => t.event === x)?.target, row["X" + x]);
  check(`smcat ${s} output`, st.onentries[0], `Z = ${row.Z}`);
  check(`tiny engine ${s} Z`, z(s), row.Z);
}
let s = init; const per = [], zPer = [], after = [], zAfter = [];
for (const x of key.test.X) { per.push(s); zPer.push(z(s)); s = next(s, x); after.push(s); zAfter.push(z(s)); }
check("tiny engine: present state per period", per, key.test.presentStatePerPeriod);
check("tiny engine: Z per period", zPer, key.test.zPerPeriod);
check("tiny engine: state after each edge", after, key.test.stateAfterEachEdge);
check("tiny engine: Z after each edge", zAfter, key.test.zAfterEachEdge);
console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
