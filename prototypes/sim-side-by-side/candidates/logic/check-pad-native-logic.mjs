// PROTOTYPE: runs the pad-native-logic engine in Node against the answer key in
// circuits/expected.json and prints PASS/FAIL per value.
//   node candidates/logic/check-pad-native-logic.mjs
import { readFileSync } from "node:fs";
import { settle, ideal, real, rowInputs } from "./pad-native-logic.engine.mjs";

const key = JSON.parse(readFileSync(new URL("../../circuits/expected.json", import.meta.url), "utf8")).logic;

// The key is written as Boolean text ("A xor B xor Cin", "A·B + Cin·(A xor B)"). Turn it into a
// JS bit expression (& binds tighter than ^, which binds tighter than |, as in Boolean algebra).
function compile(expr) {
  const js = expr.replace(/\bxor\b/g, "^").replace(/·/g, "&").replace(/\+/g, "|");
  if (!/^[\sABCin^&|()]+$/.test(js)) throw new Error("unexpected key text: " + expr);
  return new Function("A", "B", "Cin", `return (${js}) & 1;`);
}
const want = { S: compile(key.S), Cout: compile(key.Cout) };

let pass = 0, fail = 0;
const report = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

console.log(`Key: S = ${key.S};  Cout = ${key.Cout}\n`);
console.log("1) Ideal gates, settled value per row");
for (let r = 0; r < 8; r++) {
  const i = rowInputs(r), v = settle(i);
  for (const o of ["S", "Cout"]) {
    const e = want[o](i.A, i.B, i.Cin);
    report(v[o] === e, `A=${i.A} B=${i.B} Cin=${i.Cin}  ${o.padEnd(4)} = ${v[o]}  (key ${e})`);
  }
}

console.log("\n2) Ideal gates, every row reached from every other row (64 transitions)");
let idealBad = 0, idealGlitch = 0;
for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
  const run = ideal(rowInputs(a), rowInputs(b)), i = rowInputs(b);
  if (run.after.S !== want.S(i.A, i.B, i.Cin) || run.after.Cout !== want.Cout(i.A, i.B, i.Cin)) idealBad++;
  const seen = new Set();
  for (const e of run.events) { if (seen.has(e.net)) idealGlitch++; seen.add(e.net); }
}
report(idealBad === 0, `final S and Cout match the key on 64/64 transitions (${idealBad} wrong)`);
report(idealGlitch === 0, `no net changes twice under ideal gates (${idealGlitch} found)`);

console.log("\n3) Real devices (XOR 12 ns, AND 8 ns, OR 8 ns), every transition settles to the key");
let realBad = 0;
const glitchy = [];
for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
  const run = real(rowInputs(a), rowInputs(b)), i = rowInputs(b);
  if (run.after.S !== want.S(i.A, i.B, i.Cin) || run.after.Cout !== want.Cout(i.A, i.B, i.Cin)) realBad++;
  for (const g of run.glitches.filter(g => g.net === "S" || g.net === "Cout"))
    glitchy.push(`${a.toString(2).padStart(3, "0")} -> ${b.toString(2).padStart(3, "0")}: ${g.net} = ${g.value} from ${g.from} to ${g.to} ns`);
}
report(realBad === 0, `final S and Cout match the key on 64/64 transitions (${realBad} wrong)`);

// The known static-1 hazard: A falls with B = Cin = 1. G drops at 8 ns, T only rises at 20 ns,
// so Cout reads 0 from 16 ns to 28 ns before it settles back at 1.
const h = real({ A: 1, B: 1, Cin: 1 }, { A: 0, B: 1, Cin: 1 }).glitches.find(g => g.net === "Cout");
report(!!h && h.value === 0 && h.from === 16 && h.to === 28, `hazard 111 -> 011: Cout dips to 0 from 16 to 28 ns (${h ? `${h.from}..${h.to}` : "none"})`);

console.log(`\nOutput glitches under real devices (${glitchy.length} across 64 transitions, info only):`);
for (const g of glitchy) console.log("   " + g);

console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
