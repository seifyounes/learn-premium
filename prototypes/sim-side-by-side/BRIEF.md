# PROTOTYPE brief: which simulators look and feel best, side by side?

Throwaway. For the wayfinder ticket
[Which simulators look and feel best, side by side?](https://github.com/seifyounes/learn-premium/issues/24)
on the map *learn-premium v2*. Seif (the Owner) will flip through every candidate on a laptop and a phone
and pick one student-facing tool per area **by look and feel**. His criteria, in his words: the most
delightful, easiest, best-looking tool that helps students, **and** it must be accurate. Accuracy
at build time is already settled (hidden ngspice netlist gate for analog, truth-table / trace gates
for the rest); this page is about feel, but no candidate may show a wrong number.

Background reading (skim, don't copy):
- Design identity, *the Computation Pad*: `D:\Claude Os\crash course skill\DESIGN.md` (main checkout,
  branch design/visual-identity). Tokens and roles are already in `shared/pad.css`.
- Automation tools research: `D:\Claude Os\crash course skill\.claude\worktrees\agent-aad7f7dfbcc128708\docs\research\automation-tools.md`.
- Circuit simulator research + the circuit prototype: `D:\Claude Os\crash course skill\.claude\worktrees\circuit-sim\prototypes\circuit-sim\`
  (README.md, fixtures/circuit-simulators-research.md, index.html shows how CircuitJS, DigitalJS and
  ngspice-WASM were driven). The four tested circuits are copied into `circuits/` here, answer keys in
  `circuits/expected.json`.

## Where things live

Root: `D:\Claude Os\crash course skill\.claude\worktrees\sim-side-by-side\prototypes\sim-side-by-side\`

- `shared/pad.css`: the pad frame (tokens, `.sheet`, `.grid-paper`, `.title-block`, `.label`, `.btn`,
  `.seg`, `.readout`, `.answer`, `.honesty`). Read-only for you; put extra CSS in your own files.
- `circuits/`: buck, SCR, CE amp netlists + CircuitJS texts, full-adder DigitalJS JSON + CircuitJS text.
- `node_modules/` (root, already installed): digitaljs 0.14.2 (`dist/main.js`), eecircuit-engine 1.8.0
  (ngspice-47 WASM, `dist/eecircuit-engine.mjs`), jsxgraph 1.13.3, plotly.js-dist-min 3.7.0,
  state-machine-cat 12. **Do not run npm at the root or edit the root package.json.** If you need
  another package, give your area folder its own package.json + node_modules, or load it from
  cdn.jsdelivr.net / cdnjs.
- `vendor/circuitjs/circuitjs.html`: a self-hosted copy of the current CircuitJS build (same origin, so
  `iframe.contentWindow.CircuitJS1` works: setSimRunning, getTime, getNodeVoltage, setExtVoltage,
  getElements, getCircuitAsSVG, exportCircuit, importCircuit). Query params as on falstad.com
  (e.g. `whiteBackground=true`, `hideSidebar=true`, `hideMenu=true`, `editable=false`, `running=true`,
  `cct=<text>`; check which ones this build honours). A missing service-worker.js 404 is harmless.
- `vendor/` is gitignored: put any other third-party build you fetch under `vendor/<name>/`.
- **Your area folder `candidates/<area>/` is the only place you write** (plus `vendor/<name>/`).
  Other builders are working in the other area folders at the same time. Never touch `shared/`,
  `index.html`, `circuits/`, or another area. **No git commands that change state** (no commit,
  checkout, stash, reset).

## What to build

One standalone HTML page per candidate: `candidates/<area>/<id>.html`. The shell (`index.html`, built
separately) shows them one at a time in an iframe, or two side by side on a laptop, and each page
must also work opened directly (a phone will open it directly).

Every page:
- `<html lang="en" data-pad="<pad>">`, links `../../shared/pad.css`, `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- Body is the desk; content sits in `<main class="sheet grid-paper">`.
- Opens with a `.title-block`: cells TOOL (the candidate's name), CIRCUIT (the circuit shown, with a
  picker if the area has several), KIND (`Ready-made`, `Ready-made, re-skinned` or `Agent-built`),
  each value under its `.label`.
- Then the live simulation, as large as it can usefully be, with controls a student would actually use.
- Ends with a hatched `.honesty` cell headed "For the Owner": what is real vs faked in this prototype,
  what the first load weighs (measure it: transfer size from the network log), whether touch works,
  and anything that would need work to ship.
- Works at 390×844 (touch, no sideways page scroll, targets ≥ 44px, nothing under 12px) and at 1280×800.
- Light only. No rounded corners, pills, glows or card shadows inside the sheet (see DESIGN.md Don'ts).

**Ready-made candidates** (someone else's tool): embed it as it really is, inside the pad frame, so
Seif feels the actual tool. Load the same circuit/program in it. Don't re-skin unless the candidate
says so.

**Agent-built candidates** (we write the engine + view): these are where delight is won or lost, so
they get real design effort. **Call the Skill tool for `impeccable` (design) and `animations`
(motion) before building them**, and follow DESIGN.md: pad inks (pencil lines, graphite symbols,
print for printed chrome, red pen only as marks), condensed Archivo labels, Atkinson Mono quantities,
motion as the pen (strokes draw, values land in order, transform/opacity/stroke only, instant under
reduced motion). Meaning colours inside a simulator (voltage, pressure, energised, active state) are
allowed and should be clear, calm and consistent. Touch-first. The engine must be real, not
animation faked to look right: keep engine and view separate (`<id>.engine.mjs` importable in Node),
and add `candidates/<area>/check-<id>.mjs` that runs the engine in Node against the answer key and
prints PASS/FAIL per value. Run it and make it pass.

## Verifying

A static server is already running: `http://localhost:8724/` serves the root above (don't start
another on 8724). Use the Browser pane tools in **your own tab** (`tabs_create`, then pass its tabId
to every call; never act on another tab, other builders share the pane). Check each page at desktop
size and with `resize_window` preset `mobile` on your tab (reset to `desktop` when done), read the
console for errors, and take one screenshot per candidate at each size. Measure first-load weight
from `read_network_requests`.

## Hand back

1. `candidates/<area>/manifest.json`:
   ```json
   { "area": "<area>", "title": "<Area title>", "pad": "<pad>", "circuit": "<what circuit every candidate shows>",
     "candidates": [ { "id": "...", "name": "...", "file": "<id>.html", "kind": "Ready-made|Ready-made, re-skinned|Agent-built",
       "oneLine": "<what it is, ≤ 15 words>", "loadKB": 0, "touch": "works|partial|no",
       "accuracy": "<what was checked against what, or 'not checked' with why>", "caveats": "<≤ 25 words>" } ] }
   ```
   Order candidates as listed in your task.
2. A final message of at most 300 words: per candidate, one line on how it looks and feels (your
   honest read, not a sales pitch), its accuracy status, load weight, touch status; then anything
   you could not do. Screenshots paths if you saved any under `candidates/<area>/shots/`.
