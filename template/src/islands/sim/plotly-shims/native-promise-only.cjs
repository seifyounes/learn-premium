// Stands in for native-promise-only inside Plotly (see stand-ins.ts): a Promise polyfill, and every
// browser the Study site supports has Promise.
"use strict";

module.exports = globalThis.Promise;
