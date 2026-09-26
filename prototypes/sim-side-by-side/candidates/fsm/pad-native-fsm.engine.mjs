// PROTOTYPE (throwaway): a small clocked-FSM engine, importable in Node and in the browser.
// It steps a Moore/Mealy machine and derives, from the machine alone, the state table, the encoded
// transition table, the per-flip-flop excitation table, minimal sum-of-products equations and a trace.
// Nothing here is drawn; the view (pad-native-fsm.html) only renders what this returns.

const EXCITE = {
  // flip-flop type -> (q, qNext) -> { input name: 0 | 1 | null (don't care) }
  D: (q, n) => ({ D: n }),
  T: (q, n) => ({ T: q ^ n }),
  JK: (q, n) => (q === 0 ? { J: n, K: null } : { J: null, K: n ? 0 : 1 }),
};

export function createMachine(model) {
  const ids = model.states.map((s) => s.id);
  const byId = Object.fromEntries(model.states.map((s) => [s.id, s]));
  const inputs = model.inputs;
  const bits = model.encoding.bits;
  const codes = model.encoding.codes;
  const ff = model.flipflop || "D";
  if (!EXCITE[ff]) throw new Error(`Unknown flip-flop type ${ff}`);

  // ---- validation: complete and deterministic, codes unique ----
  const combos = allCombos(inputs.length);
  const problems = [];
  for (const s of ids) {
    for (const c of combos) {
      const hits = model.transitions.filter((t) => t.from === s && matches(t.when, inputs, c));
      if (hits.length === 0) problems.push(`${s}: no transition for ${fmtIn(inputs, c)}`);
      if (hits.length > 1) problems.push(`${s}: ${hits.length} transitions for ${fmtIn(inputs, c)}`);
    }
  }
  for (const t of model.transitions) if (!byId[t.to] || !byId[t.from]) problems.push(`bad state in ${JSON.stringify(t)}`);
  const codeList = ids.map((s) => codes[s]);
  if (new Set(codeList).size !== codeList.length) problems.push("state codes are not unique");
  if (codeList.some((c) => c.length !== bits.length)) problems.push("a state code has the wrong width");
  if (problems.length) throw new Error("Machine is not valid:\n" + problems.join("\n"));

  const edgeId = (t) => `${t.from}->${t.to}:${inputs.map((n) => t.when[n] ?? "x").join("")}`;

  function transitionFor(state, inVals) {
    const vec = inputs.map((n) => inVals[n] ?? 0);
    return model.transitions.find((t) => t.from === state && matches(t.when, inputs, vec));
  }
  function output(state, inVals = {}) {
    if (model.kind === "moore") return { ...byId[state].out };
    return { ...transitionFor(state, inVals).out };
  }
  /** One rising clock edge: returns the edge taken and the new state. */
  function step(state, inVals) {
    const t = transitionFor(state, inVals);
    return { next: t.to, edge: edgeId(t), transition: t, outBefore: output(state, inVals), outAfter: output(t.to, inVals) };
  }

  function stateTable() {
    return ids.map((s) => ({
      state: s,
      code: codes[s],
      meaning: byId[s].meaning,
      next: Object.fromEntries(combos.map((c) => [c.join(""), transitionFor(s, toObj(inputs, c)).to])),
      out: model.kind === "moore" ? { ...byId[s].out } : null,
    }));
  }

  // Encoded rows over (bits..., inputs...). Unused codes become don't-care rows.
  function encodedTable() {
    const rows = [];
    const nVars = bits.length + inputs.length;
    for (let m = 0; m < 1 << nVars; m++) {
      const v = toBits(m, nVars);
      const q = v.slice(0, bits.length);
      const x = v.slice(bits.length);
      const state = ids.find((s) => codes[s] === q.join(""));
      if (!state) { rows.push({ m, q, x, state: null, dontCare: true }); continue; }
      const nextState = transitionFor(state, toObj(inputs, x)).to;
      const qNext = codes[nextState].split("").map(Number);
      const excite = {};
      bits.forEach((b, i) => {
        for (const [pin, val] of Object.entries(EXCITE[ff](q[i], qNext[i]))) excite[pin + b.replace(/^Q/, "")] = val;
      });
      rows.push({ m, q, x, state, nextState, qNext, excite, out: output(state, toObj(inputs, x)) });
    }
    return rows;
  }

  function excitationTable() {
    return [[0, 0], [0, 1], [1, 0], [1, 1]].map(([q, n]) => ({ q, qNext: n, ...EXCITE[ff](q, n) }));
  }

  /** Minimal SOP for every flip-flop input and every output. */
  function equations() {
    const rows = encodedTable();
    const vars = bits.concat(inputs);
    const eq = {};
    const pinNames = Object.keys(rows.find((r) => !r.dontCare).excite);
    for (const pin of pinNames) {
      const on = [], dc = [];
      for (const r of rows) {
        if (r.dontCare || r.excite[pin] === null) dc.push(r.m);
        else if (r.excite[pin] === 1) on.push(r.m);
      }
      eq[pin] = { vars, terms: minimise(vars.length, on, dc) };
    }
    for (const o of model.outputs) {
      if (model.kind === "moore") {
        // Moore outputs are functions of the state bits only.
        const on = [], dc = [];
        for (let m = 0; m < 1 << bits.length; m++) {
          const s = ids.find((id) => codes[id] === toBits(m, bits.length).join(""));
          if (!s) dc.push(m); else if (byId[s].out[o]) on.push(m);
        }
        eq[o] = { vars: bits.slice(), terms: minimise(bits.length, on, dc) };
      } else {
        const on = [], dc = [];
        for (const r of rows) { if (r.dontCare) dc.push(r.m); else if (r.out[o]) on.push(r.m); }
        eq[o] = { vars, terms: minimise(vars.length, on, dc) };
      }
    }
    return eq;
  }

  /** Clock the machine once per input vector. Period i shows the present state and its output. */
  function trace(xs, start = model.init) {
    let s = start;
    const periods = [];
    for (const xv of xs) {
      const inVals = typeof xv === "object" ? xv : { [inputs[0]]: xv };
      const st = step(s, inVals);
      periods.push({ state: s, code: codes[s], in: inVals, out: output(s, inVals), next: st.next, edge: st.edge });
      s = st.next;
    }
    return { periods, final: { state: s, code: codes[s], out: output(s, {}) } };
  }

  /** WaveDrom-style WaveJSON of a trace (for export or a static strip). */
  function waveJSON(tr) {
    const lvl = (arr) => arr.map((v, i) => (i && arr[i - 1] === v ? "." : String(v))).join("");
    const st = tr.periods.map((p) => p.state).concat(tr.final.state);
    return {
      signal: [
        { name: "CLK", wave: "p" + ".".repeat(tr.periods.length) },
        ...inputs.map((n) => ({ name: n, wave: lvl(tr.periods.map((p) => p.in[n]).concat("x")).replace(/x$/, "x") })),
        { name: "state", wave: st.map((v, i) => (i && st[i - 1] === v ? "." : "=")).join(""), data: st.filter((v, i) => !i || st[i - 1] !== v) },
        ...model.outputs.map((o) => ({ name: o, wave: lvl(tr.periods.map((p) => p.out[o]).concat(tr.final.out[o])) })),
      ],
    };
  }

  return {
    model, ids, inputs, bits, codes, ff,
    stateById: byId, edgeId, transitionFor, output, step,
    stateTable, encodedTable, excitationTable, equations, trace, waveJSON,
    edges: model.transitions.map((t) => ({ ...t, id: edgeId(t) })),
  };
}

