// PROTOTYPE (throwaway). A small discrete-event pneumatic engine.
// Circuit = components + nets joined by PORT NAME (never by coordinates).
// Pipeline each event: valve states -> which nets hold pressure (union-find through the open
// valve paths) -> pilots shift spools after a spool delay -> cylinders travel at constant speed
// -> end-of-stroke makes/breaks roller valves -> next event. Pure JS, no DOM: runs in Node and
// in the browser. Kinematic model (no forces, no fill time): a teaching sequence simulator.

const EPS = 1e-9;

/** The circuit every pneumatics candidate shows: A+ B+ B- A-, two-group cascade. */
export const CASCADE = {
  id: 'cascade-abba',
  name: 'A+ B+ B− A−, two-group cascade',
  sequence: ['A+', 'B+', 'B-', 'A-'],
  spoolDelay: 0.04, // s, pilot applied -> spool fully shifted
  components: {
    '0Z':  { type: 'source', bar: 6 },
    A:     { type: 'cylinder', tPlus: 1.0, tMinus: 0.8, label: '1A' },
    B:     { type: 'cylinder', tPlus: 0.9, tMinus: 0.7, label: '2A' },
    '1V1': { type: 'valve52', init: '12' },
    '2V1': { type: 'valve52', init: '12' },
    '0V1': { type: 'valve52', init: '12' }, // group valve: 14 = line I, 12 = line II
    a0:    { type: 'valve32', actuator: { roller: 'A', end: 0 } },
    a1:    { type: 'valve32', actuator: { roller: 'A', end: 1 } },
    b0:    { type: 'valve32', actuator: { roller: 'B', end: 0 } },
    b1:    { type: 'valve32', actuator: { roller: 'B', end: 1 } },
    START: { type: 'valve32', actuator: { button: 'START' } },
  },
  nets: {
    P:       ['0Z.out', '1V1.1', '2V1.1', '0V1.1'],
    I:       ['0V1.4', '1V1.14', 'a1.1', 'b1.1'],
    II:      ['0V1.2', '2V1.12', 'a0.1', 'b0.1'],
    s_a0:    ['a0.2', 'START.1'],
    s_start: ['START.2', '0V1.14'],
    s_a1:    ['a1.2', '2V1.14'],
    s_b1:    ['b1.2', '0V1.12'],
    s_b0:    ['b0.2', '1V1.12'],
    A_cap:   ['1V1.4', 'A.cap'],
    A_rod:   ['1V1.2', 'A.rod'],
    B_cap:   ['2V1.4', 'B.cap'],
    B_rod:   ['2V1.2', 'B.rod'],
  },
};

/** Same parts wired the naive way (no group valve). Used by the gate to prove the conflict check bites. */
export const NAIVE = {
  id: 'naive-abba',
  name: 'A+ B+ B− A−, naive wiring (signal overlap)',
  sequence: ['A+', 'B+', 'B-', 'A-'],
  spoolDelay: 0.04,
  components: Object.fromEntries(Object.entries(CASCADE.components).filter(([k]) => k !== '0V1')),
  nets: {
    P:       ['0Z.out', '1V1.1', '2V1.1', 'a0.1', 'a1.1', 'b0.1', 'b1.1'],
    s_a0:    ['a0.2', 'START.1'],
    s_start: ['START.2', '1V1.14'],
    s_a1:    ['a1.2', '2V1.14'],
    s_b1:    ['b1.2', '2V1.12'],
    s_b0:    ['b0.2', '1V1.12'],
    A_cap:   ['1V1.4', 'A.cap'],
    A_rod:   ['1V1.2', 'A.rod'],
    B_cap:   ['2V1.4', 'B.cap'],
    B_rod:   ['2V1.2', 'B.rod'],
  },
};

// Open paths inside each valve state. 'X' = the exhaust port vents to atmosphere.
const PATHS = {
  valve52: { '14': [['1', '4'], ['2', '3X']], '12': [['1', '2'], ['4', '5X']] },
  valve32: { act: [['1', '2']], rest: [['2', '3X']] },
};

export class Sim {
  constructor(circuit = CASCADE) {
    this.c = circuit;
    this.portNet = {};
    for (const [net, ports] of Object.entries(circuit.nets)) for (const p of ports) this.portNet[p] = net;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.inputs = {};
    this.valves = {};
    this.cyl = {};
    this.scheduled = []; // { t, input, on }
    this.conflictOpen = {};
    this.trace = [];
    this.pressure = {};
    this.limits = {};
    for (const [id, c] of Object.entries(this.c.components)) {
      if (c.type === 'valve52') this.valves[id] = { pos: c.init, shift: null };
      if (c.type === 'cylinder') this.cyl[id] = { x: 0, v: 0 };
      if (c.type === 'valve32' && c.actuator.button) this.inputs[c.actuator.button] = false;
    }
    this._settle([{ kind: 'reset' }]);
  }

