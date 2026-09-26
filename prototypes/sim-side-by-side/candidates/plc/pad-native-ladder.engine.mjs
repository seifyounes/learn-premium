// PROTOTYPE (throwaway): a tiny PLC scan engine for ladder programs (program.json format).
// Importable in Node (check-pad-native-ladder.mjs) and in the browser (pad-native-ladder.html).
//
// One scan = read inputs -> solve rungs top to bottom (recording power in / out per element)
// -> update IEC timers inline -> write the output image. Coils write memory immediately, so a
// later rung sees an earlier rung's result in the same scan, as on a real PLC.
//
// Timers follow IEC 61131-3 TON: IN false -> Q false, ET 0; IN rising -> ET counts from 0 with
// elapsed clock time, capped at PT; Q = ET >= PT. Time is integer milliseconds.

export function createPLC(program) {
  const tagNames = Object.keys(program.tags);
  const field = {};   // physical state of each input device (true = button pressed)
  const mem = {};     // bit memory: input image + internal/coil bits
  const out = {};     // output image, written at the end of the scan (drives the plant)
  const timers = {};
  let trace = {};
  let scanCount = 0;
  let now = 0;

  function reset() {
    for (const n of tagNames) { field[n] = false; mem[n] = false; out[n] = false; }
    for (const [n, def] of Object.entries(program.timers || {})) {
      timers[n] = { type: def.type, pt: def.pt, in: false, q: false, et: 0, start: 0 };
    }
    trace = {}; scanCount = 0; now = 0;
  }

  // Physical button: pressed = true/false. The wiring decides the input bit.
  function press(tag, pressed) { field[tag] = !!pressed; }

  function inputBit(tag) {
    const def = program.tags[tag];
    return def.wiring === "NC" ? !field[tag] : field[tag];
  }

  function ton(name, IN, t) {
    const T = timers[name];
    if (!IN) { T.in = false; T.q = false; T.et = 0; return false; }
    if (!T.in) { T.in = true; T.start = t; }          // rising edge: ET starts at 0
    T.et = Math.min(t - T.start, T.pt);
    T.q = T.et >= T.pt;
    return T.q;
  }

  function solve(el, pin, t) {
    let pout;
    switch (el.type) {
      case "NO": { const closed = !!mem[el.tag]; pout = pin && closed; trace[el.id] = { pin, pout, closed }; return pout; }
      case "NC": { const closed = !mem[el.tag]; pout = pin && closed; trace[el.id] = { pin, pout, closed }; return pout; }
      case "coil": { mem[el.tag] = pin; trace[el.id] = { pin, pout: pin, on: pin }; return pin; }
      case "TON": {
        pout = ton(el.timer, pin, t);
        const T = timers[el.timer];
        trace[el.id] = { pin, pout, et: T.et, pt: T.pt, q: T.q };
        return pout;
      }
      case "par": {
        const outs = el.branches.map((br) => solveSeries(br, pin, t));
        pout = outs.some(Boolean);
        trace[el.id] = { pin, pout, branchOut: outs };
        return pout;
      }
      default: throw new Error("unknown element type " + el.type);
    }
  }

  function solveSeries(list, pin, t) {
    let p = pin;
    for (const el of list) p = solve(el, p, t);
    return p;
  }

  // Run one scan at absolute time t (ms).
  function scan(t) {
    now = t;
    trace = {};
    for (const n of tagNames) if (program.tags[n].kind === "input") mem[n] = inputBit(n);   // 1. input image
    for (const rung of program.rungs) {                                                      // 2. solve
      const pout = solveSeries(rung.elements, true, t);
      trace[rung.id] = { pin: true, pout };
    }
    for (const n of tagNames) if (program.tags[n].kind === "output") out[n] = !!mem[n];      // 3. output image
    scanCount++;
    return snapshot();
  }

  function read(name) {
    if (name.includes(".")) { const [tm, f] = name.split("."); return timers[tm][f.toLowerCase()]; }
    return program.tags[name]?.kind === "output" ? out[name] : mem[name];
  }

  function snapshot() {
    return {
      t: now, scanCount,
      field: { ...field }, bits: { ...mem }, outputs: { ...out },
      timers: Object.fromEntries(Object.entries(timers).map(([k, v]) => [k, { ...v }])),
      trace,
    };
  }

  reset();
  return { press, scan, read, reset, snapshot, program };
}

// Replay a program's `expect` timeline; returns one row per checked value.
export function replay(program) {
  const plc = createPLC(program);
  const dt = program.scanMs;
  const rows = [];
  const events = [...program.expect].sort((a, b) => a.t - b.t);
  const end = events[events.length - 1].t;
  let i = 0;
  for (let t = 0; t <= end; t += dt) {
    const due = [];
    while (i < events.length && events[i].t === t) due.push(events[i++]);
    for (const ev of due) for (const [tag, v] of Object.entries(ev.press || {})) plc.press(tag, v);
    plc.scan(t);
    for (const ev of due) {
      for (const [name, want] of Object.entries(ev.check || {})) {
        const got = plc.read(name);
        rows.push({ t, note: ev.note, name, want, got, pass: got === want });
      }
    }
  }
  if (i !== events.length) throw new Error("expect times must be multiples of scanMs");
  return rows;
}