// ---------- boolean helpers ----------

/** Quine-McCluskey-style exact minimisation for small functions (n <= 5). Returns terms as arrays of
 *  0 | 1 | null per variable (null = variable absent). An empty array means constant 0; [[null...]] is 1. */
export function minimise(n, on, dc = []) {
  if (on.length === 0) return [];
  const ok = new Set([...on, ...dc]);
  const cubes = [];
  const total = 3 ** n;
  for (let c = 0; c < total; c++) {
    const cube = []; let k = c;
    for (let i = 0; i < n; i++) { const d = k % 3; k = Math.floor(k / 3); cube.push(d === 2 ? null : d); }
    cube.reverse();
    const ms = cubeMinterms(cube);
    if (ms.every((m) => ok.has(m)) && ms.some((m) => on.includes(m))) cubes.push({ cube, ms });
  }
  // primes: implicants not strictly contained in another implicant
  const primes = cubes.filter((a) => !cubes.some((b) => b !== a && b.ms.length > a.ms.length && a.ms.every((m) => b.ms.includes(m))));
  // smallest cover, ties broken by fewest literals, then by a stable order
  const lits = (c) => c.cube.filter((v) => v !== null).length;
  let best = null;
  const P = primes.length;
  for (let size = 1; size <= P && !best; size++) {
    for (const combo of choose(P, size)) {
      const pick = combo.map((i) => primes[i]);
      if (!on.every((m) => pick.some((p) => p.ms.includes(m)))) continue;
      const cost = pick.reduce((a, p) => a + lits(p), 0);
      if (!best || cost < best.cost) best = { pick, cost };
    }
  }
  return best.pick.map((p) => p.cube).sort((a, b) => lits({ cube: a }) - lits({ cube: b }) || cmpCube(a, b));
}

function cmpCube(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] === null ? 2 : a[i], y = b[i] === null ? 2 : b[i];
    if (x !== y) return y - x;
  }
  return 0;
}
function cubeMinterms(cube) {
  let ms = [0];
  for (const v of cube) ms = ms.flatMap((m) => (v === null ? [m * 2, m * 2 + 1] : [m * 2 + v]));
  return ms;
}
function* choose(n, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < n; i++) { acc.push(i); yield* choose(n, k, i + 1, acc); acc.pop(); }
}

/** Evaluate a term list for a variable assignment (array of 0/1). */
export function evalSOP(terms, values) {
  return terms.some((t) => t.every((v, i) => v === null || v === values[i])) ? 1 : 0;
}
/** Plain-text form, complement as a trailing prime: "Q0·X' + Q1·Q0'·X". */
export function sopText(vars, terms) {
  if (terms.length === 0) return "0";
  return terms.map((t) => {
    const lits = t.map((v, i) => (v === null ? null : vars[i] + (v ? "" : "'"))).filter(Boolean);
    return lits.length ? lits.join("·") : "1";
  }).join(" + ");
}

function allCombos(n) {
  const out = [];
  for (let m = 0; m < 1 << n; m++) out.push(toBits(m, n));
  return out;
}
function toBits(m, n) {
  return Array.from({ length: n }, (_, i) => (m >> (n - 1 - i)) & 1);
}
function toObj(names, vals) { return Object.fromEntries(names.map((n, i) => [n, vals[i]])); }
function matches(when, names, vec) { return names.every((n, i) => when[n] === undefined || when[n] === vec[i]); }
function fmtIn(names, vec) { return names.map((n, i) => `${n}=${vec[i]}`).join(","); }
