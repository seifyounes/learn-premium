/* ============================================================
   written.js — doctor-style open questions: type, then reveal model
   Written.render(container, moduleId, items[])
   item:{ id, prompt, given?, model, mark, inferred, highYield }
   given = {cap,cols,rows,note} | [given…] — the question's data drawn as a table (U.given)
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, store, given } = w.U;
  const Flags = w.Flags, Progress = w.Progress;

  function render(container, moduleId, items) {
    container.innerHTML = "";
    if (!items || !items.length) { container.appendChild(el("p", { class: "muted", text: "No written questions yet for this lecture." })); return; }
    Progress.markSeen(moduleId, "written");

    items.forEach((it, i) => {
      const key = `${moduleId}:written:${it.id ?? i}`;
      const skey = "wq_" + moduleId + "_" + (it.id ?? i);
      const ta = el("textarea", { placeholder: "Write your answer first, then reveal the model answer…" });
      ta.value = store.get(skey, "");
      ta.addEventListener("input", () => store.set(skey, ta.value));
      const model = el("div", { class: "model" },
        el("div", { class: "callout" }, el("span", { class: "lbl", text: "Model answer" }), el("div", { html: M(it.model) })),
        it.mark ? el("div", { class: "mark", html: "✓ What earns the mark: " + M(it.mark) }) : null
      );
      const revealBtn = el("button", { class: "btn sm primary" }, "Reveal model answer");
      revealBtn.addEventListener("click", () => { model.classList.toggle("show"); revealBtn.textContent = model.classList.contains("show") ? "Hide model answer" : "Reveal model answer"; });

      container.appendChild(el("div", { class: "wq", id: "wq-" + (it.id ?? i) },
        el("div", { style: "display:flex;gap:10px;align-items:flex-start" },
          el("div", { class: "prompt", style: "flex:1" },
            el("div", { html: "<b>Q" + (i + 1) + ".</b> " + M(it.prompt)
              + (it.highYield ? ' <span class="badge yield">★ high-yield</span>' : "")
              + (it.inferred ? ' <span class="inferred">(inferred style)</span>' : "") }),
            given(it.given)),
          Flags.button(key, { moduleId, type: "written", id: it.id ?? i, label: it.prompt, href: `#/lecture/${moduleId}/written` })
        ),
        ta,
        el("div", { class: "btn-row", style: "margin-top:10px" }, revealBtn),
        model
      ));
    });
  }

  w.Written = { render };
})(window);
