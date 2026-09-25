/* ============================================================
   glitch-scan.js — the automated glitch sweep for a crash-course site.
   NOT part of the site: it lives in .claude/ and is never referenced by
   index.html. Inject it into the live page during verification.

   HOW TO RUN (browser pane / any devtools console):
     1. Read this file and paste its contents through javascript_tool.
     2. `CCScan.sweep()` → walks every route + every stepper tab and stores
        the result on window.CCScanResult (it is async — poll for it).
     3. Poll: `CCScanResult ? JSON.stringify(CCScanResult) : "still sweeping"`
     4. Repeat at each viewport width (see verification.md: 390 / ~510 / 1280).

   WHY IT EXISTS: geometry bugs are invisible in a happy-path click-through
   but obvious to the user — a 6px scrollbar on every page, a label cut off
   at an SVG edge, a nav that wraps into the content, a tab that opens an
   empty panel. Every check below was earned from a real shipped glitch.
   ============================================================ */
(function (w) {
  "use strict";

  /* Content inside a COLLAPSED <details> still reports layout boxes in Chrome
     (it is content-visibility, not display:none), so offsetParent lies about it.
     Every collapsed row then stacks at the same y and the geometry checks report
     overlaps the user can never see — one closed fold produced a phantom
     "SPAN.num covers P.muted". Treat collapsed content as hidden; the <summary>
     is the part that is actually on screen. sweep() opens every <details> before
     scanning, so nothing is skipped — it is measured expanded, where it is real. */
  const hiddenByDetails = n => {
    for (let d = n.parentElement ? n.parentElement.closest("details") : null; d;
         d = d.parentElement ? d.parentElement.closest("details") : null) {
      if (d.open) continue;
      const s = d.querySelector(":scope > summary");
      if (!(s && s.contains(n))) return true;
    }
    return false;
  };
  const vis = n => !!(n.offsetParent || n.getClientRects().length) &&
    getComputedStyle(n).visibility !== "hidden" && !hiddenByDetails(n);
  const scrollable = n => { const s = getComputedStyle(n); return /auto|scroll/.test(s.overflowX + s.overflow); };
  // SVG elements expose className as an SVGAnimatedString, not a string
  const cls = n => (typeof n.className === "string" ? n.className : (n.className && n.className.baseVal) || "");
  const tag = n => n.tagName + (cls(n) ? "." + cls(n).slice(0, 26) : "");

  /* Containers that are SUPPOSED to scroll or overhang. Extend per project —
     but only after confirming the overhang is intentional. */
  /* Designated horizontal-scroll wrappers: a table wider than a phone is SUPPOSED
     to scroll inside them, so their descendants overhanging the viewport is the
     design, not a glitch. The wrappers themselves are still checked for PAGE
     OVERFLOW like everything else. */
  const ALLOWED = ".dtable-scroll, .dtable-host, .tbl-scroll, .given, .statement, .nav, .prose, .toc, [data-allow-overflow]";

  function scan(label) {
    const vw = w.innerWidth, issues = [];
    const add = s => issues.push(s);

    // 1. the whole page scrolls sideways — the loudest, most common glitch
    if (document.documentElement.scrollWidth > vw + 1)
      add(`PAGE OVERFLOW ${document.documentElement.scrollWidth} > ${vw}`);

    // 2. elements past the right edge / clipping their own content
    document.querySelectorAll("main *:not(svg *), .topbar *").forEach(n => {
      if (!vis(n)) return;
      const r = n.getBoundingClientRect();
      if (!r.width && !r.height) return;
      if (r.right > vw + 2 && !n.closest(ALLOWED) && !scrollable(n))
        add(`OUTSIDE ${tag(n)} right=${Math.round(r.right)}`);
      if (n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0 && !scrollable(n))
        add(`CLIPPED ${tag(n)} ${n.scrollWidth}>${n.clientWidth}`);
    });

    // 3. figures/graphs that hydrated to nothing
    document.querySelectorAll("[data-figure],[data-graph]").forEach(n => {
      if (!vis(n)) return;
      if (n.getBoundingClientRect().height < 12)
        add(`EMPTY FIGURE ${n.dataset.figure || n.dataset.graph}`);
    });

    // 4. svg text drawn outside its own viewBox (labels/captions cut off)
    document.querySelectorAll("main svg").forEach(sv => {
      if (!vis(sv)) return;
      const sr = sv.getBoundingClientRect();
      if (sr.height < 6 || sr.width < 6) { add(`SVG COLLAPSED ${Math.round(sr.width)}x${Math.round(sr.height)}`); return; }
      sv.querySelectorAll("text").forEach(t => {
        const r = t.getBoundingClientRect();
        if (!r.width) return;
        if (r.left < sr.left - 1 || r.right > sr.right + 1)
          add(`SVG TEXT CUT "${(t.textContent || "").slice(0, 20)}"`);
      });
    });

    // 5. topbar integrity — the brand must not spill out of its own bar
    const tb = document.querySelector(".topbar"), br = document.querySelector(".brand");
    if (tb && br) {
      const t = tb.getBoundingClientRect(), b = br.getBoundingClientRect();
      if (b.bottom > t.bottom + 1) add(`BRAND SPILLS ${Math.round(b.bottom)} > ${Math.round(t.bottom)}`);
    }

    // 6. dead navigation: a stepper tab / nav link whose panel renders nothing.
    //    (Caught a "Quiz" tab that shipped on a written-only build.)
    document.querySelectorAll(".panel-view.active").forEach(v => {
      const txt = (v.innerText || "").replace(/\s+/g, " ").trim();
      if (txt.length < 40) add(`EMPTY PANEL #${v.id} ("${txt.slice(0, 30)}")`);
    });

    /* 7. OCCLUSION — an element sitting on top of a figure or of other text.
       Earned the hard way: value chips were absolutely positioned at the centre
       of the part they annotated, so on a dense multi-panel plot every chip
       buried the traces. Checks 1–6 all passed, and the screenshot loop could
       not run (browser pane hidden), so it shipped repeatedly. Geometry can see
       this without any pixels, so it belongs here. */
    // intentional overlays: sticky chrome, and the transient confetti burst
    const OVERLAY_OK = ".topbar, .exam-bar, .quiz-score, .wt-player, .confetti, [data-allow-overlap]";
    /* Compare INKED area, not element boxes. A block's box often reaches far
       past its glyphs (padding, a short line in a wide container), so box-vs-box
       reports overlaps a reader would never see. Text is measured with a Range
       over its text nodes; an <svg> is taken as its whole box. */
    const inked = n => {
      if (n.tagName.toLowerCase() === "svg") return [n.getBoundingClientRect()];
      const out = [], walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = walk.nextNode())) {
        if (!t.nodeValue || !t.nodeValue.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(t);
        for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
      }
      return out;
    };
    const overlappers = [...document.querySelectorAll("main *")].filter(n => {
      if (!vis(n) || n.closest(OVERLAY_OK)) return false;
      const p = getComputedStyle(n).position;
      return p === "absolute" || p === "fixed";
    });
    if (overlappers.length) {
      /* inked() walks a TreeWalker and calls getClientRects() per text node, so
         inking every candidate up front is O(page). Once expandAll() started
         opening the summary sections that ballooned into a multi-minute sweep —
         and a sweep too slow to run is a sweep nobody runs. Pre-filter on plain
         bounding boxes first (cheap, cached by the browser) and only ink the
         handful of victims whose box actually meets an overlapper's. */
      const victims = [...document.querySelectorAll("main svg, main p, main li, main td, main .k, main h3, main h4")].filter(vis);
      overlappers.forEach(n => {
        const nb = n.getBoundingClientRect();
        const boxes = inked(n).length ? inked(n) : [nb];
        for (const v of victims) {
          if (v === n || n.contains(v) || v.contains(n)) continue;
          const vb = v.getBoundingClientRect();
          if (Math.min(nb.right, vb.right) - Math.max(nb.left, vb.left) <= 3) continue;
          if (Math.min(nb.bottom, vb.bottom) - Math.max(nb.top, vb.top) <= 3) continue;
          const vr = inked(v);
          if (!vr.length) continue;
          for (const a of boxes) for (const b of vr) {
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 3 && oy > 3) {
              add(`OCCLUDES ${tag(n)} covers ${tag(v)} by ${Math.round(ox)}x${Math.round(oy)}`);
              return;
            }
          }
        }
      });
    }

    // 8. leaked placeholders / hollow values in VISIBLE text — catches
    //    unrendered template vars, undefined interpolations and 0/0 scores.
    const body = (document.querySelector("main")?.innerText || "");
    [["undefined", /\bundefined\b/], ["NaN", /\bNaN\b/], ["[object Object]", /\[object Object\]/],
     ["{{placeholder}}", /\{\{\s*[A-Z_]+\s*\}\}/], ["hollow 0/0 score", /\b0\s*\/\s*0\b/]]
      .forEach(([name, re]) => { if (re.test(body)) add(`TEXT LEAK: ${name}`); });

    /* 9-11. FLOW-LAYOUT COLLISIONS.
       Checks 2 and 7 above cover content that overflows its own box and
       absolutely-positioned overlays. Neither sees the commonest phone bug:
       ordinary static elements landing on top of one another because a
       container was given a fixed height and its contents wrapped. That is how
       the topbar shipped with its nav links rendered at y = -40 and +39px past
       the bar, on a page the sweep had called clean.

       Rects are collected per TEXT NODE, so a <b> inside a <p> cannot collide
       with its own parent's glyphs; text nodes are leaves. */
    const OVERLAP_OK = ".wt-chips, .badge, .mk, [data-allow-overlap]";
    const marks = [];
    (function collect() {
      const roots = [document.querySelector("main"), document.querySelector(".topbar")].filter(Boolean);
      for (const root of roots) {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = walk.nextNode())) {
          if (!t.nodeValue || !t.nodeValue.trim()) continue;
          const el = t.parentElement;
          if (!el || !vis(el) || el.closest(OVERLAP_OK)) continue;
          const rg = document.createRange(); rg.selectNodeContents(t);
          for (const r of rg.getClientRects()) {
            if (r.width > 1 && r.height > 1) marks.push({ el, r });
          }
        }
      }
    })();

    // 9. anything rendered off the TOP of the page — always a layout accident
    for (const m of marks) {
      if (m.r.top < -2) {
        add(`ABOVE VIEWPORT ${tag(m.el)} top=${Math.round(m.r.top)} "${(m.el.textContent || "").trim().slice(0, 24)}"`);
        break;
      }
    }

    // 10. two different elements' glyphs occupying the same pixels
    marks.sort((a, b) => a.r.top - b.r.top);
    let reported = 0;
    for (let i = 0; i < marks.length && reported < 4; i++) {
      const A = marks[i];
      for (let j = i + 1; j < marks.length; j++) {
        const B = marks[j];
        if (B.r.top >= A.r.bottom - 2) break;          // sweep line: sorted by top
        if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
        /* Two legitimate ways for elements to share pixels. Both are skipped as
           PAIRS rather than by whitelisting the containers, so a genuine
           collision inside either one is still reported. */
        // a sticky bar passes over page content while scrolling — by design
        if (!!A.el.closest(".topbar") !== !!B.el.closest(".topbar")) continue;
        // the two sides of a flip card: .face.back carries rotateY(180deg), so
        // both faces occupy one box and only one is ever turned to the reader
        const fa = A.el.closest(".face"), fb = B.el.closest(".face");
        if (fa && fb && fa !== fb) continue;
        const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
        const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
        /* An HTML range rect is a LINE BOX: it includes the leading above the
           ascender and below the descender, so two block siblings stacked in
           normal flow routinely report 2-3px of overlap with a clear gap
           between the actual glyphs (the rules page's eyebrow and h1 measured
           2.3px apart while their ink sat 9px clear). An SVG <text> rect is
           tight to its glyphs and has no such slop. Threshold accordingly, or
           the check cries wolf on every heading on the site and gets ignored. */
        const svgPair = A.el.ownerSVGElement && B.el.ownerSVGElement;
        if (ox > 2 && oy > (svgPair ? 2 : 4)) {
          add(`STACKED ${tag(A.el)} on ${tag(B.el)} by ${Math.round(ox)}x${Math.round(oy)}`);
          reported++; break;
        }
      }
    }

    /* 11. a height-locked box whose content is taller than it.
       Tolerance is 8px, not the 2px the horizontal checks use. getComputedStyle
       resolves `height` to a px value even when the author wrote `auto`, so the
       declared value cannot tell a locked box from a natural one — and a text
       element's scrollHeight routinely runs a few px past its line box (the
       hero H1's gradient-clipped glyphs measure 34 against a 30px line, with
       overflow visible and nothing clipped). Font-metric slop is a few px; a
       row that wrapped when it should not have is tens. 8px separates them. */
    document.querySelectorAll("main *, .topbar *").forEach(n2 => {
      if (!vis(n2) || n2.closest(ALLOWED)) return;
      // SVG elements have no CSS overflow box; their scrollHeight/clientHeight
      // are not meaningful and reported phantom overflow on every <text>.
      // SVG containment is covered by check 4 (SVG TEXT CUT) instead.
      if (n2.ownerSVGElement || n2.tagName.toLowerCase() === "svg") return;
      const st = getComputedStyle(n2);
      if (st.overflowY === "auto" || st.overflowY === "scroll") return;
      if (n2.scrollHeight > n2.clientHeight + 8 && n2.clientHeight > 0)
        add(`VOVERFLOW ${tag(n2)} content ${n2.scrollHeight} > box ${n2.clientHeight}`);
    });

    return { label, vw, issues: [...new Set(issues)] };
  }

  /* Collapsed content is real content — the user opens it. Expand every folded
     section before scanning so it is checked in its true layout instead of
     being skipped (or measured squashed).

     TWO mechanisms, and missing either one silently voids whole pages:
       - native <details>
       - the summary engine's `.sum-sect` / `.open` class pair, which hides its
         body with display:none. EVERY figure inside a lecture summary lives in
         one of these, so before this line the sweep was checking none of them —
         an SVG caption running outside its own viewBox sat there undetected. */
  function expandAll() {
    document.querySelectorAll("details:not([open])").forEach(d => { d.open = true; });
    document.querySelectorAll(".sum-sect:not(.open)").forEach(s => s.classList.add("open"));
  }

  /* Walk every route and every stepper tab, scanning each.

     `settle` is an EXTRA pause after each navigation/click, on top of the
     event-driven wait below. Default 0 — you should not need it.

     Why this is event-driven and not a timer. A backgrounded tab clamps
     setTimeout to ~1 s, which once turned a ~10 s sweep into 11 MINUTES and
     looked like a hang. The first fix was `{settle: 0}`, dropping the pause to
     `Promise.resolve()` — but that is a MICROtask, while `location.hash = …`
     queues `hashchange` as a MACROtask. The handler had not run when scan()
     measured, so the sweep re-scanned the PREVIOUS page on every route and
     reported a confident 0 findings for content it had never rendered.
     (Caught by injecting an over-wide table into a module's data: scan() called
     directly reported `CLIPPED DIV.sum-body 2157>350`; sweep() reported nothing.)

     So: wait on the hashchange EVENT, and yield real macrotasks through
     MessageChannel, which is not subject to background clamping. Fast AND
     actually on the page it claims to be scanning. */
  const yieldTask = () => new Promise(r => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  });

  async function sweep(opts) {
    opts = opts || {};
    const wait = opts.settle == null ? 0 : opts.settle;
    const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : yieldTask());
    /* Navigate and do not return until the router has actually re-rendered.
       A same-hash assignment fires no event, so that case yields instead. */
    const navigate = async rt => {
      if (location.hash === rt) { await yieldTask(); return; }
      let fired = false;
      const onHash = () => { fired = true; };
      w.addEventListener("hashchange", onHash, { once: true });
      location.hash = rt;
      for (let i = 0; i < 60 && !fired; i++) await yieldTask();
      w.removeEventListener("hashchange", onHash);
      await yieldTask();          // let the render task that hashchange scheduled finish
      await yieldTask();          // and let layout settle before anything is measured
    };
    const out = [];
    const routes = (opts.routes || ["#/", "#/rules", "#/revision", "#/finals", "#/exam"])
      .filter(rt => rt !== "#/finals" || (w.FINALS || []).length);
    for (const id of Object.keys(w.MODULES || {})) routes.push("#/lecture/" + id);

    const covered = [];
    for (const rt of routes) {
      await navigate(rt);
      if (wait) await sleep(wait);
      expandAll();
      const tabs = [...document.querySelectorAll(".stepitem")];
      if (tabs.length) {
        for (const t of tabs) {
          t.click();
          await yieldTask();
          if (wait) await sleep(Math.round(wait * 0.7));
          expandAll();
          await yieldTask();
          const label = rt + " » " + t.textContent.trim();
          covered.push(label);
          const r = scan(label);
          if (r.issues.length) out.push(r);
        }
      } else {
        covered.push(rt);
        const r = scan(rt);
        if (r.issues.length) out.push(r);
      }
    }
    /* `covered` is the receipt. A findings list of [] means nothing unless you
       can see WHICH pages produced it — that is how the microtask bug survived. */
    w.CCScanResult = { width: w.innerWidth, findings: out, covered, errors: w.CCScanErrors || [] };
    return w.CCScanResult;
  }

  // console errors must be captured BEFORE the sweep runs
  w.CCScanErrors = w.CCScanErrors || [];
  if (!w.__ccScanHooked) {
    w.__ccScanHooked = true;
    w.addEventListener("error", e => w.CCScanErrors.push("ERR " + e.message));
    w.addEventListener("unhandledrejection", e => w.CCScanErrors.push("REJECTION " + e.reason));
  }

  w.CCScan = { scan, sweep, reset: () => { w.CCScanResult = null; w.CCScanErrors.length = 0; } };
})(window);
"CCScan ready — run CCScan.sweep(), then poll window.CCScanResult";
