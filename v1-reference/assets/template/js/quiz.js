/* ============================================================
   quiz.js — MCQ engine: instant grade, per-option why, flag, score
   Quiz.render(container, moduleId, questions, {onScore})
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, shuffle } = w.U;
  const Flags = w.Flags, Progress = w.Progress;

  function render(container, moduleId, questions, opts = {}) {
    container.innerHTML = "";
    if (!questions || !questions.length) { container.appendChild(el("p", { class: "muted", text: "No quiz questions yet for this lecture." })); return; }
    const state = { answered: 0, correct: 0, total: questions.length };

    const scoreBar = el("div", { class: "quiz-score", style: "display:none" });
    questions.forEach((q, i) => container.appendChild(card(q, i)));
    container.appendChild(scoreBar);

    function card(q, i) {
      const key = `${moduleId}:quiz:${q.id ?? i}`;
      const head = el("div", { class: "qhead" },
        el("span", { class: "qnum", text: "Q" + (i + 1) }),
        el("span", { class: "qtext", html: M(q.q) + (q.highYield ? ' <span class="badge yield">★ high-yield</span>' : "") }),
        Flags.button(key, { moduleId, type: "quiz", id: q.id ?? i, label: q.q, href: `#/lecture/${moduleId}/quiz` })
      );
      const optsWrap = el("div", {});
      const explain = el("div", { class: "explain" });
      let done = false;
      const opts = shuffle(q.options);
      opts.forEach((o, oi) => {
        const opt = el("div", { class: "opt" },
          el("span", { class: "mk", text: String.fromCharCode(65 + oi) }),
          el("div", {}, el("div", { html: M(o.t) }), el("div", { class: "why", html: M(o.why || "") }))
        );
        opt.addEventListener("click", () => {
          if (done) return; done = true;
          state.answered++;
          opts.forEach((oo, j) => {
            const node = optsWrap.children[j];
            node.classList.add("disabled", "reveal");
            if (oo.correct) node.classList.add("correct");
          });
          if (o.correct) { opt.classList.add("correct"); state.correct++; }
          else opt.classList.add("wrong");
          if (q.explain) { explain.innerHTML = M(q.explain); explain.classList.add("show"); }
          updateScore();
        });
        optsWrap.appendChild(opt);
      });
      return el("div", { class: "q", id: "q-" + (q.id ?? i) }, head, optsWrap, explain);
    }

    function updateScore() {
      scoreBar.style.display = "flex";
      scoreBar.innerHTML = "";
      const pct = Math.round(state.correct / state.total * 100);
      scoreBar.appendChild(el("span", { class: "big", text: `${state.correct}/${state.total}` }));
      scoreBar.appendChild(el("div", { class: "bar" + (pct >= 60 ? " good" : ""), style: "flex:1", html: `<i style="width:${state.answered / state.total * 100}%"></i>` }));
      scoreBar.appendChild(el("span", { class: "muted", text: state.answered < state.total ? `${state.answered}/${state.total} answered` : `Done · ${pct}%` }));
      if (state.answered === state.total) {
        Progress.saveQuiz(moduleId, state.correct, state.total);
        Progress.markSeen(moduleId, "quiz");
        if (opts.onScore) opts.onScore(state.correct, state.total);
        w.dispatchEvent(new CustomEvent("progress:changed"));
      }
    }
  }

  w.Quiz = { render };
})(window);
