/* ============================================================
   interactive.js
   - RulesUI.mount: searchable, active-recall rule cards
     (hide/reveal formulas "test mode", mark-as-mastered, filters)
   - Summary.enhance: collapsible sections + clickable TOC +
     scroll-spy + reading-progress for a lecture summary
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M, store } = w.U;

  /* ---------------- Interactive Rules ---------------- */
  const RulesUI = {
    /* groups: [{title, icon, intro, rules:[{name,formula,when|note}],
                  figures?: [{fn, opts?}],                 — Figures builders, drawn first
                  table?: {head:[...], rows:[[...]], note?} — a comparison table (cells mathified),
                                                             blurred like a formula in Test mode }]
       opts: { storageKey, lead }
       A topic with 2–3 parallel variants (converters, bridges, controller modes)
       ships a comparison table whose rows are the quantities that DIFFER, the
       shared rules once underneath, and the circuits drawn above — organised the
       way the answer is written, not as an inventory. */
    mount(container, groups, opts = {}) {
      container.innerHTML = "";
      const sKey = opts.storageKey || "rules_generic";
      let mastered = new Set(store.get(sKey, []));
      const save = () => store.set(sKey, Array.from(mastered));

      // ---- control bar ----
      const search = el("input", { class: "ri-search", type: "search", placeholder: "🔍 Filter rules…" });
      const testBtn = el("button", { class: "btn sm ghost", type: "button" }, "🙈 Test mode");
      const revealBtn = el("button", { class: "btn sm ghost", type: "button", style: "display:none" }, "👁 Reveal all");
      const unmBtn = el("button", { class: "btn sm ghost", type: "button" }, "★ Unmastered only");
      const counter = el("span", { class: "ri-count muted" });
      const bar = el("div", { class: "ri-bar" }, search, testBtn, revealBtn, unmBtn, counter);
      container.appendChild(bar);
      if (opts.lead) container.appendChild(el("div", { class: "callout intuition" },
        el("span", { class: "lbl", text: "Rules summary — active recall" }), el("div", { html: M(opts.lead) })));

      const grid = el("div", {});
      container.appendChild(grid);

      let total = 0;
      const cards = [];
      groups.forEach((g, gi) => {
        if (g.title) grid.appendChild(el("h3", { class: "ri-group", html: (g.icon ? g.icon + " " : "") + M(g.title) }));
        if (g.intro) grid.appendChild(el("p", { class: "muted", html: M(g.intro) }));
        if (Array.isArray(g.figures) && g.figures.length && w.Figures) {
          const figs = el("div", { class: "ri-figs" });
          g.figures.forEach(f => {
            if (!w.Figures[f.fn]) return;
            figs.appendChild(el("div", { class: "svg-box", html: w.Figures[f.fn](f.opts || {}) }));
          });
          if (figs.childNodes.length) grid.appendChild(figs);
        }
        if (g.table && Array.isArray(g.table.rows)) {
          const th = (g.table.head || []).map(h => `<th>${M(h)}</th>`).join("");
          const tr = g.table.rows.map(r => "<tr>" + r.map((c, ci) => ci ? `<td class="f">${M(c)}</td>` : `<th scope="row">${M(c)}</th>`).join("") + "</tr>").join("");
          const tbl = el("div", { class: "tbl-scroll ri-table", html: `<table class="rules-table">${th ? `<thead><tr>${th}</tr></thead>` : ""}<tbody>${tr}</tbody></table>` });
          tbl.addEventListener("click", () => { if (container.classList.contains("tm")) tbl.classList.toggle("revealed"); });
          grid.appendChild(tbl);
          if (g.table.note) grid.appendChild(el("p", { class: "muted", html: M(g.table.note) }));
        }
        const wrap = el("div", { class: "rule-grid" });
        (g.rules || []).forEach((r, ri) => {
          total++;
          const id = gi + "|" + (r.name || ri);
          const note = r.note || r.when || "";
          const star = el("button", { class: "rstar" + (mastered.has(id) ? " on" : ""), type: "button", title: "Mark as mastered", text: mastered.has(id) ? "★" : "☆" });
          const formula = el("div", { class: "rf", html: M(r.formula) });
          const card = el("div", { class: "rule-card" + (mastered.has(id) ? " mastered" : ""), dataset: { text: ((r.name || "") + " " + (r.formula || "") + " " + note).toLowerCase(), id } },
            el("div", { class: "rule-top" }, el("b", { class: "rn", html: M(r.name) }), star),
            formula,
            note ? el("div", { class: "rnote", html: M(note) }) : null
          );
          // test-mode: click the formula to reveal it
          formula.addEventListener("click", () => { if (container.classList.contains("tm")) card.classList.toggle("revealed"); });
          star.addEventListener("click", (e) => {
            e.stopPropagation();
            if (mastered.has(id)) { mastered.delete(id); star.textContent = "☆"; star.classList.remove("on"); card.classList.remove("mastered"); }
            else { mastered.add(id); star.textContent = "★"; star.classList.add("on"); card.classList.add("mastered"); }
            save(); refresh();
          });
          cards.push({ card, id });
          wrap.appendChild(card);
        });
        grid.appendChild(wrap);
      });

      let testMode = false, unmOnly = false;
      function refresh() {
        const q = search.value.trim().toLowerCase();
        cards.forEach(({ card, id }) => {
          const matchQ = !q || card.dataset.text.includes(q);
          const matchU = !unmOnly || !mastered.has(id);
          card.style.display = (matchQ && matchU) ? "" : "none";
        });
        counter.innerHTML = `✓ <b>${mastered.size}</b>/${total} mastered`;
      }
      search.addEventListener("input", refresh);
      testBtn.addEventListener("click", () => {
        testMode = !testMode;
        container.classList.toggle("tm", testMode);
        testBtn.classList.toggle("primary", testMode);
        testBtn.textContent = testMode ? "👁 Show formulas" : "🙈 Test mode";
        revealBtn.style.display = testMode ? "" : "none";
        if (!testMode) cards.forEach(c => c.card.classList.remove("revealed"));
      });
      revealBtn.addEventListener("click", () => cards.forEach(c => c.card.classList.add("revealed")));
      unmBtn.addEventListener("click", () => { unmOnly = !unmOnly; unmBtn.classList.toggle("primary", unmOnly); refresh(); });
      refresh();
    }
  };

  /* ---------------- Interactive Summary ---------------- */
  const Summary = {
    enhance(view, moduleId, onRead) {
      const prose = view.querySelector(".prose");
      if (!prose) return;
      // split children into preamble + H3-delimited sections
      const kids = Array.from(prose.childNodes);
      const preamble = [], sections = []; let cur = null;
      kids.forEach(node => {
        if (node.nodeType === 1 && node.tagName === "H3") { cur = { head: node, body: [] }; sections.push(cur); }
        else if (cur) cur.body.push(node); else preamble.push(node);
      });
      if (!sections.length) return;

      prose.innerHTML = "";
      preamble.forEach(n => prose.appendChild(n));

      // TOC
      const tocList = el("div", { class: "toc-list" });
      const toc = el("nav", { class: "sum-toc" },
        el("div", { class: "toc-head" }, el("span", { text: "On this page" }),
          el("span", { class: "toc-prog", id: "tocProg" + moduleId })),
        tocList);

      const readSet = new Set(store.get("sumread_" + moduleId, []));
      const secEls = [];
      sections.forEach((s, i) => {
        const titleText = s.head.textContent.replace(/^\d+\.\s*/, "");
        const sec = el("section", { class: "sum-sect" + (i === 0 ? " open" : ""), id: "sec-" + moduleId + "-" + i });
        const chev = el("span", { class: "chev", text: "▾" });
        const dot = el("span", { class: "secdot" + (readSet.has(i) ? " read" : "") });
        const head = el("div", { class: "sum-head" }, dot, s.head, chev);
        const body = el("div", { class: "sum-body" });
        s.body.forEach(n => body.appendChild(n));
        head.addEventListener("click", () => { sec.classList.toggle("open"); });
        sec.appendChild(head); sec.appendChild(body); prose.appendChild(sec);
        secEls.push(sec);

        const link = el("a", { class: "toc-item", href: "#" }, el("span", { class: "tdot" }), el("span", { html: M(titleText) }));
        link.addEventListener("click", (e) => {
          e.preventDefault(); sec.classList.add("open");
          head.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        tocList.appendChild(link);
        sec._tocLink = link; sec._idx = i; sec._dot = dot;
      });

      // insert TOC at top of the view (above prose)
      view.insertBefore(toc, view.firstChild);

      // expand/collapse all + progress
      const allBtn = el("button", { class: "btn sm ghost", type: "button" }, "▾ Expand all");
      let allOpen = false;
      allBtn.addEventListener("click", () => {
        allOpen = !allOpen; secEls.forEach(s => s.classList.toggle("open", allOpen));
        allBtn.textContent = allOpen ? "▴ Collapse all" : "▾ Expand all";
      });
      toc.querySelector(".toc-head").appendChild(allBtn);

      // scroll-spy + mark read
      function markRead(i) {
        if (readSet.has(i)) return;
        readSet.add(i); store.set("sumread_" + moduleId, Array.from(readSet));
        const s = secEls[i]; if (s && s._dot) s._dot.classList.add("read");
        updateProg(); if (onRead) onRead();
      }
      function updateProg() {
        const p = document.getElementById("tocProg" + moduleId);
        if (p) p.textContent = readSet.size + "/" + sections.length + " read";
      }
      updateProg();

      if ("IntersectionObserver" in w) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach(en => {
            const sec = en.target;
            if (en.isIntersecting) {
              secEls.forEach(s => s._tocLink && s._tocLink.classList.remove("active"));
              sec._tocLink && sec._tocLink.classList.add("active");
              markRead(sec._idx);
            }
          });
        }, { rootMargin: "-90px 0px -55% 0px", threshold: 0 });
        secEls.forEach(s => io.observe(s));
      } else {
        secEls.forEach(s => markRead(s._idx));
      }
    }
  };

  /* ---------------- Video cards (audited external explainers) ----------------
     videos: [{topic,url,title,channel,length,match,why,timestamps:[]}] or
             {topic,status:"pending"} — link-out only, never an iframe, so the
     offline single-file build degrades gracefully. Built with el()/textContent
     (never innerHTML/M()) because the metadata comes from an external hunt —
     which also means subscripts must be written as Unicode (θ₀, x₁, ²) here. */
  const VideoCard = {
    build(videos) {
      const rail = el("div", { class: "video-rail" });
      const head = (w.SITE && w.SITE.videos) || {};
      rail.appendChild(el("div", { class: "vr-head" },
        el("span", { class: "lbl", text: head.label || "🎬 Watch it explained" }),
        el("span", { class: "muted", text: head.note || "audited against the professor's solving method · opens YouTube (needs internet)" })));
      (videos || []).forEach(v => {
        const card = el("div", { class: "video-card" + (v.status === "pending" ? " pending" : "") + (v.local ? " local" : "") });
        const info = el("div", { class: "vc-info" });
        if (v.status === "pending") {
          card.appendChild(el("span", { class: "vc-play", text: "⏳" }));
          info.appendChild(el("b", { text: (v.topic ? v.topic + " — " : "") + "video audit in progress" }));
          info.appendChild(el("div", { class: "muted vc-why", text: "No video has met the match bar yet — only faithful matches get linked." }));
          card.appendChild(info);
        } else if (v.local) {
          /* the professor's own lecture recording: a relative path into the
             (gitignored) _sources/ folder, so it plays only on the machine
             where the archives were extracted. Never deployed. */
          const isFile = location.protocol === "file:";
          card.appendChild(el("span", { class: "vc-play", text: "🎥" }));
          info.appendChild(el("b", { text: v.title || "The recorded lecture" }));
          info.appendChild(el("div", { class: "muted vc-meta", text: [v.topic, "the professor's own recording", v.length].filter(Boolean).join(" · ") }));
          info.appendChild(el("div", { class: "muted vc-why", text: (v.why ? v.why + " " : "") + "Plays from this computer only (the file is not part of the site)." }));
          card.appendChild(info);
          const side = el("div", { class: "vc-side" });
          side.appendChild(el("span", { class: "badge yield", text: "match 10/10" }));
          if (isFile) side.appendChild(el("a", { class: "btn sm primary", href: v.local, target: "_blank", rel: "noopener" }, "Open the recording ↗"));
          else side.appendChild(el("span", { class: "muted", style: "font-size:.78rem", text: "open index.html from the project folder to play it" }));
          card.appendChild(side);
        } else {
          const safe = typeof v.url === "string" && v.url.indexOf("https://") === 0;
          /* status "candidate": the best video the hunt found scored BELOW the
             9/10 bar and could not be verified frame by frame. It ships with its
             honest score and an explicit "unverified" label — never dressed up
             as a match. An honest candidate beats an 8 presented as a 9. */
          const cand = v.status === "candidate";
          if (cand) card.classList.add("candidate");
          card.appendChild(el("span", { class: "vc-play", text: cand ? "▷" : "▶" }));
          info.appendChild(el("b", { text: (cand ? "Closest match found (unverified): " : "") + (v.title || "Recommended video") }));
          info.appendChild(el("div", { class: "muted vc-meta", text: [v.topic, v.channel, v.length].filter(Boolean).join(" · ") }));
          if (v.why) info.appendChild(el("div", { class: "muted vc-why", text: v.why }));
          if (v.timestamps && v.timestamps.length) {
            const ts = el("div", { class: "vc-ts" });
            v.timestamps.forEach(t => ts.appendChild(el("span", { text: String(t) })));
            info.appendChild(ts);
          }
          card.appendChild(info);
          const side = el("div", { class: "vc-side" });
          if (typeof v.match === "number") side.appendChild(el("span", { class: "badge " + (cand ? "low" : "yield"), text: (cand ? "closest " : "match ") + v.match + "/10" }));
          if (safe) side.appendChild(el("a", { class: "btn sm primary", href: v.url, target: "_blank", rel: "noopener noreferrer" }, "Open on YouTube ↗"));
          card.appendChild(side);
        }
        rail.appendChild(card);
      });
      return rail;
    }
  };

  w.RulesUI = RulesUI;
  w.Summary = Summary;
  w.VideoCard = VideoCard;
})(window);
