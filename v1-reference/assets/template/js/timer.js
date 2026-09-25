/* ============================================================
   timer.js — per-lecture study timer (anti-procrastination)
   Accumulates study seconds per module in localStorage.
   Optional target: shows a small goal ring.
   ============================================================ */
(function (w) {
  "use strict";
  const { store, el } = w.U;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = n => String(n).padStart(2, "0");
    return (h > 0 ? h + ":" : "") + pad(m) + ":" + pad(s);
  }

  function totalFor(moduleId) { return (store.get("studytime", {})[moduleId]) || 0; }
  function add(moduleId, sec) {
    const all = store.get("studytime", {});
    all[moduleId] = (all[moduleId] || 0) + sec; store.set("studytime", all);
  }

  /* mount a timer widget into `mountEl` for module `moduleId` */
  function mount(mountEl, moduleId, opts = {}) {
    const target = opts.targetMin ? opts.targetMin * 60 : 0;
    let base = totalFor(moduleId);   // seconds before this session
    let running = false, startTs = 0, raf = 0;

    const tEl = el("span", { class: "t", text: fmt(base) });
    const playBtn = el("button", { type: "button", title: "Start / pause", text: "▶" });
    const resetBtn = el("button", { type: "button", title: "Reset this lecture's timer", text: "↺" });
    const label = el("span", { class: "lbl", text: "study time" });
    const wrap = el("div", { class: "timer" }, label, tEl, playBtn, resetBtn);

    function cur() { return base + (running ? (Date.now() - startTs) / 1000 : 0); }
    function paint() {
      const c = cur();
      tEl.textContent = fmt(c);
      if (target) label.textContent = "study " + Math.min(100, Math.round(c / target * 100)) + "% of goal";
      if (running) raf = requestAnimationFrame(paint);
    }
    function start() {
      running = true; startTs = Date.now(); playBtn.textContent = "⏸"; tEl.classList.add("run");
      paint();
    }
    function pause() {
      if (!running) return;
      running = false; cancelAnimationFrame(raf); playBtn.textContent = "▶"; tEl.classList.remove("run");
      const elapsed = (Date.now() - startTs) / 1000; add(moduleId, elapsed); base += elapsed;
      tEl.textContent = fmt(base);
    }
    playBtn.addEventListener("click", () => running ? pause() : start());
    resetBtn.addEventListener("click", () => {
      if (!confirm("Reset the study timer for this lecture?")) return;
      pause();
      const all = store.get("studytime", {}); all[moduleId] = 0; store.set("studytime", all);
      base = 0; tEl.textContent = fmt(0);
    });

    // persist periodically + on hide/unload so time isn't lost
    setInterval(() => { if (running) { const e = (Date.now() - startTs) / 1000; add(moduleId, e); base += e; startTs = Date.now(); } }, 15000);
    w.addEventListener("beforeunload", pause);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

    mountEl.appendChild(wrap);
    return { start, pause };
  }

  w.StudyTimer = { mount, totalFor, fmt };
})(window);
