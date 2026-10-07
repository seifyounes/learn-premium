// Stands in for is-mobile inside Plotly (see stand-ins.ts). Only Plotly's WebGL traces ask it (to
// keep a drawing buffer on phones), and the heatmap registers none, so it answers "not a phone".
"use strict";

module.exports = () => false;
