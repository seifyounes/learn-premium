/* ============================================================
   flags.js — flag any question, review later
   key = "moduleId:type:id"   meta = {moduleId,type,id,label,href}
   ============================================================ */
(function (w) {
  "use strict";
  const { store, el } = w.U;

  const F = {
    all() { return store.get("flags", {}); },
    is(key) { return !!F.all()[key]; },
    toggle(key, meta) {
      const all = F.all();
      if (all[key]) delete all[key];
      else all[key] = Object.assign({ at: Date.now() }, meta || {});
      store.set("flags", all);
      return !!all[key];
    },
    list() { return Object.entries(F.all()).map(([key, v]) => Object.assign({ key }, v)).sort((a, b) => b.at - a.at); },
    count() { return Object.keys(F.all()).length; },
    clear() { store.set("flags", {}); },

    /* build a flag button element bound to a key */
    button(key, meta) {
      const on = F.is(key);
      const b = el("button", { class: "flagbtn" + (on ? " on" : ""), type: "button", title: "Flag for later review" },
        el("span", { text: on ? "★" : "☆" }), el("span", { text: "Flag" }));
      b.addEventListener("click", () => {
        const nowOn = F.toggle(key, meta);
        b.classList.toggle("on", nowOn);
        b.firstChild.textContent = nowOn ? "★" : "☆";
        w.dispatchEvent(new CustomEvent("flags:changed"));
      });
      return b;
    }
  };

  w.Flags = F;
})(window);
