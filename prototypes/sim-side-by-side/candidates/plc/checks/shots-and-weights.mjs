// PROTOTYPE: first-load transfer size (fresh profile, cache off, every frame) and screenshots of the four
// PLC candidates at 1280x800 and 390x844 (touch emulated). Run from candidates/plc.
import { launch, sleep } from "./cdp.mjs";
import { writeFileSync } from "node:fs";
const base = "http://localhost:8724/candidates/plc/";
const pages = [
  ["pad-native-ladder", "?demo=7", 4000],
  ["plcsimulator-online", "", 12000],
  ["cdilga-lle", "", 7000],
  ["circuitjs-relay", "", 6000],
];
const out = {};
for (const [id, shotQuery, settle] of pages) {
  for (const [size, opts] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844, mobile: true }]]) {
    const b = await launch(opts);
    await b.goto(base + id + ".html", settle);
    const t = b.transfer();
    const lay = await b.eval(`({ sw: document.documentElement.scrollWidth, iw: innerWidth })`);
    if (shotQuery) { await b.goto(base + id + ".html" + shotQuery, settle); }
    await b.shot(`shots/${id}-${size}.png`);
    out[`${id}-${size}`] = { kb: t.kb, requests: t.requests, sideScroll: lay.sw > lay.iw, top: t.top };
    console.log(id, size, t.kb + " KB", t.requests + " req", lay.sw > lay.iw ? "SIDE-SCROLL" : "no side scroll");
    await b.close();
  }
}
writeFileSync("checks/weights.json", JSON.stringify(out, null, 1));
