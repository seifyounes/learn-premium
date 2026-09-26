// PROTOTYPE build step: renders machine-101.smcat (agent-written) to static SVGs once, in Node
// (state-machine-cat 12 + its graphviz WASM): left-right for wide screens, top-down for phones.
// The page only inlines an SVG and toggles classes, so no layout engine loads in the browser.
//   node candidates/fsm/build-smcat.mjs
import { readFileSync, writeFileSync } from "node:fs";
import smcat from "state-machine-cat";
const src = readFileSync(new URL("./machine-101.smcat", import.meta.url), "utf8");
for (const [suffix, direction] of [["lr", "left-right"], ["tb", "top-down"]]) {
  const svg = smcat.render(src, { outputType: "svg", direction, engine: "dot" });
  writeFileSync(new URL(`./smcat-highlight-${suffix}.svg`, import.meta.url), svg);
  console.log(`wrote smcat-highlight-${suffix}.svg (${svg.length} bytes)`);
}
