# Automation tools a Study site can embed

Research for [Which automation tools can a study site embed?](https://github.com/seifyounes/learn-premium/issues/23)
(map [#1](https://github.com/seifyounes/learn-premium/issues/1)). It feeds the side-by-side
prototype. Written 2026-09-26. **Findings only. The owner decides.**

**Question.** Which embeddable, in-browser tools best cover automation course content, and can an
agent author their files from a lecture figure? There are four areas:

1. PLC / ladder logic
2. pneumatics, electro-pneumatics and hydraulics
3. control systems
4. sequential logic and FSMs

For each tool this note records what
[Which circuit simulator(s) does learn-premium adopt?](https://github.com/seifyounes/learn-premium/issues/14)
asks for:

- delight, ease and looks, including touch on a phone
- accuracy
- whether it can be self-hosted or embedded
- its text/JSON format and JS API: can an agent write it, and can a build gate check it headlessly?
- licence (recorded, **not** a filter; licences are ignored for now)
- maintenance

**Method.** Primary sources only: source repos, official docs, licence files, npm/PyPI metadata,
and the GitHub API (stars and last push as of 2026-09-26). File formats and scan loops were read in
source. Two things were run, not just read:

- Pyodide + python-control and PathSim in Node.
- A small hand-written JS LTI core, checked against python-control.

Anything not checked is marked **(unverified)**. This note builds on earlier research and doesn't
repeat it: [discipline tools](https://github.com/seifyounes/learn-premium/blob/research/discipline-tools/docs/research/discipline-tools.md)
(control was "agent-built sims") and
[circuit simulators](https://github.com/seifyounes/learn-premium/blob/research/circuit-simulators/docs/research/circuit-simulators.md)
(CircuitJS, DigitalJS and Logic in depth).

---

## 1. Key findings

1. **No area has a ready-made tool that is delightful, embeddable, agent-writable *and* headlessly
   checkable all at once.**
   - The polished tools (FluidSIM web, MechSimulator, rungs.dev, PLC Fiddle, grafcet.io) are closed,
     hosted, or block framing.
   - The open tools are either full IDEs, which are cramped on a phone, or small projects with one
     maintainer.
2. **In every area, the most controllable option is an "agent-built sim".** The pattern is the same
   each time:
   - The agent writes a small JSON model from the figure.
   - A few hundred lines of TypeScript run that model **in Node for the build gate** and **in the
     browser** behind a custom SVG, JSXGraph or Plotly view.

   Each area has open-source prior art to borrow semantics or tests from (listed per area).
3. **Control has one strong new ready-made find: PathView + PathSim.** It is MIT, runs a
   Simulink-style block-diagram editor fully in the browser (Pyodide), and uses a documented JSON
   `.pvm` format. It is heavy and IDE-like on a phone, and has no Bode or root locus.
4. **The open question from the discipline-tools research is settled: Pyodide + python-control
   works**, run in Node on 2026-09-26.
   - For G = 4/(s(s+2)) in unity feedback it gave the correct closed-loop TF, 16.30 % overshoot,
     51.83° phase margin and correct root-locus points.
   - At about 37 MB and about 15 s cold load it suits the **build-gate oracle**, not a phone runtime.
   - A ~50-line dependency-free JS core matched it to 6+ digits.
5. **The circuit candidates already cover part of automation.**
   - **CircuitJS** covers **hardwired relay control**: ladder-style coil and contacts linked by
     label, on-delay/off-delay/latching relays, and a time-delay relay. It does not model a PLC scan
     cycle.
   - **DigitalJS** has a real clocked **FSM** cell, Mealy-only with numbered states.
   - **Logic (jppellet)** has the flip-flops, registers, shift registers and counters, but no FSM and
     no waveform view.
6. **GRAFCET/SFC has no open-source embeddable simulator.** Only SchemaTex renders it (AGPL, no
   simulation) and grafcet.io runs it (closed SaaS).

---

## 2. What the circuit candidates already cover

Checked in source for this note, on top of the circuit-simulator research.

| Area | CircuitJS (Falstad) | DigitalJS | Logic (jppellet) |
|---|---|---|---|
| **Hardwired relay ladder** (seal-in, interlock, DOL starter, electro-pneumatic relay half) | **Yes.** `RelayCoilElm` has types normal, on-delay, off-delay, latching, and latching set/reset ([RelayCoilElm.java L61-66](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/client/RelayCoilElm.java)). `RelayContactElm` links to its coil by label ("Label (for linking)"), which gives the detached-contact ladder style. `TimeDelayRelayElm` has on/off delay in seconds. Bundled examples: relay AND/OR/XOR, flip-flop, counter, latching relay, motor protection ([setuplist.txt](https://github.com/pfalstad/circuitjs1/blob/master/src/com/lushprojects/circuitjs1/public/setuplist.txt)) | No relay element | No relay element |
| **PLC scan cycle** (rung order, one-shots, IEC TON/TOF/TP, CTU/CTD) | No. It is an electrical MNA solver, not a PLC | No | No |
| **Flip-flops, counters, shift registers** | D/JK/T flip-flops, latch, counters, ring counter, SIPO/PISO, sequence generator, scopes | DFF (enable, async/sync reset, set/clr); JK/T built from gates | FlipflopD/JK/T, LatchD/SR, Register, ShiftRegister, Counter, Clock |
| **FSM (state diagram)** | No graph. The custom logic element can hold a small stateful truth table | **`FSM` cell:** `trans_table` of `{state_in, ctrl_in, state_out, ctrl_out}`. It advances on the clock edge and pops up a dagre-laid-out state graph with the current state highlighted. States are numbers only and it is Mealy-only ([fsm.mjs](https://github.com/tilk/digitaljs/blob/master/src/cells/fsm.mjs)) | None |
| **Timing diagrams** | Scopes | Live waveform monitor (`wavecanvas`) | None |
| **Control** | Op-amp PI/PID circuits and scopes only. No TF blocks, Bode or root locus | – | – |
| **Headless gate** | Needs a browser (Playwright driving `window.CircuitJS1`); pure Node not verified | `HeadlessCircuit` in Node | Sequential tests would need a custom harness; its `TestSuite` has combinational cases only |

---

## 3. PLC / ladder logic

| Tool | Delight / phone | IEC accuracy | Self-host / embed | Format + headless | Licence | Maintenance |
|---|---|---|---|---|---|---|
| **PLCSimulator.online** = [codingplc/plc-simulator](https://github.com/codingplc/plc-simulator) | Authentic rung grid; energised wires turn green (a colour change, no flow animation). Mobile layout under 640 px, but rung building uses the HTML5 drag-and-drop backend, which is weak on touch (inferred) | Rockwell set: XIC/XIO/OSP/OSN, OTE/OTL/OTU, TON/TOF/TONR, CTU/CTD/CTUD, compare, math, MOV. **No TP.** Fixed 66 ms scan. TOF's ET counts down, which is not IEC style | Vite SPA. Share links load from Firestore; the build has AdSense, PostHog and Sentry. A fork would need a small patch to load static JSON | Normalised JSON `{runglist, rungs, branches, elements, variables}` keyed by UUIDs: verbose but writable. **`cycleScan(draft)` is a pure function** ([cycleScan.ts](https://github.com/codingplc/plc-simulator/blob/master/src/helpers/cycleScan.ts)), so it can run in Node | GPL-3.0 | 52★, pushed 2026-09-09 (v1.9.0) |
| **[cdilga/ladder-logic-editor](https://github.com/cdilga/ladder-logic-editor)** ([demo](https://lle.dilger.dev/)) | Clean React Flow ladder, dark theme, mobile layout with Playwright mobile tests. **The live power-flow highlight is styled but not wired**: edges are created with `powerFlow: false` | Strongest found: TON/TOF/TP (non-retriggerable), CTU/CTD/CTUD, R_TRIG/F_TRIG, SR/RS, with a large compliance test suite | Static Vite SPA, so an iframe works. Programs load only via localStorage or the docs button; there is no URL-parameter load | **Structured Text**; the ladder is generated from it. Headless: `parseSTToAST` + `runScanCycle` against a plain store, already used in Vitest tests (traffic light, conveyor, pump, motor starter) | MIT | 17★, pushed 2026-04-10, one author, no releases |
| **[Prizm plc-academy](https://github.com/Prizm-Technical-Services/plc-academy)** | A game with plant scenes: conveyor, tank, traffic light, cylinder, door, oven, motor. Live green power trace; pointer events | Fixed 10 ms read/solve/write scan. NO/NC/pos/neg, coil/set/reset, TON/TOF/TP, CTU, cmp/move/calc. **No CTD.** Also has FBD/SCL/STL engines | Static files, no dependencies | Compact JS rung builder. `node tools/run-tests.js` grades every reference solution **headless in Node**, which is our pattern already | MIT | 0★, one push (2026-08-05) |
| **[OpenPLC Editor v4](https://github.com/Autonomy-Logic/openplc-editor)** | Full professional IDE; desktop-first | The only real IEC toolchain: ST/LD/FBD/IL → STruC++ → C++, run on emulated AVR (avr8js) | **Electron desktop.** The browser build is a private repo inside the Autonomy Edge cloud ([docs](https://edge.autonomylogic.com/docs/openplc-editor/overview/)). Not embeddable | `project.json` + PLCopen XML. [STruC++](https://github.com/Autonomy-Logic/STruCpp) `--test` runs ST unit tests but needs a C++17 compiler in CI | GPL-3.0 | 394★, v4.3.1 on 2026-09-23 |
| **Falstad CircuitJS** | Animated current dots, touch handling in code | Electrical relay logic only (section 2) | Static, iframe + same-origin JS API | Text/XML circuit; gate needs Playwright | GPL-2.0 | Very active |
| **[SchemaTex](https://github.com/SchemaTex/SchemaTex)** | Good-looking SVG ladder **and SFC** from a Mermaid-like DSL | **Render only**, no simulator | npm, zero dependencies | DSL is easy for an agent (`rung 1: … XIC(START) … OTE(MOTOR)`) | AGPL-3.0 | 78★, pushed 2026-09-21 |
| [PLC Fiddle](https://www.plcfiddle.com/), [rungs.dev](https://rungs.dev/), [grafcet.io](https://www.grafcet.io/en/about) | Polished hosted simulators (grafcet.io is the only GRAFCET one with step highlighting) | (unverified) | Closed SaaS; no embed API found. PLC Fiddle sent no X-Frame-Options header (iframe probably works, unverified) | No public format or API | Proprietary | Active |

Fringe tools, not recommended:

- Need a server: [hiperiondev/ladder-editor](https://github.com/hiperiondev/ladder-editor) (WebSocket server) and [NiRuLogic](https://github.com/NiRuLabs/NiRuLogic) (Go binary).
- No WASM target: [RuSTy](https://github.com/PLC-lang/rusty) and matiec.
- Experimental: [adclz/rk](https://github.com/adclz/rk), which compiles ST to WASM (AGPL, 0★).

**Agent-built option.**

- **Model.** The agent writes a ladder JSON per figure: tags, rungs as series/parallel element lists,
  function blocks such as `ton` with `pt`, and an `expect` timeline taken from the Professor's
  timing table.
- **Engine.** A ~300-line TypeScript scan engine:
  - reads the input image,
  - solves rungs top to bottom, recording power in and out per element,
  - updates the IEC timers and counters,
  - writes the output image.
- **Two uses.** It replays `expect` in Node for the gate. In the page it drives SVG rungs with an
  animated power trace, tap-to-toggle inputs and an optional plant scene (traffic light, conveyor,
  tank).
- **GRAFCET/SFC** would be the same engine plus a step/transition evaluator.
- **Prior art:** plc-academy (MIT) for semantics and scenes, and cdilga's compliance tests (MIT) as a
  timer/counter oracle.

---

## 4. Pneumatics, electro-pneumatics and hydraulics

| Tool | Coverage | Delight / phone | Accuracy | Self-host / embed | Format + headless | Licence | Maintenance |
|---|---|---|---|---|---|---|---|
| **Festo FluidSIM 6 / FluidSIM web** | All three domains, 800+ parts; the reference standard | Excellent. The web app is Blazor WASM, iPad-capable per Festo | Physical | **No.** Needs a Festo account and licence; sends `X-Frame-Options: sameorigin` (checked with curl) ([ART Systems](https://www.art-systems.de/www/site/en/fluidsim/)) | Closed `.ct` format; no public API | Proprietary subscription | Desktop v6.3, 2026-07 |
| **Automation Studio** (Famic) | All three + PLC + GRAFCET | Excellent | Physical | **No.** Windows desktop only ([Famic](https://www.famictech.com/en/Products/Automation-Studio/Educational-Edition)) | Closed | Proprietary | Alive |
| **[MechSimulator](https://mechsimulator.com/tools/pneumatic-circuit/)** (pneumatic, electro-pneumatic and hydraulic tools) | Very broad: 5/3 and 4/3 centres, relays, timers, counters, cascade, displacement diagram | Very good: animated flow, glowing wires, pointer/touch, pinch-zoom | Semi-physical (force balance, orifice flow) | **No.** `frame-ancestors 'self'`; [terms](https://mechsimulator.com/terms/) forbid copying or mirroring. Link-out only | Closed, minified; share URL `#c=` | Proprietary | Very active |
| **[Picuino neumatic](https://github.com/picuino/neumatic)** | Pneumatics only: single/double-acting cylinders, 3/2, 4/2, 5/2 (manual, pilot, roller), AND/OR, check, flow control. **No** solenoids, 5/3, relief valve, timers or hydraulics | Decent flat canvas, with a **built-in displacement-step diagram** and an A+B+B-A- example. **Mouse events only** (verified: `08-UIController.js` binds only mousedown/move/up) | Physical-ish: air mass per node, load mass, friction | **Yes.** Static single HTML file, `?loadFile=` parameter | JSON array plus a `cyrb53` hash footer (an agent can compute it). **Pipes join by coordinate matching**, so authoring is fragile. The engine is tied to the canvas, so running it headless needs extraction | GPL-3.0 (README text; no LICENSE file) | 8★, pushed 2026-08-31, one maintainer |
| **[YujiKF/pneumatic-circuit](https://github.com/YujiKF/pneumatic-circuit)** | Parses `A+B+A-B-`, solves it by the intuitive, cascade or step-counter method, and draws pneumatic and ladder SVGs | SVG, no animation | Discrete | Dependency-free TS core, runs in Node | Pure `generate()` pipeline with `node --test`, very close to our gate design. Its own audit marks the cascade simulator "not approved" | **No licence** (all rights reserved) | 0★, one day old (2026-09-13) |
| **Falstad CircuitJS** (electrical half only) | Relay ladder, time-delay relay, push buttons, lamps, motors | Animated current | Physical electrical | Yes (static, iframe) | Text/XML; `setExtVoltage` / `getNodeVoltage` could bridge to a pneumatic sim; gate needs Playwright | GPL-2.0 | Active |
| **Modelica → FMU → WASM** ([Bodylight.js](https://github.com/creative-connections/Bodylight.js-FMU-Compiler), [OpenHydraulics](https://github.com/modelica-3rdparty/OpenHydraulics)) | Hydraulics only (OpenHydraulics); no open pneumatic valve library found | No visuals of its own | Fully physical | Static JS + WASM, but a Docker/OpenModelica compile per model | Agent writes Modelica. **Far too heavy** for sequence teaching | Compiler GPL-3.0, components MIT | OpenHydraulics last release 2022 |
| **[Hopsan](https://github.com/Hopsan/hopsan)** | Rich hydraulics; minimal pneumatics (no directional valves or cylinders) | Desktop Qt | Physical (TLM) | Desktop only | XML. Its ISO-style SVGs are split into `_base`/`_movable` parts, useful for animation | Apache-2.0 | v2.24.4, 2026-09-21 |

DigitalJS is not a fit here: it has no relay, coil or solenoid element.

**Symbol sources for an agent-built sim:**

- [QElectroTech elements](https://github.com/qelectrotech/qelectrotech-elements): 343 pneumatic and 94
  hydraulic ISO symbols as XML vectors, CC-BY 3.0 when redistributed. It has an explicit clause
  against use as ML training data.
- Wikimedia Commons "ISO 1219" and "Pneumatic symbols SVG" (licence varies per file, unverified).
- Hopsan's Apache-2.0 SVGs.

**Agent-built option.**

- **Model.** The agent writes a `circuit.json`:
  - components with ISO ids, e.g. `1V1` a 5/2 pilot valve, `1A` a double-acting cylinder, `1S2` a
    roller valve at `1A.plus`;
  - connections by **port name**, not coordinates;
  - the Professor's `sequence: "A+ B+ B- A-"`;
  - optionally, the relay ladder (K1…, Y1…, S1…).
- **Engine.** A small TS discrete-event engine propagates pressure through valve states, evaluates
  the relay rungs and emits a trace of cylinder positions.
- **Gate.** In Node, it builds the displacement-step diagram from the trace, compares it with the
  Professor's, and fails on signal conflicts or a stuck cycle.
- **Look.** SVG ISO 1219 symbols with spool shift and piston travel as CSS transforms, blue
  pressurised lines, orange energised wires, and big tap targets. The displacement-step diagram draws
  live underneath.
- **Hydraulics** add 4/3 centres, a relief valve, pump/motor and a steady-state pressure/flow readout.
- **Prior art:** [mcl431-circuits](https://github.com/vaibhav11123/mcl431-circuits) (MIT, Python)
  already does "YAML spec → validate → draw step-displacement sheets" for one course.

---

## 5. Control systems

| Tool | Covers | Delight / phone | Accuracy | Self-host / embed | Format + headless | Licence | Maintenance |
|---|---|---|---|---|---|---|---|
| **[PathView](https://github.com/pathsim/pathview) + [PathSim](https://github.com/pathsim/pathsim)** | Simulink-style block diagram with time simulation: TF (num/den, ZPG), PID, anti-windup PID, state space, discrete TF/SS, scopes. **No Bode, Nyquist or root locus** | Polished dark SvelteFlow editor with Plotly results. Runs on a 375 px viewport but panels overlap: an editor, not a lesson widget. No light theme seen | 30+ solvers (RK4, adaptive RK, BDF, ESDIRK), events | Static SvelteKit app; Pyodide in a Web Worker; no backend. `?model=<url>` loads a model. No documented viewer-only mode | **Documented JSON `.pvm`** ([spec](https://github.com/pathsim/pathview/blob/main/docs/pvm-spec.md)): nodes with `type` + `params` (Python expressions, so authored files need an allow-list), connections, simulation settings. `pathview convert` gives a PathSim script, runnable in Node Pyodide or CPython | MIT (both) | PathSim 496★, v0.25.1 (2026-09-17). PathView 92★, v0.19.3 |
| **Pyodide + [python-control](https://github.com/python-control/python-control)** | TF/SS, feedback, step info, margins, Bode/Nyquist data, root locus | None (library) | Reference quality. **Tested:** correct T(s), OS 16.30 %, PM 51.83° | About 37 MB (scipy, matplotlib pulled in even with `deps=False`), ~15 s cold in Node | Excellent **gate oracle** | BSD-3 | 2,086★, v0.10.2 |
| **SymPy `physics.control`** (in Pyodide) | Symbolic Series/Parallel/Feedback reduction | None | Exact. **Tested:** closed loop `K/(s²+2s+K)`, 7.6 s cold | Lighter than scipy | Checks "the reduced TF equals the Professor's expression" | BSD | Bundled with Pyodide |
| **[JSXGraph](https://github.com/jsxgraph/jsxgraph)** (renderer + numerics) | Draggable s-plane poles/zeros, sliders, curves. No control functions | Multi-touch; fully restyleable | `Numerics.polzeros`, `rungeKutta`. **Tested in Node** | npm, static | The same numerics run in the gate and the page | MIT or LGPL-3.0 | 1,458★, v1.13.3 |
| **Plotly.js** (renderer) | Log-axis Bode, Nyquist, step, with hover | Touch pan/zoom; a recognisable look unless restyled | – | npm, heavy (~3.5 MB, unverified) | – | MIT | Very active |
| [control-systems-js](https://github.com/Brenopms/systems-controls-js) | step, bode, nyquist, rlocus | None | **Its author reports time-domain error around 10⁻¹** (Gaver-Stehfest inverse Laplace), so it would fail a gate | npm | – | MIT | Last publish 2023-05, 6★ |
| Falstad CircuitJS | Op-amp PID circuits and scopes only | Animated | MNA | Static iframe | Gate needs a browser | GPL-2.0 | Active |
| Desmos API / GeoGebra | Plots of step or root locus from expressions | Very delightful, touch | Plots only; no control numerics | Desmos needs an API key; GeoGebra embeds free for non-commercial use | Expressions an agent can write; no Node gate | Proprietary | Active |
| [RLDraw / BodeDraw](https://lpsa.swarthmore.edu/Root_Locus/RLDraw.html) (Swarthmore) | Root-locus sketching rules, K slider | Good teaching UX | ok | No licence stated; uses Highcharts | UX reference only | None stated | 2020 |
| LibreSim, Xcos on Cloud, EjsS, Bodylight.js, pycollimator, BlockWerk | Various block-diagram simulators | – | – | LibreSim needs a FastAPI backend, Xcos on Cloud a Scilab server. EjsS is authored in a Java desktop tool. Bodylight needs a Modelica compile per model. pycollimator's official repo is gone. BlockWerk's source was not found (unverified) | Poor fit for agent authoring | Mixed | – |

**Coverage by sub-area:**

- **Block-diagram drawing and simulation:** yes, with PathView (heavy on a phone).
- **Symbolic block-diagram reduction:** SymPy in the gate; the steps become written content.
- **TF, step/impulse, PID tuning, Bode, Nyquist, margins, root locus, pole-zero, state space:**
  **no maintained, open, embeddable tool exists.**

**Agent-built option.**

- **Model.** The agent writes a `sim.json`: plant `G`, controller (e.g. PID gains), feedback `H`,
  which views to show, which sliders, and `expect` values from the Professor (OS, Ts, PM, closed-loop
  TF).
- **Core.** A small TS LTI core: polynomial ops, reduction, roots, RK4 or matrix-exponential step,
  jω sampling, margins by bisection, and a root-locus sweep.
- **Gate.** The core runs in Node, and python-control/SymPy act as a second oracle.
- **Proof it is cheap.** A 50-line core gave poles −1 ± 1.732051j, OS 16.30335 %, PM 51.8273° at
  1.5723 rad/s, all matching python-control.
- **Pin the definitions in the gate.** Settling time differed (4.038 s against 4.047 s) only because
  of the time grid, so the gate must fix the band %, the time grid and the tolerance to the
  Professor's convention. The textbook 4/(ζωn) gives 4.0 s here.
- **Browser.** It lazy-loads the ~10–20 KB core plus JSXGraph (draggable poles, touch) or Plotly (log
  plots).

---

## 6. Sequential logic and FSMs

| Tool | Current state / stepping | Semantics | Embed | Format + headless | Licence | Maintenance |
|---|---|---|---|---|---|---|
| **DigitalJS `FSM` cell** + DFF + waveform monitor | Current state and next transition highlighted in a popup graph (dagre layout). States are numbered circles only | Edge-triggered **Mealy** (Moore = identical outputs on every edge out of a state). An unmatched input goes to `init_state` | npm bundle, JointJS | JSON `trans_table` with `x` don't-cares. Circuits run in `HeadlessCircuit` in Node (FSM cell headless: unverified) | BSD-2 | 783★, v0.14.2 (2026-02) |
| **Logic (jppellet)** | Live wire values; no state graph | Flip-flops with a rising/falling trigger option | `<logic-editor>` web component | Circuit JSON5. Sequential tests would need a custom harness | MIT | 35★, pushed 2026-07-30 |
| **CircuitJS** | Scopes; no state graph | Mixed analog/digital | iframe | Text/XML; gate needs a browser | GPL-2.0 | Active |
| **CircuitVerse** | Timing-diagram panel; a testbench `seq` mode ticks the clock once per row | Clocked | iframe from circuitverse.org (backend) | JSON; tests run in the browser only | MIT | Pushed 2026-09-22 |
| **[WaveDrom](https://github.com/wavedrom/wavedrom)** | Static timing diagrams | – | npm/CDN, SVG | WaveJSON, very easy for an agent; renders in Node | MIT | npm 3.7.0 (2026-08) |
| **[XState v5](https://github.com/statelyai/xstate)** | Engine only | **Event-driven, not clocked**: a clock becomes a `CLK` event, and Mealy outputs become awkward actions | npm | Pure `transition()` works headlessly | MIT | 30k★, very active |
| **[Stately Sketch](https://github.com/statelyai/sketch)** | Most polished modern visualizer and simulator | XState | A full app with a server, not a component | Reads XState, JSON, YAML, Mermaid | MIT | 80★, new (2026) |
| [state-machine-cat](https://github.com/sverweij/state-machine-cat), [Mermaid stateDiagram](https://mermaid.js.org/syntax/stateDiagram.html) | Static SVG. smcat passes `class` through, so external code can toggle a highlight | – | npm | Text that agents write reliably; render only | MIT | Active |
| [Evan Wallace FSM designer](https://github.com/evanw/fsm), [automatonsimulator](https://github.com/kdickerson/automatonSimulator) | Drawing only (2015, mouse only) / DFA-NFA-PDA acceptors, not Moore/Mealy | – | Static | – | MIT | Dormant |
| [hneemann Digital](https://github.com/hneemann/Digital) (Java) | The gold standard for this curriculum: FSM editor, FSM → transition table → circuit, CLI tester | Correct | **Desktop only** | `.fsm`/`.dig` XML; a JVM CLI could serve as an offline cross-check | GPL-3.0 | Pushed 2026-09-07 |

Not web tools, noted briefly: Logisim-evolution (Java, has a chronogram but no FSM editor) and
Deeds-FsM (Windows).

**Coverage by sub-area:**

- **Flip-flops, counters, shift registers:** well covered by Logic, CircuitJS and DigitalJS.
- **Timing diagrams:** WaveDrom and the DigitalJS monitor.
- **Moore/Mealy state diagrams with stepping, state tables, state assignment, excitation tables and
  sequence-detector walkthroughs:** **no web tool does these well.**

**Agent-built option.**

- **Model.** The agent writes an FSM JSON: `kind` (Moore or Mealy), inputs and outputs, states (with
  Moore outputs), transitions (with Mealy outputs), `init`, `encoding`, flip-flop type, and checks
  (the Professor's state table plus input→output sequences).
- **Engine.** A ~200-line TS engine:
  - steps the machine and checks it is complete and deterministic;
  - derives the state table, encoded transition table, per-flip-flop excitation table, a trace, and
    WaveJSON of that trace.
- **Gate.** In Node, the tables must equal the Professor's and the sequences must match. This catches
  Moore one-cycle lag and overlap errors in sequence detectors. A DigitalJS `FSM` device generated
  from the same JSON can serve as an independent cross-check.
- **Page.** The layout is pre-computed at build time (elkjs or dagre) into SVG: a current-state glow,
  a token that travels along the edge on each clock, input toggles and a Clock button, and linked
  table rows plus a growing timing strip.

---

## 7. Options for the side-by-side prototype

These are options for [the side-by-side prototype](https://github.com/seifyounes/learn-premium/issues/24),
not decisions.

| Area | Options |
|---|---|
| **PLC / ladder** | (a) Agent-built TS scan engine + SVG rungs + plant scene. (b) PLCSimulator.online fork, with Firestore and ads removed. (c) cdilga/ladder-logic-editor (ST-first; power flow needs wiring). (d) CircuitJS for the hardwired relay-control lectures only |
| **Pneumatics / hydraulics** | (a) Agent-built TS + SVG ISO 1219 sim with a live displacement-step diagram. (b) Picuino neumatic, self-hosted fork (needs touch and a headless engine). (c) Agent-built pneumatic side + a CircuitJS iframe for the relay half. (d) MechSimulator as a link-out look benchmark only |
| **Control** | (a) PathView embedded (`?model=`, self-hosted). (b) Agent-built TS LTI core + JSXGraph (draggable poles, sliders). (c) Agent-built core + Plotly (Bode/Nyquist/step). (d) In-page Pyodide + python-control, to feel its cost on a phone (its likely role is the gate) |
| **Sequential / FSM** | (a) Agent-built FSM sim (JSON → TS engine → pre-laid-out SVG + tables + timing strip). (b) DigitalJS `FSM` cell + gate-level version + monitor. (c) Logic (jppellet) for flip-flop, counter and register playgrounds. (d) state-machine-cat or Mermaid with highlight toggling, or Stately Sketch as a style reference |

## 8. Not verified

- Phone behaviour of PLCSimulator.online, Picuino and CircuitJS was judged from source (event
  handlers, backends), not tried on a device. PathView was tried at a 375 px viewport in a browser
  pane only.
- CircuitJS running headless in pure Node.
- Whether the DigitalJS `FSM` cell runs in `HeadlessCircuit` (circuits in general do).
- PLC Fiddle iframing; rungs.dev file format; grafcet.io simulation accuracy; BlockWerk source.
- Per-file licences of Wikimedia ISO 1219 symbols.
