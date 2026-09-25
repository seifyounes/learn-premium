# Research: which interactive tool fits each engineering discipline?

Ticket: [#8](https://github.com/seifyounes/learn-premium/issues/8) (wayfinder:research, feeds #13).
Researched: 2026-09-25. Findings only. The owner makes the decisions.

**Scope.** For each discipline below: which web-embeddable interactive tools or libraries fit, their
licence and embeddability (API keys, offline use), and whether an agent can write their content as
text or code from a Course's Materials. Circuit simulators are covered by
[#6](https://github.com/seifyounes/learn-premium/issues/6), and 3D machine parts by
[#7](https://github.com/seifyounes/learn-premium/issues/7). Those rows only point there.

**Method.** Primary sources only: official docs, source repositories, licence files, and first-party
policy pages. Licence and activity data come from the GitHub API on 2026-09-25 (`licenseInfo`,
`pushedAt`, `latestRelease`). "Last push" dates below come from that query. Anything I inferred
without checking against a source is marked **(unverified)**.

---

## 1. Key findings

1. **A small open-source core covers most disciplines.** JSXGraph for 2D/3D math and geometry,
   Plotly for scientific charts, Pyodide or marimo-WASM for real computation, and three.js for 3D
   can serve almost every row. All four are MIT, LGPL/MIT, MPL or Apache, need no API key and can be
   bundled for offline use.
2. **VisualPDE is the standout multi-discipline find.** It is MIT code with CC-BY HTML, embeds via
   iframe, and loads a whole simulation from an `options=` URL parameter holding LZ-compressed JSON.
   It covers heat transfer, fluids (Navier–Stokes, shallow water, vorticity), waves and vibrations
   (wave and plate equations), PDEs in math, and numerical-method intuition.
3. **PMKS+ is the mechanisms find.** It is an MIT, browser-only planar-linkage simulator with
   kinematic and static/dynamic force analysis, checked against MATLAB, and a "URL is the document"
   sharing model. It covers linkages in machine design and dynamics.
4. **Three popular tools carry licence risk for anything beyond personal use.**
   - The **Desmos API** allows free use only for personal non-commercial use or a 90-day trial.
     Production apps need the paid Commercial Tier.
   - **GeoGebra** is free only for non-commercial use.
   - **PhET** switched from CC BY to CC BY-NC on 2026-03-29.

   **Falstad** applets (EM, waves, Fourier) are also non-commercial only. Whether learn-premium
   Study sites count as commercial is an owner decision.
5. **Control, strength of materials and statics have no dedicated embeddable tool.** They need
   generated code on the core: JSXGraph or Plotly for plots, and Pyodide running `python-control`
   and SciPy for the numbers.
6. **Agent-authorability is high across the board.** Nearly every candidate takes content as text:
   JS/JSX code, command strings (GeoGebra `evalCommand`), JSON (WaveJSON, VisualPDE options, Desmos
   state), URL state (PMKS+, TF Playground hash), or Python (Manim, Pyodide, marimo `.py`). The
   trouble is fidelity to the lecture, not the format.
7. **Generated animation splits two ways.** Manim renders video files (mp4/webm/gif/mov, transparent
   supported), which are not interactive. Motion Canvas has a `<motion-canvas-player>` web component
   that takes variables. Remotion needs a paid company licence above 3 employees.

---

## 2. Tool catalogue

"Agent authoring" means the form an agent writes the content in. "Offline" means it can be bundled
into the Study site without calling a third-party server.

### 2.1 General math and plotting

| Tool | Licence | Embed / offline | Agent authoring | Notes |
| --- | --- | --- | --- | --- |
| **JSXGraph** | Dual LGPL-3.0+ / MIT, no dependencies ([repo](https://github.com/jsxgraph/jsxgraph)) | Self-hosted JS, SVG or canvas rendering ([repo](https://github.com/jsxgraph/jsxgraph)) | JS code, or **JessieCode**, a small DSL that "restrict[s] the user's access to the DOM" ([JessieCode](https://github.com/jsxgraph/JessieCode)) | 2D geometry, function plots, charts. 3D through `View3D`, `Functiongraph3D` and `ParametricSurface3D` ([View3D](https://jsxgraph.org/docs/symbols/JXG.View3D.html), [Functiongraph3D](http://jsxgraph.org/docs/symbols/Functiongraph3D.html)). Very active: v1.13.3, 2026-09-07. |
| **Mafs** | MIT ([repo](https://github.com/stevenpetryk/mafs)) | npm, React only ([mafs.dev](https://mafs.dev/)) | JSX components | Plot.OfX/OfY/Parametric/Inequality/VectorField, movable points, transforms, experimental LaTeX ([plots](https://mafs.dev/guides/display/plots)). 2D only. Last release v0.21.0 (2024-10), last push 2025-03, so slowing. |
| **function-plot** | MIT ([repo](https://github.com/mauriciopoppe/function-plot)) | npm, D3-based | JS config object | Lightweight 2D function plotter. v1.25.4, 2026-04. |
| **Plotly.js** | MIT ([repo](https://github.com/plotly/plotly.js)) | No account or key; minified bundle can be downloaded and included locally ([getting started](https://plotly.com/javascript/getting-started/)) | JSON-like `data` and `layout` objects | Scientific charts, including 3D surfaces and contours. Very active: v4.1.1, 2026-09. |
| **Desmos API** (graphing, geometry, 3D, scientific) | Proprietary. Free **Trial Tier** is "solely for (a) personal, non-commercial use or (b) a 90 day trial"; production use needs the paid **Commercial Tier** ([API terms](https://github.com/desmosinc/policies/blob/main/api-terms.md)) | Needs an `apiKey` in the script URL. Self-hosting only for partners ([docs](https://www.desmos.com/api/v1.11/docs/index.html)). Framing or mirroring the tools needs written consent ([FAQ](https://github.com/desmosinc/policies/blob/main/faqs.md)) | `setExpression` with LaTeX, `setState` JSON. Desmos says states are "opaque values" ([docs](https://www.desmos.com/api/v1.11/docs/index.html)) | Best-in-class UX. Static images of Desmos graphs are CC-BY-SA even commercially ([FAQ](https://github.com/desmosinc/policies/blob/main/faqs.md)). |
| **GeoGebra Apps** (graphing, geometry, 3D, CAS, classic) | Free "for non-commercial purposes"; commercial use (publishers, online schools, ad or sponsorship revenue) needs a licence ([licence](https://www.geogebra.org/license)). Source is EUPL 1.2 ([licence](https://www.geogebra.org/license)) | `deployggb.js`. A downloadable **Math Apps Bundle** allows self-hosting via `setHTML5Codebase()` ([embedding](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_Embedding/)) | `evalCommand("…")` takes input-bar commands (English names). Also `setXML` / `setBase64` ([API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/)) | Covers the widest range of math, including CAS and 3D. Licence is the blocker. |
| **CindyJS** | Apache-2.0 ([repo](https://github.com/CindyJS/CindyJS)) | Self-hosted | CindyScript text ([repo](https://github.com/CindyJS/CindyJS)) | Cinderella-compatible geometry. Smaller community (714 stars). |
| **math.js** | Apache-2.0 ([repo](https://github.com/josdejong/mathjs)) | npm | Expression strings | Unit-aware arithmetic and conversion (energy, pressure, custom units) ([units](https://mathjs.org/docs/datatypes/units.html)). A calculator engine, not a visual tool. |
| **MathLive** | MIT ([repo](https://github.com/arnog/mathlive)) | npm | none | Math *input* field, so students can type answers in drills. |

### 2.2 Computation in the browser

| Tool | Licence | Embed / offline | Agent authoring | Notes |
| --- | --- | --- | --- | --- |
| **Pyodide** | MPL-2.0 ([repo](https://github.com/pyodide/pyodide)) | Self-hostable WASM | Python | Ships NumPy 2.4.6, SciPy 1.18.0, SymPy 1.14.0, scikit-learn 1.8.0, matplotlib, pandas. Pure-Python PyPI wheels install via `micropip` ([packages](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)). |
| **marimo (WASM export)** | Apache-2.0 ([repo](https://github.com/marimo-team/marimo)) | "entirely in the browser, without a backend". Exports to static WASM HTML and can be embedded in other pages ([WASM guide](https://docs.marimo.io/guides/wasm/)) | Notebooks are plain `.py` files ([WASM guide](https://docs.marimo.io/guides/wasm/)) | Reactive notebook UI on Pyodide. 2 GB memory limit and no true parallelism ([WASM guide](https://docs.marimo.io/guides/wasm/)). |
| **JupyterLite** | BSD-3-Clause ([repo](https://github.com/jupyterlite/jupyterlite)) | Static site | `.ipynb` | Full Jupyter UI in the browser. Heavier than marimo for embedding (unverified). |
| **python-control** | BSD-3-Clause ([PyPI](https://pypi.org/project/control/)) | Via Pyodide | Python (`tf`, `bode`, `rlocus`, `step_response`) | Published as a pure-Python wheel (`py3-none-any`). Its dependencies (NumPy, SciPy, matplotlib) ship with Pyodide ([PyPI](https://pypi.org/project/control/), [Pyodide packages](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)), so it *should* `micropip`-install **(unverified; not run)**. |

### 2.3 Simulation and physics

| Tool | Licence | Embed / offline | Agent authoring | Notes |
| --- | --- | --- | --- | --- |
| **VisualPDE** | Software MIT, HTML/CSS CC-BY 4.0 with attribution to "VisualPDE.com by Benjamin Walker, Adam Townsend, and Andrew Krause" ([LICENSE](https://github.com/Pecnut/visual-pde/blob/main/LICENSE.md)) | Share → **Embed** gives an iframe with full, minimal or no UI. Self-hosting a modified copy is explicitly allowed ([FAQ](https://github.com/Pecnut/visual-pde/blob/main/_user-guide/FAQ.md)) | Equations typed as text, 1–8 species, Periodic, Dirichlet, Neumann, Robin or Mixed boundary conditions, 1D/2D with surface plots. **Copy code** exports JSON ([advanced options](https://visualpde.com/user-guide/advanced-options)). The sim reads `?preset=` and `?options=` (LZ-String-compressed JSON) from the URL ([main.js](https://github.com/Pecnut/visual-pde/blob/main/sim/scripts/RD/main.js)) | Built-in examples: heat and inhomogeneous heat, wave, plate, advection ([basic PDEs](https://github.com/Pecnut/visual-pde/tree/main/_basic-pdes)); Navier–Stokes, shallow water, vorticity, thermal convection, dipoles, method of images ([fluids](https://github.com/Pecnut/visual-pde/tree/main/_fluids)). Active, but only 116 stars, so bus-factor risk. |
| **PMKS+** | MIT ([README](https://github.com/PMKS-Web/Planar-Mechanism-Kinematic-Simulator)) | Browser-only single-page app, no account, no server storage ([README](https://github.com/PMKS-Web/Planar-Mechanism-Kinematic-Simulator)). iframe use not documented (unverified) | "A URL is the document": Share Project gives a link that reopens the exact mechanism. There is also a `.pmks` file format ([README](https://github.com/PMKS-Web/Planar-Mechanism-Kinematic-Simulator)). The encoding is not documented as a public format **(unverified)** | Planar linkages with pin, slot and slide joints. Position, velocity and acceleration graphs. Static (equilibrium) and dynamic (Newton–Euler) force analysis. 42-mechanism library. Verified against MATLAB ([README](https://github.com/PMKS-Web/Planar-Mechanism-Kinematic-Simulator)). |
| **Matter.js** | MIT ([repo](https://github.com/liabru/matter-js)) | npm | JS | 2D rigid-body engine. Game-grade, not engineering-grade. |
| **planck.js** | MIT ([repo](https://github.com/piqnt/planck.js)) | npm | JS | Box2D rewrite. Revolute, prismatic, gear, pulley, weld, distance, wheel, rope and motor joints ([docs](https://piqnt.com/planck.js/docs)). |
| **Rapier** | Apache-2.0 ([rapier](https://github.com/dimforge/rapier)) | npm `@dimforge/rapier2d` or `rapier3d`, WASM, with `-compat` builds that embed the WASM ([JS guide](https://rapier.rs/docs/user_guides/javascript/getting_started_js)) | JS | The old `rapier.js` repo is **archived** and moved into the `dimforge/rapier` monorepo ([rapier.js](https://github.com/dimforge/rapier.js)). |
| **PhET sims** | Sims are **CC BY-NC since 2026-03-29**. Educators and schools remain free; "any use … that provides commercial advantage or monetary compensation" needs a partnership ([PhET post](https://phetsims.substack.com/p/a-small-change-to-support-a-big-mission), [HTML licensing](https://phet.colorado.edu/en/licensing/html)). Code in repos is GPL-3.0 or MIT per repo ([faradays-law](https://github.com/phetsims/faradays-law), [scenery](https://github.com/phetsims/scenery)) | Hosted HTML sims. Embed specifics not verified in this pass | Not authorable: fixed sims | Polished, but the content is theirs, not the lecture's. Useful as "go play with this" links. |
| **Falstad applets** (EM statics and waves, 3D fields, waveguides, ripple tank, Fourier, digital filters, coupled oscillators, heat engine) | Classroom use free. Non-commercial modification and redistribution allowed with attribution. "Contact me for any other uses" ([licensing](https://www.falstad.com/licensing.html)) | Mostly converted from Java to JavaScript ([index](https://www.falstad.com/mathphysics.html)) | Limited: fixed sims with parameters | The only strong ready-made EM visualisers found. CircuitJS belongs to #6. |
| **CoolProp (JS/WASM)** | MIT ([repo](https://github.com/CoolProp/CoolProp)) | Emscripten `coolprop.js` + `coolprop.wasm`. The `.wasm` must be served as `application/wasm` ([JS wrapper](https://coolprop.org/coolprop/wrappers/Javascript/index.html)) | JS calls such as `PropsSI(…)` | Real-fluid property tables (steam, refrigerants) in the browser. v8.0.0, 2026-06. |
| **Energy2D-JS** | No licence detected. **Archived**, last push 2012 ([repo](https://github.com/concord-consortium/energy2d-js)) | — | — | Avoid. Listed only because it comes up in searches. |
| **Schroeder lattice-Boltzmann fluid sim** | No licence stated ([page](https://physics.weber.edu/schroeder/fluids/)) | — | — | Good pedagogy, but reuse rights are unclear. |
| **WebGL-Fluid-Simulation** | MIT ([repo](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)) | Self-hosted | JS config | Visual "wow" only, not quantitative. Last push 2024-11. |

### 2.4 Domain-specific diagram formats

| Tool | Licence | Agent authoring | Use |
| --- | --- | --- | --- |
| **WaveDrom** | MIT ([repo](https://github.com/wavedrom/wavedrom)) | WaveJSON text (`{signal:[{name, wave:"P..."}]}`), rendered in the browser ([tutorial](https://wavedrom.com/tutorial.html)) | Digital timing diagrams (logic, sequential circuits). |
| **netlistsvg** | MIT ([repo](https://github.com/nturley/netlistsvg)) | Yosys JSON netlist to SVG schematic | Gate-level schematics. Last push 2024-01. |
| **Web Audio API** | Web standard, "Baseline: Widely available" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)) | JS | OscillatorNode, BiquadFilterNode, IIRFilterNode, AnalyserNode (FFT), ConvolverNode ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)). Lets students *hear* filters and convolution. |

### 2.5 3D and generated animation

| Tool | Licence | Output | Agent authoring | Notes |
| --- | --- | --- | --- | --- |
| **three.js** | MIT ([repo](https://github.com/mrdoob/three.js)) | Live WebGL scene | JS | Base for any custom 3D (fields, stress colouring, parts). 3D CAD pipeline is #7. |
| **Manim Community** | MIT ([repo](https://github.com/ManimCommunity/manim)) | Video or image files: `--format png, gif, mp4, webm, mov`, plus `--transparent` ([config](https://docs.manim.community/en/stable/guides/configuration.html)) | Python scenes | Needs a local Python toolchain. Depends on PyAV and pycairo ([pyproject](https://github.com/ManimCommunity/manim/blob/main/pyproject.toml)). LaTeX is optional unless `Tex`/`MathTex` is used ([install](https://docs.manim.community/en/stable/installation/uv.html)). The result is **not interactive**. |
| **Motion Canvas** | MIT ([repo](https://github.com/motion-canvas/motion-canvas)) | Image sequence (PNG, JPEG, WebP), then video via ffmpeg ([rendering](https://motioncanvas.io/docs/rendering)). Can also play live via `@motion-canvas/player` ([npm](https://www.npmjs.com/package/@motion-canvas/player)) | TypeScript generators ([docs](https://motioncanvas.io/docs/)). Player takes `variables` ([project variables](https://motioncanvas.io/docs/project-variables/)) | Last release v3.17.2, 2024-12, so releases have slowed. |
| **Remotion** | Custom licence. Free for individuals, non-profits and for-profits with up to 3 employees; otherwise a paid company licence ([LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)) | React to video | React | Only relevant if Study sites embed rendered video. |
| **anime.js** | MIT ([repo](https://github.com/juliangarnier/anime)) | Live DOM/SVG animation | JS | Already the house animation stack (global CLAUDE.md). Suits choreographed step-throughs of static figures (the v1 "redraw" move). |

---

## 3. Discipline matrix

Tools are listed in order of fit. "Custom" means code generated on the core stack for that Course.

| Discipline | What students need to *interact* with | Best-fit tools | Agent authoring from Materials | Gaps and cautions |
| --- | --- | --- | --- | --- |
| **Math: calculus** | Function and derivative sliders, tangent and secant, Riemann sums, series | JSXGraph; Mafs (if React); Plotly for 3D surfaces; Desmos or GeoGebra (licence-gated) | High. A function or construction is a few lines of code or one `evalCommand` string | Desmos and GeoGebra are the most polished, but free only for non-commercial use (§2.1). |
| **Math: linear algebra** | Matrix as transformation, eigenvectors, 3D spans | Mafs `Transform` and vector fields; JSXGraph `View3D`; three.js | High | No dedicated open library found. MathBox (MIT) has had no push since 2023 ([repo](https://github.com/unconed/mathbox)). |
| **Math: ODEs** | Slope and phase fields, parameter sweeps, solution curves | Mafs `Plot.VectorField`; JSXGraph; Pyodide + SciPy `solve_ivp` behind a Plotly chart | High | — |
| **Math: probability** | Distributions with parameter sliders, sampling and CLT | Plotly or JSXGraph; Pyodide `scipy.stats` | High | — |
| **Math: PDEs (in math courses)** | Heat, wave and Laplace equations with editable BCs | **VisualPDE** | High. Equations and BCs are text, loaded through the `options=` URL | — |
| **Logic circuits** | Gate simulation, truth tables, K-maps, timing | Simulator → **see #6** (DigitalJS, CircuitVerse …). Around it: **WaveDrom** for timing diagrams, netlistsvg for schematics, custom HTML for truth tables and K-maps | High. WaveJSON and truth tables are pure text | — |
| **Electric circuits** | Live circuits, phasors, transients | Simulator → **see #6**. Phasor diagrams in JSXGraph or Mafs; transient curves in Plotly | Medium–high | — |
| **Electronics** | Device curves, amplifier bias, frequency response | Simulator → **see #6**. Plotly for I–V and Bode curves | Medium | — |
| **Signals and systems** | Convolution, Fourier series and transform, sampling and aliasing, filters, pole–zero | JSXGraph or Plotly (custom); **Web Audio API** to hear filters and convolution; Pyodide `scipy.signal`; Falstad Fourier and filter applets (non-commercial) | High for plots, medium for audio | No ready-made open convolution or pole–zero widget found. |
| **Control** | Step response vs gains, root locus, Bode and Nyquist, PID tuning | Pyodide + **python-control** (unverified in-browser) or hand-written JS math, plotted with Plotly or JSXGraph; planck.js or Rapier for "plant" demos (inverted pendulum) | Medium–high. Transfer functions are text | **No maintained JS control library found** in this pass (search only surfaced one-off calculators). |
| **Electromagnetics** | Field lines, potentials, EM waves, waveguides | **Falstad** EM applets (non-commercial); three.js or JSXGraph for custom field-line plots; VisualPDE for wave equations and dipoles | Medium. Custom field plots need the physics coded by hand | No permissively licensed, maintained EM simulator found. |
| **Thermodynamics** | Property lookups, P–v and T–s diagrams, cycle analysis | **CoolProp WASM** for properties, with Plotly or JSXGraph for diagrams; math.js for units; PhET Gas Properties (CC BY-NC) as a link | High. Cycles are states and property calls | CoolProp needs WASM served with the right MIME type (§2.3). That matters for v1-style single-file or `file://` delivery (unverified in this setup). |
| **Heat transfer** | Conduction and convection fields, fins, transient cooling | **VisualPDE** (heat, inhomogeneous heat, thermal convection); Plotly for 1D analytic solutions | High | Energy2D-JS is dead (archived 2012, no licence). |
| **Fluid mechanics** | Flow fields, pressure and Bernoulli, potential flow, pipe flow charts | **VisualPDE** (Navier–Stokes, shallow water, vorticity, dipoles, method of images); Plotly for Moody-type charts; WebGL-Fluid-Simulation (visual only); PhET Fluid Pressure and Flow (CC BY-NC) | High for VisualPDE presets, medium for custom flows | The Schroeder LBM sim has no stated licence. |
| **Statics and dynamics** | Free-body diagrams, equilibrium, trusses, projectiles, rigid-body motion | JSXGraph for FBDs and vector sums; **PMKS+** static and dynamic force analysis of linkages; planck.js, Matter.js or Rapier for motion | High for JSXGraph, medium for physics engines (tuning) | No embeddable truss or frame solver found. anaStruct (Python) ships only compiled wheels, so it is not micropip-ready in Pyodide ([PyPI](https://pypi.org/project/anastruct/)). Its licence also differs: LGPL-3.0 on GitHub vs GPL-3.0-or-later on PyPI ([repo](https://github.com/anastruct/anaStruct)). |
| **Strength of materials** | SFD and BMD, stress transformation (Mohr's circle), deflection, torsion | Custom: JS computes the diagrams, drawn with JSXGraph or Plotly; three.js for 3D stress colouring | High. These are closed-form formulas | **No dedicated embeddable tool found.** VisualPDE's plate equation is adjacent but not beam theory. |
| **Machine design and mechanisms** | Linkages, cams, gears, kinematics | **PMKS+** for planar linkages; planck.js gear and pulley joints; JSXGraph for cam profiles. 3D parts and assemblies → **see #7** | Medium. PMKS+ links are shareable but the format is undocumented | Whether PMKS+ can be iframed was not verified. |
| **Numerical methods** | Watch a method converge (Newton, bisection, Euler/RK, finite differences), with error plots | Pyodide or **marimo WASM** (real Python, editable); JSXGraph or Plotly step-by-step visuals; VisualPDE for time-stepping and stability intuition | High | Pyodide adds a multi-MB runtime. Lazy-load it (unverified sizing). |
| **Machine learning** (Pilot course) | Gradient descent, decision boundaries, k-means, overfitting, neural nets | v1's zero-dependency demos (v1 `subject-types.md`); **TF Playground** (Apache-2.0, self-buildable, URL-hash state with `_hide` flags for UI controls: [state.ts](https://github.com/tensorflow/playground/blob/master/src/state.ts)); **Pyodide + scikit-learn**; TensorFlow.js ([site](https://www.tensorflow.org/js)); ONNX Runtime Web ([docs](https://onnxruntime.ai/docs/tutorials/web/)) | High | TF.js's last release was 2024-10 ([repo](https://github.com/tensorflow/tfjs)). ONNX Runtime Web is more active (v1.30.0, 2026-09) ([repo](https://github.com/microsoft/onnxruntime)). |

---

## 4. Tools that cover many disciplines at once

| Tool | Disciplines covered | Why it matters |
| --- | --- | --- |
| **JSXGraph** | All math rows, signals, control plots, statics FBDs, strength of materials, EM field plots, cams, numerical methods | Permissive (MIT option), 2D+3D, no dependencies, sandboxed text DSL (JessieCode). The most general open "draw anything mathematical" tool found. |
| **Plotly.js** | Every row that needs a chart or 3D surface | MIT, offline bundle, JSON-shaped input. |
| **Pyodide** (directly or through marimo) | Numerical methods, control, signals, probability, ODEs, ML, thermodynamics (through CoolProp's Python wrapper — unverified in Pyodide) | Runs the *same* SciPy code students see in lectures. Numbers can be checked against the Materials. |
| **VisualPDE** | Heat transfer, fluids, waves and vibrations, PDEs, numerical methods | One text/JSON-driven embed for every PDE-based topic. |
| **three.js** | EM, strength of materials, linear algebra, dynamics, machine parts (#7) | Standard 3D base. |
| **PMKS+** | Mechanisms, dynamics, statics of linkages | Verified solver; URL-based sharing. |
| **GeoGebra / Desmos** | All math, parts of physics | Broadest coverage, but licence-gated (§5). |

---

## 5. Licence risk summary

| Tool | Free use | Paid or blocked use | Source |
| --- | --- | --- | --- |
| Desmos API | Personal non-commercial, or a 90-day trial | "any use of the API in an Application that is accessed by End Users in production" (Commercial Tier, fees) | [api-terms.md](https://github.com/desmosinc/policies/blob/main/api-terms.md) |
| GeoGebra | Non-commercial, with attribution | Revenue-generating use, publishers, online schools | [licence](https://www.geogebra.org/license) |
| PhET sims | Educators, schools, students | Commercial advantage or monetary compensation (CC BY-NC since 2026-03-29) | [PhET post](https://phetsims.substack.com/p/a-small-change-to-support-a-big-mission) |
| Falstad applets | Classroom; non-commercial modify and redistribute with attribution | Everything else: "Contact me" | [licensing](https://www.falstad.com/licensing.html) |
| Remotion | Individuals, non-profits, companies up to 3 employees | Larger for-profits | [LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) |
| Energy2D-JS, Schroeder LBM | Unclear (no licence) | — | [energy2d-js](https://github.com/concord-consortium/energy2d-js), [LBM page](https://physics.weber.edu/schroeder/fluids/) |

Every other tool in §2 is MIT, ISC, BSD, Apache-2.0, MPL-2.0 or LGPL/MIT dual. They are free to
bundle, subject to attribution notices (VisualPDE HTML/CSS needs its CC-BY credit line).

---

## 6. Open questions and unverified points

- Whether `python-control` and CoolProp's Python package actually import inside Pyodide was not run.
- PMKS+'s URL encoding is not documented as a public format, and iframe embedding was not tested.
- VisualPDE's `options=` payload is its internal JSON. It is stable enough for its own share links,
  but there is no published schema.
- The size and cold-start cost of Pyodide, marimo WASM and CoolProp WASM were not measured. They
  matter if Study sites stay offline single files as in v1.
- PhET embedding mechanics and query parameters were not verified from a primary page in this pass.

---

## 7. Implications for learn-premium

These are options for #13, not decisions.

- **Option A: small open core, plus generated code per topic.** JSXGraph, Plotly, Pyodide (lazy),
  three.js and anime.js, with VisualPDE and PMKS+ as the two "specialist embeds". Every row in §3 is
  covered without API keys or non-commercial clauses. The cost is that control, strength of
  materials, signals and EM need the agent to write the physics and plots itself. That puts the
  weight on v1's verification discipline (numbers checked against Materials).
- **Option B: per-discipline toolkits.** Each discipline gets a named best tool (the §3 "best fit"
  column) and its own authoring recipe. Coverage is richer, but there are more integrations to
  maintain, and some rows land on licence-gated tools (Desmos, GeoGebra, PhET, Falstad).
- **Option C: core by default, licensed tools allowed only if the owner rules Study sites
  non-commercial.** If Study sites stay private and personal, Desmos (Trial Tier), GeoGebra, PhET and
  Falstad become usable. If they are ever sold or offered to clients, those embeds would need
  replacing or licences.
- **Classification granularity.** Many Courses mix disciplines (a heat-transfer Course uses ODEs and
  numerical methods). The matrix maps naturally to *per topic* tool choice with a per-Course default,
  which is the question #13 owns.
- **Animation route.** Manim gives the "3Blue1Brown" look but only as video. Motion Canvas's player
  or anime.js keep it live. Which of these fits is a design question for #4 and #11.
- **Delivery constraint to settle with #2 and #11.** WASM-based tools (Pyodide, CoolProp, Rapier)
  need correct MIME types and are large. That conflicts with v1's single-file offline build unless
  the stack changes.
