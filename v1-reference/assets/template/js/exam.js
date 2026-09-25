/* ============================================================
   exam.js — timed mock exam: countdown, sections, auto-grade MCQ,
   reveal model solutions, score report with links to weak topics.
   Reads window.EXAM_BANK (or a bank passed in). Mount: Exam.init(rootEl[, bank[, bankKey]])
   bankKey names the result slot in Progress (per-variant scores).
   Bank shape: { title?, blurb?, durationMin, sections:[{title, type:"mcq"|"written", questions:[…]}] }
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, store, qp, given } = w.U;
  const Flags = w.Flags, Progress = w.Progress, Graphs = w.Graphs;

  let bank, bankKey = null, root, answers = {}, started = 0, endTs = 0, tick = 0, submitted = false;

  function init(rootEl, bankOverride, key) {
    root = rootEl; bank = bankOverride || w.EXAM_BANK;
    bankKey = key || (bankOverride ? null : "EXAM_BANK");
    if (!bank) { root.appendChild(el("p", { class: "muted", text: "Exam bank not loaded." })); return; }
    intro();
  }

  function intro() {
    root.innerHTML = "";
    const total = bank.sections.reduce((a, s) => a + s.questions.length, 0);
    const marks = bank.sections.reduce((a, s) => a + s.questions.reduce((b, q) => b + (q.marks || (s.type === "mcq" ? 2 : 10)), 0), 0);
    root.appendChild(el("div", { class: "card pad narrow" },
      el("div", { class: "eyebrow", text: "Mock exam · exam mode" }),
      el("h1", { text: bank.title || "Timed Mock Exam" }),
      el("p", { class: "muted", html: (bank.blurb ? M(bank.blurb) + " " : "") + `<b>${total} questions · ~${marks} marks · ${bank.durationMin} minutes.</b>` }),
      el("ul", { class: "prose" },
        // describe the sections this bank ACTUALLY ships (a written-only paper has no MCQ section)
        bank.sections.map(s => el("li", { html: `<b>${M(s.title)}</b>` + (s.type === "mcq"
          ? " — multiple choice, auto-graded."
          : " — written. Solve on paper, then reveal the model solution + marking notes.") })),
        el("li", { text: "The clock auto-submits at 0:00. You can submit early. Flag tricky questions to revisit." }),
        el("li", { html: "★ high-yield = appeared in the course material; highest probability of appearing as-is." })
      ),
      el("div", { class: "btn-row", style: "margin-top:16px" },
        el("button", { class: "btn primary", onclick: start }, "▶ Start the mock exam"),
        el("a", { class: "btn ghost", href: "#/" }, "Back to dashboard"))
    ));
    const prev = Progress.examResult(bankKey);
    if (prev) root.appendChild(el("p", { class: "muted center", style: "margin-top:14px", html: prev.mcqTotal
      ? `Last attempt: <b>${prev.mcqCorrect}/${prev.mcqTotal}</b> MCQ correct · ${new Date(prev.at).toLocaleString()}`
      : `Last attempt: ${new Date(prev.at).toLocaleString()}` }));
  }

  function start() {
    submitted = false; answers = {}; started = Date.now(); endTs = started + bank.durationMin * 60000;
    render();
    tick = setInterval(updateClock, 1000); updateClock();
    w.scrollTo(0, 0);
  }

  function render() {
    root.innerHTML = "";
    const clock = el("span", { class: "exam-clock", id: "exClock" });
    const bar = el("div", { class: "exam-bar" }, el("div", { class: "wrap", style: "display:flex;align-items:center;gap:16px;width:100%" },
      el("b", { text: "⏱ Mock Exam" }), clock,
      el("span", { class: "muted", id: "exProg" }),
      el("button", { class: "btn primary sm", style: "margin-left:auto", onclick: () => submit(false) }, "Submit exam")
    ));
    root.appendChild(bar);

    bank.sections.forEach((sec, si) => {
      root.appendChild(el("h2", { class: "exam-section-h", html: M(sec.title) }));
      sec.questions.forEach((q, qi) => {
        if (sec.type === "mcq" && q.options) q.options = U.shuffle(q.options);
        root.appendChild(sec.type === "mcq" ? mcq(q, si, qi) : written(q, si, qi));
      });
    });
    root.appendChild(el("div", { class: "center", style: "margin:30px 0" },
      el("button", { class: "btn primary", onclick: () => submit(false) }, "Submit exam ▸")));
    updateProg();
  }

  function qkey(si, qi) { return si + "_" + qi; }

  function mcq(q, si, qi) {
    const id = qkey(si, qi);
    const fkey = `exam:mcq:${q.id ?? id}`;
    const optsWrap = el("div", {});
    q.options.forEach((o, oi) => {
      const opt = el("div", { class: "opt" },
        el("span", { class: "mk", text: String.fromCharCode(65 + oi) }),
        el("div", {}, el("div", { html: M(o.t) }), el("div", { class: "why", html: M(o.why || "") })));
      opt.addEventListener("click", () => {
        if (submitted) return;
        answers[id] = oi;
        Array.from(optsWrap.children).forEach(c => c.classList.remove("selected"));
        opt.classList.add("selected"); updateProg();
      });
      optsWrap.appendChild(opt);
    });
    return el("div", { class: "q", id: "ex-" + id, dataset: { si, qi, type: "mcq" } },
      el("div", { class: "qhead" },
        el("span", { class: "qnum", text: "A" + (qi + 1) }),
        el("span", { class: "qtext", html: M(q.q) + tag(q) }),
        Flags.button(fkey, { moduleId: q.module, type: "exam-mcq", id: q.id ?? id, label: q.q, href: "#/exam" })),
      optsWrap,
      el("div", { class: "explain" }));
  }

  function written(q, si, qi) {
    const id = qkey(si, qi);
    const fkey = `exam:written:${q.id ?? id}`;
    const Figures = w.Figures || w.Circuits || {};
    let circuit = q.circuit ? (typeof q.circuit === "string" ? q.circuit : (Figures[q.circuit.fn] ? Figures[q.circuit.fn](q.circuit.opts || {}) : "")) : "";
    let graphsNode = null;
    if (q.graphs && q.graphs.length && Graphs) {
      graphsNode = el("div", { class: "fq-graphs" });
      q.graphs.forEach(g => { if (Graphs[g.fn]) graphsNode.appendChild(Graphs[g.fn](g.opts || {})); });
    }
    const ta = el("textarea", { placeholder: "Work it on paper; jot key results here…" });
    ta.addEventListener("input", () => { answers[id] = ta.value ? 1 : undefined; updateProg(); });
    return el("div", { class: "q", id: "ex-" + id, dataset: { si, qi, type: "written" } },
      el("div", { class: "qhead" },
        el("span", { class: "qnum", text: "B" + (qi + 1) }),
        el("span", { class: "qtext", html: M(q.prompt) + ` <span class="muted">(${q.marks || 10} marks)</span>` + tag(q) }),
        Flags.button(fkey, { moduleId: q.module, type: "exam-written", id: q.id ?? id, label: q.prompt, href: "#/exam" })),
      given(q.given),   // the question's data as a table (q.given — same contract as walkthrough)
      circuit ? el("div", { class: "svg-box", style: "max-width:440px;margin:10px 0", html: circuit }) : null,
      graphsNode,
      ta,
      el("div", { class: "model" },
        el("div", { class: "callout" }, el("span", { class: "lbl", text: "Model solution" }), el("div", { html: M(q.model) })),
        q.mark ? el("div", { class: "mark", html: "✓ Marking: " + M(q.mark) }) : null));
  }

  function tag(q) { return q.highYield ? ' <span class="badge yield">★</span>' : ""; }

  function updateClock() {
    const left = Math.max(0, endTs - Date.now());
    const el2 = document.getElementById("exClock"); if (!el2) return;
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el2.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    el2.classList.toggle("warn", left < 15 * 60000 && left >= 5 * 60000);
    el2.classList.toggle("danger", left < 5 * 60000);
    if (left <= 0) submit(true);
  }
  function updateProg() {
    const p = document.getElementById("exProg"); if (!p) return;
    const total = bank.sections.reduce((a, s) => a + s.questions.length, 0);
    const done = Object.values(answers).filter(v => v !== undefined).length;
    p.textContent = `${done}/${total} attempted`;
  }

  function submit(auto) {
    if (submitted) return;
    if (!auto && !confirm("Submit the exam and reveal all solutions?")) return;
    submitted = true; clearInterval(tick);
    let mcqCorrect = 0, mcqTotal = 0;
    const perModule = {};
    bank.sections.forEach((sec, si) => sec.questions.forEach((q, qi) => {
      const id = qkey(si, qi), node = document.getElementById("ex-" + id);
      if (!node) return;
      node.querySelectorAll(".model").forEach(m => m.classList.add("show"));
      if (sec.type === "mcq") {
        mcqTotal++;
        const chosen = answers[id];
        const opts = node.querySelectorAll(".opt");
        opts.forEach((o, oi) => {
          o.classList.add("disabled", "reveal");
          if (q.options[oi].correct) o.classList.add("correct");
          if (oi === chosen && !q.options[oi].correct) o.classList.add("wrong");
        });
        const ok = chosen != null && q.options[chosen].correct;
        if (ok) mcqCorrect++;
        const ex = node.querySelector(".explain"); if (q.explain) { ex.innerHTML = M(q.explain); ex.classList.add("show"); }
        const mod = q.module || "?"; perModule[mod] = perModule[mod] || { c: 0, t: 0 }; perModule[mod].t++; if (ok) perModule[mod].c++;
      }
    }));
    const result = { mcqCorrect, mcqTotal, at: Date.now(), perModule };
    Progress.saveExam(result, bankKey);
    w.dispatchEvent(new CustomEvent("progress:changed"));
    report(result);
  }

  function report(res) {
    const card = el("div", { class: "card pad", style: "margin:18px 0" });
    const pct = res.mcqTotal ? Math.round(res.mcqCorrect / res.mcqTotal * 100) : 0;
    card.appendChild(el("div", { class: "eyebrow", text: "Result" }));
    // a written-only paper has nothing auto-gradable — don't report a hollow 0/0
    card.appendChild(res.mcqTotal
      ? el("h2", { html: `MCQ score: ${res.mcqCorrect}/${res.mcqTotal} <span class="muted">(${pct}%)</span>` })
      : el("h2", { text: "Paper submitted — now mark yourself" }));
    card.appendChild(el("p", { class: "muted", text: res.mcqTotal
      ? "Written questions are graded on paper against the revealed model solutions and marking notes below."
      : "Every question here is written. Go through the model solutions below and award yourself the marks honestly — check that each answer's TABLE is drawn, not just the final number." }));
    // module names come from the loaded modules — no hardcoded course map
    const name = id => { const m = (w.MODULES || {})[id]; return m ? (m.short || m.title) : id; };
    const weak = Object.entries(res.perModule).filter(([, v]) => v.c / v.t < 0.6);
    if (weak.length) {
      card.appendChild(el("h4", { text: "Revise these (scored < 60%):" }));
      card.appendChild(el("div", { class: "btn-row" }, ...weak.map(([m, v]) =>
        el("a", { class: "btn sm", href: `#/lecture/${m}` }, `${name(m)} — ${v.c}/${v.t}`))));
    } else if (res.mcqTotal) {
      card.appendChild(el("p", { html: "<b style='color:var(--good)'>Strong MCQ performance across modules. ✅</b>" }));
    }
    card.appendChild(el("div", { class: "btn-row", style: "margin-top:14px" },
      el("button", { class: "btn ghost", onclick: intro }, "↺ New attempt"),
      el("a", { class: "btn", href: "#/" }, "Dashboard")));
    root.insertBefore(card, root.children[1] || null);
    w.scrollTo(0, 0);
  }

  w.Exam = { init };
})(window);
