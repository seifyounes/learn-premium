/* ============================================================
   app.js — single-page hash router + view renderers
   Routes:  #/            -> home dashboard
            #/lecture/N   -> lecture N (optional /section)
            #/revision    -> final revision (only if window.REVISION)
            #/finals      -> past exams vault (only if window.FINALS has entries)
            #/rules       -> master rules (only if window.RULES_MASTER has entries)
            #/exam        -> mock exam (only if any exam bank exists)
   Everything renders into <main id="app">. Topbar is persistent.
   All subject-specific strings come from window.SITE (data/site.js) —
   engines stay generic; content lives in data files.
   ============================================================ */
(function (w) {
  "use strict";
  const { el, M } = w.U;
  const SITE = w.SITE || {};
  const BRAND = SITE.brand || { logo: "C", first: "Crash", rest: " Course" };
  const SUFFIX = SITE.titleSuffix || (" — " + (BRAND.first + BRAND.rest).trim());
  const LBL = SITE.labels || {};

  /* which optional routes actually have content? */
  function examBanks() {
    const variants = (SITE.exam && SITE.exam.variants) || [];
    const found = variants.filter(v => w[v.key]);
    if (w.EXAM_BANK) found.push({ key: "EXAM_BANK", label: (SITE.exam && SITE.exam.generalLabel) || "General mock (MCQ + problems)", general: true });
    return found;
  }
  const HAS = {
    revision: () => !!w.REVISION,
    finals: () => !!(w.FINALS && w.FINALS.length),
    rules: () => !!(w.RULES_MASTER && w.RULES_MASTER.length),
    exam: () => examBanks().length > 0,
  };
  function navLinks() {
    const links = [["#/", "Home", "home"]];
    if (HAS.revision()) links.push(["#/revision", LBL.revision || "Revision", "revision"]);
    if (HAS.finals()) links.push(["#/finals", LBL.finals || "Past Exams", "finals"]);
    if (HAS.rules()) links.push(["#/rules", LBL.rules || "Master Rules", "rules"]);
    if (HAS.exam()) links.push(["#/exam", LBL.exam || "Mock Exam", "exam"]);
    return links;
  }

  /* ---------- persistent topbar ---------- */
  function buildTopbar() {
    const host = document.getElementById("topbarHost");
    if (!host) return;
    host.innerHTML = "";
    const navKids = navLinks().map(([href, label, r]) => el("a", { href, dataset: { route: r } }, label));
    if (SITE.arabic) {
      const arBtn = el("button", { class: "ar-toggle", title: "إظهار/إخفاء الشرح بالعربي · Toggle Arabic notes" });
      arBtn.addEventListener("click", () => { setAr(!w.U.store.get("show_ar", true)); });
      navKids.push(arBtn);
    }
    host.appendChild(el("div", { class: "topbar" },
      el("div", { class: "wrap" },
        el("a", { class: "brand", href: "#/" },
          el("span", { class: "logo", text: BRAND.logo || "C" }),
          el("span", {}, el("b", { text: BRAND.first }), el("span", { text: BRAND.rest }))),
        el("nav", { class: "nav" }, ...navKids))));
    if (SITE.arabic) setAr(w.U.store.get("show_ar", true));
  }
  function setAr(show, btn) {
    w.U.store.set("show_ar", show);
    document.body.classList.toggle("hide-ar", !show);
    const b = btn || document.querySelector(".ar-toggle");
    if (b) { b.textContent = show ? "🇪🇬 عربي: ظاهر" : "🇪🇬 عربي: مخفي"; b.classList.toggle("on", show); }
  }
  function setActiveNav(route) {
    document.querySelectorAll("#topbarHost .nav a").forEach(a =>
      a.classList.toggle("active", a.dataset.route === (route || "home")));
  }

  /* ---------- scope banner: marks a route whose content belongs to an
     archived exam part, so no page can be mistaken for the current scope.
     Data-driven — SITE.pageBanners[route]; absent = no banner. ---------- */
  function banner(route) {
    const b = (SITE.pageBanners || {})[route];
    return b ? `<div class="callout archive-banner">${M(b)}</div>` : "";
  }

  /* ---------- shared hydration: figures / graphs / calcs / anims in HTML ---------- */
  function hydrate(v) {
    v.querySelectorAll("[data-graph]").forEach(host => {
      const fn = host.getAttribute("data-graph"); let opts = {}; const a = host.getAttribute("data-opts"); if (a) { try { opts = JSON.parse(a); } catch (e) {} }
      if (w.Graphs && w.Graphs[fn]) host.appendChild(w.Graphs[fn](opts));
    });
    v.querySelectorAll("[data-circuit],[data-figure]").forEach(host => {
      const fn = host.getAttribute("data-circuit") || host.getAttribute("data-figure");
      let opts = {}; const a = host.getAttribute("data-opts"); if (a) { try { opts = JSON.parse(a); } catch (e) {} }
      if (w.Figures && w.Figures[fn]) host.innerHTML = `<div class="svg-box">${w.Figures[fn](opts)}</div>`;
    });
    v.querySelectorAll("[data-calc]").forEach(host => {
      const fn = host.getAttribute("data-calc");
      if (w.Calc && w.Calc[fn]) host.appendChild(w.Calc[fn]());
    });
    v.querySelectorAll("[data-anim]").forEach(host => {
      const fn = host.getAttribute("data-anim");
      if (w.Anim && w.Anim[fn]) host.appendChild(w.Anim[fn]());
    });
    // any table authored in prose gets a scroll container — a wide comparison
    // table used to be silently clipped with no way to reach its last column
    v.querySelectorAll("table").forEach(t => {
      if (t.closest(".tbl-scroll") || t.closest(".table-scroll") || t.closest(".dtable-wrap") || t.closest(".given")) return;
      const box = document.createElement("div");
      box.className = "tbl-scroll";
      t.parentNode.insertBefore(box, t);
      box.appendChild(t);
    });
  }

  /* ---------- router ---------- */
  function parts() { return location.hash.replace(/^#\/?/, "").split("/").filter(Boolean); }
  function router() {
    const p = parts();
    const route = p[0] || "home";
    const app = document.getElementById("app");
    app.innerHTML = "";
    setActiveNav(route);
    if (route === "lecture") renderLecture(app, p[1] || "1", p[2]);
    else if (route === "revision" && HAS.revision()) renderRevision(app);
    else if (route === "finals" && HAS.finals()) renderFinals(app);
    else if (route === "rules" && HAS.rules()) renderRules(app);
    else if (route === "exam" && HAS.exam()) renderExam(app);
    else renderHome(app);
    w.scrollTo(0, 0);
  }

  /* ========================= HOME ========================= */
  function renderHome(app) {
    document.title = (SITE.course || "Study Site") + SUFFIX;
    const MODS = Object.values(w.MODULES || {}).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    const weightBadge = { high: '<span class="badge high">High weight</span>', med: '<span class="badge med">Med weight</span>', low: '<span class="badge low">Low weight</span>' };
    const done = w.U.store.get("studyplan", {});
    const PLAN = SITE.plan || [];

    /* ---- modules grouped by EXAM PART (SITE.parts) ----
       Keeps a sat/archived part visibly separate from the one still in scope.
       With no parts declared the engine falls back to a single "All lectures"
       group, i.e. the original behaviour. A module whose `part` matches no
       declared group is never dropped — it lands in the first group. */
    const PARTS = (SITE.parts && SITE.parts.length)
      ? SITE.parts : [{ key: "", title: "All lectures", ic: "📚", open: true, all: true }];
    const declared = new Set(PARTS.map(p => p.key));
    const groups = PARTS.map(p => ({ p, mods: p.all ? MODS : MODS.filter(m => (m.part || "") === p.key) }));
    const orphans = PARTS.some(p => p.all) ? [] : MODS.filter(m => !declared.has(m.part || ""));
    if (orphans.length) groups[0].mods = groups[0].mods.concat(orphans);
    const ARCHIVED = new Set(PARTS.filter(p => p.archived).map(p => p.key));
    const foldsHtml = groups.map(({ p, mods }, i) => `
      <details class="lectures-fold${p.archived ? " archived" : ""}"${i === 0 ? ' id="lectures"' : ""}${p.open ? " open" : ""}>
        <summary><span class="ic">${p.ic || "📚"}</span> ${M(p.title)}
          <span class="part-count">${mods.length ? mods.length + (mods.length === 1 ? " lecture" : " lectures") : "empty"}</span></summary>
        ${p.note ? `<p class="muted part-note">${M(p.note)}</p>` : ""}
        ${mods.length ? `<div class="grid cards" data-part-grid="${i}"></div>`
                      : (p.empty ? `<div class="callout part-empty">${M(p.empty)}</div>` : "")}
      </details>`).join("");

    /* Primary CTA never points at a syllabus that has already been sat. With no
       archived part declared this is the original single-CTA behaviour. */
    const liveMods = MODS.filter(m => !ARCHIVED.has(m.part || ""));
    const split = ARCHIVED.size > 0 && liveMods.length > 0;
    const ctas = [];
    if (split) ctas.push(`<a class="btn primary" href="#lectures">📚 Start studying</a>`);
    if (HAS.revision()) ctas.push(`<a class="btn ${split ? "ghost" : "primary"}" href="#/revision">📘 ${M(ARCHIVED.size ? (LBL.revision || "Revision") : "Open the Final Revision")}</a>`);
    if (HAS.finals()) ctas.push(`<a class="btn" href="#/finals">📂 ${LBL.finals || "Past Exams"} (solved)</a>`);
    if (HAS.exam()) ctas.push(`<a class="btn ghost" href="#/exam">🧪 ${LBL.exam || "Mock Exam"}</a>`);
    if (!ctas.length) ctas.push(`<a class="btn primary" href="#lectures">📚 Start studying</a>`);

    const jumps = [];
    if (HAS.revision()) jumps.push(`<a class="chip-link" href="#/revision">📘 ${LBL.revision || "Revision"}</a>`);
    if (HAS.finals()) jumps.push(`<a class="chip-link" href="#/finals">📂 ${LBL.finals || "Past Exams"}</a>`);
    if (HAS.rules()) jumps.push(`<a class="chip-link" href="#/rules">📋 ${LBL.rules || "Master Rules"}</a>`);
    if (HAS.exam()) jumps.push(`<a class="chip-link" href="#/exam">🧪 ${LBL.exam || "Mock Exam"}</a>`);
    jumps.push(`<a class="chip-link" href="#lectures">📚 Lectures</a>`);

    app.innerHTML = `
      <section class="home-head">
        <div class="eyebrow">${M(SITE.eyebrow || ((SITE.course || "") + (SITE.course ? " · " : "") + "Exam Revision"))}</div>
        <h1>${M(BRAND.first)} <span class="grad">${M(String(BRAND.rest).trim())}</span></h1>
        ${SITE.byline ? `<div class="byline">${M(SITE.byline)}</div>` : ""}
        <p class="muted">${M(SITE.tagline || "Concise summaries, worked solutions, drills and a timed mock exam — everything you need, offline.")}</p>
        ${SITE.credit ? `<div class="credit muted">${M(SITE.credit)}</div>` : ""}
        <div class="btn-row" style="margin-top:16px">${ctas.join("")}</div>
      </section>

      ${PLAN.length ? `<section class="section-title" id="plan"><span class="ic">🗓️</span><h2>${M(SITE.planTitle || "Your study plan")}</h2>
        <span class="muted" style="margin-left:auto;font-size:.86rem">Tick as you go — saved on this device.</span></section>
      <div class="grid plan-grid" id="planGrid"></div>` : ""}

      <div class="jumprow">${jumps.join("")}</div>

      <section class="section-title"><span class="ic">📊</span><h2>Progress</h2></section>
      <div class="stats" id="statRow" style="margin-bottom:6px"></div>

      ${foldsHtml}
      ${SITE.weightNote ? `<p class="muted part-foot">${M(SITE.weightNote)}</p>` : ""}

      <details class="lectures-fold" style="margin-top:12px">
        <summary><span class="ic">★</span> Flagged for review <button class="btn ghost sm" id="clearFlags" style="margin-left:auto">Clear all</button></summary>
        <div id="flagList" style="margin-top:10px"></div>
      </details>`;

    // study-plan cards
    const planGrid = document.getElementById("planGrid");
    if (planGrid) PLAN.forEach(d => {
      const doneN = d.tasks.filter(t => done[t.id]).length;
      const card = el("div", { class: "card pad plan-card" });
      card.appendChild(el("div", { class: "plan-top" },
        el("b", { text: d.day }),
        el("span", { class: "muted plan-count", text: `${doneN}/${d.tasks.length}` })));
      card.appendChild(el("div", { class: "plan-theme muted", text: d.theme || "" }));
      d.tasks.forEach(t => {
        const cb = el("input", { type: "checkbox" });
        cb.checked = !!done[t.id];
        cb.addEventListener("change", () => {
          const dd = w.U.store.get("studyplan", {});
          if (cb.checked) dd[t.id] = true; else delete dd[t.id];
          w.U.store.set("studyplan", dd);
          row.classList.toggle("checked", cb.checked);
          const n = d.tasks.filter(x => w.U.store.get("studyplan", {})[x.id]).length;
          card.querySelector(".plan-count").textContent = `${n}/${d.tasks.length}`;
        });
        const row = el("label", { class: "plan-task" + (done[t.id] ? " checked" : "") },
          cb, el("a", { href: t.href, html: M(t.t), onclick: (e) => e.stopPropagation() }));
        card.appendChild(row);
      });
      planGrid.appendChild(card);
    });

    groups.forEach(({ mods }, i) => {
      const grid = document.querySelector(`[data-part-grid="${i}"]`);
      if (grid) mods.forEach(m => grid.appendChild(moduleCard(m)));
    });
    function moduleCard(m) {
      const mast = w.Progress.mastery(m.id, m), st = w.StudyTimer.totalFor(m.id);
      return el("a", { class: "module-card card", href: `#/lecture/${m.id}` },
        el("span", { class: "num", text: String(m.id) }),
        el("div", { class: "row" }, el("span", { html: weightBadge[m.weight] || "" }),
          m.tag ? el("span", { class: "mod-tag", text: m.tag }) : null,
          mast >= 80 ? el("span", { class: "badge done", text: "✓ strong" }) : null),
        el("h3", { html: M(m.title) }),
        el("p", { html: M(m.subtitle || "") }),
        el("div", { class: "row" },
          el("span", { class: "muted", style: "font-size:.82rem", text: m.counts || "" }),
          el("span", { class: "muted", style: "margin-left:auto;font-size:.82rem", text: st ? "⏱ " + w.StudyTimer.fmt(st) : "⏱ —" })),
        el("div", { class: "bar" + (mast >= 70 ? " good" : ""), style: "margin-top:10px" }, el("i", { style: `width:${mast}%` })),
        el("div", { class: "muted", style: "font-size:.78rem;margin-top:6px", text: `${mast}% mastery` }));
    }

    function paintStats() {
      /* stats track the IN-SCOPE part once it has modules; until then they cover
         everything loaded, so the row never shows a hollow 0%. */
      const inScope = MODS.filter(m => !ARCHIVED.has(m.part || ""));
      const STAT_MODS = inScope.length ? inScope : MODS;
      const overall = w.Progress.overall(STAT_MODS);
      const totalStudy = STAT_MODS.reduce((a, m) => a + w.StudyTimer.totalFor(m.id), 0);
      // results are stored per bank; the home tile reports the PRIMARY variant
      const variants = ((SITE.exam || {}).variants || []);
      const primary = variants.find(x => x.primary) || variants[0];
      const ex = w.Progress.examResult(primary ? primary.key : "EXAM_BANK");
      const row = document.getElementById("statRow"); if (!row) return; row.innerHTML = "";
      [["Overall", overall + "%", inScope.length ? "mastery" : "archive — nothing live yet"],
       ["Study time", w.StudyTimer.fmt(totalStudy), "tracked total"],
       ["Flagged", w.Flags.count(), "to review"],
       // a written-only paper has no auto-graded score — never show a hollow 0/0
       [(SITE.exam && SITE.exam.statLabel) || "Mock exam",
        ex ? (ex.mcqTotal ? `${ex.mcqCorrect}/${ex.mcqTotal}` : "✔") : "—",
        ex ? (ex.mcqTotal ? "last MCQ score" : "sat — mark it yourself") : "not taken yet"]]
        .forEach(([lbl, big, sub]) => row.appendChild(el("div", { class: "stat" },
          el("div", { class: "big", text: String(big) }), el("div", { class: "lbl", text: lbl }), el("div", { class: "muted", style: "font-size:.74rem", text: sub }))));
    }
    function paintFlags() {
      const list = document.getElementById("flagList"); list.innerHTML = "";
      const flags = w.Flags.list();
      if (!flags.length) { list.appendChild(el("p", { class: "muted", text: "No flagged questions yet. Hit the ☆ Flag button on any question to save it here." })); return; }
      const typeName = { quiz: "MCQ", worked: "Worked example", written: "Written Q", "exam-mcq": "Exam MCQ", "exam-written": "Exam problem" };
      flags.forEach(f => list.appendChild(el("div", { class: "flag-item" },
        el("span", { class: "badge yield", text: "★" }),
        el("div", { style: "flex:1" }, el("div", { html: M((f.label || "Question").slice(0, 140)) }), el("div", { class: "meta", text: typeName[f.type] || f.type })),
        el("a", { class: "btn ghost sm", href: f.href || "#/" }, "Open"),
        el("button", { class: "btn ghost sm", onclick: () => { w.Flags.toggle(f.key); paintFlags(); paintStats(); } }, "✕"))));
    }
    paintStats(); paintFlags();
    document.getElementById("clearFlags").addEventListener("click", () => { if (confirm("Clear all flagged questions?")) { w.Flags.clear(); paintFlags(); paintStats(); } });
  }

  /* ======================= LECTURE ======================= */
  function renderLecture(app, id, section) {
    const m = (w.MODULES || {})[id];
    if (!m) { app.innerHTML = '<p class="muted" style="padding:40px 0">Module not found. <a href="#/">Back home</a>.</p>'; return; }
    document.title = m.title + SUFFIX;
    const wb = { high: '<span class="badge high">High exam weight</span>', med: '<span class="badge med">Medium weight</span>', low: '<span class="badge low">Low weight</span>' };
    app.innerHTML = `
      <div class="lec-head">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <a class="btn ghost sm" href="#/">◂ All lectures</a>
          <span>${wb[m.weight] || ""}</span>
          <div id="timerMount" style="margin-left:auto"></div>
        </div>
        <h1>${M(m.title)}</h1><div class="sub">${M(m.subtitle || "")}</div>
      </div>
      <div class="stepper" id="stepper"></div>
      <div id="views"></div>`;

    w.StudyTimer.mount(document.getElementById("timerMount"), m.id, { targetMin: m.estMinutes || 60 });

    // 5-step guided path — regroups the content pieces; nothing removed
    const steps = [
      ["learn", "Learn", "📖"],
      ["rules", "Rules &amp; Formulas", "📐"],
      ["worked", "Worked Examples", "✍"],
      ["practice", "Practice", "🃏"],
    ];
    // the quiz step only exists when the module actually ships a quiz (written-only builds don't)
    if ((m.quiz || []).length) steps.push(["quiz", "Quiz", "✅"]);
    // legacy section names (from flag deep-links) → step keys
    const sectionMap = { summary: "learn", tips: "learn", rules: "rules", formulas: "rules", worked: "worked", flashcards: "practice", written: "practice", quiz: "quiz", learn: "learn", practice: "practice" };
    // teaching order of lectures -> where "Next" goes after the last step (Quiz)
    const ORDER = Object.keys(w.MODULES || {}).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const myPos = ORDER.indexOf(String(m.id));
    const nextLectureId = (myPos >= 0 && myPos < ORDER.length - 1) ? ORDER[myPos + 1] : null;

    const stepperEl = document.getElementById("stepper"), views = document.getElementById("views"), viewNodes = {};
    const visited = new Set(); let currentIdx = 0;
    steps.forEach(([key, label, ic], i) => {
      const item = el("button", { class: "stepitem", type: "button", dataset: { k: key } },
        el("span", { class: "snum", text: String(i + 1) }),
        el("span", { class: "slabel", html: ic + " " + label }));
      item.addEventListener("click", () => activate(key, true));
      stepperEl.appendChild(item);
      const v = el("div", { class: "panel-view", id: "view-" + key });
      views.appendChild(v); viewNodes[key] = v;
    });

    const built = {};
    const fireProgress = () => w.dispatchEvent(new CustomEvent("progress:changed"));
    function paintTicks() {
      stepperEl.querySelectorAll(".stepitem").forEach((n, i) => {
        n.classList.toggle("active", i === currentIdx);
        const done = visited.has(steps[i][0]) && i !== currentIdx;
        n.classList.toggle("done", done);
        n.querySelector(".snum").textContent = done ? "✓" : String(i + 1);
      });
    }
    function activate(key, scroll) {
      const idx = steps.findIndex(s => s[0] === key); if (idx < 0) return;
      currentIdx = idx;
      Object.entries(viewNodes).forEach(([k, v]) => v.classList.toggle("active", k === key));
      if (!built[key]) { build(key, idx); built[key] = true; }
      visited.add(key); paintTicks();
      if (scroll) views.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function stepNav(v, idx) {
      const prev = steps[idx - 1], next = steps[idx + 1];
      v.appendChild(el("div", { class: "step-nav" },
        prev ? el("button", { class: "btn ghost", type: "button", onclick: () => activate(prev[0], true) }, "◂ " + prev[1].replace("&amp;", "&")) : el("span", {}),
        el("span", { class: "step-count", text: `Step ${idx + 1} of ${steps.length}` }),
        next ? el("button", { class: "btn primary", type: "button", onclick: () => activate(next[0], true) }, "Next: " + next[1].replace("&amp;", "&") + " ▸")
             : (nextLectureId
                 ? el("a", { class: "btn primary", href: `#/lecture/${nextLectureId}` }, "Next lecture: " + w.MODULES[nextLectureId].title + " ▸")
                 : (HAS.exam()
                     ? el("a", { class: "btn primary", href: "#/exam" }, "Finish → " + (LBL.exam || "Mock Exam") + " ▸")
                     : el("a", { class: "btn primary", href: "#/" }, "Finish → Home ▸")))));
    }

    function build(key, idx) {
      const v = viewNodes[key];
      if (key === "learn") {
        // summaries carry the same θ_0 / ^2 notation as the rest of the site — mathify
        // them too (tags are masked inside mathify, so data-opts attributes survive)
        v.innerHTML = `<div class="prose">${M(m.summaryHtml || "<p class='muted'>Summary coming.</p>")}</div>`;
        hydrate(v);
        w.Summary.enhance(v, m.id, fireProgress);
        // audited video cards (module.videos[]) sit above the summary — link-outs only
        if (m.videos && m.videos.length && w.VideoCard) v.insertBefore(w.VideoCard.build(m.videos), v.firstChild);
        if ((m.tips || []).length) {
          const items = m.tips.map(t => `<li>${M(t)}</li>`).join("");
          v.appendChild(el("details", { class: "tips-fold" },
            el("summary", { html: "⚠ Common mistakes &amp; exam tips" }),
            el("ul", { class: "prose", html: items })));
        }
        w.Progress.markSeen(m.id, "summary"); w.Progress.markSeen(m.id, "tips"); fireProgress();
      }
      else if (key === "rules") {
        const host = el("div", {}); v.appendChild(host);
        const groups = Array.isArray(m.ruleGroups) && m.ruleGroups.length ? m.ruleGroups : [{ rules: m.rules || [] }];
        w.RulesUI.mount(host, groups, { storageKey: "rules_m" + m.id,
          lead: "Quick-reference for every rule the exam can test on this topic. <b>Search</b> to find one, hit <b>Test mode</b> to hide the formulas and quiz yourself, and tick the <b>★</b> on each rule you've mastered." });
        if ((m.formulas || []).length) {
          const cards = m.formulas.map(f => `<div class="formula-card"><div class="big">${M(f.big)}</div><div class="meaning">${M(f.meaning || "")}</div></div>`).join("");
          v.appendChild(el("h3", { class: "sub-h", html: "∑ Key formulas explained" }));
          v.appendChild(el("div", { class: "grid", style: "grid-template-columns:repeat(auto-fill,minmax(260px,1fr))", html: cards }));
        }
        if (HAS.rules()) v.appendChild(el("p", { style: "margin-top:14px" }, el("a", { class: "btn ghost sm", href: "#/rules" }, "📋 Open the full Master Rules sheet")));
        w.Progress.markSeen(m.id, "rules"); w.Progress.markSeen(m.id, "formulas"); fireProgress();
      }
      else if (key === "worked") {
        if (SITE.methodNote) v.appendChild(el("div", { class: "callout tip", html: "<span class='lbl'>" + (SITE.methodNoteLbl || "Solved the professor's way") + "</span>" + SITE.methodNote }));
        const host = el("div", {}); v.appendChild(host); w.Walkthrough.render(host, m.id, m.worked); fireProgress();
      }
      else if (key === "practice") {
        v.appendChild(el("h3", { class: "sub-h", html: "🃏 Flashcards" }));
        const fc = el("div", {}); v.appendChild(fc); w.Flashcards.render(fc, m.id, m.flashcards);
        v.appendChild(el("hr", { class: "hr" }));
        v.appendChild(el("h3", { class: "sub-h", html: "📝 Written (exam-style) questions" }));
        const wr = el("div", {}); v.appendChild(wr); w.Written.render(wr, m.id, m.written);
        fireProgress();
      }
      else if (key === "quiz") { const host = el("div", {}); v.appendChild(host); w.Quiz.render(host, m.id, m.quiz, { onScore: fireProgress }); }
      stepNav(v, idx);
    }

    activate("learn", false);
    const target = section ? (sectionMap[section] || section) : null;
    if (target && viewNodes[target] && target !== "learn") activate(target, false);
  }

  /* ======================== RULES ======================== */
  function renderRules(app) {
    document.title = (LBL.rules || "Master Rules") + SUFFIX;
    app.classList.add("narrow");
    const RS = SITE.rules || {};   // optional subject strings (site.js)
    app.innerHTML = `
      <div class="hero" style="padding:34px 0 10px">
        <div class="eyebrow">${M(RS.eyebrow || "One-page cheat sheet")}</div>
        <h1>${M(RS.title || "Master Rules &amp; Formulas")}</h1>
        <p class="muted">${M(RS.sub || "Every rule the exam can test, organized by topic. Print it (or save as PDF) and keep it beside you while you drill problems.")}</p>
        <div class="btn-row no-print">
          <button class="btn primary" id="printBtn">🖨 Print / Save as PDF</button>
          <a class="btn ghost" href="#/">◂ Dashboard</a>
        </div>
      </div>${banner("rules")}<div id="rulesRoot"></div>`;
    document.getElementById("printBtn").addEventListener("click", () => w.print());
    w.RulesUI.mount(document.getElementById("rulesRoot"), w.RULES_MASTER || [], {
      storageKey: "rules_master",
      lead: RS.lead || "Every rule the exam can test, organized by topic. <b>Search</b> across all of them, switch on <b>Test mode</b> to hide formulas and self-test, and tick the <b>★</b> on each rule you've nailed. Your mastered rules are saved on this device."
    });
  }

  /* ======================= REVISION ======================= */
  function renderRevision(app) {
    document.title = (LBL.revision || "Final Revision") + SUFFIX;
    const R = w.REVISION || { html: "" };
    app.innerHTML = `
      <div class="lec-head">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a class="btn ghost sm" href="#/">◂ Home</a>
          <span class="badge yield">★ Exam-ready revision</span>
          <button class="btn ghost sm no-print" id="revPrint" style="margin-left:auto">🖨 Print / Save PDF</button>
        </div>
        <h1>${M(R.title || "Final Revision")}</h1>
        <div class="sub">${M(R.subtitle || "")}</div>
      </div>
      ${banner("revision")}
      <div id="revBody"><div class="prose">${R.html || ""}</div></div>`;
    const v = document.getElementById("revBody");
    hydrate(v);
    w.Summary.enhance(v, "rev", function () {});
    const pb = document.getElementById("revPrint"); if (pb) pb.addEventListener("click", () => w.print());
  }

  /* ======================= PAST EXAMS ======================= */
  function renderFinals(app) {
    const F = SITE.finals || {};
    document.title = (LBL.finals || "Past Exams") + SUFFIX;
    const exams = w.FINALS || [];
    app.innerHTML = `
      <div class="lec-head">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a class="btn ghost sm" href="#/">◂ Home</a>
          <span class="badge yield">${M(F.badge || "★ Real past exams")}</span>
        </div>
        <h1>${M(F.title || "Past Exams — solved step by step")}</h1>
        <div class="sub">${M(F.sub || "The real past papers, reproduced faithfully and worked step-by-step. Press ▶ on any question to watch it solve.")}</div>
      </div>
      <div id="finalsBody"></div>`;
    const body = document.getElementById("finalsBody");
    if (!exams.length) { body.appendChild(el("p", { class: "muted", text: "Past exams not loaded." })); return; }

    exams.forEach((exam, ei) => {
      const det = el("details", { class: "finals-exam" });
      if (ei === 0) det.open = true;
      det.appendChild(el("summary", {},
        el("span", { class: "fx-title", html: M(exam.title) }),
        el("span", { class: "muted fx-meta", text: exam.meta || "" })));
      const inner = el("div", { class: "finals-inner" });
      if (exam.note) inner.appendChild(el("p", { class: "muted finals-note", html: M(exam.note) }));
      det.appendChild(inner);
      body.appendChild(det);

      let built = false;
      const build = () => {
        if (built) return; built = true;
        exam.questions.forEach(q => inner.appendChild(buildQuestion(exam, q)));
      };
      if (det.open) build();
      det.addEventListener("toggle", () => { if (det.open) build(); });
    });

    function buildQuestion(exam, q) {
      if (q.placeholder) {
        return el("div", { class: "finals-q card pad" },
          el("h3", { html: M(q.title) }),
          el("div", { class: "callout warn", style: "margin-top:8px" },
            el("span", { class: "lbl", text: "Page not uploaded" }),
            el("div", { html: M(q.statement) })),
          q.ar ? el("div", { class: "ar-note", html: `<span class="ar-lbl">🇪🇬 بالعربي</span>${q.ar}` }) : null);
      }
      const holder = el("div", {});
      w.Walkthrough.render(holder, "final-" + exam.id, [q]);
      const card = holder.querySelector(".worked");
      if (card) {
        if (q.marks) { const h = card.querySelector("header"); if (h) h.appendChild(el("span", { class: "badge", text: q.marks + " marks" })); }
        if (q.ar) { const st = card.querySelector(".statement"); const note = el("div", { class: "ar-note", html: `<span class="ar-lbl">🇪🇬 بالعربي</span>${q.ar}` }); if (st && st.parentNode) st.parentNode.insertBefore(note, st.nextSibling); else card.appendChild(note); }
        if (q.graphs && q.graphs.length) {
          const g = el("div", { class: "fq-graphs" });
          q.graphs.forEach(spec => { if (w.Graphs[spec.fn]) g.appendChild(w.Graphs[spec.fn](spec.opts || {})); });
          card.appendChild(g);
        }
        if (q.anims && q.anims.length) {
          const a = el("div", { class: "fq-graphs" });
          q.anims.forEach(name => { if (w.Anim && w.Anim[name]) a.appendChild(w.Anim[name]()); });
          card.appendChild(a);
        }
      }
      return holder;
    }
  }

  /* ========================= EXAM ========================= */
  function renderExam(app) {
    document.title = (LBL.exam || "Mock Exam") + SUFFIX;
    const bn = banner("exam");
    if (bn) app.appendChild(el("div", { style: "padding-top:20px", html: bn }));
    const root = el("div", { id: "examRoot", style: bn ? "" : "padding-top:24px" });
    app.appendChild(root);
    const banks = examBanks();
    if (banks.length <= 1) {                      // only one bank → no chooser
      const only = banks[0];
      w.Exam.init(root, only && !only.general ? w[only.key] : undefined, only ? only.key : undefined);
      return;
    }
    const buttons = banks.map((v, i) =>
      el("button", { class: "btn" + (v.primary ? " primary" : (v.general ? " ghost" : "")), onclick: () => w.Exam.init(root, v.general ? undefined : w[v.key], v.key) }, v.label || v.key));
    const choose = el("div", { class: "card pad narrow" },
      el("div", { class: "eyebrow", text: (LBL.exam || "Mock Exam") + " · pick your rehearsal" }),
      el("h1", { text: "Rehearse the exam" }),
      el("p", { class: "muted", html: (SITE.exam && SITE.exam.blurb) || "Sit a timed mock under exam conditions. MCQ is auto-graded; written problems reveal model solutions and marking notes when you submit." }),
      el("div", { class: "exam-choose" }, ...buttons),
      (SITE.exam && SITE.exam.tip) ? el("p", { class: "muted", style: "margin-top:12px;font-size:.84rem", html: SITE.exam.tip }) : null);
    root.appendChild(choose);
  }

  // publish the topbar's real height so sticky content (the professor's table)
  // pins BELOW it instead of sliding under the translucent bar
  function trackTopbarHeight() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", Math.round(bar.getBoundingClientRect().height) + "px");
    set();
    if (w.ResizeObserver) new ResizeObserver(set).observe(bar);
    w.addEventListener("resize", set);
  }

  /* ---------- boot ---------- */
  function boot() {
    buildTopbar();
    trackTopbarHeight();
    router();
    document.body.appendChild(w.U.footer());
  }
  w.addEventListener("hashchange", () => { document.getElementById("app").classList.remove("narrow"); router(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
