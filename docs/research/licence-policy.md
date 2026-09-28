# Licence policy: what Study sites ship, link, generate and republish

Research for issue #34, as of **2026-09-28**. Primary sources only: official LICENSE files in
project repos, the npm registry, official licence texts (SPDX, gnu.org, creativecommons.org,
openfontlicense.org), rights-holders' own terms pages, WIPO Lex and WTO. This is a record of what
the sources say. It is **not legal advice**, and it makes no decisions. The owner decides.

Quotes are verbatim and kept short. "UNVERIFIED" marks anything not confirmed at a primary source.

## 0. Summary

- **Most shipped libraries are MIT or BSD.** Their only condition is to keep the copyright
  notice and licence text with every copy, and a minified bundle is a copy.
- **Two shipped libraries also need the source to be available:**
  - **elkjs** (EPL-2.0 §3.1)
  - **Pyodide** (MPL-2.0 §3.2)
  - For both, the duty is to make the source available and to tell recipients how to get it. A
    link to the exact upstream release is the usual way to do that.
- **Watch items:**
  - **Fonts with a Reserved Font Name.** The KaTeX font files declare OFL-1.1 with RFNs, even
    though the katex-fonts repo says MIT.
  - **mhchem ships without a header.** KaTeX's minified mhchem file has no licence header, but
    its code is part Apache-2.0.
  - **Third-party code inside Plotly.** The full `plotly.min.js` bundles maplibre-gl (BSD-3).
  - **Compiled-in libraries in RDKit and CoolProp.** Their WASM builds include other libraries.
  - **No LICENSE file in two npm packages.** `pyodide` and `@rdkit/rdkit` ship without one.
- **Build-time tools put no licence on their output.** Running a tool without distributing it
  creates no obligations. The GPL FAQ and the GPL/LGPL texts say output is covered only when it
  copies the program itself. Numbers, GLB files, MP4s and transcripts are not covered.
  H.264 patents are a separate question, and this research did not resolve it.
- **Linking to a CC work.** A plain hyperlink to PhET or Falstad copies nothing. CC's own FAQ says
  that in "some countries" linking needs no copyright permission, so no licence duty applies
  there. CC does not say this holds everywhere.
- **NotebookLM (now Gemini Notebook).** Google does not claim ownership of generated content.
  Users must not mislead people into thinking AI content was made by a human. No attribution to
  Google is required.
- **Public repo without a licence.** Default copyright applies. Other users may only view and fork
  the repo on GitHub.
- **Egyptian law.** Law 82/2002 Art. 141 excludes ideas, procedures, methods, concepts and data
  from protection. Art. 171 allows quotation for criticism, discussion or information, and short
  extracts for teaching. Both carry conditions.
- **Enforcement tools exist.** Vite 8 `build.license` (Astro 7.3.5 uses Vite ^8) writes the
  licences of bundled dependencies. `license-checker-rseidelsohn --onlyAllow` fails the build on
  any licence outside an allow-list. Neither tool sees files served from `public/`.

## 1. Libraries shipped in the browser bundle

Versions are the npm `latest` (or release) seen on 2026-09-28.

