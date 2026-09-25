/* ============================================================
   graphs.js — interactive SVG plots (no dependencies)
   Each builder returns a DOM node (svg-box + controls).
   The plot/axes/path/slider infrastructure is generic — add
   subject-specific builders (load lines, loss curves, waveforms…)
   next to the two generic ones below. Embed in summaries with
   <div data-graph="linePlot" data-opts='{"…":…}'></div>.
   ============================================================ */
(function (w) {
  "use strict";
  const { el, r, clamp } = w.U;
  const SVGNS = "http://www.w3.org/2000/svg";
  const COL = { axis: "#5b6f9c", grid: "#1a2950", line: "#36c7ff", line2: "#ffcf5c", q: "#fb7185", txt: "#a9b8da" };

  function s(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function plot(wv = 460, hv = 280, pad = 38) {
    const svg = s("svg", { viewBox: `0 0 ${wv} ${hv}`, role: "img" });
    const box = el("div", { class: "svg-box lite" }); box.appendChild(svg);
    return { svg, box, wv, hv, pad,
      x: (vx, x0, x1) => pad + (vx - x0) / (x1 - x0) * (wv - pad - 14),
      y: (vy, y0, y1) => (hv - pad) - (vy - y0) / (y1 - y0) * (hv - pad - 14)
    };
  }
  function axes(P, xlabel, ylabel, x0, x1, y0, y1, xticks = 5, yticks = 4) {
    const { svg, pad, wv, hv } = P;
    svg.appendChild(s("line", { x1: pad, y1: hv - pad, x2: wv - 8, y2: hv - pad, stroke: COL.axis, "stroke-width": 1.5 }));
    svg.appendChild(s("line", { x1: pad, y1: hv - pad, x2: pad, y2: 8, stroke: COL.axis, "stroke-width": 1.5 }));
    for (let i = 0; i <= xticks; i++) { const vx = x0 + (x1 - x0) * i / xticks, X = P.x(vx, x0, x1);
      svg.appendChild(s("line", { x1: X, y1: hv - pad, x2: X, y2: 10, stroke: COL.grid, "stroke-width": 1 }));
      const t = s("text", { x: X, y: hv - pad + 14, fill: COL.txt, "font-size": 10, "text-anchor": "middle" }); t.textContent = r(vx, 1); svg.appendChild(t); }
    for (let i = 0; i <= yticks; i++) { const vy = y0 + (y1 - y0) * i / yticks, Y = P.y(vy, y0, y1);
      svg.appendChild(s("line", { x1: pad, y1: Y, x2: wv - 8, y2: Y, stroke: COL.grid, "stroke-width": 1 }));
      const t = s("text", { x: pad - 5, y: Y + 3, fill: COL.txt, "font-size": 10, "text-anchor": "end" }); t.textContent = r(vy, 1); svg.appendChild(t); }
    const xl = s("text", { x: wv - 8, y: hv - pad + 26, fill: COL.txt, "font-size": 11, "text-anchor": "end" }); xl.innerHTML = xlabel; svg.appendChild(xl);
    const yl = s("text", { x: pad - 6, y: 12, fill: COL.txt, "font-size": 11, "text-anchor": "start" }); yl.innerHTML = ylabel; svg.appendChild(yl);
  }
  function path(P, pts, x0, x1, y0, y1, color, wd = 2.4) {
    let d = ""; pts.forEach((p, i) => { d += (i ? "L" : "M") + P.x(p[0], x0, x1) + " " + P.y(clamp(p[1], y0, y1), y0, y1) + " "; });
    P.svg.appendChild(s("path", { d, fill: "none", stroke: color, "stroke-width": wd }));
  }
  function slider(label, min, max, step, value) {
    const out = el("span", { class: "readout" });
    const inp = el("input", { type: "range", min, max, step, value });
    const c = el("label", { class: "ctrl" }, el("span", { html: label + " " }, out), inp);
    return { c, inp, out };
  }

  const G = {};

  /* STATIC multi-series line plot from data.
     opts: { xlabel, ylabel, x0, x1, y0, y1,
             series:[{pts:[[x,y]…], color?, width?, label?}],
             marks:[{x,y,label?}], levels:[{y,label}], caption } */
  G.linePlot = (o = {}) => {
    const series = o.series || [];
    const all = series.flatMap(sr => sr.pts || []);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = o.x0 ?? (xs.length ? Math.min(...xs) : 0), x1 = o.x1 ?? (xs.length ? Math.max(...xs) : 10);
    const y0 = o.y0 ?? (ys.length ? Math.min(0, ...ys) : 0), y1 = o.y1 ?? (ys.length ? Math.max(...ys) * 1.1 : 10);
    const P = plot(o.w || 450, o.h || 250, 34);
    axes(P, o.xlabel || "x", o.ylabel || "y", x0, x1, y0, y1, o.xticks || 5, o.yticks || 4);
    const palette = [COL.line, COL.line2, COL.q, "#34d399", "#a78bfa"];
    series.forEach((sr, i) => path(P, sr.pts || [], x0, x1, y0, y1, sr.color || palette[i % palette.length], sr.width || 2.4));
    (o.levels || []).forEach(L => {
      const Y = P.y(L.y, y0, y1);
      P.svg.appendChild(s("line", { x1: P.pad, y1: Y, x2: P.wv - 8, y2: Y, stroke: COL.line2, "stroke-dasharray": "4 3", "stroke-width": 1 }));
      if (L.label) { const t = s("text", { x: P.wv - 10, y: Y - 3, fill: COL.line2, "font-size": 10, "text-anchor": "end" }); t.innerHTML = L.label; P.svg.appendChild(t); }
    });
    (o.marks || []).forEach(mk => {
      const X = P.x(mk.x, x0, x1), Y = P.y(clamp(mk.y, y0, y1), y0, y1);
      P.svg.appendChild(s("circle", { cx: X, cy: Y, r: 5, fill: COL.q }));
      if (mk.label) { const t = s("text", { x: X + 8, y: Y - 6, fill: COL.q, "font-size": 11, "font-weight": 700 }); t.textContent = mk.label; P.svg.appendChild(t); }
    });
    if (series.some(sr => sr.label)) {
      let lx = P.pad + 6;
      series.forEach((sr, i) => {
        if (!sr.label) return;
        const t = s("text", { x: lx, y: 16, fill: sr.color || palette[i % palette.length], "font-size": 10 }); t.innerHTML = "— " + sr.label; P.svg.appendChild(t);
        lx += (String(sr.label).length * 6 + 26);
      });
    }
    const box = el("div", {}, P.box);
    if (o.caption) box.appendChild(el("div", { class: "muted", style: "font-size:.82rem;text-align:center;margin-top:4px", html: o.caption }));
    return box;
  };

  /* STATIC scatter plot (optionally colored groups + an overlay line).
     opts: { xlabel, ylabel, x0, x1, y0, y1,
             groups:[{pts:[[x,y]…], color?, label?}], line:{pts:[[x,y]…], color?}, caption } */
  G.scatter = (o = {}) => {
    const groups = o.groups || [];
    const all = groups.flatMap(g => g.pts || []).concat((o.line && o.line.pts) || []);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x0 = o.x0 ?? (xs.length ? Math.min(...xs) - 1 : 0), x1 = o.x1 ?? (xs.length ? Math.max(...xs) + 1 : 10);
    const y0 = o.y0 ?? (ys.length ? Math.min(...ys) - 1 : 0), y1 = o.y1 ?? (ys.length ? Math.max(...ys) + 1 : 10);
    const P = plot(o.w || 450, o.h || 250, 34);
    axes(P, o.xlabel || "x", o.ylabel || "y", x0, x1, y0, y1, o.xticks || 5, o.yticks || 4);
    const palette = [COL.line, COL.line2, COL.q, "#34d399", "#a78bfa"];
    groups.forEach((g, gi) => (g.pts || []).forEach(p =>
      P.svg.appendChild(s("circle", { cx: P.x(p[0], x0, x1), cy: P.y(p[1], y0, y1), r: 4.5, fill: g.color || palette[gi % palette.length], opacity: .9 }))));
    if (o.line && o.line.pts) path(P, o.line.pts, x0, x1, y0, y1, o.line.color || COL.q, 2.2);
    const box = el("div", {}, P.box);
    if (o.caption) box.appendChild(el("div", { class: "muted", style: "font-size:.82rem;text-align:center;margin-top:4px", html: o.caption }));
    return box;
  };

  // expose the toolkit so subject builders (added per project) can reuse it
  G._ = { s, plot, axes, path, slider, COL };
  w.Graphs = G;
})(window);