  // ---------- pure evaluation ----------
  _limitMade(id) {
    const a = this.c.components[id].actuator;
    if (a.button) return !!this.inputs[a.button];
    const { x, v } = this.cyl[a.roller];
    // made at the end of stroke, and released the moment the rod starts to leave it
    return a.end === 1 ? x >= 1 - EPS && v >= 0 : x <= EPS && v <= 0;
  }

  _evaluate() {
    const parent = {};
    const find = (n) => (parent[n] === undefined || parent[n] === n ? (parent[n] = n) : (parent[n] = find(parent[n])));
    const union = (a, b) => { parent[find(a)] = find(b); };
    const node = (comp, port) => {
      if (port.endsWith('X')) return 'ATM';
      return this.portNet[`${comp}.${port}`] ?? `~${comp}.${port}`; // unconnected port = its own dead end
    };
    for (const [id, c] of Object.entries(this.c.components)) {
      if (c.type === 'source') union(node(id, 'out'), 'SRC');
      if (c.type === 'valve52' || c.type === 'valve32') {
        const state = c.type === 'valve52' ? this.valves[id].pos : this._limitMade(id) ? 'act' : 'rest';
        for (const [p, q] of PATHS[c.type][state]) union(node(id, p), node(id, q));
      }
    }
    if (find('SRC') === find('ATM')) throw new Error('supply is open to atmosphere (short)');
    const pressure = {}, vented = {};
    for (const net of Object.keys(this.c.nets)) {
      pressure[net] = find(net) === find('SRC');
      vented[net] = find(net) === find('ATM');
    }
    return { pressure, vented };
  }

  _pilot(valve, pilot) {
    const net = this.portNet[`${valve}.${pilot}`];
    return !!(net && this.pressure[net]);
  }

