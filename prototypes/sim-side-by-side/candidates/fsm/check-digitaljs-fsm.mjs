// PROTOTYPE gate: runs the DigitalJS FSM circuit (digitaljs-fsm.json) headless in Node and clocks the
// test sequence from expected.json through it. For a controllable clock the Clock device is swapped for
// a Button in this check only; the FSM cell (the thing under test) is unchanged.
//   node candidates/fsm/check-digitaljs-fsm.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { HeadlessCircuit } = require("digitaljs");
const { Vector3vl } = require("3vl");

const key = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
const json = JSON.parse(readFileSync(new URL("./digitaljs-fsm.json", import.meta.url), "utf8"));
json.devices.clk = { type: "Button", label: "CLK", net: "CLK" };
const c = new HeadlessCircuit(json);
const settle = () => { for (let i = 0; i < 200 && c.hasPendingEvents; i++) c.updateGates(); };
const cell = c._graph.getCell("fsm");
const set = (net, v) => { c.setInput(net, Vector3vl.fromBool(!!v)); settle(); };
let pass = 0, fail = 0;
const check = (what, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${JSON.stringify(got)}${ok ? "" : `  expected ${JSON.stringify(want)}`}`); };

set("rst", 1); set("rst", 0); set("clk", 0);
const statePer = [], zPer = [], stateAfter = [], zAfter = [];
for (const x of key.test.X) {
  set("x", x);
  statePer.push("S" + cell.get("current_state")); zPer.push(Number(c.getOutput("z").toBin()));
  set("clk", 1); // rising edge
  stateAfter.push("S" + cell.get("current_state")); zAfter.push(Number(c.getOutput("z").toBin()));
  set("clk", 0);
}
check("present state per period", statePer, key.test.presentStatePerPeriod);
check("Z per period", zPer, key.test.zPerPeriod);
check("state after each edge", stateAfter, key.test.stateAfterEachEdge);
check("Z after each edge", zAfter, key.test.zAfterEachEdge);
// every row of the state table, from each state
for (const [s, row] of Object.entries(key.stateTable)) {
  for (const x of [0, 1]) {
    cell.set("current_state", Number(s[1])); settle(); set("x", x);
    const zNow = Number(c.getOutput("z").toBin());
    set("clk", 1); const nxt = "S" + cell.get("current_state"); set("clk", 0);
    check(`${s} on X=${x} -> next`, nxt, row["X" + x]);
    check(`${s} on X=${x} -> Z`, zNow, row.Z);
  }
}
console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
