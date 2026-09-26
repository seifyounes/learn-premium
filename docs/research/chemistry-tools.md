# Research: which interactive tools fit engineering chemistry?

Ticket: [#22](https://github.com/seifyounes/learn-premium/issues/22) (wayfinder:research, feeds #13).
Researched: 2026-09-26. Findings only. The Owner makes the decisions.

**Scope.** Engineering chemistry was added as a discipline after the discipline-tools matrix
([#8](https://github.com/seifyounes/learn-premium/issues/8),
[`discipline-tools.md`](https://github.com/seifyounes/learn-premium/blob/research/discipline-tools/docs/research/discipline-tools.md))
was written. This note covers the topics of a typical engineering chemistry Course: stoichiometry and
balancing, gas laws, thermochemistry, equilibrium and ICE tables, kinetics, electrochemistry,
corrosion, water treatment and hardness, fuels and combustion, polymers, phase diagrams and basic
spectroscopy. For each topic it gives the tools that fit, their licence, embedding and
self-hosting, bundle size, whether an agent can author their content from the Materials, and how
each tool can take the Course pad's frame. The tools #8 already catalogued (JSXGraph, Plotly,
Pyodide, CoolProp, math.js, VisualPDE) are only re-checked where chemistry needs something new.

**Licence frame.** [#16](https://github.com/seifyounes/learn-premium/issues/16) decided that Study
sites are non-commercial and that licences are ignored for now. Licences are recorded here so the
deferred Licence review has the facts. They do not rule anything out.

**Method.** Primary sources only: licence files and metadata from the GitHub API, npm registry
metadata, PyPI JSON, the Pyodide lockfile, PhET's metadata API, and official docs. Every size and
behaviour marked **(run)** was measured or executed in this pass (Node 24, KaTeX 0.18.9, RDKit.js
2026.3.6, Pyodide 314.0.7, all in a scratch folder outside the repo). Anything inferred without a
source is marked **(unverified)**. No course Materials were read or used.

---

## 1. Key findings

1. **Chemistry notation is solved at build time.** KaTeX's `mhchem` extension renders `\ce{}` and
   `\pu{}` server-side in Node with no client JS. 27 of 29 test expressions rendered **(run)**:
   equations, equilibrium arrows, arrow conditions, states, precipitate and gas marks, charges,
   hydrates, isotopes, bonds, Kröger–Vink, units, cell notation, Nernst and K<sub>c</sub>
   expressions, and ICE tables built with `array`. Only `\cf` (deprecated) and `\chemfig` (not
   supported) failed. There are three traps: a trailing `-` after a subscript becomes a charge, the
   oxidation state prints as a superscript rather than over the symbol, and **rehype-katex 7.0.1
   pins its own KaTeX 0.16, so importing mhchem from a newer top-level KaTeX silently leaves `\ce`
   undefined (run).**
2. **Molecules come from three MIT/BSD pieces.** RDKit (BSD-3) at build time turns SMILES into
   validated 2D SVG in the pad's inks **(run)**. 3Dmol.js (BSD-3, about 160 KB gzipped) shows 3D
   ball-and-stick on demand. PubChem PUG REST turns a name into SMILES, a formula and a 3D SDF at
   build time **(run)**. Nothing has to call an outside service at view time.
3. **PhET has 35 HTML5 chemistry sims, all CC BY-NC 4.0** (PhET metadata API). Balancing Chemical
   Equations, Reactants/Products/Leftovers, Gas Properties, Molecule Shapes, Beer's Law Lab, pH
   Scale, Molarity and Concentration are the strong fits. Each is a single ~3 MB HTML file with no
   `X-Frame-Options` header **(run)**. PhET only accepts its own colour profiles, so it cannot take
   the pad. **There is no HTML5 PhET sim for kinetics, reversible reactions or electrochemistry:
   Reactions & Rates, Reversible Reactions and Soluble Salts are Java-only.**
4. **Python chemistry in the browser is patchy (run in Pyodide 314.0.7).** CoolProp imports and
   works: water T<sub>sat</sub> at 1 atm = 373.124 K, and the CO<sub>2</sub> triple point is
   correct. It needs matplotlib, though, which is about 27 MB with numpy. ChemPy's balancer and
   formula masses work only with `deps=False`, because `pyneqsys`, `pyodesys` and `sym` have no pure
   wheels. `pint` and `periodictable` install. **Cantera and RDKit do not install**: there are no
   wasm wheels.
5. **Cantera (BSD-3) belongs to the build, not the browser.** It is the right engine for
   adiabatic flame temperature, equilibrium composition and combustion products. It ships only
   native wheels. An agent runs it at build time and ships JSON tables to a JSXGraph or Plotly
   figure.
6. **No maintained embeddable tool exists for** ICE-table equilibrium, rate-law or Arrhenius
   exploration, galvanic cells or the Nernst equation, Pourbaix diagrams, hardness and softening
   calculations, or binary phase diagrams with the lever rule. None turned up on GitHub, npm or
   PhET. These need agent-built sims on the #8 core (JSXGraph and a small JS solver). All of them
   are closed-form or single-root problems, so an independent recompute can check them.
7. **Pad frame vs meaning colours has one real clash.** Jmol/CPK oxygen red (`#FF0D0D`) is only
   3° of OKLCH hue away from the red pen (`#C0341D`, hue 32°) **(run)**. The Red Pen Rule reserves
   red for marking. CPK white H (1.20:1), yellow S (1.12:1) and green Cl (1.29:1) are also nearly
   invisible as text on the Indigo sheet. 3D spheres survive through shading, but 2D labels need
   darkened variants. That is an Owner decision (§6).

---

## 2. Tool catalogue (chemistry-specific)

"Agent authoring" is the form an agent writes content in. Sizes are **(run)**: jsDelivr files,
gzip level 9. Activity is from the GitHub API on 2026-09-26.

### 2.1 Structures and molecules

| Tool | Licence | Size (raw / gzip) | Embed, self-host, touch | Agent authoring | Notes |
| --- | --- | --- | --- | --- | --- |
| **RDKit** (RDKit.js in Node, or Python) | BSD-3-Clause ([npm](https://www.npmjs.com/package/@rdkit/rdkit)) | `RDKit_minimal.wasm` 7.33 / 2.38 MB, plus a 106 KB JS loader | Use at **build time**: SVG output, no client cost. In-browser use is possible but heavy | SMILES → `get_svg_with_highlights` with `atomColourPalette`, `backgroundColour`, `bondLineWidth`, `legend` **(run)**. `is_valid()` rejects bad SMILES **(run)**. `get_inchi()` gives the formula layer for checks | v2026.03.6. RDKit.js has no `get_formula`. Take the formula from the InChI, or from Python `CalcMolFormula` (unverified). |
| **3Dmol.js** | BSD-3-Clause ([LICENSE](https://github.com/3dmol/3Dmol.js/blob/master/LICENSE)) | `3Dmol-min.js` 0.54 / 0.16 MB | Self-hosted JS, WebGL. Auto-embed with `class="viewer_3Dmoljs"` and `data-href`/`data-type`/`data-style`/`data-backgroundcolor`/`data-backgroundalpha` ([embeddable](https://3dmol.csb.pitt.edu/doc/tutorial-embeddable.html)). `data-cid`/`data-pdb` fetch from PubChem/RCSB at view time: avoid, and bundle the file instead | Style JSON (`{stick:{}, sphere:{scale:0.3}}`) plus a model file string (SDF, MOL2, XYZ, PDB, CIF, CUBE …) ([formats](https://3dmol.csb.pitt.edu/doc/global.html)) | Element schemes include `Jmol`, `rasmol`, `CPK`, `greenCarbon` … and custom maps or colour functions ([global](https://3dmol.csb.pitt.edu/doc/global.html)). Active: v2.5.5, 2026-05, 1k stars. Phone touch not tested. |
| **Kekule.js** | MIT ([README](https://github.com/partridgejiang/Kekule.js)); the npm `license` field is empty | `core.min.js` 0.24 / 0.05 MB; `chemWidget.min.js` 0.97 / 0.17 MB; full `kekule.min.js` 2.66 / 0.57 MB. Optional OpenBabel/Indigo WASM 4–5 MB each | Self-hosted, `data-widget="Kekule.ChemWidget.Viewer"` auto-init | Molfile/SMILES/CML strings. Reads **JCAMP-DX spectra** ([README](https://github.com/partridgejiang/Kekule.js)) | Viewer, editor ("Composer") and spectrum loading in one MIT kit. Small community (279 stars), active (v1.0.4, 2026-05). |
| **SmilesDrawer** | MIT ([repo](https://github.com/reymond-group/smilesDrawer)) | 0.20 / 0.06 MB | Client-side SVG/canvas | SMILES string | "The colors of SmilesDrawer are completely configurable" through a `themes` object ([README](https://github.com/reymond-group/smilesDrawer)). The lightest client-side 2D option when a drill must draw a student-entered SMILES. |
| **OpenChemLib JS** | BSD-3-Clause ([repo](https://github.com/cheminfo/openchemlib-js)) | 1.10 / 0.34 MB | Self-hosted | Molfile/SMILES/IDCode | Has an editor and toolkit. Only 90 stars. |
| **Ketcher** | Apache-2.0 ([repo](https://github.com/epam/ketcher)) | `ketcher-standalone` is 110 MB unpacked on npm | React app | — | A full structure editor. Too heavy for "draw this monomer" drills. |
| **NGL / Mol\*** | MIT ([ngl](https://github.com/nglviewer/ngl), [molstar](https://github.com/molstar/molstar)) | NGL 0.82 / 0.23 MB; Mol\* viewer 5.03 / 1.44 MB | Self-hosted | PDB/mmCIF | Built for macromolecules and proteins. Overkill for small molecules. |
| **JSmol (Jmol)** | LGPL-2.0 ([SourceForge](https://sourceforge.net/projects/jmol/)) | Not measured; distributed as a zip, not on npm | Self-hosted HTML5 mode. The Java mode is "faster … by a factor of 6 to 10" than HTML5 ([wiki](https://wiki.jmol.org/index.php/JSmol)) | Jmol script (text) | Includes JSpecView (JCAMP-DX, NMR) ([SourceForge](https://sourceforge.net/projects/jmol/)). Powerful, but a legacy transpiled codebase. v16.4.23, 2026-09-06. |
| **ChemDoodle Web Components** | GPL-3.0 or proprietary ([licence](https://web.chemdoodle.com/installation/license)) | Not measured | Self-hosted | JS | 2D/3D, reactions, spectra and a periodic table in one kit ([site](https://web.chemdoodle.com/)). GPL obligations as with CircuitJS (#16). |
| **PubChem PUG REST** | Public NIH service | — | **Build time only** | `…/compound/name/{name}/property/MolecularFormula,SMILES,IUPACName/JSON` returned C<sub>2</sub>H<sub>4</sub>, `C=C`, "ethene" for "ethylene". `…/name/aspirin/SDF?record_type=3d` returned a 3D SDF **(run)** | Responses carry an `X-Throttling-Control` header **(run)**. The usage-policy page did not render for fetching (unverified). |

### 2.2 Computation (browser or build)

| Tool | Licence | Where it runs | Verified behaviour | Notes |
| --- | --- | --- | --- | --- |
| **CoolProp** | MIT ([repo](https://github.com/CoolProp/CoolProp)) | Browser, either as Pyodide package `coolprop` 7.2.0 (4.89 MB, depends on numpy and matplotlib) **(run)**, or as the JS wrapper (`coolprop.wasm` 9.2 MB + `coolprop.js` 167 KB, [SourceForge](https://sourceforge.net/projects/coolprop/files/CoolProp/8.0.0/Javascript/)) | `PropsSI('T','P',101325,'Q',0,'Water')` = 373.124 K. CO<sub>2</sub> triple point = 216.59 K, 517.96 kPa **(run, Pyodide)** | Real-gas behaviour (the Z factor against the ideal gas law) and the water and CO<sub>2</sub> phase diagrams. The JS wrapper avoids matplotlib, so it is the lighter route (unverified in this pass). |
| **Cantera** | BSD-3-Clause ([License.txt](https://github.com/Cantera/cantera/blob/main/License.txt)) | **Build machine only**. PyPI 3.2.0 ships macOS, manylinux and win_amd64 wheels only ([PyPI](https://pypi.org/project/cantera/)). `micropip.install('cantera')` fails **(run)** | — | Combustion: adiabatic flame temperature, equilibrium products, ignition. Precompute tables and plot them client-side. No WASM effort found on GitHub. |
| **ChemPy** | BSD-2-Clause ([repo](https://github.com/bjodah/chempy)) | Build machine, or Pyodide with `deps=False` plus `quantities`, `pyparsing` and `tabulate` | `balance_stoichiometry({'C3H8','O2'},{'CO2','H2O'})` → 1, 5 → 3, 4. `Substance.from_formula('Fe2(SO4)3').mass` = 399.858 **(run, Pyodide)**. A full install fails: no pure wheels for `sym`, `pyneqsys`, `pyodesys` **(run)** | Best used at build time to recompute balanced equations and molar masses as a verification gate. v0.10.2, 2026-09-19. |
| **pint / periodictable** | BSD ([pint](https://github.com/hgrecco/pint)), public domain ([periodictable](https://github.com/python-periodictable/periodictable)) (unverified: licences not checked) | Pyodide via micropip **(run)** | `8.314 J/mol/K × 298 K → 2.4776 kJ/mol`. `formula('CaCO3').mass` = 100.086 **(run)** | Unit-safe arithmetic and molar masses for build-time checks. math.js (Apache-2.0, #8) is the JS equivalent. |
| **pycalphad** | MIT ([LICENSE](https://github.com/pycalphad/pycalphad/blob/develop/LICENSE)) | Build machine. It depends on `symengine`, which is not in the Pyodide lockfile **(run)** | — | Computes binary phase diagrams from TDB thermodynamic databases. The Course's diagram is usually a textbook one (Fe–C, Cu–Ni, Pb–Sn), so digitising the Materials figure is more faithful. |
| **PHREEQC** | USGS public software ([USGS](https://www.usgs.gov/software/phreeqc-version-3)) | Build machine. No JS or WASM port found on GitHub | — | Aqueous speciation and saturation indices. Beyond a typical hardness syllabus. |
| **Pyodide core** | MPL-2.0 | Browser | `pyodide.asm.wasm` 9.60 MB + `python_stdlib.zip` 2.55 MB. numpy 2.96, scipy 14.03, sympy 4.19, matplotlib 6.98 MB **(run; uncompressed transfer)** | That is ~12 MB before any package. Keep it a lazy, opt-in "run the Python" tool, not the default engine for chemistry figures. |

### 2.3 Ready-made sims

| Tool | Licence | Embed | Chemistry sims that fit (HTML5) | Customisation |
| --- | --- | --- | --- | --- |
| **PhET** | Each sim lists `by-nc/4.0` and `GPL/2.0` in the metadata API ([API](https://phet.colorado.edu/services/metadata/1.3/simulations?format=json&type=html)). Sims published before 2026-03-29 stay CC BY ([licensing](https://phet.colorado.edu/en/licensing/html)) | `…/sims/html/{sim}/latest/{sim}_all.html` is one ~3 MB file (Balancing 3.11 MB, Gas Properties 3.04 MB). No `X-Frame-Options` header **(run)** | Balancing Chemical Equations; Reactants, Products and Leftovers; Gas Properties; Gases Intro; Diffusion; States of Matter; Molecule Shapes; Molecule Polarity; Build a Molecule; Build an Atom; Isotopes and Atomic Mass; Beer's Law Lab; Concentration; Molarity; pH Scale; Acid-Base Solutions; Molecules and Light; Energy Forms and Changes; Atomic Interactions (35 in the chemistry category) | Public query parameters include `screens`, `initialScreen`, `homeScreen` and `colorProfile`. `colorProfile` only accepts the sim's own profiles ([initialize-globals.js](https://github.com/phetsims/chipper/blob/main/js/browser/initialize-globals.js)), so no pad colours. The content is fixed: it cannot load the Professor's equations. |
| **ChemCollective Virtual Lab** | CC BY-NC-ND 3.0 ([terms](https://chemcollective.org/terms)) | Hosted (embed terms not stated) | Titration (NaOH/KHP, unknown acid-base), calorimetry and Hess's law, redox, Le Chatelier ([vlabs](https://chemcollective.org/vlabs)) | NoDerivs. The only fit is a "go try this" link. |

### 2.4 Things searched for and not found

- A maintained **JS equation balancer**. The GitHub results are 1–3-star one-offs, mostly
  unlicensed. The balancing maths is a rational null-space problem, a few dozen lines on math.js
  fractions.
- A **PHREEQC** or **Cantera** WASM build.
- An **HTML5** PhET sim for kinetics, reversible reactions or solubility. `reactions-and-rates`,
  `reversible-reactions` and `soluble-salts` appear only in the Java listing of the metadata API
  **(run)**.
- An open **galvanic-cell, Nernst or Pourbaix** widget. pymatgen (MIT) can compute Pourbaix
  diagrams, but it draws on Materials Project data through their API (unverified: the key
  requirement was not confirmed from a primary page).
- **Spectrum parsing:** `jcampconverter` on npm is **CC-BY-NC-SA-4.0** (v11 and v12), and so is
  `@zakodium/nmrium-core`. Kekule.js (MIT) reads JCAMP-DX.

---

## 3. Topic matrix

"Agent-built" means code the agent writes for this Course on the #8 core: JSXGraph for interactive
geometry and sliders, Plotly for data plots, KaTeX for notation. The numbers are recomputed by an
independent build-time script (ChemPy, pint, CoolProp or Cantera).

| Topic | What students interact with | Best-fit tools | Agent authoring from Materials | Needs an agent-built sim? |
| --- | --- | --- | --- | --- |
| **Stoichiometry and balancing** | Balance an equation, mole ratios, limiting reagent, % yield | mhchem for notation. **Agent-built** balancing drill (coefficient steppers with a live atom-count table) and a limiting-reagent sim. PhET Balancing Chemical Equations and Reactants/Products/Leftovers as optional links | **High.** Equations are `\ce{}` text, and the correct coefficients are recomputed at build time by ChemPy `balance_stoichiometry` **(run)**. Masses come from `periodictable` or ChemPy | Yes, for the Professor's own equations (PhET's are fixed). Small. |
| **Gas laws** | P–V–T sliders, ideal vs real gas, Dalton, van der Waals | **Agent-built** JSXGraph P–V isotherms. CoolProp for real-gas Z against the ideal gas (lazy). PhET Gas Properties / Gases Intro | High. Closed-form laws, constants from the Materials | Yes for Course numbers. PhET covers the intuition. |
| **Thermochemistry** | Hess cycles, ΔH from formation enthalpies, calorimetry, Kirchhoff | mhchem + `\pu{}` for equations. **Agent-built** Hess-cycle diagram (SVG) and an enthalpy-level diagram. Plotly for ΔH(T) | High. ΔH<sub>f</sub>° values **must come from the Professor's table**, not an outside database. Recompute with pint | Yes (diagram + calculator). Cantera optional at build time. |
| **Equilibrium and ICE tables** | Fill I/C/E rows, solve for x, Le Chatelier shifts, Q vs K | **ICE table = the Study site's solving table** (the Computation Pad's signature component; KaTeX `array` also works **(run)**). **Agent-built** Le Chatelier sim: sliders for concentration, P and T, with a JS root-find for x | **High.** The ICE table is rows and columns, filled in hand order. x is recomputed by a build script and checked against the Materials' answer | Yes. No tool found (§2.4). |
| **Kinetics and rate laws** | Integrated rate laws (0, 1, 2 order), half-life, initial rates, Arrhenius (ln k vs 1/T) | **Agent-built** JSXGraph/Plotly: concentration–time with an order selector, linearised plots, Arrhenius fit. Pyodide + SciPy `solve_ivp` only for multi-step mechanisms | High. Closed-form, and data tables come from the Materials | **Yes.** There is no HTML5 PhET (Reactions & Rates is Java-only). |
| **Electrochemistry and cells** | Cell notation, E°cell from the series, Nernst E vs concentration and T, ΔG = −nFE, electrolysis (Faraday) | mhchem cell notation `\ce{Zn(s) \| Zn^{2+}(aq) \|\| Cu^{2+}(aq) \| Cu(s)}` **(run)**. **Agent-built** Nernst sim (sliders for [ion], T and n, with a live E and a cell diagram with electron flow) | **High.** The Nernst equation and E° values from the Materials. A build-time recompute of E at each preset | **Yes.** Nothing ready-made found. |
| **Corrosion** | Galvanic series, Pourbaix (E–pH) regions, differential aeration, protection (sacrificial anode, impressed current) | **Agent-built** Pourbaix diagram: lines computed from Nernst for the Course's metal (usually Fe), drawn in JSXGraph with a movable (pH, E) point that names the region. Illustrated cells (SVG + anime.js) | Medium–high. Lines follow from the E° values and reactions in the Materials. Region labels need care | **Yes.** pymatgen is possible at build time, but its data source differs from the lecture's. |
| **Water treatment and hardness** | Temporary vs permanent hardness (as CaCO<sub>3</sub> equivalents), EDTA titration, lime-soda requirements, ion exchange, (sometimes) BOD/COD | **Agent-built** calculators and step-throughs on the solving table. An animated EDTA titration curve (JSXGraph). mhchem for the reactions | **High.** These are formula-driven, and the equivalents are recomputed with `periodictable` **(run: CaCO<sub>3</sub> = 100.086)** | Yes, as worked-example tables more than sims. |
| **Fuels and combustion** | Calorific value (Dulong, bomb calorimeter), proximate and ultimate analysis, air–fuel ratio, flue-gas composition, adiabatic flame temperature | **Agent-built** air–fuel and flue-gas calculator. **Cantera at build time** for flame temperature and equilibrium products against the equivalence ratio, shipped as JSON to Plotly | High for the syllabus formulas. Cantera tables are generated, not authored | Yes. Cantera cannot run in the browser (§2.2). |
| **Polymers** | Monomer → repeat unit, addition vs condensation, tacticity, Mn/Mw and PDI, Tg | RDKit SVG for monomers and repeat units. 3Dmol.js for an oligomer in 3D (tacticity). mhchem `\ce{-[CH2-CH2]_{n}-{}}` (note the trailing `{}`, §4). **Agent-built** Mn/Mw calculator | High for 2D. 3D oligomers need an RDKit embedding step at build time (unverified: not run) | Small (calculator). |
| **Phase diagrams** | Water/CO<sub>2</sub> P–T, Gibbs phase rule, binary eutectic and isomorphous diagrams, lever rule, cooling curves | **Agent-built** JSXGraph diagram with a draggable state point that reads the phases and lever-rule fractions. Single-component curves from CoolProp at build time. Binary diagrams **digitised from the Materials figure** | Medium. Digitising a figure needs a fidelity check (as in v1's figure-fidelity gate and #19's "scaled" tags) | **Yes.** No embeddable phase-diagram tool found. |
| **Basic spectroscopy** | Beer–Lambert (A = εlc), calibration curve, UV-Vis/IR bands, reading a spectrum | **Agent-built** Beer–Lambert sim + Plotly calibration fit. PhET Beer's Law Lab / Molecules and Light as links. Kekule.js or JSmol/JSpecView if a JCAMP spectrum must be shown | High for Beer–Lambert. **Spectra themselves need a clean source**: NIST WebBook data is copyrighted Standard Reference Data ([NIST](https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications)), so take spectra from the Materials | Yes for Beer–Lambert. |
| **Structure and bonding** (usually in the same Course) | VSEPR shapes, polarity, hybridisation, crystal structures | 3Dmol.js (molecules; CIF for unit cells). PhET Molecule Shapes / Molecule Polarity | High. A name or SMILES leads, at build time, to a 3D SDF from PubChem or RDKit | No. |

---

## 4. Chemistry notation: KaTeX `mhchem`

**What it is.** `katex/contrib/mhchem` adds `\ce` and `\pu` ([README](https://github.com/KaTeX/KaTeX/blob/main/contrib/mhchem/README.md)).
It "implements a KaTeX version of mhchem version 3.3.0", adapted from MathJax. Reaction arrows are
drawn with KaTeX's extensible arrows ([mhchem.js](https://github.com/KaTeX/KaTeX/blob/main/contrib/mhchem/mhchem.js)).
The mhchem manual lists all feature groups (formulae, charges, isotopes, arrows, bonds, oxidation
states, radicals, Kröger–Vink, precipitate/gas, units) and notes that "all the arrows do stretch in
LaTeX and KaTeX" ([manual](https://mhchem.github.io/MathJax-mhchem/)). Licence: KaTeX is MIT. The
mhchem code is Apache-2.0 (header of `mhchem.js`).

**Size.** `mhchem.min.js` is 34 KB raw, about 10 KB gzipped **(run)**. At build time it costs the
page nothing: only `katex.min.css` (25 KB raw) and the KaTeX fonts ship.

**Build-time rendering (run).** `require('katex'); require('katex/contrib/mhchem');
katex.renderToString('\\ce{…}')` works in Node. KaTeX's own maintainers describe this route as
"not well-documented" ([KaTeX#2168](https://github.com/KaTeX/KaTeX/issues/2168)). The package
exports `./contrib/mhchem` for both `import` and `require` (`katex` `package.json`).

**Test set (run, 29 expressions, visually checked in a browser).**

| Worked | Failed |
| --- | --- |
| `\ce{2 H2 + O2 -> 2 H2O}`, `<=>`, `<=>>`, `<->`, `->[\Delta][-CO2]`, long text over arrows, `(aq)`/`(s)` states, `v` precipitate, `^` gas, `Fe^{3+}`, `e-`, `CuSO4.5H2O`, `^{235}_{92}U`, `-`/`=`/`#`/`\bond{~}` bonds, Kröger–Vink, radical dots, `\pu{8.314 J K-1 mol-1}`, `\pu{1.2e-3 mol L-1}`, `\pu{123 kJ//mol}`, Nernst and K<sub>c</sub> with `\ce` inside `\frac`, cell notation, an ICE table in `\begin{array}`, a thermochemical equation with `\Delta_r H^\circ = \pu{…}` | `\cf{H2O}`: "This extension supports only `\ce`" ([README](https://github.com/KaTeX/KaTeX/blob/main/contrib/mhchem/README.md)). `\chemfig`: not supported, and a maintainer calls it "Pretty hard" because it depends on TikZ ([KaTeX#2232](https://github.com/KaTeX/KaTeX/issues/2232)) |

**Limits and traps.**

- **No structural formulas.** Skeletal or structural drawings (`chemfig`) are not possible in KaTeX.
  Use RDKit SVG (§2.1).
- **A trailing `-` after a subscript or bracket becomes a charge.** `\ce{-[CH2-CH2]_{n}-}` renders
  the last `-` as a superscript. `\ce{-[CH2-CH2]_{n}-{}}` fixes it **(run, MathML checked)**. An
  agent will hit this with polymer repeat units.
- **Oxidation states print as superscripts.** `\ce{Fe^{II}}` puts the Roman numeral top-right, not
  over the symbol. A user reported this as incorrect, and KaTeX sent it upstream to mhchem
  ([KaTeX#3807](https://github.com/KaTeX/KaTeX/issues/3807)). Use `\overset{+2}{\ce{Fe}}` when the
  Professor writes it over the symbol.
- **Chemistry inside `\cancel` loses parsing.** `\ce{\cancel{H2O}}` renders italic math. Write
  `\cancel{\ce{H2O}}` instead **(run)**. This matters for cancelling spectator ions.
- **Spacing is slightly wider than MathJax** between a subscript and the next element (open bug
  [KaTeX#2165](https://github.com/KaTeX/KaTeX/issues/2165)). It is cosmetic.
- **`<=>>` loses its unequal shape in the MathML output** (an accessibility layer, not the visual)
  **(run)**.
- **Integration trap (run):** `rehype-katex@7.0.1` depends on `katex ^0.16.0`. With `katex@0.18.9`
  at the top level, npm installs a nested 0.16.47. `import 'katex/contrib/mhchem'` then patches the
  wrong copy, and `\ce` renders as the letters "c e". Aligning the top-level KaTeX to 0.16.x (or
  forcing one copy with `overrides`) fixed it. Any Markdown pipeline (Astro, per #9) needs a build
  gate that renders one `\ce` and fails on an error span.
- **Direction.** Chemical equations are LTR like numbers (global bilingual rule). On an Arabic page
  they need `dir="ltr"` isolation (unverified: not tested in RTL).

---

## 5. Can an agent author it from the Materials?

| Content | Route | Verdict | Gate that makes it trustworthy |
| --- | --- | --- | --- |
| Balanced equation | `\ce{}` text written by the agent | **Yes** | ChemPy `balance_stoichiometry` recomputes the coefficients from the species list **(run)**, and atoms and charge must balance on both sides |
| Worked ICE table | The Study site's solving table (rows I, C, E; columns = species), filled in the Professor's order | **Yes** | An independent script solves for x (a quadratic or root-find) and compares it with the Materials' answer, v1-style |
| Nernst-equation sim | Agent writes a JSXGraph island: sliders feed E = E° − (RT/nF) ln Q | **Yes (agent-built)** | Recompute E at each preset in a build test, with E° values traced to the Materials |
| Molecule from a name | PubChem name → SMILES + formula + 3D SDF at build time **(run)**, bundled for 3Dmol.js | **Yes** | The PubChem formula must match the formula the agent wrote in `\ce{}`, and RDKit must parse the SMILES |
| Molecule from SMILES | RDKit SVG (2D) at build time **(run)**, or RDKit 3D embedding for 3Dmol (unverified) | **Yes, with a gate** | LLM-written SMILES can be valid but wrong. Cross-check the InChI formula against the Materials' formula and look the name up in PubChem |
| PhET sim | Pick a sim and a screen via `screens=` | Choose only, no content authoring | — |
| Rate-law, phase-diagram, Pourbaix and hardness sims | Agent-built JSXGraph/Plotly islands | **Yes (agent-built)** | Closed-form recompute. Phase diagrams additionally need a fidelity check against the Materials figure |
| Combustion tables | Cantera at build time → JSON | **Yes** | Compare one point with a textbook value quoted in the Materials |
| Spectra | Only from the Materials (digitised or supplied files) | Partly | The source must be the Materials. Outside databases carry licence restrictions (§3) |

**Topics that need an agent-built sim:** equilibrium and Le Chatelier (the ICE table itself is the
solving table), kinetics and Arrhenius, the Nernst equation and cells, Pourbaix and corrosion, water
hardness and softening, combustion calculators, phase diagrams with the lever rule, and
Beer–Lambert. Stoichiometry and gas laws also want an agent-built version for the Professor's
numbers, with PhET as an optional side link.

---

## 6. Taking the pad frame while keeping meaning colours

#20 rule: tools take the frame (sheet, grid, print, graphite) but keep colours that carry meaning.
The Indigo ink pad values below come from `DESIGN.md` (sheet `#E5EAF6`, grid-major `#B8C2DA`, print
`#2D3E7E`).

| Tool | How it takes the frame | Meaning colours |
| --- | --- | --- |
| **KaTeX + mhchem** | Inherits CSS `color`, so it renders in graphite on the sheet like all paper math | None. Arrows and charges are monochrome |
| **RDKit SVG** | `backgroundColour: [0,0,0,0]` lets the grid show through, carbon and bonds go graphite through `atomColourPalette` **(run)**, and `bondLineWidth` matches pencil weights | Heteroatom colours kept. The palette is per-element, so darkened CPK variants are one config value |
| **3Dmol.js** | `backgroundAlpha 0` puts the model on the sheet. Labels and axes can use graphite and pencil | `colorscheme: 'Jmol'` or a custom element map |
| **SmilesDrawer** | A custom `themes` entry (C → graphite, background transparent) | Per-element theme colours |
| **JSXGraph / Plotly (agent-built)** | Full control: grid-fine and grid-major lines, pencil axes, mono ticks (#4 Figure spec) | Species colours are chosen per figure. Red is reserved for the pen |
| **PhET** | **Cannot take the frame.** `colorProfile` only accepts the sim's own profiles ([chipper](https://github.com/phetsims/chipper/blob/main/js/browser/initialize-globals.js)). Frame it with a ruled `print` border and the credit line | Its own |
| **Kekule / JSmol / ChemDoodle** | Theme CSS or script colours (unverified per tool) | Own element schemes |

**The CPK problem (run, WCAG 2.x on the Indigo sheet, OKLCH hue against the red pen at 32°).**

| Element (Jmol colour) | Contrast on sheet | Hue gap to red pen |
| --- | --- | --- |
| O `#FF0D0D` | 3.28:1 | **3°** |
| N `#3050F8` | 4.80:1 | 125° |
| C `#909090` | 2.65:1 | grey |
| H `#FFFFFF` | **1.20:1** | grey |
| S `#FFFF30` | **1.12:1** | 78° |
| Cl `#1FF01F` | **1.29:1** | 111° |
| Fe `#E06633` | 2.85:1 | **10°** |
| Cu `#C88033` | 2.64:1 | 32° |

- **Oxygen and iron sit on the red pen's hue.** The Red Pen Rule says red means marking. A red O
  next to a red-pen ring reads as the same ink. Darkening O to `#B01010` reaches 5.95:1 but stays
  red (4° gap).
- **H, S, Cl and C fail as 2D text.** A 3D sphere survives through shading and a silhouette. A 2D
  label does not. RDKit's darker defaults help (N `#0000FF` 7.13:1) but not for Cl `#00CC00`
  (1.81:1).

These are options for the Owner, not decisions:

- **A. Chemistry exception:** atom colours are meaning colours and stay CPK inside a molecule
  figure. The red pen stays a stroke (ring, double frame, arrow) and never touches an atom. This is
  the smallest change to convention, but red means two things on one sheet.
- **B. Pad-safe CPK:** keep CPK hues but darken every element to ≥4.5:1 on the sheet (the same
  auto-fix the pad build already runs). O and Fe keep their conventional red and orange, and the
  red pen is told apart by shape only. This matches #20's "red marks always carry a shape" rule.
- **C. Monochrome structures by default:** graphite skeletal drawings with element *letters* (how
  a Professor writes on paper). Colour only in 3D views, with CPK. This is the most "paper", and
  it removes the clash in 2D.

---

## 7. Licence summary (for the deferred Licence review)

| Tool | Licence | Note |
| --- | --- | --- |
| KaTeX, mhchem (KaTeX build) | MIT; mhchem parts Apache-2.0 | Credit lines only |
| RDKit, 3Dmol.js, OpenChemLib, Cantera | BSD-3-Clause | Build-time use ships only output (RDKit, Cantera) |
| ChemPy | BSD-2-Clause | Build time |
| Kekule.js, SmilesDrawer, NGL, Mol\*, CoolProp, pycalphad | MIT | — |
| Ketcher | Apache-2.0 | — |
| JSmol / Jmol | LGPL-2.0 | Source offer if modified (unverified detail) |
| ChemDoodle Web Components | GPL-3.0 or proprietary | GPL obligations as with CircuitJS (#16) |
| PhET chemistry sims | CC BY-NC 4.0 (plus GPL-2.0 code) | Credit and logo at the point of use (#16) |
| ChemCollective | CC BY-NC-ND 3.0 | Link only |
| jcampconverter, @zakodium/nmrium-core | CC-BY-NC-SA-4.0 | Avoid. Kekule.js reads JCAMP under MIT |
| NIST Chemistry WebBook data | Copyrighted Standard Reference Data | Avoid as a data source. Use the Materials |

---

## 8. Open questions and unverified points

- 3Dmol.js touch rotate and zoom on a real phone, and its WebGL cost next to KaTeX pages. Not
  tested.
- RDKit 3D embedding (ETKDG) for oligomers and 3Dmol, in RDKit.js or Python. Not run.
- CoolProp JS wrapper (9.2 MB WASM) against the Pyodide route (about 27 MB with matplotlib), and
  cold-start times in a browser. Only the Node/Pyodide route was run. That first call took about
  74 s, including package download, which is not representative of a cached browser.
- PubChem's published request limits and terms: the policy pages did not render for fetching.
- mhchem inside RTL (Arabic) pages.
- Whether an agent can digitise a Materials phase diagram (Fe–C) accurately enough. This is the
  same class of risk as #18's "figure to circuit".
- The CPK and red-pen choice (§6) needs a visual prototype on the Indigo pad before the Owner
  decides.

---

## 9. Recommended core toolkit for engineering chemistry

These are recommendations for #13 and the Owner, not decisions. The toolkit follows #8 Option A
(small open core plus agent-built sims) and adds four chemistry pieces.

**Core (every chemistry Course):**

1. **KaTeX + `mhchem` at build time** for all equations, units, cell notation and ICE-table
   notation. Include a build gate that renders a `\ce` probe (to catch the rehype-katex duplicate
   copy) and a lint for trailing `-` and `\ce{\cancel…}`.
2. **The Study site's solving table** as *the* ICE-table, stoichiometry-table and hardness-table
   tool. The Computation Pad already makes this its signature component.
3. **RDKit at build time** (Node RDKit.js or Python) for 2D structure SVG in pad inks, with
   PubChem name lookup and formula cross-checks as the molecule gate.
4. **3Dmol.js (lazy)** for 3D molecules, VSEPR shapes and polymer segments, loading bundled SDF
   files, never runtime fetches.
5. **JSXGraph + Plotly (from #8)** for the agent-built sims: Le Chatelier, kinetics and Arrhenius,
   Nernst and cells, Pourbaix, phase diagram and lever rule, Beer–Lambert, gas laws.
6. **A build-time Python verification kit:** ChemPy (balancing, molar masses), pint and
   periodictable (units and masses), CoolProp (real gas, water and CO<sub>2</sub> phases) and
   Cantera (combustion tables). All of it runs on the build machine, so nothing heavy ships to the
   browser.

**Optional, per Course:** PhET chemistry sims as credited "explore" links or iframes, placed where
they match a topic (balancing, gases, molecule shapes, Beer's law, pH). CoolProp in the browser only
if a Course needs live real-gas lookups. Kekule.js if the Materials include JCAMP spectra.

**Not recommended:** Ketcher and Mol\* (too heavy for the need), jcampconverter (NC-SA), NIST
spectra as a data source, and Pyodide as the default chemistry engine (about 12 MB before
packages, against the "light shell" rule from #2).

## 10. Open risks

- **Red pen against CPK red.** This needs an Owner decision (§6 options A/B/C) before any chemistry
  figure ships.
- **Silent mhchem failure through a duplicated KaTeX.** This is proven (§4), so a gate is
  mandatory.
- **LLM-written SMILES or formulas can be wrong but valid.** Verification depends on the PubChem
  and InChI cross-check. Names the Professor uses informally (trade names, polymer abbreviations)
  may not resolve.
- **The agent-built share is large.** 8 of 12 topics need a custom sim, and 2 more (stoichiometry,
  gas laws) want one for the Professor's numbers. Correctness rests on v1's
  independent-recompute discipline, and each sim needs a preset-by-preset build test.
- **The main topic tools for kinetics, cells and phase diagrams are agent-built,** with no tested
  reference implementation yet. A chemistry prototype ticket (like #18/#19 for circuits and parts)
  would retire this risk.
- **PhET cannot match the pad,** and the Owner has not decided (per #16) whether non-commercial
  embeds are safe on a portfolio-linked site.
- **There is no second pilot for chemistry.** The Pilot course (ML) exercises none of this. A
  synthetic chemistry fixture or a real Course would be needed to prove it end to end.
