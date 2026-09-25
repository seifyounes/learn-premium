# Circuit simulators a Study site can embed

Research for [issue #6](https://github.com/seifyounes/learn-premium/issues/6), map
[#1](https://github.com/seifyounes/learn-premium/issues/1). Written 2026-09-25.

**Question.** Which analog, digital/logic and power-electronics simulators can run inside a Study
site page? For each one: how it embeds, whether it works offline or self-hosted, its licence,
whether an agent can write circuits as text from a lecture figure (and how reliably), what the
student can interact with, whether the page can drive it from JavaScript, and how accurate it is
for power-electronics switching and op-amps, BJTs and MOSFETs.

**Method.** Primary sources only: official docs, source repos, licence files and npm metadata.
For the text formats I read the parser or serializer source rather than trusting the docs. Where
something is my own inference, or I did not test it, the text says so. This note contains no
decisions (see the last section).

---

## At a glance

| Tool | Domain | Embed | Self-host / offline | Licence | Agent writes circuits as text | Page → sim JS API | Power-electronics / device fidelity |
|---|---|---|---|---|---|---|---|
| **Falstad CircuitJS1** | Analog + digital + power, animated | iframe + URL params | Yes: static files; Electron desktop builds; new TS/Vite port | GPL-2.0-or-later | Yes: XML or line format. Wires join where coordinates match, so the agent has to lay the circuit out | Yes (same-origin): run/stop, read voltages/currents, drive "external voltage" sources, import/export whole circuit | Teaching-grade: square-law MOSFET, BJT with junction caps, LM741/LM324 subcircuits, SCR/triac; buck/boost/rectifier examples ship with it |
| **ngspice in WASM** (`eecircuit-engine`) | Analog + power, batch SPICE | Library (no UI) | Yes: one npm package (~20 MB module) | MIT wrapper; ngspice Modified-BSD with listed exceptions | Yes: plain SPICE netlist (node names, no layout), the most natural text for an agent | Yes: `setNetList` / `runSim` return arrays; the site builds its own UI | Highest here: real SPICE models (VDMOS power MOSFET, `.model` cards); XSPICE is disabled in this build |
| **EEcircuit app** | Same engine + schematic UI | Hosted at eecircuit.com only | UI can't be built from public source (private dependency) | MIT | n/a for embedding | none documented | as above |
| **DigitalJS** | Digital / RTL | npm lib or bundle, draws into a `div` | Yes: fully client-side | BSD-2 (deps MPL-2.0, EPL-2.0) | Yes: topology-only JSON, auto-laid-out, **or** Verilog → Yosys → JSON at build time | Yes: `setInput`/`getOutput`/`monitor`, waveform view; headless in Node | n/a (digital) |
| **Logic (jppellet)** | Digital, gate level | Web component `<logic-editor>` with inline JSON5 | Yes: one JS bundle | MIT | Yes: JSON (components with `pos`, wires as pin-id pairs) | Some: `loadCircuitOrLibrary`, `setMode`, `highlight` | n/a (digital) |
| **CircuitVerse** | Digital | iframe of a saved project on circuitverse.org | Vue frontend builds standalone, but it loads circuits and compiles Verilog through a backend API | MIT | JSON save format carries layout and node indices; Verilog import needs the server | none documented for embeds | n/a (digital) |
| **Wokwi** | Microcontrollers + digital | Iframe embed is "experimental", not officially supported | No (hosted, closed simulator) | Closed; free personal, paid commercial | `diagram.json` (parts + pin connections) | experimental | Analog is "very basic": resistors are ignored next to analog parts |
| **EveryCircuit** | Analog + digital, animated | `everycircuit.com/embed/<id>` | No (hosted) | Proprietary subscription | No documented text format | none documented | Has MOSFET/BJT/op-amp, but the model is undocumented |

---

## 1. Falstad CircuitJS1

**Project status.** The active repo is
[pfalstad/circuitjs1](https://github.com/pfalstad/circuitjs1). It is GPL-2.0 per the GitHub API,
and the [README licence section](https://github.com/pfalstad/circuitjs1/blob/master/README.md#license)
says "version 2 … or (at your option) any later version". Development is active (last push
2026-09-24; release `4.1.5.1js` on 2026-09-11). falstad.com/circuit points to this repo for
"Latest changes" ([falstad.com/circuit](https://www.falstad.com/circuit/)). The older
[sharpie7/circuitjs1](https://github.com/sharpie7/circuitjs1) fork was last pushed in January 2024.

### Embed and offline

- **iframe + query parameters.** The README documents `?cct=` (circuit text), `?ctz=` (LZ-compressed
  text), `?startCircuit=`, `?startCircuitLink=` (CORS URL), `running`, `hideSidebar`, `hideMenu`,
  `editable=false`, `whiteBackground`, colour overrides, `euroResistors`/`IECGates` and
  `hideInfoBox` ([README § Embedding](https://github.com/pfalstad/circuitjs1/blob/master/README.md#embedding)).
  The `ctz` value is decoded with `LZString.decompressFromEncodedURIComponent`
  ([CirSim.java L139, L190-192](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/CirSim.java#L139)).
- **Self-hosting.** Copy the compiled `war` directory (minus `WEB-INF`) to any web server
  ([README § Deployment](https://github.com/pfalstad/circuitjs1/blob/master/README.md#deployment-of-the-web-application)).
  The JS-interface docs say to put the contents of the offline build's `resources/app/war`
  directory on your site ([js-interface.html](https://github.com/pfalstad/circuitjs1/blob/master/war/doc/js-interface.html)).
  Offline desktop builds for Windows, macOS and Linux (about 100 MB each, Electron) are dated
  11-Sep-2026 ([falstad.com/circuit/offline](https://www.falstad.com/circuit/offline/)).
- **New TypeScript port (days old).** The `dev-ts` branch rewrites the app in TypeScript with a
  Vite build ([ts/](https://github.com/pfalstad/circuitjs1/tree/dev-ts/ts), `vite.config.ts`,
  `service-worker.template.js`). On 2026-09-23 the GitHub Pages deployment moved to it: "GitHub
  Pages deployment has moved to the dev-ts branch (TypeScript rewrite)"
  ([commit 690cca3b](https://github.com/pfalstad/circuitjs1/commit/690cca3b)). The live
  [pfalstad.github.io/circuitjs1/circuitjs.html](https://pfalstad.github.io/circuitjs1/circuitjs.html)
  now loads Vite ES-module chunks. So the app no longer needs a Java/GWT toolchain to build. Note:
  `ts/package.json` says `"license": "ISC"` ([ts/package.json](https://github.com/pfalstad/circuitjs1/blob/dev-ts/ts/package.json)),
  but the source file headers still carry GPL notices
  ([ts/JSInterface.ts](https://github.com/pfalstad/circuitjs1/blob/dev-ts/ts/JSInterface.ts)).
  Treat it as GPL.
- **Untested (needs a prototype):** whether an iframe'd CircuitJS plus the JS API works from
  `file://`. The API needs same-origin access, and the TS build uses ES modules. Both are usually
  restricted on `file://`. v1's "offline single-file" model may not carry over as-is.

### JS API (page drives the simulator)

The API works only when the host page and the simulator share an origin: "the simulator and the
controlling JavaScript page must be served from the same origin"
([js-interface.html](https://github.com/pfalstad/circuitjs1/blob/master/war/doc/js-interface.html)).
It is exposed as `window.CircuitJS1` inside the iframe
([JSInterface.java L55-76](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/JSInterface.java#L55-L76)):

- `setSimRunning`, `isRunning`, `getTime`, `getTimeStep`, `getMaxTimeStep`, `setMaxTimeStep`
- `getNodeVoltage(label)`, which reads a *labeled node*
- `setExtVoltage(name, v)`, which drives an "External Voltage" source element from JS
- `getElements()`, `exportCircuit()`, `importCircuit(text, subcircuitsOnly)`, `getCircuitAsSVG()`
- hooks: `onupdate` (~60 Hz), `ontimestep`, `onanalyze`, `onsvgrendered`, plus
  `window.oncircuitjsloaded`.

Element objects are **read-only**: `getType`, `getInfo`, `getVoltageDiff`, `getVoltage(n)`,
`getCurrent`, `getLabelName`, `getPostCount`
([CircuitElm.java L1447-1456](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/CircuitElm.java#L1447-L1456)).
There is **no call to change a component value or a slider directly**. A walkthrough step can do
one of two things:

1. model the parameter as an External Voltage source and call `setExtVoltage`, or
2. rewrite the circuit text and call `importCircuit`, which resets the simulation state.

I found no `postMessage` handling in `CirSim.java`. The TS port has the same API
([ts/JSInterface.ts L64-78](https://github.com/pfalstad/circuitjs1/blob/dev-ts/ts/JSInterface.ts#L64-L78)).
A WebSocket shim for remote control also exists
([websocket/README.md](https://github.com/pfalstad/circuitjs1/blob/dev/websocket/README.md)).

### Text authoring (verified in the parser source)

There are two formats, and both parsers are in the current code:

1. **Legacy line format.** One element per line: `type x1 y1 x2 y2 flags params…`. `$` holds
   options, `o` a scope, `38` a slider ("Adjustable"), `34`/`32` diode/transistor models, and `.`
   subcircuits ([CircuitLoader.java L142-205](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/CircuitLoader.java#L142-L205)).
   Example: [fullrect.txt](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/public/circuits/fullrect.txt).
2. **XML format** (added February 2025, [commit 7885e6de](https://github.com/pfalstad/circuitjs1/commit/7885e6de)).
   The loader switches on `text.startsWith("<")`
   ([CircuitLoader.java L73-79](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/CircuitLoader.java#L73-L79)).
   Attributes are named, e.g. `<v x="208 240 208 176" wf="2" fr="1000" dutyCycle="0.72"/>`.
   Sliders are `<adj e="2" … en="Duty Cycle" mn="0" mx="100"/>` and scopes are `<o>`
   ([conv-buck.txt](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/public/circuits/conv-buck.txt),
   [XMLDeserializer.java](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/XMLDeserializer.java)).
   The TS port writes XML on export and still reads both formats
   ([ts/CirSim.ts `dumpCircuit`](https://github.com/pfalstad/circuitjs1/blob/dev-ts/ts/CirSim.ts),
   [ts/CircuitLoader.ts L98-103](https://github.com/pfalstad/circuitjs1/blob/dev-ts/ts/CircuitLoader.ts#L98-L103)).

**How reliable is agent authoring?** Every element carries endpoint coordinates (`x="x1 y1 x2 y2"`),
and nodes join only where endpoints coincide. So the agent must produce a consistent grid layout,
not just a topology. That is the main risk of error (my inference from the format). Two things
help:

- **Labeled nodes** (dump type 207) join every node that shares a label: "all nodes with the same
  label are connected"
  ([LabeledNodeElm.java L105-124](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/LabeledNodeElm.java#L105-L124)).
  An agent can connect by name instead of by exact wiring.
- A bad line is skipped and logged ("unrecognized dump type", "exception while undumping"). It
  does not abort the load
  ([CircuitLoader.java L200-213](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/CircuitLoader.java#L200-L213)).
  That means a silently broken circuit can still render, so a check gate is needed.

A `spiceimport` branch (SPICE netlist → CircuitJS) exists, but it is 1342 commits behind `master`
and was last touched in 2022 (GitHub compare API). It is not usable as-is.

### Interactivity

This is the richest student-facing interactivity of any tool here: animated current dots and
voltage colours; sliders defined in the circuit file (`<adj>` / `38` lines); switches you click;
scopes defined in the file (`<o>`), including 2-D/X-Y plots and FFT; and value edits by mouse
wheel (`mouseWheelEdit`)
([README](https://github.com/pfalstad/circuitjs1/blob/master/README.md#embedding),
[ts/ file list: Scope*, SliderDialog, ScopeFFT](https://github.com/pfalstad/circuitjs1/tree/dev-ts/ts)).

### Fidelity

- **Solver.** Modified nodal analysis with Newton iteration for nonlinear parts. You can pick
  trapezoidal or backward-Euler integration
  ([INTERNALS.md](https://github.com/pfalstad/circuitjs1/blob/master/INTERNALS.md)). A flag
  (`flags & 64`) turns on adaptive time-step
  ([CircuitLoader.java L271-278](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/CircuitLoader.java#L271-L278)).
- **MOSFET.** Threshold, β, λ, optional Cgs/Cgd and a body diode: a square-law (level-1-like) model
  ([MosfetModel.java L21-35](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/MosfetModel.java#L21-L35)).
- **BJT.** SPICE Gummel-Poon-style junction-capacitance parameters
  ([TransistorModel.java L19-40](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/TransistorModel.java#L19-L40)).
- **Op-amps.** An ideal element, plus "real" LM741/LM324 subcircuits with finite slew rate and
  output current. The docs warn "you may run problems with convergence"
  ([opampreal.html](https://github.com/pfalstad/circuitjs1/blob/master/war/doc/opampreal.html)).
- **Power parts and examples.** SCR, triac, diac, transformers and relays exist as elements. It
  ships buck, boost and buck-boost converters, rectifiers, a triac dimmer and delta-PWM examples
  (`conv-buck.txt`, `conv-boost.txt`, `conv-buckboost.txt`, `fullrect*.txt`, `triacdimmer.txt`,
  `delta-pwm.txt` in [public/circuits](https://github.com/pfalstad/circuitjs1/tree/master/src/com/lushprojects/circuitjs1/public/circuits)).
  PWM is a square source with `dutyCycle`, as in `conv-buck.txt`.
- **My reading (not benchmarked):** good for teaching waveforms such as ripple, CCM/DCM, diode
  conduction and firing angle. Not a basis for switching-loss or transition-detail numbers.

### Licence

GPLv2 §0: "The act of running the Program is not restricted, and the output from the Program is
covered only if its contents constitute a work based on the Program"
([COPYING.txt](https://github.com/pfalstad/circuitjs1/blob/master/COPYING.txt)).

- **Private use is fine.** The GPL FAQ says "You are free to make modifications and use them
  privately, without ever releasing them"
  ([GPL FAQ #GPLRequireSourcePostedPublic](https://www.gnu.org/licenses/gpl-faq.html#GPLRequireSourcePostedPublic)).
- **Sharing a site distributes the code.** GPL JavaScript that a website sends to visitors counts
  as distribution: "the source code for the programs being distributed must be released to the
  user" ([GPL FAQ #UnreleasedMods](https://www.gnu.org/licenses/gpl-faq.html#UnreleasedMods)).
  §3 then requires shipping the source or a written offer
  ([COPYING.txt §3](https://github.com/pfalstad/circuitjs1/blob/master/COPYING.txt)).
- **The rest of the site should be unaffected.** "Mere aggregation" does not extend the GPL to
  the rest of the site
  ([COPYING.txt §2](https://github.com/pfalstad/circuitjs1/blob/master/COPYING.txt)).
- **The grey zone.** Whether an iframe plus direct same-origin function calls count as "separate
  programs" is, per the FAQ, "a legal question, which ultimately judges will decide". Exchanging
  "complex internal data structures" leans toward one combined program
  ([GPL FAQ #MereAggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)).
- **In practice (not legal advice):** a Study site kept for Seif alone triggers nothing. A site
  shared with others should ship CircuitJS unmodified in its own folder, with `COPYING.txt` and a
  source link.

---

## 2. ngspice compiled to WebAssembly (`eecircuit-engine`, EEcircuit)

- **What it is.** [eelab-dev/EEcircuit-engine](https://github.com/eelab-dev/EEcircuit-engine)
  (MIT, npm `eecircuit-engine` 1.8.0, modified 2026-09-19) is ngspice built with Emscripten.
  - **API:** `new Simulation()`, `await sim.start()`, `sim.setNetList(text)`,
    `await sim.runSim()`. It returns `{variableNames, numPoints, dataType, data:[{name, type,
    values}]}`
    ([README](https://github.com/eelab-dev/EEcircuit-engine/blob/main/README.md),
    [src/readOutput.ts](https://github.com/eelab-dev/EEcircuit-engine/blob/main/src/readOutput.ts)).
  - **Size:** the package ships a single ~20 MB ES module (`dist/eecircuit-engine.mjs`,
    20,350,824 bytes) with the WASM inlined (unpkg file listing for 1.8.0; unpacked package
    43 MB per `npm view`).
- **Build flags.** The build runs
  `configure … --disable-xspice --disable-osdi`
  ([Docker/run.sh L107](https://github.com/eelab-dev/EEcircuit-engine/blob/main/Docker/run.sh#L107)).
  So there are **no XSPICE code models** (no digital/mixed-signal code models, no XSPICE PWM
  blocks) and no Verilog-A. PWM must come from `PULSE` sources, behavioural sources or
  comparators and switches. The README's example uses `pulse(...)` with `.tran`. It builds the
  latest ngspice release tag at build time
  ([run.sh L66-69](https://github.com/eelab-dev/EEcircuit-engine/blob/main/Docker/run.sh#L66-L69)).
  The current ngspice is **ngspice-47 (11-Aug-2026)**, and the **VDMOS power-MOSFET model** has
  existed since ngspice-28 ([ngspice news](https://ngspice.sourceforge.io/news.html)).
- **Offline.** Yes. It is a library with no network calls in the run path. EEcircuit's own README
  says circuits "are never uploaded to the network"
  ([EEcircuit README](https://github.com/eelab-dev/EEcircuit/blob/gen2-next/README.md)).
  **Untested:** `Simulation` instantiates the WASM module directly and I saw no Web Worker in
  `simulationLink.ts`. A long `.tran` would block the page unless the site wraps it in a Worker.
- **Licence.** Wrapper MIT. ngspice is "Modified BSD" except for listed parts: KLU and
  `tclspice` LGPLv2, numparam LGPLv2+, OSDI MPL-2.0, and XSPICE `icm/table` GPLv2+ (disabled in
  this build) ([ngspice COPYING](https://sourceforge.net/p/ngspice/ngspice/ci/master/tree/COPYING)).
  This is a much lighter obligation than GPL for a shared site.
- **Text authoring.** Standard SPICE netlist. It is topology only (named nodes, no coordinates),
  plus `.model` cards and `.tran`/`.ac`/`.dc`/`.op`. This is the most natural format for an LLM
  and needs no layout step (my assessment). Models for textbook parts (1N4007, IRF540, 2N2222,
  LM741 macromodels) would be pasted as `.model`/`.subckt` text. The bundled model cards are CMOS
  PDK models (FreePDK45, PTM, SkyWater, GF180), not discrete power parts
  ([models.md](https://github.com/eelab-dev/EEcircuit-engine/blob/main/models.md)).
- **Interactivity.** None built in. It is a batch solver: the site must draw the schematic, add
  sliders, rerun the netlist and plot the result (EEcircuit uses
  [webgl-plot](https://github.com/danchitnis/webgl-plot)). There are no animated current dots and
  no live "turn the knob while it runs".
- **EEcircuit app (UI).** Hosted at [eecircuit.com](https://eecircuit.com). Its README says the
  repo "expects the sibling `../EEcircuit-schematic` package because it is a local file
  dependency" ([README](https://github.com/eelab-dev/EEcircuit/blob/gen2-next/README.md)).
  `github.com/eelab-dev/EEcircuit-schematic` returns 404 through the GitHub API, so **the UI can't
  be self-built from public source**. I found no documented iframe or URL-load API.
- **Other ngspice-WASM builds.**
  - [wokwi/ngspice-wasm](https://github.com/wokwi/ngspice-wasm): MIT, build scripts only, last
    push 2022.
  - [physbox-io/volt](https://github.com/physbox-io/volt): an "interactive SPICE" UI with no
    licence file and 0 stars. Not viable today.

## 3. DigitalJS (+ yosys2digitaljs, YoWASP)

- **Library.** [tilk/digitaljs](https://github.com/tilk/digitaljs) is BSD-2-Clause, npm
  `digitaljs` 0.14.2. It is a teaching tool (CSERC '19 paper cited in the README). Usage:
  `new digitaljs.Circuit(json)`, `circuit.displayOn($('#paper'))`, `circuit.start()`. It is
  available from npm or as a webpack bundle
  ([README](https://github.com/tilk/digitaljs/blob/master/README.md)).
- **JSON format (verified in source).** `devices` (keyed by id, with `type`, `label` and
  attributes), `connectors` (`{from:{id,port}, to:{id,port}}`) and `subcircuits`
  ([README § Input format](https://github.com/tilk/digitaljs/blob/master/README.md#input-format)).
  **Positions are optional.** A graph with no `position` is auto-laid-out, using ELK by default
  and dagre optionally
  ([circuit.mjs L159](https://github.com/tilk/digitaljs/blob/master/src/circuit.mjs#L159),
  [index.mjs L91, L159-178](https://github.com/tilk/digitaljs/blob/master/src/index.mjs#L91)).
  This makes it the most agent-friendly format here, since the agent writes topology only. Device
  types include gates, arithmetic, mux, DFF, memory, FSM, clock, button, lamp, 7-segment and
  numeric I/O.
- **JS API.** `start`/`stop`, `setInput(name, sig)`, `getOutput(name)`, `monitor`/`monitorWire`,
  `waitFor`, `alarm` and `toJSON`
  ([circuit.mjs L197-352](https://github.com/tilk/digitaljs/blob/master/src/circuit.mjs#L197-L352)).
  Exports `MonitorView` (waveforms), `IOPanelView` and `HeadlessCircuit`
  ([index.mjs L19](https://github.com/tilk/digitaljs/blob/master/src/index.mjs#L19)).
  `HeadlessCircuit` runs in Node, and the repo's Jest tests use it, so a build-time truth-table
  check is possible.
- **Verilog path.** [yosys2digitaljs](https://github.com/tilk/yosys2digitaljs) (BSD-2) turns
  Yosys JSON into DigitalJS JSON. Its file-based helpers shell out to a native `yosys` via
  `child_process.exec("timeout … yosys …")`
  ([src/index.ts L73-74](https://github.com/tilk/yosys2digitaljs/blob/master/src/index.ts#L73)).
  That needs Unix `timeout`, so it won't run as-is on Windows. The pure
  `yosys2digitaljs(json)` function takes Yosys output directly
  ([README § API](https://github.com/tilk/yosys2digitaljs/blob/master/README.md)).
  [YoWASP Yosys](https://github.com/YoWASP/yosys) (ISC, npm `@yowasp/yosys`, ~78 MB unpacked)
  runs Yosys as WASM through `runYosys`
  ([npmjs README](https://github.com/YoWASP/yosys/blob/develop/npmjs/README.md)).
  **Untested combination:** YoWASP → yosys2digitaljs core → static JSON at build time, with no
  native install and no server.
  [digitaljs_online](https://github.com/tilk/digitaljs_online) is "a web app with a Node backend".
- **Dependency licences.** `@joint/core` MPL-2.0
  ([clientIO/joint](https://github.com/clientIO/joint)). `elkjs` "EPL-2.0 OR GPL-3.0-or-later"
  ([package.json](https://github.com/kieler/elkjs/blob/master/package.json)). `wavecanvas` BSD-2.
  Plus jQuery and jQuery UI
  ([digitaljs package.json](https://github.com/tilk/digitaljs/blob/master/package.json)).
- **Scope.** Digital only; no analog.

## 4. Logic (jppellet/Logic-Circuit-Simulator), a better find for intro logic

- [jppellet/Logic-Circuit-Simulator](https://github.com/jppellet/Logic-Circuit-Simulator) is MIT
  and active (push 2026-07-30), but small (35 stars). Its README says it is "based on web
  components so that it can easily be embedded by pulling in a single JS file". Other features
  from the README: faulty-component exercises, circuit tests, propagation-delay animation, and
  "Component buttons can be hidden or shown for educational purposes"
  ([README](https://github.com/jppellet/Logic-Circuit-Simulator/blob/master/README.md)).
- **Embed.** `<logic-editor mode="connect|design|full">` with an inline
  `<script type="application/json5">` circuit
  ([samples/html/embedding_localhost.html](https://github.com/jppellet/Logic-Circuit-Simulator/blob/master/samples/html/embedding_localhost.html)).
- **Format.** JSON with `in`, `gates` and `out` entries (each with `pos:[x,y]`), and `wires` as
  pin-id pairs ([samples/2bit-decoder.json](https://github.com/jppellet/Logic-Circuit-Simulator/blob/master/samples/2bit-decoder.json)).
  Wires are by pin id rather than coordinates, so connections are unambiguous. The agent still
  picks positions, but misplaced positions only look bad; they don't break connectivity (my
  inference).
- **API.** `loadCircuitOrLibrary`, `setMode`, `setShowOnly` and `highlight`
  ([LogicEditor.ts](https://github.com/jppellet/Logic-Circuit-Simulator/blob/master/simulator/src/LogicEditor.ts)).
  Less documented than the others.

## 5. CircuitVerse

- **Licence.** MIT, for both [CircuitVerse](https://github.com/CircuitVerse/CircuitVerse) and
  [cv-frontend-vue](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/README.md#license).
  It is digital logic only.
- **Embed.** An iframe of a project saved on circuitverse.org, via
  `/simulator/embed/<projectId>`. Query parameters: `theme`, `display_title`, `clock_time`,
  `fullscreen` and `zoom_in_out`
  ([cv-frontend-vue README § Embed Mode](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/README.md#embed-mode),
  [embed.vue L197-201](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/src/pages/embed.vue#L197-L201),
  [docs](https://docs.circuitverse.org/chapter1/chapter1-keyfeatures/)). It has a clock toggle and
  zoom. I found no documented API for the host page.
- **Self-host.** The Vue frontend builds to static assets (`npm run build` →
  `dist/simulatorvue/`) and is "route-agnostic"
  ([README](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/README.md)). But it fetches
  circuits from `/api/v1/projects/${projectId}/circuit_data`
  ([setup.js L151-165](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/src/simulator/src/setup.js#L151-L165)),
  and Verilog → circuit POSTs to `/api/v1/simulator/verilogcv`, where Yosys runs on the server
  ([Verilog2CV.js L252](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/src/simulator/src/Verilog2CV.js#L252)).
  **Untested:** serving static JSON at the `circuit_data` path might be enough for view-only
  embeds.
- **Format.** JSON per scope: `layout`, `allNodes` (serialized nodes), one array per module type
  with positions, and `nodes` as indices into `allNodes`
  ([backupCircuit.js](https://github.com/CircuitVerse/cv-frontend-vue/blob/main/src/simulator/src/data/backupCircuit.js)).
  An agent could write it, but it would be verbose and fragile (my inference). The simulator has
  Timing Diagram and TestBench panels (`src/components/Panels/…`).

## 6. Wokwi

- **Licence and cost.** The simulator is closed. "Wokwi is free for personal use. For commercial
  users and professionals, please check out our paid plans" ([docs.wokwi.com](https://docs.wokwi.com/)).
  [wokwi-elements](https://github.com/wokwi/wokwi-elements) (MIT) holds only the visual part
  components.
- **Format.** `diagram.json` with `parts` (`id`, `type`, optional `left`/`top`, `attrs`) and
  `connections` as `["part:pin", "part:pin", color, routing]`
  ([diagram-format](https://docs.wokwi.com/diagram-format)). Easy for an agent to write.
- **Embed.** A prototype iframe to `wokwi.com/experimental/embed?client_id=…`: "Not officialy
  supported at this time" ([wokwi-embed-example](https://github.com/wokwi/wokwi-embed-example)).
  No offline mode.
- **Analog.** "Wokwi only has a very basic analog circuit simulation. You won't be able to use
  resistors together with analog components" ([wokwi-resistor](https://docs.wokwi.com/parts/wokwi-resistor)).
  Useful only for a microcontroller or embedded-systems course.

## 7. EveryCircuit

- Proprietary. The free tier limits "Simulation of your own circuits … to 5 components per
  circuit". Paid plans are $5/month or $15 forever, and there are educator licences
  ([everycircuit.com](https://everycircuit.com/), [terms](https://everycircuit.com/termsofuse)).
- **Embed.** `https://everycircuit.com/embed/<id>` serves the viewer with
  `theDisplayMode = "embed"` (observed in the page HTML, 2026-09-25). This only works for circuits
  saved on their service.
- **No documented text format or import**, so an agent can't author circuits. Hosted only.

## Adjacent tools (not simulators, but relevant to "agent authors circuits")

- **WaveDrom** ([wavedrom/wavedrom](https://github.com/wavedrom/wavedrom), MIT) draws digital
  timing diagrams from JSON.
- **Lcapy** ([mph-/lcapy](https://github.com/mph-/lcapy), LGPL-2.1) does symbolic linear analysis
  from SPICE-like netlists. It also draws circuitikz schematics from the same netlist, but
  "additional drawing hints, such as direction and size are required"
  ([README](https://github.com/mph-/lcapy/blob/master/README.md)). It is a possible build-time
  source of a schematic image and worked-solution maths for the ngspice path.
- **Digital** ([hneemann/Digital](https://github.com/hneemann/Digital), GPL-3.0) is a strong logic
  simulator, but it is a Java desktop app and can't be embedded in a web page.

---

## Cross-cutting findings

1. **Topology-only formats are the safe ones for an agent.** SPICE netlists, DigitalJS JSON
   (auto-layout) and Verilog carry no geometry. CircuitJS (coordinates) and CircuitVerse (layout +
   node indices) do. CircuitJS labeled nodes narrow the gap, and a Logic/Wokwi-style "pin-id
   wires + cosmetic positions" is in between.
2. **Every candidate supports a machine-checkable gate.** These gates would extend v1's
   verification discipline to simulators:
   - DigitalJS: `HeadlessCircuit` truth tables in Node.
   - ngspice: run the netlist and compare against the worked answer.
   - CircuitJS: load it in a real browser and read `getNodeVoltage`/`getElements` after it
     settles.
3. **"Offline single HTML file" is harder than in v1.** CircuitJS needs same-origin iframe
   scripting, ngspice is a 20 MB module, and CircuitVerse needs an API. All of them work on a
   static host (Vercel/any HTTP server). `file://` behaviour is untested.
4. **Licence spread.** Only CircuitJS is GPL. Everything else open is permissive (MIT, BSD, ISC)
   or file-level weak copyleft (MPL, EPL, LGPL in ngspice parts).

## Not verified here

- Runtime cost of ngspice-WASM transients such as a buck converter over 10 ms (no benchmark run).
- CircuitJS TS port stability. It went live on Pages on 2026-09-23 and is a moving target.
- `file://` behaviour of each embed, and YoWASP → yosys2digitaljs in the browser or Node on
  Windows.
- How accurately an agent turns a *lecture figure* into each format. That needs a prototype
  ticket with real figures.

---

## Implications for learn-premium (options, not decisions)

These matter for the second pilot (a circuits, logic or power course). The ML pilot needs none of
them.

| Option | What it gives | Trade-offs |
|---|---|---|
| **A. CircuitJS, self-hosted in an iframe** (GWT `master` build or the new TS port) | The "feel" tool: animated, sliders and switches, scopes, mixed analog/digital/power in one. Walkthrough steps via `setExtVoltage` / `importCircuit`; verify via `getNodeVoltage` | GPL (fine privately; must ship source if shared). Agent must lay out coordinates (labeled nodes help). No direct "set R = 10k" call. TS port is days old |
| **B. ngspice-WASM (`eecircuit-engine`) + own UI** | Textbook-accurate numbers from plain SPICE netlists (easiest agent format); VDMOS and real `.model` cards for power parts; permissive licence | Batch only: no live animation, and the site must build the plots, sliders and schematic. 20 MB payload. XSPICE off. Worker wrapping and speed untested |
| **C. DigitalJS** (JSON, or Verilog → Yosys at build time) | Best digital fit: agent writes topology or Verilog, auto-layout, waveforms, headless truth-table gate, BSD | Digital only. jQuery/JointJS look needs restyling for the "not default Claude" design. YoWASP path untested |
| **D. Logic (jppellet) web component** | Lightest embed for gate-level intro logic (one JS file, inline JSON5); built-in exercise features; MIT | Small project (bus-factor risk). Agent supplies positions. Thinner API |
| **E. Hosted embeds** (CircuitVerse, EveryCircuit, Wokwi) | Zero build | Need online accounts or saved projects, no offline use, can't be generated from text (EveryCircuit) or only via a server or experimental API. Weak analog (Wokwi) |
| **F. Hybrid A + B** (or B + C) | CircuitJS for intuition, ngspice for exact numbers, DigitalJS for logic, one per discipline | Two or three toolkits to maintain. No public converter keeps one agent-written topology in sync between CircuitJS and SPICE (`spiceimport` branch stale since 2022) |
