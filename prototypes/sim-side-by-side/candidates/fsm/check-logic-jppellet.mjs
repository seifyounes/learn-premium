// PROTOTYPE gate for the Logic (jppellet) candidate. Logic has no headless mode, so this drives the real
// page in headless Chrome over CDP: it sets X, pulses the CLK push button, and reads Q1 Q0 Z from the
// editor, then compares with expected.json. Needs the static server on :8724 and Chrome installed.
//   node candidates/fsm/check-logic-jppellet.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL_ = "http://localhost:8724/candidates/fsm/logic-jppellet.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 100);
const ch = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "lj-"))}`, "about:blank"], { stdio: "ignore" });
let tabs; for (let k = 0; k < 50; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Page.navigate", { url: URL_ });
await sleep(3000);
const drive = `(async () => {
  const le = document.getElementById("le");
  const C = Object.fromEntries([...le.components.all()].map((c) => [c.ref, c]));
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const set = async (c, b) => { c.setValue([!!b]); le.recalcMgr.recalcAndPropagateIfNeeded(); await w(400); };
  const bit = (c) => (c.value[0] === true ? 1 : c.value[0] === false ? 0 : "?");
  const read = () => ({ s: "S" + (bit(C.out0) * 2 + bit(C.out1)), z: bit(C.out2) });
  await set(C.in1, 0); await set(C.in2, 1); await set(C.in2, 0);
  const per = [], after = [];
  for (const x of ${JSON.stringify(key.test.X)}) {
    await set(C.in0, x); per.push(read());
    await set(C.in1, 1); after.push(read()); await set(C.in1, 0);
  }
  return { per, after };
})()`;
const res = (await send("Runtime.evaluate", { expression: drive, awaitPromise: true, returnByValue: true })).result.value;
ws.close(); ch.kill();

let pass = 0, fail = 0;
const check = (what, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}: ${JSON.stringify(got)}${ok ? "" : `  expected ${JSON.stringify(want)}`}`); };
check("present state per period (Q1 Q0)", res.per.map((r) => r.s), key.test.presentStatePerPeriod);
check("Z per period", res.per.map((r) => r.z), key.test.zPerPeriod);
check("state after each edge", res.after.map((r) => r.s), key.test.stateAfterEachEdge);
check("Z after each edge", res.after.map((r) => r.z), key.test.zAfterEachEdge);
console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
