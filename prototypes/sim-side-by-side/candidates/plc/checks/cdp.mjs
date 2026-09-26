// PROTOTYPE helper: drive headless Chrome over the DevTools protocol (Node 22+, no dependencies).
// Used for first-load transfer size (all frames, cross-origin included) and real-browser checks.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800, mobile = false } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = mkdtempSync(join(tmpdir(), "plc-cdp-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    "--no-first-run", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  let ver;
  for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  // network accounting over the page and every child frame/worker session
  const bytes = new Map(); const urls = new Map();
  const sessions = new Set([sessionId]);
  listeners.push(async (msg) => {
    if (msg.method === "Target.attachedToTarget") {
      const sid = msg.params.sessionId; sessions.add(sid);
      await send("Network.enable", {}, sid).catch(() => {});
      await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
      await send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => {});
    }
    if (msg.method === "Network.requestWillBeSent") urls.set(msg.sessionId + msg.params.requestId, msg.params.request.url);
    if (msg.method === "Network.loadingFinished") bytes.set(msg.sessionId + msg.params.requestId, msg.params.encodedDataLength);
  });
  await S("Network.enable");
  await S("Network.setCacheDisabled", { cacheDisabled: true });
  await S("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await S("Page.enable");
  await S("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const api = {
    send: S,
    async goto(url, settleMs = 6000) { bytes.clear(); urls.clear(); await S("Page.navigate", { url }); await sleep(settleMs); },
    transfer() {
      let total = 0; const rows = [];
      for (const [k, b] of bytes) { total += b; rows.push([b, urls.get(k) || k]); }
      rows.sort((a, b) => b[0] - a[0]);
      return { kb: Math.round(total / 1024), requests: bytes.size, top: rows.slice(0, 8).map(([b, u]) => `${Math.round(b / 1024)} KB ${u.slice(0, 110)}`) };
    },
    async eval(expression) {
      const r = await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(path, full = false) {
      const r = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    async press(x, y, holdMs = 300) {
      await S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await sleep(holdMs);
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return api;
}
