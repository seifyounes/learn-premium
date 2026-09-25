/* ============================================================
   util.js — shared helpers (no dependencies)
   Reads window.SITE (data/site.js, loaded first) for the
   localStorage namespace and footer text.
   ============================================================ */
(function (w) {
  "use strict";

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  /* localStorage wrapper (namespaced, JSON, safe) */
  const NS = (w.SITE && w.SITE.ns) || "cc_v1_";
  const store = {
    get(key, fallback) {
      try { const r = localStorage.getItem(NS + key); return r == null ? fallback : JSON.parse(r); }
      catch (e) { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch (e) {} },
    del(key) { try { localStorage.removeItem(NS + key); } catch (e) {} },
    keys() { return Object.keys(localStorage).filter(k => k.startsWith(NS)).map(k => k.slice(NS.length)); }
  };

  /* ---- tiny math markup -> HTML ----
     X_ab   -> X<sub>ab</sub>     (use _{multi word} for spaces)
     X^2    -> X<sup>2</sup>
     ||  -> ‖ ; ->  -> arrow ; <= >= -> ≤ ≥ ; +- -> ±
     a / b  -> stacked fraction (see fractionize)
     Wrap a whole string: mathify("V_CE = V_CC - I_C*R_C") */

  // Protected-block sentinel: whole <svg>…</svg>, <pre>…</pre> and <code>…</code>
  // blocks pass through mathify UNTOUCHED. Injecting <sub>/<sup>/<span> inside SVG
  // makes the HTML parser break out of foreign content and dump the rest as flat
  // text (HTML5 "breakout" tags), and math markup inside code snippets corrupts
  // the code. Never regress this.
  const BLK_MK = String.fromCharCode(0xE010);
  const BLK_RE = /<svg[\s\S]*?<\/svg>|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/gi;
  function mathify(s) {
    if (s == null) return "";
    let t = String(s);
    if (t.indexOf("<svg") < 0 && t.indexOf("<pre") < 0 && t.indexOf("<code") < 0) return mathifyCore(t);
    const blocks = [];
    t = t.replace(BLK_RE, m => { blocks.push(m); return BLK_MK + (blocks.length - 1) + BLK_MK; });
    t = mathifyCore(t);
    return t.replace(new RegExp(BLK_MK + "(\\d+)" + BLK_MK, "g"), (m, i) => blocks[+i]);
  }
  /* Mask every HTML TAG (not its text) while the math substitutions run, so an
     attribute value can never be rewritten. Without this, a data-opts JSON
     carrying "θ_j" becomes "θ<sub>j</sub>" inside the attribute and the figure
     stops parsing. Same protective idea as BLK_RE above — never regress it. */
  const TAG_MK = String.fromCharCode(0xE011);
  function mathifyCore(t) {
    const tags = [];
    t = t.replace(/<[^>]+>/g, m => { tags.push(m); return TAG_MK + (tags.length - 1) + TAG_MK; });
    t = mathifyText(t);
    return t.replace(new RegExp(TAG_MK + "(\\d+)" + TAG_MK, "g"), (m, i) => tags[+i]);
  }
  function mathifyText(t) {
    // Explicit stacked fraction: {numerator}/{denominator} ALWAYS renders as a
    // horizontal-bar fraction (the Master Rules write every division this way,
    // per Seif: "dividend and divisor underneath each other, a long line").
    // Runs first so the braces are consumed before the _{…}/^{…} passes; the
    // lookbehind keeps _{1} and ^{2} out of it. One level only — no nesting.
    t = t.replace(/(?<![_^])\{([^{}]+)\}\s*\/\s*\{([^{}]+)\}/g,
      (m, n, d) => '<span class="frac ex"><span class="n">' + n + '</span><span class="d">' + d + '</span></span>');
    t = t.replace(/\|\|/g, "‖")
         .replace(/->/g, "→")
         .replace(/<=/g, "≤").replace(/>=/g, "≥")
         .replace(/\+-/g, "±")
         .replace(/\binfinity\b/g, "∞")
         .replace(/\bohm\b/g, "Ω").replace(/\bohms\b/g, "Ω")
         .replace(/\bdeg\b/g, "°");
    // superscripts ^{...} or ^x
    t = t.replace(/\^\{([^}]*)\}/g, (m, g) => `<sup>${g}</sup>`)
         .replace(/\^(-?\w)/g, (m, g) => `<sup>${g}</sup>`);
    // subscripts _{...} or _x
    t = t.replace(/_\{([^}]*)\}/g, (m, g) => `<sub>${g}</sub>`)
         .replace(/_(-?\w+)/g, (m, g) => `<sub>${g}</sub>`);
    // stacked fractions: a / b  ->  num-over-den (guarded so prose is untouched)
    t = fractionize(t);
    return t;
  }

  /* Turn "a / b" into a proper stacked fraction, but ONLY for math-looking operands.
     Leaves prose ("input/output", "AC/DC"), hrefs ("#/lecture/3") and dates alone.
     Method: temporarily hide every "/" that lives INSIDE an HTML tag (closing tags +
     attribute values) with a private-use marker, so the only "/" left to match are
     real division operators. */
  const PUA = String.fromCharCode(0xE000);
  const FR_CH = "A-Za-z0-9.%µΩπβαλμσγτδφθωΦΔΣ°√'′";
  // a number followed by a unit with an optional space ("25 mV", "3.19 mA").
  // Extend the unit list per subject if the fraction guard misses one.
  const FR_NUMU = "[0-9][0-9.,]*\\s*(?:[kKmMµunpGT]?(?:Hz|eV|V|A|W|F|H|s|Ω|Wb|T)|%|°)";
  const FR_UNIT = "(?:" + FR_NUMU + "|\\([^()]+\\)|(?:<sub>[^<]*<" + PUA + "sub>|<sup>[^<]*<" + PUA + "sup>|[" + FR_CH + "])+)";
  const FR_RE = new RegExp("(" + FR_UNIT + ")\\s*/\\s*(" + FR_UNIT + ")", "g");
  const FR_STRONG = /^\(|<su[bp]>|[0-9%µΩπβαλμσγτδφθωΦΔΣ°√'′]/;
  function fractionize(t) {
    if (t.indexOf("/") < 0) return t;
    // step 1: hide "/" inside any tag (</sub>, <a href="#/x">, <br/>, …)
    t = t.replace(/<[^>]*>/g, tag => tag.split("/").join(PUA));
    // step 2: every remaining "/" is a division operator → stack it (when it looks like math)
    t = t.replace(FR_RE, (m, a, b) => {
      if (!FR_STRONG.test(a) && !FR_STRONG.test(b)) return m;                 // both prose-ish → leave alone
      const plain = x => x.replace(/<[^>]+>/g, "");
      if (/^\d+$/.test(plain(a)) && /^\d+$/.test(plain(b))) return m;          // bare int/int (dates) → leave
      const strip = x => /^\([^()]*\)$/.test(x) ? x.slice(1, -1) : x;          // drop the now-redundant outer ()
      return '<span class="frac"><span class="n">' + strip(a) + '</span><span class="d">' + strip(b) + '</span></span>';
    });
    // step 3: restore the hidden slashes
    return t.split(PUA).join("/");
  }
  // fraction helper (explicit)
  function frac(n, d) { return '<span class="frac"><span class="n">' + mathify(n) + '</span><span class="d">' + mathify(d) + '</span></span>'; }

  /* round helper for display */
  function r(x, dp = 2) {
    if (!isFinite(x)) return String(x);
    const f = Math.pow(10, dp);
    return String(Math.round(x * f) / f);
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function debounce(fn, ms = 120) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }

  /* Fisher-Yates shuffle (returns a new array) */
  function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* query string */
  function qp(name, def = null) { return new URLSearchParams(location.search).get(name) ?? def; }

  function footer() {
    const html = (w.SITE && w.SITE.footer) || "Built with the Crash Course study-site template. Verify nothing is left unrevised. Good luck. ⚡";
    return el("footer", { class: "site" },
      el("div", { class: "wrap" }, el("div", { html })));
  }

  /* "Given" data table — draws a question's data the way the SOURCE drew it
     (a table), never as a run of tuples. spec = {cap, cols, rows, note} or an
     array of specs (rendered side by side). Static: nothing fills or circles —
     the professor's SOLVING table is walkthrough.js's job. Used by the
     walkthrough statement, the written-question prompt and exam prompts. */
  function given(spec) {
    if (!spec) return null;
    const list = Array.isArray(spec) ? spec : [spec];
    const wrap = el("div", { class: "given" });
    list.forEach(s => {
      if (!s || !Array.isArray(s.cols)) return;
      const box = el("div", { class: "given-box" });
      box.appendChild(el("div", { class: "given-cap", html: mathify(s.cap || "Given") }));
      const tbl = el("table", { class: "dtable given-table" });
      const htr = el("tr");
      s.cols.forEach(c => htr.appendChild(el("th", { html: mathify(String(c)) })));
      tbl.appendChild(el("thead", {}, htr));
      const tb = el("tbody");
      (s.rows || []).forEach(row => {
        const tr = el("tr");
        s.cols.forEach((_, ci) => tr.appendChild(el("td", { html: mathify(row[ci] == null ? "" : String(row[ci])) })));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      box.appendChild(el("div", { class: "dtable-scroll" }, tbl));
      if (s.note) box.appendChild(el("div", { class: "given-note", html: mathify(s.note) }));
      wrap.appendChild(box);
    });
    return wrap.childNodes.length ? wrap : null;
  }

  w.U = { $, $$, el, store, mathify, M: mathify, frac, given, r, clamp, debounce, shuffle, qp, footer };
})(window);
