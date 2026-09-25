/* ============================================================
   progress.js — per-module completion, quiz scores, mastery
   ============================================================ */
(function (w) {
  "use strict";
  const { store } = w.U;

  const P = {
    /* quiz scores: { [moduleId]: { best:{correct,total}, last:{correct,total} } } */
    quiz(moduleId) { return (store.get("quiz", {})[moduleId]) || null; },
    saveQuiz(moduleId, correct, total) {
      const all = store.get("quiz", {});
      const cur = all[moduleId] || {};
      cur.last = { correct, total, at: Date.now() };
      if (!cur.best || correct / total > cur.best.correct / cur.best.total) cur.best = { correct, total };
      all[moduleId] = cur; store.set("quiz", all);
    },

    /* mark sections viewed: { [moduleId]: { summary:true, worked:true, ... } } */
    seen(moduleId) { return (store.get("seen", {})[moduleId]) || {}; },
    markSeen(moduleId, section) {
      const all = store.get("seen", {});
      all[moduleId] = all[moduleId] || {};
      all[moduleId][section] = true; store.set("seen", all);
    },

    /* flashcards known: { [moduleId]: { known:n, total:n } } */
    saveCards(moduleId, known, total) {
      const all = store.get("cards", {});
      all[moduleId] = { known, total, at: Date.now() }; store.set("cards", all);
    },
    cards(moduleId) { return (store.get("cards", {})[moduleId]) || null; },

    /* mastery % for a module: blend of sections seen, quiz best, cards known.
       Modules that ship no quiz (written-only courses) redistribute the quiz
       weight: 70% sections seen + 30% cards known. */
    mastery(moduleId, def) {
      const seen = P.seen(moduleId);
      const sectionCount = (def && def.sectionKeys ? def.sectionKeys.length : 6);
      const seenN = Object.keys(seen).filter(k => seen[k]).length;
      const seenScore = Math.min(1, seenN / sectionCount);          // 40% (70% when no quiz)
      const q = P.quiz(moduleId);
      const quizScore = q && q.best ? q.best.correct / q.best.total : 0; // 45%
      const c = P.cards(moduleId);
      const cardScore = c && c.total ? c.known / c.total : 0;        // 15% (30% when no quiz)
      const hasQuiz = !!(def && def.quiz && def.quiz.length);
      if (!hasQuiz) return Math.round(seenScore * 70 + cardScore * 30);
      return Math.round((seenScore * 40 + quizScore * 45 + cardScore * 15));
    },

    /* exam results are stored PER BANK KEY (EXAM_BANK, MOCK_FINAL, …) so a
       second variant never clobbers the first. Earned on a build that added a
       mock final beside its midterm mock: one shared slot silently overwrote
       the earlier result. */
    examResult(key) {
      const all = store.get("examResults", {});
      return all[key || "EXAM_BANK"] || null;
    },
    saveExam(r, key) {
      const all = store.get("examResults", {});
      all[key || "EXAM_BANK"] = r; store.set("examResults", all);
    },

    overall(modules) {
      if (!modules || !modules.length) return 0;
      const sum = modules.reduce((a, m) => a + P.mastery(m.id, m), 0);
      return Math.round(sum / modules.length);
    },

    reset() {
      ["quiz", "seen", "cards", "examResult", "examResults"].forEach(store.del);
    }
  };

  w.Progress = P;
})(window);
