// PROTOTYPE: replays program.json's expected timeline through the real scan engine in Node.
// Run: node candidates/plc/check-pad-native-ladder.mjs
import { readFileSync } from "node:fs";
import { replay } from "./pad-native-ladder.engine.mjs";

const program = JSON.parse(readFileSync(new URL("./program.json", import.meta.url), "utf8"));
const rows = replay(program);
const fmt = (n, v) => (n.endsWith(".ET") ? (v / 1000).toFixed(2) + " s" : v ? "1" : "0");
let fails = 0;
for (const r of rows) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  t=${(r.t / 1000).toFixed(2).padStart(5)} s  ${r.name.padEnd(5)} want ${fmt(r.name, r.want).padEnd(6)} got ${fmt(r.name, r.got).padEnd(6)} ${r.note}`);
}
console.log(`\n${rows.length - fails}/${rows.length} values PASS${fails ? `, ${fails} FAIL` : ""}`);
process.exit(fails ? 1 : 0);