  // ---------- event processing ----------
  _settle(events) {
    for (let pass = 0; pass < 8; pass++) {
      const { pressure, vented } = this._evaluate();
      for (const net of Object.keys(pressure)) {
        if (!!this.pressure[net] !== pressure[net]) events.push({ kind: 'line', net, on: pressure[net] });
      }
      this.pressure = pressure;
      this.vented = vented;

      // pilots -> spool shifts (memory valves; both pilots live = signal conflict)
      for (const [id, v] of Object.entries(this.valves)) {
        const p14 = this._pilot(id, '14'), p12 = this._pilot(id, '12');
        if (p14 && p12) {
          if (!this.conflictOpen[id]) { this.conflictOpen[id] = true; events.push({ kind: 'conflict', valve: id }); }
          continue;
        }
        this.conflictOpen[id] = false;
        const want = p14 ? '14' : p12 ? '12' : null;
        if (want && v.pos !== want && !(v.shift && v.shift.to === want)) {
          v.shift = { from: v.pos, to: want, t0: this.t, t1: this.t + this.c.spoolDelay };
          events.push({ kind: 'pilot', valve: id, to: want });
        }
      }

      // chambers -> piston velocity
      let changed = false;
      for (const [id, cy] of Object.entries(this.cyl)) {
        const c = this.c.components[id];
        const cap = this.portNet[`${id}.cap`], rod = this.portNet[`${id}.rod`];
        let v = 0;
        if (pressure[cap] && vented[rod] && cy.x < 1 - EPS) v = 1 / c.tPlus;
        else if (pressure[rod] && vented[cap] && cy.x > EPS) v = -1 / c.tMinus;
        if (v !== cy.v) {
          if (v !== 0) events.push({ kind: 'move', cyl: id, dir: v > 0 ? '+' : '-' });
          cy.v = v;
          changed = true;
        }
      }

      // rollers / buttons (only report edges)
      for (const id of Object.keys(this.c.components)) {
        if (this.c.components[id].type !== 'valve32') continue;
        const made = this._limitMade(id);
        if (!!this.limits[id] !== made) {
          this.limits[id] = made;
          if (!this.c.components[id].actuator.button) events.push({ kind: 'limit', id, on: made });
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (events.length) this.trace.push({ t: this.t, events, snap: this.snapshot() });
    return events;
  }

  snapshot() {
    return {
      t: this.t,
      x: Object.fromEntries(Object.entries(this.cyl).map(([k, c]) => [k, c.x])),
      v: Object.fromEntries(Object.entries(this.cyl).map(([k, c]) => [k, c.v])),
      valves: Object.fromEntries(Object.entries(this.valves).map(([k, v]) => [k, v.pos])),
      pressure: { ...this.pressure },
      limits: { ...this.limits },
      inputs: { ...this.inputs },
    };
  }

  /** Earliest pending event time (Infinity when the machine is idle). */
  nextEventTime() {
    let tn = Infinity;
    for (const s of this.scheduled) tn = Math.min(tn, s.t);
    for (const v of Object.values(this.valves)) if (v.shift) tn = Math.min(tn, v.shift.t1);
    for (const cy of Object.values(this.cyl)) {
      if (cy.v > 0) tn = Math.min(tn, this.t + (1 - cy.x) / cy.v);
      if (cy.v < 0) tn = Math.min(tn, this.t + cy.x / -cy.v);
    }
    return tn;
  }

  _travelTo(t) {
    const dt = t - this.t;
    for (const cy of Object.values(this.cyl)) cy.x = Math.min(1, Math.max(0, cy.x + cy.v * dt));
    this.t = t;
  }

  /** Set a push-button now (a student tap). Returns the events it caused. */
  setInput(name, on) {
    if (this.inputs[name] === on) return [];
    this.inputs[name] = on;
    return this._settle([{ kind: 'input', input: name, on }]);
  }

  /** Queue a push-button change at a future sim time. */
  scheduleInput(t, name, on) {
    this.scheduled.push({ t: Math.max(t, this.t), input: name, on });
  }

  /** Process the next pending event (if any). Returns its events, or null when idle. */
  step(limit = Infinity) {
    const tn = this.nextEventTime();
    if (!(tn <= limit)) return null;
    this._travelTo(tn);
    const events = [];
    for (const cy of Object.values(this.cyl)) {
      if (cy.v > 0 && cy.x >= 1 - EPS) { cy.x = 1; events.push({ kind: 'end', cyl: idOf(this.cyl, cy), at: 1 }); cy.v = 0; }
      if (cy.v < 0 && cy.x <= EPS) { cy.x = 0; events.push({ kind: 'end', cyl: idOf(this.cyl, cy), at: 0 }); cy.v = 0; }
    }
    for (const [id, v] of Object.entries(this.valves)) {
      if (v.shift && v.shift.t1 <= this.t + EPS) { v.pos = v.shift.to; v.shift = null; events.push({ kind: 'shift', valve: id, to: v.pos }); }
    }
    const due = this.scheduled.filter((s) => s.t <= this.t + EPS);
    this.scheduled = this.scheduled.filter((s) => s.t > this.t + EPS);
    for (const s of due) {
      if (this.inputs[s.input] !== s.on) { this.inputs[s.input] = s.on; events.push({ kind: 'input', input: s.input, on: s.on }); }
    }
    return this._settle(events);
  }

  /** Run every event up to time t, then let the pistons travel to t. */
  advanceTo(t) {
    const out = [];
    for (let guard = 0; guard < 10000; guard++) {
      const ev = this.step(t);
      if (!ev) break;
      out.push({ t: this.t, events: ev });
    }
    if (t > this.t) this._travelTo(t);
    return out;
  }

  /** Spool position for drawing: 0 = at 12, 1 = at 14, fractional while shifting. */
  spool(id, t = this.t) {
    const v = this.valves[id];
    const at = (p) => (p === '14' ? 1 : 0);
    if (!v.shift) return at(v.pos);
    const f = Math.min(1, Math.max(0, (t - v.shift.t0) / (v.shift.t1 - v.shift.t0)));
    return at(v.shift.from) + (at(v.shift.to) - at(v.shift.from)) * f;
  }
}

function idOf(map, obj) {
  for (const [k, v] of Object.entries(map)) if (v === obj) return k;
  return '?';
}

// ---------- analysis helpers (used by the gate and by the view) ----------

/** Movements in order, from a trace: ['A+', 'B+', ...]. */
export function movements(trace) {
  const out = [];
  for (const rec of trace) for (const e of rec.events) if (e.kind === 'move') out.push({ t: rec.t, m: e.cyl + e.dir });
  return out;
}

/** Every signal conflict in a trace. */
export function conflicts(trace) {
  const out = [];
  for (const rec of trace) for (const e of rec.events) if (e.kind === 'conflict') out.push({ t: rec.t, valve: e.valve });
  return out;
}

/** Positions at each step boundary (after each completed movement), starting from rest. */
export function stepTable(trace, cylinders = ['A', 'B']) {
  const rows = [Object.fromEntries(cylinders.map((c) => [c, trace[0].snap.x[c]]))];
  for (const rec of trace) {
    if (rec.events.some((e) => e.kind === 'end')) rows.push(Object.fromEntries(cylinders.map((c) => [c, rec.snap.x[c]])));
  }
  return rows;
}

/** One START tap (pressed at tPress for tHold s), run until idle or tMax. */
export function runCycle(circuit = CASCADE, { tPress = 0.2, tHold = 0.3, tMax = 30 } = {}) {
  const sim = new Sim(circuit);
  sim.scheduleInput(tPress, 'START', true);
  sim.scheduleInput(tPress + tHold, 'START', false);
  sim.advanceTo(tMax);
  return sim;
}
