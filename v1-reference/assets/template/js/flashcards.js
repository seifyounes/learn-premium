/* ============================================================
   flashcards.js — flip deck + simple spaced repetition (Leitner)
   Flashcards.render(container, moduleId, cards[])  card:{front,back}
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, store } = w.U;
  const Progress = w.Progress;

  function render(container, moduleId, cards) {
    container.innerHTML = "";
    if (!cards || !cards.length) { container.appendChild(el("p", { class: "muted", text: "No flashcards yet for this lecture." })); return; }

    // restore per-card box levels (1..3); higher = known
    const skey = "fcbox_" + moduleId;
    let boxes = store.get(skey, {});
    // ordering: lowest box first (need more practice)
    let order = cards.map((_, i) => i).sort((a, b) => (boxes[a] || 0) - (boxes[b] || 0));
    let pos = 0, flipped = false;

    const cardEl = el("div", { class: "flashcard" },
      el("div", { class: "inner" },
        el("div", { class: "face front" }, el("div", { class: "q" })),
        el("div", { class: "face back" }, el("div", { class: "a" }))
      ));
    const meta = el("div", { class: "fc-meta" });
    const front = cardEl.querySelector(".front .q");
    const back = cardEl.querySelector(".back .a");

    cardEl.addEventListener("click", () => { flipped = !flipped; cardEl.classList.toggle("flipped", flipped); });

    function known() { return order.filter(i => (boxes[i] || 0) >= 2).length; }
    function paint() {
      const idx = order[pos];
      flipped = false; cardEl.classList.remove("flipped");
      front.innerHTML = M(cards[idx].front);
      back.innerHTML = M(cards[idx].back);
      meta.innerHTML = `Card ${pos + 1} / ${order.length} &nbsp;·&nbsp; known: ${known()}/${cards.length} &nbsp;·&nbsp; <span class="muted">tap card to flip</span>`;
    }
    function grade(good) {
      const idx = order[pos];
      boxes[idx] = good ? Math.min(3, (boxes[idx] || 0) + 1) : 0;
      store.set(skey, boxes);
      Progress.saveCards(moduleId, known(), cards.length);
      Progress.markSeen(moduleId, "flashcards");
      w.dispatchEvent(new CustomEvent("progress:changed"));
      next();
    }
    function next() { pos = (pos + 1) % order.length; paint(); }
    function prev() { pos = (pos - 1 + order.length) % order.length; paint(); }
    function shuffle() { order = order.sort(() => Math.random() - 0.5); pos = 0; paint(); }

    const controls = el("div", { class: "btn-row center", style: "justify-content:center;margin-top:14px" },
      el("button", { class: "btn ghost sm", onclick: prev }, "◂ Prev"),
      el("button", { class: "btn sm", style: "border-color:rgba(251,113,133,.5)", onclick: () => grade(false) }, "↺ Again"),
      el("button", { class: "btn sm", style: "border-color:rgba(52,211,153,.5)", onclick: () => grade(true) }, "✓ Got it"),
      el("button", { class: "btn ghost sm", onclick: next }, "Next ▸"),
      el("button", { class: "btn ghost sm", onclick: shuffle }, "⤮ Shuffle")
    );

    container.appendChild(el("div", { class: "fc-stage" }, cardEl));
    container.appendChild(el("div", { class: "center" }, meta));
    container.appendChild(controls);
    paint();
  }

  w.Flashcards = { render };
})(window);