| Library | SPDX | Version | Keep notice + licence text? | Source-availability duty? | Verified at |
|---|---|---|---|---|---|
| three.js | `MIT` | 0.186.1 | Yes | No | [LICENSE](https://github.com/mrdoob/three.js/blob/dev/LICENSE), [npm](https://registry.npmjs.org/three/latest) |
| JSXGraph | `MIT OR LGPL-3.0-or-later` (recipient chooses) | 1.13.3 | Yes, if MIT is chosen | No, if MIT is chosen | [README/COPYRIGHT](https://github.com/jsxgraph/jsxgraph), [npm](https://registry.npmjs.org/jsxgraph/latest) |
| Plotly.js | `MIT`. The full dist also bundles maplibre-gl (`BSD-3-Clause`) and other MIT/ISC/BSD-3 dependencies. | 4.1.1 | Yes, for Plotly **and** the bundled third parties | No | [LICENSE](https://github.com/plotly/plotly.js/blob/master/LICENSE), [maplibre LICENSE](https://github.com/maplibre/maplibre-gl-js/blob/v6.9.0/LICENSE.txt) |
| KaTeX | `MIT` | 0.18.9 | Yes | No | [LICENSE](https://github.com/KaTeX/KaTeX/blob/main/LICENSE) |
| KaTeX `contrib/mhchem` | `MIT AND Apache-2.0` (KaTeX changes MIT; original MathJax/Hensel code Apache-2.0) | mhchem 3.3.0 | Yes. Apache §4(a) needs a copy of the licence, and §4(b) needs notices on changed files. | No. Upstream has no NOTICE file. | [mhchem.js header](https://github.com/KaTeX/KaTeX/blob/main/contrib/mhchem/mhchem.js), [upstream](https://github.com/mhchem/MathJax-mhchem) |
| KaTeX fonts | **Conflict.** The repo LICENSE says `MIT`, but the TTF `name` tables say `OFL-1.1` with Reserved Font Names (for example `KaTeX_Main`). | 0.18.9 | Yes (OFL §2) | No | [katex-fonts](https://github.com/KaTeX/katex-fonts) |
| motion | `MIT` | 13.4.4 | Yes | No | [LICENSE.md](https://github.com/motiondivision/motion/blob/main/LICENSE.md) |
| React 19 / react-dom | `MIT` (react-dom also embeds a Modernizr MIT snippet) | 19.3.0 | Yes. Production files keep their `@license` headers. | No | [LICENSE](https://github.com/facebook/react/blob/main/LICENSE) |
| Astro | `MIT`. Its LICENSE also carries MIT notices for SvelteKit and Vite code. | 7.3.5 | Yes, for any island runtime shipped (`astro-island` script) | No | [LICENSE](https://github.com/withastro/astro/blob/main/LICENSE), [npm](https://registry.npmjs.org/astro/latest) |
| Tailwind CSS v4 | `MIT` | 4.3.3 | Yes. The compiler emits a `/*! tailwindcss v… \| MIT License \| https://tailwindcss.com */` header on its output. | No | [LICENSE](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE) |
| elkjs | `EPL-2.0 OR GPL-3.0-or-later` (GPL is the Exhibit A Secondary License) | 0.12.0 (npm) | Notices may not be removed (EPL §3.3). A copy of the licence goes with source copies (§3.2(b)). | **Yes (EPL §3.1(a))** | [LICENSE.md](https://github.com/kieler/elkjs/blob/master/LICENSE.md), [SPDX EPL-2.0](https://spdx.org/licenses/EPL-2.0.html) |
| 3Dmol.js | `BSD-3-Clause`. It includes GLmol (MIT/LGPL-3 dual), three.js and jQuery (MIT), and pako (`MIT AND Zlib`). | 2.5.5 | Yes (BSD clause 2) | No | [LICENSE](https://github.com/3dmol/3Dmol.js/blob/master/LICENSE) |
| RDKit.js (`@rdkit/rdkit`, MinimalLib WASM) | `BSD-3-Clause`, plus compiled-in Boost (`BSL-1.0`), FreeType (`FTL OR GPL-2.0`), zlib (`Zlib`), InChI (`MIT`), coordgenlibs and RingDecomposerLib (`BSD-3-Clause`) | 2026.3.6 | Yes. FreeType's FTL also needs a credit line in the documentation. | No | [license.txt](https://github.com/rdkit/rdkit/blob/master/license.txt), [MinimalLib docker](https://github.com/rdkit/rdkit/tree/master/Code/MinimalLib/docker) |
| Pyodide | `MPL-2.0`. Every bundled package keeps its own licence (see §1.3). | 314.0.7 | Yes, for each component | **Yes (MPL-2.0 §3.2(a))** | [LICENSE](https://github.com/pyodide/pyodide/blob/main/LICENSE) |
| CoolProp (official JS/WASM build) | `MIT`. Master pulls in Eigen 5.0.1 (`MPL-2.0`) and other MIT/BSD/BSL dependencies. | 8.0.0 (2026-06-28) | Yes | Eigen's MPL §3.2 applies **if** Eigen is compiled into the WASM (UNVERIFIED) | [LICENSE](https://github.com/CoolProp/CoolProp/blob/master/LICENSE), [JS wrapper docs](http://www.coolprop.org/coolprop/wrappers/Javascript/index.html) |
| Archivo, Atkinson Hyperlegible Next, Atkinson Hyperlegible Mono | `OFL-1.1`, with **no Reserved Font Name** | Google Fonts main | Yes (OFL §2) | No | [google/fonts ofl/](https://github.com/google/fonts/tree/main/ofl) (`archivo`, `atkinsonhyperlegiblenext`, `atkinsonhyperlegiblemono` OFL.txt) |

### 1.1 The rules behind the table

- **MIT.** The notice "shall be included in all copies or substantial portions of the Software."
  A minified bundle counts as a copy.
- **BSD-3-Clause, clause 2.** "Redistributions in binary form must reproduce the above copyright
  notice", together with the conditions and the disclaimer.
- **Apache-2.0 §4.** It requires three things:
  - (a) give recipients a copy of the licence;
  - (b) put prominent notices on modified files;
  - (d) pass on the NOTICE file, if there is one.
- **EPL-2.0, as distributed in minified form.**
  - **§3.1 covers distribution "in any form"**, including object or minified code. (The
    "object code" wording some people use comes from EPL-1.0.)
  - **§3.1(a):** the Program "must also be made available as Source Code". The distributor must
    also say how recipients can get it ("informs Recipients how to obtain it").
  - **§3.1(b):** any other licence used for the distributed form must not "attempt to limit or
    alter the recipients' rights" to the source.
  - **§3.3:** copyright notices may not be removed.
  - **Serving counts as distributing.** "Distribute" includes "making available in any manner that
    enables the transfer of a copy", so serving the file to browsers is distribution.
  - **What "Source Code" might mean here.** elkjs is transpiled with GWT from Eclipse ELK Java, so
    the "form … preferred for making modifications" arguably includes the ELK Java sources. This is
    an interpretation point (UNVERIFIED).
  - Source: [elkjs LICENSE.md](https://github.com/kieler/elkjs/blob/master/LICENSE.md).
- **MPL-2.0, as distributed in executable form.**
  - **§3.2(a):** executable form "must also be made available in Source Code Form". The
    distributor must "inform recipients … how they can obtain a copy".
  - **§3.2(b):** the executable form may be sublicensed only if the new licence does not limit
    or alter the recipients' rights in the source.
  - **§3.4:** licence notices in the source must not be removed.
  - Source: [Pyodide LICENSE](https://github.com/pyodide/pyodide/blob/main/LICENSE).
- **OFL-1.1.**
  - **§2:** copies must carry the copyright notice and licence, "as stand-alone text files,
    human-readable headers or … metadata".
  - **Changing formats is modification.** The licence defines "Modified Version" to include
    "changing formats".
  - The [OFL FAQ](https://openfontlicense.org/ofl-faq/) adds:
    - **2.2.1:** converting to WOFF is fine without renaming if the "font data remains unchanged
      except for WOFF compression".
    - **2.6:** removing unused glyphs (subsetting) "is considered modification".
  - **What this means for each font family:**
    - **KaTeX fonts** have RFNs, so a subsetted version must use a different primary name
      (OFL §3). Shipping the upstream woff2 files unchanged is fine. (Their woff2 metadata was not
      inspected: UNVERIFIED.)
    - **Archivo and Atkinson** have no RFN, so subsetting them needs no rename.

### 1.2 Per-library findings that change what we must ship

- **mhchem has no header in its minified file.** KaTeX's `dist/contrib/mhchem.min.js` has **no
  licence header**; the `.mjs` build keeps it. If we ship the minified file, we must add the
  Apache-2.0 text and the copyright notices ourselves.
- **The full Plotly bundle contains maplibre-gl.** It contains maplibre-gl v6.9.0 under
  `@license 3-Clause BSD`, and maplibre's LICENSE also carries Mapbox (BSD-3), Evan Wallace (MIT)
  and Mike Bostock (BSD) notices. A custom Plotly bundle without map traces would leave maplibre
  out. The repo has `CUSTOM_BUNDLE.md` for this; not tested.
- **3Dmol's bundled licence file is not the licence.** `3Dmol-min.js` points to
  `3Dmol-min.js.LICENSE.txt`, but that file holds only a version and author banner, not the
  BSD-3 text. The full LICENSE has to be shipped separately.
- **Two npm packages ship no LICENSE file.**
  - `pyodide@314.0.7` and `@rdkit/rdkit@2026.3.6` have none.
  - We would have to supply the texts ourselves, from pyodide/pyodide `LICENSE` and rdkit/rdkit
    `license.txt`.
- **JSXGraph's licence header survives minification.** The minified `jsxgraphcore.js` keeps the
  full dual-licence header. Its COPYRIGHT file also includes Bjoern Hoehrmann's MIT UTF-8
  decoder.
- **CoolProp's JS build is not on npm.**
  - Its JavaScript docs say to download `coolprop.js` and `coolprop.wasm` from SourceForge (the
    8.0.0 folder). There is no npm `coolprop` package (registry 404).
  - Which of the dependencies in `cmake/dependencies.cmake` end up in the WASM is UNVERIFIED:
    Eigen (MPL-2.0), fmt, nlohmann/json, valijson, msgpack-c, IF97, boost headers,
    multicomplex, miniz and incbin.
- **Whether the minifier keeps `/*!` headers was not tested.**

### 1.3 Pyodide's bundled packages

- **CPython** is `PSF-2.0`. Its notice must be retained
  ([LICENSE](https://github.com/python/cpython/blob/main/LICENSE)).
- **NumPy** is `BSD-3-Clause AND 0BSD AND MIT AND CC0-1.0` (per its pyproject `license` and
  `license-files`).
  - Pyodide's numpy 2.4.6 recipe builds with `-Dallow-noblas=true`, so it contains **no
    OpenBLAS**.
- **SciPy** is `BSD-3-Clause`.
  - Its `LICENSES_bundled.txt` lists further components: Boost (BSL-1.0), Qhull, HiGHS (MIT),
    SuperLU, ARPACK, pybind11, and others.
  - Pyodide's scipy 1.18.0 recipe links the separate `libopenblas` package (0.3.31, BSD-3-Clause).
- **Where each package's licence is recorded.** No explicit Pyodide statement that "bundled
  packages keep their own licences" was found (UNVERIFIED). The Pyodide docs do say that each
  wheel's `*.metadata` file records its licence.

### 1.4 What a public repo changes

- **Ignored dependencies are not redistributed.** If `node_modules` stays in `.gitignore`, a
  public repo does not redistribute those libraries.
- **Committed third-party files are redistributed.** Anything vendored or self-hosted from
  `public/` counts: Pyodide files, WASM, KaTeX fonts, web fonts, minified bundles.
  - MIT/BSD code needs its LICENSE files kept beside it.
  - MPL and EPL code also triggers the source-form rules (MPL §3.1, EPL §3.2).

## 2. Build-time-only tools

| Tool | SPDX | Verified at |
|---|---|---|
| ngspice | Mostly `BSD-3-Clause`. Exceptions: `src/maths/KLU` is LGPLv2, `numparam` is LGPLv2+, `tclspice.c` is LGPLv2, `xspice/icm/table` is GPLv2+, `src/osdi` is MPL-2.0, `maths/sparse` is MIT. | [COPYING](https://sourceforge.net/p/ngspice/ngspice/ci/master/tree/COPYING) |
| eecircuit-engine 1.8.0 | `MIT` covers only the wrapper. The shipped `spice.wasm` is ngspice compiled with Emscripten; its build flags leave KLU on, so it most likely contains LGPL parts (inferred from the build files). | [repo](https://github.com/eelab-dev/EEcircuit-engine) |
| python-control 0.10.2 | `BSD-3-Clause` | [LICENSE](https://github.com/python-control/python-control/blob/main/LICENSE) |
| SymPy 1.14.0 | `BSD-3-Clause` (its latex2sympy files are MIT) | [LICENSE](https://github.com/sympy/sympy/blob/master/LICENSE) |
| build123d 0.13.0 | `Apache-2.0` | [LICENSE](https://github.com/gumyr/build123d/blob/dev/LICENSE) |
| OCP / cadquery-ocp 8.0.1 | `Apache-2.0` for the bindings. The wheel contains compiled OCCT, which keeps its own licence. | [LICENSE](https://github.com/CadQuery/OCP/blob/master/LICENSE) |
| Open CASCADE Technology | `LGPL-2.1-only WITH OCCT-exception-1.0`. The exception lets object code that uses OCCT headers be distributed "under terms of your choice", with a prominent notice. | [LICENSE_LGPL_21.txt](https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt), [OCCT_LGPL_EXCEPTION.txt](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt) |
| faster-whisper 1.2.1 / CTranslate2 | `MIT` / `MIT`. The converted Systran models on Hugging Face are tagged MIT. | [LICENSE](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE), [CTranslate2](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE) |
| Whisper code and weights | `MIT`, per the README. The Hugging Face card for `openai/whisper-large-v3` is tagged apache-2.0 (a discrepancy; both are permissive). | [openai/whisper](https://github.com/openai/whisper) |
| FFmpeg | `LGPL-2.1-or-later` by default. `GPL-2.0-or-later` for the whole build with `--enable-gpl` (for example libx264). "nonfree" with `--enable-nonfree`. The gyan.dev Windows builds are GPLv3; BtbN offers gpl, lgpl and nonfree variants. | [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html), [gyan.dev](https://www.gyan.dev/ffmpeg/builds/), [BtbN](https://github.com/BtbN/FFmpeg-Builds) |
| Playwright 1.63.0 | `Apache-2.0`. The downloaded browsers have their own licences. | [LICENSE](https://github.com/microsoft/playwright/blob/main/LICENSE) |

### 2.1 Running a tool is not distributing it

- **The GPL and LGPL do not restrict running the program.**
  - GPL-2.0 §0: "The act of running the Program is not restricted".
  - LGPL-2.1 §0 has matching wording.
  - GPL-3.0 §2 affirms "unlimited permission to run the unmodified Program".
  - Source: [gnu.org](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt).
- **Permissive licences attach conditions only to redistribution.** For MIT, BSD and Apache, the
  conditions apply only when copies are passed on.
- **A dependency manifest contains none of the tools' code.**
  - A public repo holding only `requirements.txt` or `package.json` plus scripts that call the
    tools includes no tool code.
  - Committing the binaries would be redistribution. That covers a vendored `ffmpeg.exe`,
    `spice.wasm` or `node_modules`.
- **The build scripts themselves can use any licence.** GPL FAQ: "the copyright on the editors and
  tools does not cover the code you write"
  ([#CanIUseGPLToolsForNF](https://www.gnu.org/licenses/gpl-faq.html#CanIUseGPLToolsForNF)).

### 2.2 Output from a tool is not covered by the tool's licence

- **The GPL FAQ says output is generally not covered.**
  - [#WhatCaseIsOutputGPL](https://www.gnu.org/licenses/gpl-faq.html#WhatCaseIsOutputGPL): "The
    output of a program is not, in general, covered by the copyright on the code".
  - [#GPLOutput](https://www.gnu.org/licenses/gpl-faq.html#GPLOutput): output "inherits" the
    copyright status of its input. The exception is output that copies substantial parts of the
    program itself (the Bison case).
- **The licence texts say the same.**
  - GPL-2.0 §0: output is covered "only if its contents constitute a work based on the Program".
  - GPL-3.0 §2 and LGPL-2.1 §0 have matching wording.
- **How this applies here:**
  - **OCCT GLB geometry:** OCCT itself says nothing about this. The general LGPL §0 rule applies.
  - **ngspice numbers and faster-whisper transcripts:** no project-specific statements were found,
    and none was expected under MIT/BSD.
  - **FFmpeg MP4s:** ffmpeg.org says nothing on output copyright.
- **Patents are a separate question from copyright.**
  - FFmpeg's "Patent Mini-FAQ" on [legal.html](https://ffmpeg.org/legal.html) treats patents
    separately: private users have "remarkably little reason to be concerned", while commercial
    products "might have a problem". It also notes MPEG LA collects for H.264/MPEG-4.
  - Whether publishing H.264 MP4s on a free site needs a patent licence is **UNVERIFIED**.
  - Encoding with a royalty-free codec (VP9/AV1) through an LGPL build would sidestep both the
    GPL question and the libx264 question. That is a design option, not a sourced finding.
- **eecircuit-engine becomes a shipped library if it runs in the browser.** Serving `spice.wasm`
  to visitors distributes an ngspice binary. That would bring the BSD-3 notices and probably the
  LGPL duties for KLU and numparam, and the package's MIT label does not cover them.

## 3. Linking to PhET and Falstad

### 3.1 Creative Commons on linking and NonCommercial

- **Linking is a jurisdiction question, per CC's own FAQ.**
  - The [CC FAQ](https://creativecommons.org/faq/) answers it under the dataset-attribution
    question.
  - The answer says "CC licenses never limit uses that copyright doesn't control."
  - It then gives linking as an example: in "some countries" linking needs no copyright
    permission, "which means the CC license obligations do not come into play".
  - CC does not say that holds in every country.
- **The licence only reaches uses that need permission.**
  - [CC BY-NC 4.0 legal code](https://creativecommons.org/licenses/by-nc/4.0/legalcode.en)
    defines "Share" as making material available "by any means or process that requires
    permission under the Licensed Rights".
  - §2(a)(2): where exceptions and limitations apply, "this Public License does not apply".
- **The NonCommercial definition.** NC means "not primarily intended for or directed towards
  commercial advantage or monetary compensation."
- **The CC FAQ on NC.**
  - "CC's definition does not turn on the type of user."
  - "CC cannot advise you on what is and is not commercial use."
  - There is no blanket rule that educational use is non-commercial.

### 3.2 PhET

- **The date split.** Checked on 2026-09-28; the brief's claim needs one correction.
  - **The current [licensing page](https://phet.colorado.edu/en/licensing) has no date split.**
    It says Regular HTML Simulation Files are "published under the Creative Commons
    Attribution–NonCommercial license (CC BY-NC 4.0)".
  - **The split appears only on the separate [historical page](https://phet.colorado.edu/en/licensing/html).**
    That page covers versions "published prior to March 29, 2026", which were under CC BY 4.0. It
    shows a banner saying the version is outdated and no longer maintained.
  - **How to tell which licence applies:** open the sim's PhET menu, then About, and check its
    publication date.
  - **The change was announced** on 2026-03-30 by PhET's Executive Director
    ([Substack](https://phetsims.substack.com/p/a-small-change-to-support-a-big-mission)).
- **PhET's own definition of commercial use.** Commercial use is "any use that provides
  commercial advantage or monetary compensation". The examples include paid or subscription
  products, "ad-supported websites or monetized YouTube channels", marketing, and fee-based
  nonprofit products.
- **Teaching use.** Educators may use sims free "for any non-commercial purposes", with
  attribution, and "You do not need to seek any further permissions from us."
- **Required attribution text.** "Simulation by PhET Interactive Simulations, University of
  Colorado Boulder, licensed under CC BY-NC 4.0 (https://phet.colorado.edu)."
  - It must sit close to the point of use.
  - It may be translated but not otherwise changed.
  - The PhET logo inside a sim must stay unaltered.
- **Embedding.** The [Help Center](https://phet.colorado.edu/en/help-center/getting-started)
  explains how to embed a sim with its "Embed" button (iframe code), so embedding is officially
  supported.
  - **PhET publishes no separate terms for linking or embedding.** Its Terms of Use question
    points back to the Licensing page.
- **Source code.** "Most of PhET's simulation-specific repositories are licensed under GPL"
  ([source-code page](https://phet.colorado.edu/en/about/source-code)). The exact GPL version is
  UNVERIFIED.

### 3.3 Falstad

- **Site licence.** [falstad.com/licensing.html](https://www.falstad.com/licensing.html) allows:
  - classroom use and screenshots of unmodified applets;
  - non-commercial modification or redistribution, with credit to Paul Falstad and a link to his
    page.
  - "Contact me for any other uses."
  - **There is no term about hyperlinking.**
- **circuitjs1 licence.** The repos ([pfalstad](https://github.com/pfalstad/circuitjs1) and
  [sharpie7](https://github.com/sharpie7/circuitjs1)) are GPL-2.0 "or (at your option) any later
  version".
- **Embedding note in the README.** The README says you can link to the full-page app or iframe
  it. That is a technical note, not a licence grant.

## 4. NotebookLM / Gemini Notebook outputs

- **Name and help centre.** Google renamed NotebookLM to Gemini Notebook on 2026-07-16
  ([Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/)).
  The Help Centre is at `support.google.com/gemininotebook`.
- **Which terms apply**
  ([Help](https://support.google.com/gemininotebook/answer/16164461)):
  - Consumer accounts: the Google Terms of Service.
  - Workspace accounts: the Workspace terms.
  - Education accounts: the Workspace for Education terms.
- **Ownership.** The [Google ToS](https://policies.google.com/terms) (effective 2026-07-30,
  Egypt version) says "Google won't claim ownership over that content". Uploaded content "remains
  yours".
  - No clause saying "similar content may be generated for others" was found in the current ToS
    (UNVERIFIED elsewhere).
- **The old AI terms no longer apply.**
  - The [Generative AI Additional Terms](https://policies.google.com/terms/generative-ai) were
    folded into the main ToS on 2024-05-22.
  - They "no longer apply" except to business partners with signed agreements.
- **Disclosure rules.**
  - **In the ToS:** the ToS prohibits "misleading others into thinking that generative AI content
    was created by a human".
  - **In the Prohibited Use Policy:** the
    [Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy)
    (2024-12-17) forbids misrepresenting provenance "by claiming it was created solely by a human,
    in order to deceive".
  - **Exceptions:** the policy allows exceptions for "educational, documentary, scientific, or
    artistic considerations".
  - **No attribution or AI label is required** on any page found. The only duty is not to
    deceive.
- **Other restrictions in the ToS:**
  - It forbids "using AI-generated content from our services to develop machine learning models".
  - It says not to rely on the services for professional advice.
  - The help pages say outputs "are AI-generated and may contain inaccuracies".
- **Publishing outputs on a website.**
  - Audio, Video and Infographic outputs all have a Download option; infographics download as PNG.
  - **No page forbids or explicitly allows republishing downloads on an external website.**
  - Downloads can be blocked by publisher restrictions on a source (for example Play Books).
  - The [public notebooks page](https://support.google.com/gemininotebook/answer/16322204) warns:
    "Do not share copyrighted content without the necessary rights". This bears on outputs made
    from a professor's slides.
- **Age limits.** Some formats are 18+, for example Cinematic Video Overviews
  ([Help](https://support.google.com/gemininotebook/answer/16454555)).
- **Watermarking.** No statement on SynthID or watermarking of these outputs was found
  (UNVERIFIED).

## 5. Licence options for a public Course repo

- **A repo with no licence.**
  - [GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository):
    without a licence "the default copyright laws apply". No one may reproduce, distribute or
    create derivative works.
  - Under the GitHub ToS, users of a public repo "have the right to view and fork" it.
- **GitHub ToS §D.5, "License Grant to Other Users."**
  - [ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service): a public
    repo grants a licence to use, display and fork "through the Service as permitted by GitHub's
    functionality".
  - It also says: "If you post Content you did not create or own, you are responsible" for making
    sure it is licensed for those uses. This matters for any professor-derived material.
- **choosealicense.com.**
  - [no-permission](https://choosealicense.com/no-permission/): unlicensed work is "under
    exclusive copyright by default". It suggests stating that no licence is offered.
  - [non-software](https://choosealicense.com/non-software/): recommends CC0-1.0, CC-BY-4.0 or
    CC-BY-SA-4.0 for content. It does not list NC licences.
  - [MIT](https://choosealicense.com/licenses/mit/): "A short and simple permissive license".
- **Creative Commons on software.** "We recommend against using Creative Commons licenses for
  software" ([CC FAQ](https://creativecommons.org/faq/)). The reasons given: no source-code terms,
  no patent terms, and incompatibility with the major software licences.
- **CC BY-NC-SA 4.0** ([deed](https://creativecommons.org/licenses/by-nc-sa/4.0/)) allows sharing
  and adapting, with four conditions:
  - attribution;
  - a note to "indicate if changes were made";
  - NonCommercial use;
  - ShareAlike ("same license").
- **Mixed licences in one repo.** GitHub's licence detection may fail on "multiple licenses or
  other complexity". GitHub advises a simple root LICENSE, with the split explained in the README.
  GitHub documents no per-directory licence feature.
- **Common layouts:**
  - MIT for the code, plus CC BY-NC-SA 4.0 or no licence for the text;
  - or all rights reserved, with an explicit no-licence notice.
  - Third-party code keeps its own licence either way.

## 6. The Professor's lecture material (Egypt)

Report only. Translation and currency are uncertain.

- **Source.** Law No. 82 of 2002 on the Protection of Intellectual Property Rights, on
  [WIPO Lex](https://www.wipo.int/wipolex/en/legislation/details/22066).
  - The Arabic text is consolidated up to Law No. 178 of 2020.
  - WIPO notes: "Current text in English unavailable. 2002 version provided for reference
    purposes". The English below is that 2002 translation.
  - WIPO lists the 2020 amendment as touching only Art. 185 in Book Three. That suggests Arts.
    138–171 are unchanged, but this is inferred from WIPO's listing, not checked against the
    Arabic text (UNVERIFIED).
- **Art. 138 (definitions).** A "work" is any creative literary, artistic or scientific product.
  "Creation" is the creative nature that makes it original.
- **Art. 140 (protected works).** The list includes:
  - (1) written works;
  - (4) "Lectures, speeches, sermons and any other oral works when recorded";
  - (9) drawings;
  - (12) illustrations, maps and sketches;
  - (13) derivative works.
- **Art. 141 (not protected).** "mere ideas, procedures, systems, operational methods, concepts,
  principles, discoveries and data", even when they are expressed or illustrated in a work.
- **Art. 171 (acts allowed after publication; moral rights are preserved).** Relevant items
  (paraphrased):
  - **(4)** Analysis of a work, or excerpts or quotations from it, "for the purpose of criticism,
    discussion or information".
  - **(6)** Reproducing short extracts for teaching, by way of illustration or explanation, in
    writing or recordings. Conditions: within reasonable limits, and the author's name and the
    title shown where practical.
  - **(7)** Reproducing an article, a short work or extracts where necessary for teaching in
    educational institutions, with the author and title on each copy.
  - **(1)** Performance at a student gathering inside an educational institution, with no
    remuneration.
  - Whether a public website run by a student falls within items (6) or (7), which name teaching
    and educational institutions, is **not answered by the text** (UNVERIFIED).
- **Ideas versus expression (international).**
  - [TRIPS Art. 9(2)](https://www.wto.org/english/docs_e/legal_e/27-trips_04_e.htm) and
    [WCT Art. 2](https://www.wipo.int/wipolex/en/text/295166) say protection extends "to
    expressions and not to ideas, procedures, methods of operation or mathematical concepts as
    such".
  - Egypt has been a WTO member since 30 June 1995
    ([WTO](https://www.wto.org/english/thewto_e/countries_e/egypt_e.htm)), so TRIPS applies.
    Whether Egypt is party to the WCT is UNVERIFIED.
  - The US Copyright Office's [Circular 33](https://www.copyright.gov/circs/circ33.pdf) says the
    same for the US: methods and systems are unprotected, but the text and illustrations that
    express them are protected.
- **How this reads for Study sites (a restatement of the sources, not a legal conclusion):**
  - Equations, methods and facts from a lecture fall under Art. 141.
  - The professor's own wording, slide layout and drawings are expression (Art. 140).
  - Restating a problem in new words and redrawing a figure moves toward new expression. How far
    it must move is not settled by these texts.

## 7. Enforcement: what a build gate can use

- **Vite `build.license`.**
  - From the [Vite build options](https://vite.dev/config/build-options) and
    [Features: License](https://vite.dev/guide/features):
    - The type is `boolean | { fileName?: string }`.
    - It writes `.vite/license.md` listing each **bundled** dependency's name, version, licence
      identifier and licence text.
    - A `fileName` ending in `.json` produces raw JSON instead, which a build script can check.
  - It was added in Vite 7.2 ([PR #18546](https://github.com/vitejs/vite/pull/18546)). Astro
    7.3.5 depends on `vite ^8.0.13` ([npm](https://registry.npmjs.org/astro/latest)), so it is
    available through Astro's `vite` config key.
  - **Limitation:** the PR calls it "very crude", and it excludes the project's own licence.
- **license-checker-rseidelsohn** (5.0.1, BSD-3-Clause;
  [README](https://github.com/RSeidelsohn/license-checker-rseidelsohn)):
  - `--onlyAllow "MIT;BSD-3-Clause;…"` exits with code 1 on the first licence outside the list.
  - `--failOn` exits with code 1 on a listed licence.
  - `--production` checks production dependencies only.
  - `--excludePackages` exempts named packages.
  - `--json` gives machine-readable output.
- **Blind spots these tools share:**
  - Neither sees files copied from `public/`: self-hosted Pyodide, CoolProp WASM downloaded from
    SourceForge, fonts.
  - Neither sees licences compiled inside a WASM: RDKit's FreeType/Boost, eecircuit's ngspice
    KLU, CoolProp's Eigen.
  - Neither sees packages whose npm metadata is incomplete (pyodide and `@rdkit/rdkit` ship no
    LICENSE file).
  - Those cases would need a hand-kept manifest that the gate checks against.
- **Negative controls a gate could use** (design ideas, not sourced):
  - add a fixture dependency with a licence outside the allow-list;
  - drop one credit line;
  - add an unlisted file under `public/`.
  - Each should make the build fail.

## 8. UNVERIFIED items

- KaTeX woff2 font metadata (only the TTF `name` tables were read).
- What is compiled into the RDKit npm WASM (Eigen, the Emscripten runtime licence) and into the
  CoolProp 8.0.0 WASM (Eigen, msgpack-c, multicomplex).
- An explicit Pyodide statement that each package keeps its own licence.
- Whether the minifier keeps `/*!` licence comments.
- The exact GPL version of PhET's sim repos.
- A patent licence for publishing H.264 MP4s.
- Whether Egypt Law 82/2002 Arts. 138–171 changed after 2002 (Arabic consolidated text not
  checked), whether Art. 171(6)/(7) cover a student's public website, and whether Egypt is party
  to the WCT.
- NotebookLM output watermarking (SynthID).
