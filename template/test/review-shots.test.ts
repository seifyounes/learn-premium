// The fresh reviewer's screenshots (`npm run gates -- shots`): a Module page at phone and laptop
// width, every collapsible open, once per tab view, on a tiny static build.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { takeShots } from "../gates/shots.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A Module page whose folded section is 2000px tall, and a Table | Plot tab list. */
function tinyBuild(): string {
  const dist = mkdtempSync(join(tmpdir(), "lp-shots-"));
  mkdirSync(join(dist, "01-m01"));
  writeFileSync(
    join(dist, "01-m01", "index.html"),
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}</style></head><body>
<h1>Conduction</h1>
<details><summary>Worked example</summary><div style="height:2000px">steps</div></details>
<div role="tablist">
  <button role="tab" aria-selected="true" onclick="show('table')">Table</button>
  <button role="tab" aria-selected="false" onclick="show('plot')">Plot</button>
</div>
<div id="table">table</div><div id="plot" hidden>plot</div>
<script>function show(id){for(const p of ["table","plot"])document.getElementById(p).hidden=p!==id;
for(const t of document.querySelectorAll('[role=tab]'))t.setAttribute('aria-selected',String(t.textContent.toLowerCase()===id));}</script>
</body></html>`,
  );
  return dist;
}

/** A PNG's width and height, read from its IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("the fresh reviewer's screenshots", () => {
  it("shoots the Module page at phone and laptop width with every section open, once per tab view, and names the commit", async () => {
    const out = mkdtempSync(join(tmpdir(), "lp-shots-out-"));

    const manifest = await takeShots({ distDir: tinyBuild(), module: "01-m01", out, commit: COMMIT });

    expect(manifest).toMatchObject({ shots: "learn-premium review shots v1", module: "01-m01", commit: COMMIT });
    expect(manifest.files.map((f) => [f.device, f.width, f.view, f.file])).toEqual([
      ["phone", 375, 1, "phone.png"],
      ["phone", 375, 2, "phone-view2.png"],
      ["laptop", 1280, 1, "laptop.png"],
      ["laptop", 1280, 2, "laptop-view2.png"],
    ]);
    expect(JSON.parse(readFileSync(join(out, "shots.json"), "utf8"))).toEqual(manifest);
    const phone = pngSize(join(out, "phone.png"));
    expect(phone.width).toBe(375);
    // The folded section is open: the whole page, 2000px of it, is in the shot.
    expect(phone.height).toBeGreaterThan(2000);
    expect(pngSize(join(out, "laptop.png")).width).toBe(1280);
  });

  it("refuses a Module page that isn't in the build", async () => {
    const out = mkdtempSync(join(tmpdir(), "lp-shots-out-"));

    await expect(takeShots({ distDir: tinyBuild(), module: "02-m02", out, commit: COMMIT })).rejects.toThrow(
      /02-m02.*404/,
    );
  });
});
