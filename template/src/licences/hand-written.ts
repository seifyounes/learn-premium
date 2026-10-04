// The notices the Site template keeps by hand, for what generating the Licences file from the
// bundled packages can't see: code that ships inside another package under its own licence, fonts,
// compiled libraries and the runtimes a tool loads. Reviewed at every Template release; the
// `licences-file` gate holds every built Licences file to carrying all of them.
//
// The licence texts in `texts/` are the projects' own: Apache-2.0 (as ESLint ships it), OFL-1.1 (as
// Fontsource ships it), MPL-2.0 (Pyodide's LICENSE), RDKit's and CoolProp's LICENSE files, FreeType's
// FTL.TXT and the Eclipse Foundation's EPL-2.0.txt.
import { readFileSync } from "node:fs";
import type { HandWrittenNotice } from "./file.ts";

const text = (file: string) =>
  readFileSync(new URL(`./texts/${file}`, import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();

const KATEX_FONTS = [
  "AMS",
  "Caligraphic",
  "Fraktur",
  "Main",
  "Math",
  "SansSerif",
  "Script",
  "Size1",
  "Size2",
  "Size3",
  "Size4",
  "Typewriter",
].map((name) => `KaTeX_${name}`);

export const HAND_WRITTEN_NOTICES: readonly HandWrittenNotice[] = [
  {
    id: "mhchem",
    title: "mhchem for KaTeX",
    covers:
      "KaTeX's mhchem extension, which sets chemical equations (\\ce); KaTeX's package declares MIT, but this code is adapted from MathJax's mhchem.js under Apache-2.0",
    licence: "Apache-2.0",
    copyright: "Copyright (c) 2011-2015 The MathJax Consortium; Copyright (c) 2015-2018 Martin Hensel",
    source: "https://github.com/mhchem/MathJax-mhchem",
    text: text("Apache-2.0.txt"),
  },
  {
    id: "katex-fonts",
    title: "KaTeX fonts",
    covers: `the math fonts KaTeX's stylesheet loads (${KATEX_FONTS.join(", ")}), which ship inside KaTeX's MIT package under their own licence`,
    licence: "OFL-1.1",
    copyright: `Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>); Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>), with Reserved Font Names ${KATEX_FONTS.join(", ")}`,
    source: "https://github.com/KaTeX/katex-fonts",
    text: text("OFL-1.1.txt"),
  },
  {
    id: "pyodide",
    title: "Pyodide",
    covers:
      "the Python runtime the site loads for in-page Python runs, self-hosted; each Python package it loads carries its own licence inside its wheel",
    licence: "MPL-2.0",
    copyright: "Copyright (c) the Pyodide contributors",
    source:
      "The source code of Pyodide, including the files this site serves, is available at https://github.com/pyodide/pyodide under the Mozilla Public License 2.0.",
    text: text("MPL-2.0.txt"),
  },
  {
    id: "rdkit",
    title: "RDKit",
    covers: "RDKit's compiled libraries (the RDKit.js WebAssembly build) that draw molecules",
    licence: "BSD-3-Clause",
    source: "https://github.com/rdkit/rdkit",
    text: text("RDKit-BSD-3-Clause.txt"),
  },
  {
    id: "freetype",
    title: "FreeType",
    covers: "the FreeType font engine compiled into RDKit's WebAssembly build",
    licence: "FTL",
    copyright:
      "Portions of this software are copyright (c) The FreeType Project (www.freetype.org). All rights reserved.",
    source: "https://gitlab.freedesktop.org/freetype/freetype",
    text: text("FTL.txt"),
  },
  {
    id: "coolprop",
    title: "CoolProp (WebAssembly)",
    covers: "the CoolProp WebAssembly build that works out fluid properties",
    licence: "MIT",
    source: "https://github.com/CoolProp/CoolProp",
    text: text("CoolProp-MIT.txt"),
  },
  {
    id: "elkjs",
    title: "elkjs",
    covers: "the Eclipse Layout Kernel, compiled to JavaScript, that lays out schematic sims",
    licence: "EPL-2.0",
    source:
      "The source code of elkjs is available at https://github.com/kieler/elkjs under the Eclipse Public License 2.0.",
    text: text("EPL-2.0.txt"),
  },
];
