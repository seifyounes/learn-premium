/* ============================================================
   walkthrough.js — step-reveal worked solutions, now with a
   "watch it solve" player + animated visuals.
   Walkthrough.render(container, moduleId, worked[])
   worked item: { id, title, highYield, statement,
                  given:{cap,cols,rows,note} | [given…],  // the question's DATA as the
                                                          // source drew it (U.given)
                  circuit:{fn:"ceAmp",opts:{}} | svgString,
                  table:{...},                       // the professor's table (below)
                  steps:[{k, html, hl:["p-RC"], chip:"opt text",
                          fill:["c2"], mark:["sum:c4"], table:{...}}], answer }

   THE PROFESSOR'S TABLE (generic — any subject that solves in a table):
     table: {
       cols: ["X","y","h","h−y"],      // header cells
       rows: [["2","3","6","3"], …],   // body cells (strings; mathified)
       sum:  ["Σ","","","12"],         // optional Σ / total row
       pre:  ["c0","c1"],              // cells already on the board before step 1
       cap:  "…", note: "…"
     }
   A step reveals cells with `fill` (cumulative — the board fills up as you go),
   circles the headline number with `mark`, and may carry a whole NEW `table`
   (a second iteration = a fresh table, carried forward like `circuit`).
   Cell selectors (0-INDEXED): "all" · "sum" · "c3" (body column) · "r1" (body
   row) · "r1c3" (one cell) · "sum:c3" (one Σ cell) · "head:c3".
   If NO step declares `fill`, the table simply shows complete.
   `given` is the question's DATA (static, drawn the way the source drew it);
   `table` is the professor's SOLVING table (fills as the steps run). Both may
   appear on one example — they are different things.
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, given } = w.U;
  const Flags = w.Flags, Progress = w.Progress, Circuits = w.Circuits;

  /* ---------- the professor's table: build + progressive fill ---------- */
  function makeTable(spec) {
    const cols = spec.cols || [], rows = spec.rows || [];
    const wrap = el("div", { class: "dtable-wrap" });
    if (spec.cap) wrap.appendChild(el("div", { class: "dtable-cap", html: M(spec.cap) }));
    const tbl = el("table", { class: "dtable" });
    const htr = el("tr");
    cols.forEach((c, ci) => htr.appendChild(el("th", { html: M(String(c)), dataset: { cell: "head:c" + ci } })));
    tbl.appendChild(el("thead", {}, htr));
    const tb = el("tbody");
    rows.forEach((r, ri) => {
      const tr = el("tr");
      cols.forEach((_, ci) => {
        const v = r[ci] == null ? "" : String(r[ci]);
        tr.appendChild(el("td", { dataset: { cell: "r" + ri + "c" + ci } }, el("span", { class: "v", html: M(v) })));
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    if (spec.sum && spec.sum.length) {
      const tr = el("tr", { class: "sum-row" });
      cols.forEach((_, ci) => {
        const v = spec.sum[ci] == null ? "" : String(spec.sum[ci]);
        tr.appendChild(el("td", { dataset: { cell: "sum:c" + ci } }, el("span", { class: "v", html: M(v) })));
      });
      tbl.appendChild(el("tfoot", {}, tr));
    }
    wrap.appendChild(el("div", { class: "dtable-scroll" }, tbl));
    if (spec.note) wrap.appendChild(el("div", { class: "dtable-note", html: M(spec.note) }));
    return wrap;
  }

  function cellInfo(v) {
    if (v.indexOf("sum:c") === 0) return { kind: "sum", c: +v.slice(5) };
    if (v.indexOf("head:c") === 0) return { kind: "head", c: +v.slice(6) };
    const m = /^r(\d+)c(\d+)$/.exec(v);
    return m ? { kind: "body", r: +m[1], c: +m[2] } : null;
  }
  function matches(info, s) {
    s = String(s).trim();
    if (s === "all") return true;
    if (s === "sum") return info.kind === "sum";
    if (s.indexOf("sum:c") === 0) return info.kind === "sum" && info.c === +s.slice(5);
    if (/^c\d+$/.test(s)) return info.kind === "body" && info.c === +s.slice(1);
    if (/^r\d+$/.test(s)) return info.kind === "body" && info.r === +s.slice(1);
    if (/^r\d+c\d+$/.test(s)) return info.kind === "body" && ("r" + info.r + "c" + info.c) === s;
    return false;
  }
  function applyFill(node, shown, flash, mark) {
    if (!node) return;
    node.querySelectorAll("td[data-cell]").forEach(td => {
      const info = cellInfo(td.dataset.cell); if (!info) return;
      const on = shown.some(s => matches(info, s));
      td.classList.toggle("pend", !on);
      td.classList.toggle("fresh", on && flash.some(s => matches(info, s)));
      td.classList.toggle("circled", on && mark.some(s => matches(info, s)));
    });
  }

  /* Pull the last <b>…</b> out of a step's html → the headline result for a chip.
     A chip is a VALUE badge, so bail out rather than truncate: slicing a long
     formula at a fixed width shipped chips like "V_o-av = (1/T)∫₀ᵀ v_o(" —
     meaningless, and worse than no chip. Long results stay in the step text,
     where they are already readable. Author an explicit `chip:` to override. */
  const CHIP_MAX = 30;
  function resultText(html) {
    const m = String(html).match(/<b>([\s\S]*?)<\/b>(?![\s\S]*<b>)/i);
    if (!m) return null;
    const tmp = document.createElement("div"); tmp.innerHTML = m[1];
    const t = (tmp.textContent || "").trim();
    return (!t || t.length > CHIP_MAX) ? null : t;
  }

  function render(container, moduleId, worked) {
    container.innerHTML = "";
    if (!worked || !worked.length) { container.appendChild(el("p", { class: "muted", text: "No worked examples yet for this lecture." })); return; }
    worked.forEach((ex, i) => container.appendChild(item(ex, i)));
    Progress.markSeen(moduleId, "worked");

    function item(ex, i) {
      const key = `${moduleId}:worked:${ex.id ?? i}`;
      const stepsWrap = el("div", { class: "wt-steps" });
      const steps = (ex.steps || []).slice();
      if (ex.answer) steps.push({ k: "Answer", html: ex.answer, answer: true });

      // the professor's "redraw" — a step may carry its own circuit; carry the last one forward
      const stepSpec = []; let lastSpec = ex.circuit || null;
      for (let j = 0; j < steps.length; j++) { if (steps[j].circuit) lastSpec = steps[j].circuit; stepSpec[j] = lastSpec; }
      const anyCircuit = !!(ex.circuit || stepSpec.some(Boolean));
      let circuitNode = null, overlay = null, svgHost = null, mountedSvg = null;
      if (anyCircuit) {
        circuitNode = el("div", { class: "svg-box circuit-hold" });
        svgHost = el("div", { class: "circuit-svg" });
        /* Chips live in a strip UNDER the figure, never on top of it.
           They used to be absolutely positioned over the drawing, which is only
           safe when the figure has empty space. A multi-panel waveform plot has
           none, so every chip landed on a trace and buried the thing it was
           annotating. The `hl` highlight already points at the right part; the
           chip only has to carry the value, and it must stay readable. */
        overlay = el("div", { class: "wt-chips" });
        circuitNode.appendChild(svgHost); circuitNode.appendChild(overlay);
      }
      function specSvg(spec) { return !spec ? "" : (typeof spec === "string" ? spec : (Circuits[spec.fn] ? Circuits[spec.fn](spec.opts || {}) : "")); }
      function setCircuit(spec) { if (!svgHost) return; const svg = specSvg(spec || ex.circuit); if (svg === mountedSvg) return; mountedSvg = svg; svgHost.innerHTML = svg; }
      setCircuit(ex.circuit || stepSpec[0]);

      // the professor's table — carried forward step to step, swapped when a step brings a new one
      const tblSpec = []; let lastTbl = ex.table || null;
      for (let j = 0; j < steps.length; j++) { if (steps[j].table) lastTbl = steps[j].table; tblSpec[j] = lastTbl; }
      const anyTable = !!(ex.table || tblSpec.some(Boolean));
      const anyFill = steps.some(st => (st.fill || []).length);
      let tableHost = null, tableNode = null, mountedTbl = null;
      if (anyTable) tableHost = el("div", { class: "dtable-host" });
      function setTable(spec) {
        if (!tableHost || !spec || spec === mountedTbl) return;
        mountedTbl = spec; tableHost.innerHTML = ""; tableNode = makeTable(spec); tableHost.appendChild(tableNode);
        publishTableHeight();
      }
      // the table pins under the topbar; steps and the figure need its height so they
      // never scroll underneath it (see --wt-tbl-h in styles.css)
      function publishTableHeight() {
        if (!tableHost) return;
        requestAnimationFrame(() => {
          const host = tableHost.closest(".worked") || tableHost.parentElement;
          if (host) host.style.setProperty("--wt-tbl-h", Math.round(tableHost.getBoundingClientRect().height) + "px");
        });
      }
      function paintTable() {
        if (!tableHost) return;
        const spec = (cur >= 0 && tblSpec[cur]) || ex.table || tblSpec[0];
        setTable(spec);
        if (!anyFill) { applyFill(tableNode, ["all"], [], []); return; }
        const shown = (spec && spec.pre ? spec.pre.slice() : []);
        for (let j = 0; j <= cur; j++) {
          if (tblSpec[j] !== spec) continue;                       // fills belong to their own table
          (steps[j].fill || []).forEach(s => shown.push(s));
        }
        const on = cur >= 0 && tblSpec[cur] === spec;
        applyFill(tableNode, shown, on ? (steps[cur].fill || []) : [], on ? (steps[cur].mark || []) : []);
      }
      setTable(ex.table || tblSpec[0]);

      let cur = -1, playing = false, speed = 1, timer = null;

      steps.forEach((st) => {
        stepsWrap.appendChild(el("div", { class: "step" + (st.answer ? " answer" : "") },
          el("span", { class: "k", html: M(st.k || "Step") }),
          el("div", { html: M(st.html) })));
      });

      function clearHl() { if (circuitNode) circuitNode.querySelectorAll(".hl").forEach(n => n.classList.remove("hl")); }
      function setHl(ids) {
        if (!circuitNode) return; clearHl();
        (ids || []).forEach(id => { const g = circuitNode.querySelector("#" + CSS.escape(id)); if (g) g.querySelectorAll("path,line,polygon,polyline,circle,rect,ellipse").forEach(p => p.classList.add("hl")); });
      }
      function clearChips() { if (overlay) overlay.innerHTML = ""; }
      /* One chip per step, appended to the strip in reveal order. No positioning
         maths, so there is nothing to collide with and nothing to clamp.
         Duplicate text is dropped so a repeated value doesn't clutter the row. */
      function addChip(j) {
        if (!overlay) return;
        const st = steps[j];
        const txt = st.chip || resultText(st.html); if (!txt) return;
        if (Array.from(overlay.children).some(c => c.textContent === txt)) return;
        overlay.appendChild(el("div", { class: "wt-chip", text: txt }));
      }

      function reveal(i) {
        cur = Math.max(-1, Math.min(i, steps.length - 1));
        Array.from(stepsWrap.children).forEach((node, j) => {
          node.classList.toggle("shown", j <= cur);
          node.classList.toggle("current", j === cur);
        });
        clearChips();
        if (cur >= 0) {
          setCircuit(stepSpec[cur]);              // redraw: swap to this step's circuit first
          setHl(steps[cur].hl);
          for (let j = 0; j <= cur; j++) addChip(j);
          const node = stepsWrap.children[cur];
          node.scrollIntoView({ behavior: "smooth", block: "nearest" });
          if (steps[cur].answer) celebrate(node);
        } else { setCircuit(ex.circuit || stepSpec[0]); clearHl(); }
        paintTable();
        paint();
      }
      function next() { if (cur < steps.length - 1) reveal(cur + 1); else stop(); }
      function prev() { if (cur > 0) reveal(cur - 1); else reveal(-1); }
      function resetAll() { stop(); reveal(-1); }

      function play() { if (cur >= steps.length - 1) reveal(-1); playing = true; paint(); schedule(); }
      function stop() { playing = false; if (timer) { clearTimeout(timer); timer = null; } paint(); }
      function schedule() {
        if (!playing) return;
        timer = setTimeout(() => {
          if (cur >= steps.length - 1) { stop(); return; }
          next(); schedule();
        }, 2600 / speed);
      }

      function celebrate(node) {
        node.classList.add("solved");
        const burst = el("div", { class: "confetti" });
        for (let k = 0; k < 14; k++) {
          const p = el("i");
          p.style.left = (10 + Math.random() * 80) + "%";
          p.style.setProperty("--dx", (Math.random() * 2 - 1).toFixed(2));
          p.style.animationDelay = (Math.random() * 0.25).toFixed(2) + "s";
          p.style.background = ["#36c7ff", "#ffcf5c", "#34d399", "#a78bfa", "#fb7185"][k % 5];
          burst.appendChild(p);
        }
        node.appendChild(burst);
        setTimeout(() => burst.remove(), 1500);
      }

      // ---- player controls ----
      const bar = el("i", { class: "wt-fill" });
      const progress = el("div", { class: "wt-progress" }, bar);
      const counter = el("span", { class: "muted", style: "white-space:nowrap" });
      const prevBtn = el("button", { class: "wt-ico", title: "Previous step", onclick: () => { stop(); prev(); } }, "◂");
      const playBtn = el("button", { class: "wt-ico play", title: "Play / pause", onclick: () => playing ? stop() : play() }, "▶");
      const nextBtn = el("button", { class: "wt-ico", title: "Next step", onclick: () => { stop(); next(); } }, "▸");
      const resetBtn = el("button", { class: "btn sm ghost", onclick: resetAll }, "↺ Reset");
      const allBtn = el("button", { class: "btn sm ghost", onclick: () => { stop(); reveal(steps.length - 1); } }, "Reveal all");
      const speedBtn = el("button", { class: "btn sm ghost", title: "Playback speed", onclick: () => { speed = speed === 1 ? 2 : 1; if (playing) { stop(); play(); } paint(); } }, "1×");

      function paint() {
        const pct = (cur + 1) / steps.length * 100;
        bar.style.width = pct + "%";
        counter.textContent = `${cur + 1} / ${steps.length}`;
        playBtn.textContent = playing ? "⏸" : "▶";
        playBtn.classList.toggle("on", playing);
        prevBtn.disabled = cur <= -1;
        nextBtn.disabled = cur >= steps.length - 1;
        speedBtn.textContent = speed + "×";
      }

      const controls = el("div", { class: "wt-player" },
        el("div", { class: "wt-tx" }, prevBtn, playBtn, nextBtn),
        progress, counter,
        el("div", { class: "wt-tx" }, speedBtn, allBtn, resetBtn));
      paint();
      paintTable();   // draw the empty skeleton before the first step runs
      if (tableHost && w.ResizeObserver) new ResizeObserver(publishTableHeight).observe(tableHost);

      const solveArea = el("div", { class: "solve-area" + (circuitNode ? " with-circuit" : "") });
      if (circuitNode) solveArea.appendChild(circuitNode);
      solveArea.appendChild(el("div", {}, controls, stepsWrap));

      return el("div", { class: "worked card pad", id: "w-" + (ex.id ?? i) },
        el("header", {},
          el("h3", { html: M(ex.title || ("Worked example " + (i + 1))) }),
          ex.highYield ? el("span", { class: "badge yield", text: "★ high-yield" }) : null,
          Flags.button(key, { moduleId, type: "worked", id: ex.id ?? i, label: ex.title, href: `#/lecture/${moduleId}/worked` })
        ),
        // statement + the question's DATA as a table (never a run of tuples)
        el("div", { class: "statement" }, el("div", { html: M(ex.statement) }), given(ex.given)),
        el("p", { class: "muted wt-hint", html: anyTable
          ? "▶ Press <b>Play</b> and watch the professor's table fill in, column by column — exactly the order you should write it on the exam."
          : "▶ Press <b>Play</b> to watch it solve step-by-step, or step through yourself." }),
        tableHost,
        solveArea
      );
    }
  }

  w.Walkthrough = { render };
})(window);
