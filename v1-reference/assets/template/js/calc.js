/* ============================================================
   calc.js — interactive formula calculators (plug values → live result)
   Each builder returns a DOM node. Verify every formula against
   docs/source-of-truth.md before shipping a calculator.
   Embed in summaries with <div data-calc="sample"></div>.
   Add subject calculators with the widget() factory below.
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, r } = w.U;
  const par = (a, b) => (a + b ? (a * b) / (a + b) : 0);   // parallel / product-over-sum

  /* generic widget:
     fields: [{k,label,val,min,max,step,unit, type:"number"|"select", options:[{v,t}]}]
     compute(vals) -> [{label, val, unit, hot}] */
  function widget(title, note, fields, compute) {
    const box = el("div", { class: "calc" });
    box.appendChild(el("div", { class: "calc-h" }, el("span", { text: "🧮 " }), el("b", { html: M(title) })));
    if (note) box.appendChild(el("div", { class: "calc-note muted", html: M(note) }));
    const inputs = {};
    const grid = el("div", { class: "calc-grid" });
    fields.forEach(f => {
      let input;
      if (f.type === "select") {
        input = el("select", {}, ...f.options.map(o => el("option", { value: o.v }, o.t)));
        input.value = f.val;
      } else {
        input = el("input", { type: "number", value: f.val, step: f.step ?? "any" });
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
      }
      input.addEventListener("input", recompute);
      input.addEventListener("change", recompute);
      inputs[f.k] = input;
      grid.appendChild(el("label", { class: "calc-field" },
        el("span", { html: M(f.label) + (f.unit ? ` <i class="cu">${f.unit}</i>` : "") }), input));
    });
    box.appendChild(grid);
    const out = el("div", { class: "calc-out" });
    box.appendChild(out);
    function recompute() {
      const vals = {};
      fields.forEach(f => { vals[f.k] = f.type === "select" ? inputs[f.k].value : parseFloat(inputs[f.k].value); });
      let rows = [];
      try { rows = compute(vals) || []; } catch (e) { rows = [{ label: "Error", val: "check inputs" }]; }
      out.innerHTML = "";
      rows.forEach(row => out.appendChild(el("div", { class: "calc-res" + (row.hot ? " hot" : "") },
        el("span", { class: "rl", html: M(row.label) }),
        el("span", { class: "rv", html: M(String(row.val)) + (row.unit ? ` <i class="cu">${row.unit}</i>` : "") }))));
    }
    recompute();
    return box;
  }

  const C = {};

  /* sample calculator — replace with subject calculators; exercises the widget path */
  C.sample = () => widget("Weighted score",
    "score = w₁·a + w₂·b — a stand-in showing how calculators work. Replace with the subject's formulas.",
    [{ k: "a", label: "a", val: 70 }, { k: "b", label: "b", val: 90 },
     { k: "w1", label: "w_1", val: 0.6, step: 0.1 }, { k: "w2", label: "w_2", val: 0.4, step: 0.1 }],
    v => [{ label: "Weighted score", val: r(v.w1 * v.a + v.w2 * v.b, 2), hot: true },
          { label: "Plain average", val: r((v.a + v.b) / 2, 2) }]);

  C._ = { widget, par };   // factory for subject calculators
  w.Calc = C;
})(window);
