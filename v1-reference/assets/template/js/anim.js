/* ============================================================
   anim.js — looping animated concept diagrams (pure SVG + SMIL, offline)
   Each builder returns a DOM node. Embed with <div data-anim="sample"></div>.
   Keep animations SMIL-only (no JS timers) so they survive the
   single-file build and run offline. Add subject animations with
   the helpers below (box / carrier / t / svg).
   ============================================================ */
(function (w) {
  "use strict";
  const { el } = w.U;
  const E = "#36c7ff", H = "#ffcf5c", TX = "#cfe0ff", WIRE = "#8fa6dd";

  const box = (svg, caption) => el("div", { class: "anim-box" },
    el("div", { class: "svg-box lite", html: svg }),
    caption ? el("div", { class: "anim-cap muted", html: caption }) : null);

  // a moving dot that travels from x0 to x1 at height y (loops forever)
  function carrier(x0, y, x1, color, sign, dur, begin, fade) {
    const op = fade
      ? `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.7;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`
      : `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.9;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;
    return `<g>
      <circle cx="${x0}" cy="${y}" r="8" fill="${color}">
        <animate attributeName="cx" values="${x0};${x1}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${op}</circle>
      <text x="${x0}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#04263a">${sign}
        <animate attributeName="x" values="${x0};${x1}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${op}</text>
    </g>`;
  }
  const t = (x, y, s, anchor = "middle", fill = TX, size = 12) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-family="Consolas,monospace">${s}</text>`;
  const svg = (vb, body) => `<svg viewBox="0 0 ${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

  const A = {};

  /* sample animation — data flowing through a 3-stage pipeline.
     Replace with subject animations (carrier flow, algorithm steps, …). */
  A.sample = () => box(svg("360 150", [
    `<rect x="20" y="55" width="80" height="42" rx="8" fill="rgba(54,199,255,.08)" stroke="#213562"/>`,
    `<rect x="140" y="55" width="80" height="42" rx="8" fill="rgba(255,207,92,.08)" stroke="#213562"/>`,
    `<rect x="260" y="55" width="80" height="42" rx="8" fill="rgba(52,211,153,.08)" stroke="#213562"/>`,
    t(60, 80, "input", "middle", TX, 11), t(180, 80, "process", "middle", TX, 11), t(300, 80, "output", "middle", TX, 11),
    `<line x1="100" y1="76" x2="140" y2="76" stroke="${WIRE}" stroke-width="2"/>`,
    `<line x1="220" y1="76" x2="260" y2="76" stroke="${WIRE}" stroke-width="2"/>`,
    t(180, 30, "data flows left → right", "middle", "#a9b8da", 11),
    carrier(30, 120, 330, E, "•", 3, 0, false),
    carrier(30, 120, 330, H, "•", 3, 1.5, false),
  ].join("")), "A sample SMIL animation — dots loop through the pipeline. Replace with a concept animation for the subject.");

  A._ = { box, carrier, t, svg, E, H, TX, WIRE };   // helpers for subject animations
  w.Anim = A;
})(window);
