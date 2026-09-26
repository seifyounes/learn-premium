// PROTOTYPE (throwaway): a tiny gate-level evaluator for the 1-bit full adder.
// Pure logic, no DOM: the page (pad-native-logic.html) and the Node check both import it.
//
// Two ways to run the same netlist:
//   ideal(prev, next)             the Professor's ideal gates: every net takes its final value;
//                                 events carry the net's logic depth so the view can draw
//                                 them gate by gate. No intermediate values exist.
//   real(prev, next, delaysNs)    an event-driven simulation with a transport delay per gate
//                                 type. Nets can pass through wrong values on the way (glitches).

// Netlist read from circuits/logic/notes.md (G1..G5 with the nets P, G, T).
export const INPUTS = ["A", "B", "Cin"];
export const OUTPUTS = ["S", "Cout"];
export const GATES = {
  G1: { type: "XOR", in: ["A", "B"], out: "P" },
  G2: { type: "AND", in: ["A", "B"], out: "G" },
  G3: { type: "XOR", in: ["P", "Cin"], out: "S" },
  G4: { type: "AND", in: ["P", "Cin"], out: "T" },
  G5: { type: "OR", in: ["T", "G"], out: "Cout" },
};
export const NETS = ["A", "B", "Cin", "P", "G", "T", "S", "Cout"];

// Illustrative only: roughly the order of a 74HC-class gate at 5 V. Not measured.
export const REAL_DELAYS_NS = { XOR: 12, AND: 8, OR: 8 };

const FN = { AND: (a, b) => a & b, OR: (a, b) => a | b, XOR: (a, b) => a ^ b };
const DRIVER = Object.fromEntries(Object.entries(GATES).map(([id, g]) => [g.out, id]));
const FANOUT = {};
for (const [id, g] of Object.entries(GATES)) for (const n of g.in) (FANOUT[n] ??= []).push(id);

const bit = v => (v ? 1 : 0);

/** Logic depth of every net (inputs 0, a gate's output = 1 + deepest input). */
export const LEVEL = (() => {
  const lv = Object.fromEntries(INPUTS.map(n => [n, 0]));
  const depth = n => (n in lv ? lv[n] : (lv[n] = 1 + Math.max(...GATES[DRIVER[n]].in.map(depth))));
  NETS.forEach(depth);
  return lv;
})();

/** Settled value of every net for the given inputs {A, B, Cin}. */
export function settle(inputs) {
  const v = {};
  for (const n of INPUTS) v[n] = bit(inputs[n]);
  const order = NETS.filter(n => !INPUTS.includes(n)).sort((a, b) => LEVEL[a] - LEVEL[b]);
  for (const n of order) {
    const g = GATES[DRIVER[n]];
    v[n] = FN[g.type](v[g.in[0]], v[g.in[1]]);
  }
  return v;
}

/** Ideal gates: the nets that change, each once, to its final value, ordered by logic depth. */
export function ideal(prevInputs, nextInputs) {
  const before = settle(prevInputs), after = settle(nextInputs);
  const events = NETS.filter(n => before[n] !== after[n])
    .map(n => ({ net: n, value: after[n], level: LEVEL[n], gate: DRIVER[n] ?? null }))
    .sort((a, b) => a.level - b.level);
  return { before, after, events, glitches: [] };
}

/**
 * Real devices: start from the settled state of prevInputs, change every input that differs
 * at t = 0 (all at the same instant), and run the event queue until nothing is pending.
 * Transport delay: each gate re-evaluates when an input net changes and schedules its output
 * `delay` ns later; a later event on the same net can follow an earlier one (so pulses survive).
 */
export function real(prevInputs, nextInputs, delaysNs = REAL_DELAYS_NS) {
  const before = settle(prevInputs);
  const cur = { ...before };
  const projected = { ...before }; // value each net will have once its queued events land
  const queue = [];
  const push = e => { queue.push(e); queue.sort((a, b) => a.t - b.t || a.seq - b.seq); };
  let seq = 0;
  for (const n of INPUTS) {
    const nv = bit(nextInputs[n]);
    if (nv !== cur[n]) { push({ t: 0, net: n, value: nv, gate: null, seq: seq++ }); projected[n] = nv; }
  }
  const events = [];
  let guard = 0;
  while (queue.length) {
    if (++guard > 1000) throw new Error("did not settle");
    const t = queue[0].t;
    const now = [];
    while (queue.length && queue[0].t === t) now.push(queue.shift());
    const changed = [];
    for (const e of now) {
      if (cur[e.net] === e.value) continue;
      cur[e.net] = e.value;
      events.push({ t: e.t, net: e.net, value: e.value, gate: e.gate });
      changed.push(e.net);
    }
    const touched = new Set(changed.flatMap(n => FANOUT[n] ?? []));
    for (const id of touched) {
      const g = GATES[id];
      const out = FN[g.type](cur[g.in[0]], cur[g.in[1]]);
      if (out !== projected[g.out]) {
        projected[g.out] = out;
        push({ t: t + delaysNs[g.type], net: g.out, value: out, gate: id, seq: seq++ });
      }
    }
  }
  const after = cur;
  return { before, after, events, glitches: findGlitches(before, after, events), endNs: events.at(-1)?.t ?? 0 };
}

/** A glitch: a non-input net that changes more than once, i.e. passes through a value it does not keep. */
function findGlitches(before, after, events) {
  const out = [];
  for (const n of NETS) {
    if (INPUTS.includes(n)) continue;
    const ev = events.filter(e => e.net === n);
    if (ev.length < 2) continue;
    for (let i = 0; i < ev.length - 1; i++) {
      out.push({ net: n, value: ev[i].value, from: ev[i].t, to: ev[i + 1].t, settlesAt: after[n], wasBefore: before[n] });
    }
  }
  return out;
}

/** Row index 0..7 in the order A B Cin (A is the most significant bit). */
export const rowIndex = i => (bit(i.A) << 2) | (bit(i.B) << 1) | bit(i.Cin);
export const rowInputs = r => ({ A: (r >> 2) & 1, B: (r >> 1) & 1, Cin: r & 1 });
