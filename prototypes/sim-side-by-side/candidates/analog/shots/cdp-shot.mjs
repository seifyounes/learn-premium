// PROTOTYPE helper: full-resolution screenshots through headless Chrome + the DevTools protocol
// (Node's built-in WebSocket; no packages). Usage:
//   node cdp-shot.mjs <url> <out.png> <w> <h> [waitMs] [mobile 0|1] [js-before-shot] [fullPage 0|1]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, w = "1280", h = "800", wait = "8000", mobile = "0", js = "", full = "0"] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "lp-cdp-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pending = new Map(), logs = [], net = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  if (m.method === "Network.loadingFinished") net.push(m.params.encodedDataLength);
  if (m.method === "Network.loadingFailed") logs.push(`NETFAIL: ${m.params.errorText}`);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: mobile === "1" ? 2 : 1, mobile: mobile === "1" });
if (mobile === "1") await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url });
await sleep(+wait);
if (js) { const r = await send("Runtime.evaluate", { expression: js, awaitPromise: true }); logs.push("js -> " + JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text)); await sleep(2500); }
const metrics = await send("Runtime.evaluate", { expression: "JSON.stringify({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight})" });
let clip;
if (full === "1") { const m = JSON.parse(metrics.result.result.value); clip = { x: 0, y: 0, width: +w, height: m.sh, scale: 1 }; }
const shot = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(JSON.stringify({ out, transferredKB: Math.round(net.reduce((a, b) => a + b, 0) / 1024), requests: net.length, metrics: metrics.result.result.value, logs }, null, 1));
ws.close(); chrome.kill();
process.exit(0);
