// Stands in for has-hover inside Plotly (see stand-ins.ts): whether the device's main pointer
// hovers. The map is a static picture, so Plotly never acts on the answer.
"use strict";

const media = globalThis.matchMedia;
module.exports = typeof media === "function" ? !media("(hover: none)").matches : typeof globalThis.window === "object";
