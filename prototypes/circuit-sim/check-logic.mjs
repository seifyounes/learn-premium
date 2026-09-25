// PROTOTYPE: exhaustive truth-table gate for an agent-authored DigitalJS circuit.
import { createRequire } from "node:module";
const { HeadlessCircuit } = createRequire(import.meta.url)("digitaljs");
import { Vector3vl } from "3vl";
import { readFileSync, writeFileSync } from "node:fs";

const json = JSON.parse(readFileSync(process.argv[2], "utf8"));
const c = new HeadlessCircuit(json);
const rows = [];
let fails = 0;
for (let n = 0; n < 8; n++) {
  const A = (n >> 2) & 1, B = (n >> 1) & 1, Cin = n & 1;
  c.setInput("A", Vector3vl.fromBool(!!A));
  c.setInput("B", Vector3vl.fromBool(!!B));
  c.setInput("Cin", Vector3vl.fromBool(!!Cin));
  for (let i = 0; i < 100 && c.hasPendingEvents; i++) c.updateGates();
  const S = c.getOutput("S").toBin(), Cout = c.getOutput("Cout").toBin();
  const eS = String(A ^ B ^ Cin), eC = String((A & B) | (Cin & (A ^ B)));
  const ok = S === eS && Cout === eC;
  if (!ok) fails++;
  rows.push({ A, B, Cin, S, Cout, eS, eC, ok });
}
console.table(rows);
console.log(fails ? `FAIL: ${fails}/8 rows wrong` : "PASS: 8/8 rows match the full-adder truth table");
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ rows, fails }));
