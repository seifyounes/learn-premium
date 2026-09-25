# PROTOTYPE: lecture circuit figure → live simulation (wayfinder #18)

Throwaway. It answers one question for the map: **can an agent turn a lecture circuit figure into a
correct live simulation?** The verdict and findings are in the ticket
([#18](https://github.com/seifyounes/learn-premium/issues/18)) and at the bottom of `index.html`.

## Run it

```bash
npm install
npm start
```

Then open <http://localhost:8718/index.html>. The page embeds CircuitJS from `pfalstad.github.io`,
runs ngspice-WASM in the browser (the α slider) and DigitalJS live.

The lecture figures sit in `fixtures/materials/`, which is **gitignored**: professor material is never
committed. On a fresh clone, copy them in from the v1 projects (paths in `docs` below) or the figure
panels show broken images. Everything else still works.

## What's here

| Path | What |
|---|---|
| `authored/<circuit>/` | What the blind authoring agents wrote: `circuit.cir` (ngspice), `circuitjs.txt`, `digitaljs.json`, `notes.md` (their figure reading and predictions). `buck/circuitjs-steady.txt` is the buck with seeded initial conditions. |
| `expected.json` | Answer keys, from the v1 source-of-truth docs (the CE amp's VCEQ is corrected; see #18). |
| `run-spice.mjs` | Runs a netlist through `eecircuit-engine` (ngspice-47 WASM) in Node. |
| `check-*.mjs`, `measure.mjs` | Value gates: steady-state measurements vs the key, with tolerances. |
| `check-logic.mjs` | Exhaustive truth-table gate on headless DigitalJS. |
| `results/circuitjs.json` | CircuitJS numbers and nets, measured in a real browser through `window.CircuitJS1`. |
| `fixtures/full-adder.*` | Synthetic logic figure (v1 has no logic course). `make_logic_fig.py` draws it and doubles as its answer key. |

`npm run gates` re-runs every ngspice and DigitalJS gate and rebuilds `results/summary.json`. The
CircuitJS runs were driven by hand through the browser pane (see `results/circuitjs.json` `_how`).

## Sources of the four figures (read-only, outside the repo)

- Buck: `D:\Claude Os\Power electronics\out\lec4\page-13.png` (Lecture 4, slides 13 + 20)
- SCR rectifier: `D:\Claude Os\Power electronics\Professional Lectures\Lec ANU 02.pdf`, slide 4
- CE amplifier: `D:\Claude Os\electronics website\_extracted\sheets\Sheets\Sheet 5-1.pdf`, figure (i)
