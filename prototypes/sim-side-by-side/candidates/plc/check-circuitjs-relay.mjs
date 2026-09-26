// PROTOTYPE: drives the CircuitJS relay circuit in headless Chrome like a student (mouse press on the
// START / STOP push switches) and records, on every circuit time step (CircuitJS1.ontimestep), when the
// K1 coil current, lamp M1 and lamp M2 switch. Times below are circuit (simulated) seconds.
// Run from candidates/plc: node check-circuitjs-relay.mjs   (static server on :8724 must be running)
import { launch, sleep } from "./checks/cdp.mjs";

const b = await launch({ width: 1280, height: 800 });
await b.goto("http://localhost:8724/candidates/plc/circuitjs-relay.html", 4000);
const C = "document.getElementById('cjs').contentWindow.CircuitJS1";
for (let i = 0; i < 60 && !(await b.eval(`!!(${C}) && ${C}.getElements().length > 30 && ${C}.getTime() > 0.3`)); i++) await sleep(250);
// recorder: edges of |V(K1 coil)| > 12 V, I(M1 lamp) > 50 mA, I(M2 lamp) > 50 mA
await b.eval(`(()=>{const c=${C}; const E=c.getElements(); const K1=E.filter(e=>e.getType()==='RelayCoilElm')[0]; const L=E.filter(e=>e.getType()==='LampElm');
  const w=document.getElementById('cjs').contentWindow; w.__edges=[]; let prev={};
  c.ontimestep=()=>{const s={K1:Math.abs(K1.getVoltageDiff())>12, M1:Math.abs(L[0].getCurrent())>0.05, M2:Math.abs(L[1].getCurrent())>0.05};
    for(const k in s) if(prev[k]!==s[k]){ w.__edges.push([k,s[k],c.getTime()]); } prev=s;}; return true})()`);
const START = [480, 282], STOP = [357, 282];      // screen positions of the two push switches at 1280x800 (see shots/)
const edges = () => b.eval(`document.getElementById('cjs').contentWindow.__edges`);
const tm = () => b.eval(`${C}.getTime()`);
const w0 = Date.now(), t0 = await tm();
await b.press(...START, 250);                     // press and release START
await sleep(7500);
await b.shot("shots/circuitjs-relay-desktop.png");   // both lamps lit
await b.press(...STOP, 250);                      // press and release STOP
await sleep(1500);
const rate = ((await tm()) - t0) / ((Date.now() - w0) / 1000);
const E = (await edges()).filter((e) => e[2] > t0);
const first = (k, v, after = 0) => E.find((e) => e[0] === k && e[1] === v && e[2] >= after)?.[2];
const k1On = first("K1", true), m1On = first("M1", true), m2On = first("M2", true);
const k1Off = first("K1", false, m2On ?? 0), m1Off = first("M1", false, m2On ?? 0), m2Off = first("M2", false, m2On ?? 0);
const lastState = (k) => { const l = E.filter((e) => e[0] === k).pop(); return l ? l[1] : false; };
const rows = []; let fails = 0;
const check = (name, ok, detail) => { rows.push(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`); if (!ok) fails++; };
const f = (x) => (x === undefined ? "never" : x.toFixed(3) + " s");
check("START: M1 on at once", m1On !== undefined && m1On - k1On < 0.05, `K1 energised at ${f(k1On)}, M1 lit at ${f(m1On)}`);
check("seal-in holds after START released", m1Off === undefined || m1Off > m2On, `M1 stayed lit until STOP (off at ${f(m1Off)})`);
check("M2 on 5 s after M1", m2On !== undefined && Math.abs(m2On - m1On - 5) <= 0.02, `M2 lit at ${f(m2On)}, ${m2On === undefined ? "-" : (m2On - m1On).toFixed(3)} s after M1`);
check("STOP: both drop together", m1Off !== undefined && m2Off !== undefined && Math.abs(m2Off - m1Off) <= 0.02, `K1 off ${f(k1Off)}, M1 off ${f(m1Off)}, M2 off ${f(m2Off)}`);
check("after STOP released: stays off", !lastState("M1") && !lastState("M2"), `M1 ${+lastState("M1")}, M2 ${+lastState("M2")} at the end`);
rows.push(`(circuit time ran at ${rate.toFixed(2)}x wall time in headless Chrome)`);
await b.close();
console.log(rows.join("\n") + `\n\n${5 - fails}/5 PASS`);
process.exit(fails ? 1 : 0);
