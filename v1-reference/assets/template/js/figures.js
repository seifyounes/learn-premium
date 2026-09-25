/* ============================================================
   figures.js — the SUBJECT VISUAL TOOLKIT (SVG-string builders)
   This is the one engine file that changes per subject: circuits for
   electronics, network/architecture diagrams for ML, labeled anatomy
   for biology, geometry for math…

   THE CONTRACT (walkthrough.js, exam.js and app.js depend on it):
   - Every builder is a function Figures.name(opts) that RETURNS AN
     <svg> STRING (not a DOM node) with a viewBox.
   - Sub-parts the walkthrough should highlight carry id="p-…" and
     class="part"  →  a step with hl:["p-w1"] lights that part up, and
     chips anchor to it. Per-step `circuit:{fn,opts}` swaps the whole
     figure (the professor's "redraw the simpler equivalent" morph).
   - window.Figures and window.Circuits are the SAME object (legacy
     alias) — engines and data files may use either name.

   Build subject figures with the primitives below; keep coordinates
   inside the viewBox and label parts with txt()/val().
   ============================================================ */
(function (w) {
  "use strict";

  const WIRE = "#8fa6dd", COMP = "#d9f3ff", LBL = "#cfe0ff", VAL = "#ffcf5c", HOT = "#36c7ff";

  // ---- primitives (coordinates in a 0..viewBox space) ----
  const svg = (vb, body) => `<svg viewBox="0 0 ${vb}" xmlns="http://www.w3.org/2000/svg" role="img">${body}</svg>`;
  const ln = (x1, y1, x2, y2, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${WIRE}" stroke-width="2" ${extra}/>`;
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${WIRE}"/>`;
  const txt = (x, y, s, anchor = "middle", fill = LBL, size = 13) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-family="Consolas,monospace">${s}</text>`;
  const val = (x, y, s, anchor = "start") => txt(x, y, s, anchor, VAL, 13);
  // a highlightable sub-part: part("p-w1", …inner svg…) → carries id + class="part"
  const part = (id, inner) => `<g id="${id || ""}" class="part">${inner}</g>`;
  // rounded labeled box (nodes, layers, stages)
  const boxNode = (x, y, wd, ht, label, id, fill = "rgba(54,199,255,.08)") =>
    part(id, `<rect x="${x}" y="${y}" width="${wd}" height="${ht}" rx="8" fill="${fill}" stroke="${COMP}" stroke-width="2"/>${label ? txt(x + wd / 2, y + ht / 2 + 4, label, "middle", LBL, 12) : ""}`);
  // arrow between two points
  const arrow = (x1, y1, x2, y2, id, label) => {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ax = x2 - 10 * Math.cos(ang), ay = y2 - 10 * Math.sin(ang);
    const p1 = `${x2},${y2}`, p2 = `${ax - 5 * Math.sin(ang)},${ay + 5 * Math.cos(ang)}`, p3 = `${ax + 5 * Math.sin(ang)},${ay - 5 * Math.cos(ang)}`;
    return part(id, `${ln(x1, y1, ax, ay)}<polygon points="${p1} ${p2} ${p3}" fill="${WIRE}"/>${label ? txt((x1 + x2) / 2, (y1 + y2) / 2 - 8, label, "middle", VAL, 11) : ""}`);
  };

  const F = {};

  /* neutral sample: a 3-stage flow whose parts light up step by step.
     Used by the sample module; replace with subject builders. */
  F.sampleFlow = (o = {}) => svg("420 150", [
    boxNode(20, 50, 100, 50, o.a || "input", "p-in"),
    arrow(120, 75, 160, 75, "p-a1"),
    boxNode(160, 50, 100, 50, o.b || "process", "p-mid", "rgba(255,207,92,.08)"),
    arrow(260, 75, 300, 75, "p-a2"),
    boxNode(300, 50, 100, 50, o.c || "output", "p-out", "rgba(52,211,153,.08)"),
    txt(210, 30, o.cap || "sample flow — parts highlight step by step", "middle", LBL, 11),
  ].join(""));

  /* the simplified/equivalent version of sampleFlow — demonstrates the
     per-step morph (`circuit:{fn:"sampleFlowSimple"}` inside a step) */
  F.sampleFlowSimple = (o = {}) => svg("420 150", [
    boxNode(60, 50, 140, 50, o.a || "input", "p-in"),
    arrow(200, 75, 240, 75, "p-a1", o.k || "combined"),
    boxNode(240, 50, 120, 50, o.c || "output", "p-out", "rgba(52,211,153,.08)"),
    txt(210, 30, o.cap || "redrawn: the middle stage folded in", "middle", LBL, 11),
  ].join(""));

  // export the toolkit for subject builders added by the content phase
  F._ = { svg, ln, dot, txt, val, part, boxNode, arrow, WIRE, COMP, LBL, VAL, HOT };

  w.Figures = F;
  w.Circuits = F;   // legacy alias — walkthrough.js/exam.js/data files may use window.Circuits
})(window);
