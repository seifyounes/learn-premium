// The browser gates' in-page half: injected into every page the sweep opens, and measured there.
// Plain browser JavaScript, read from disk and evaluated as text, so no bundler helper reaches
// the page. It defines `window.__lpSweep`.
//
// Each check exists because v1 shipped its defect (lessons C6–C13 in docs/research/v1-lessons.md,
// on the research/v1-lessons branch):
//   page-scroll     the page scrolls sideways
//   covers-figure   something positioned over a figure (value chips laid on the traces)
//   above-viewport  content rendered off the top of the page (a wrapped bar centred upwards)
//   text-collision  two elements' text on the same pixels (static flow stacks too)
//   height-overflow a height-locked box whose content is taller than it
//   tiny-text       text rendered under the 12px floor, SVG labels at their drawn size included
// and, on the live page's text:
//   katex-error     a formula KaTeX couldn't render
//   raw-tex         TeX that reached the page untypeset
//   hollow-copy     copy that assumes a content shape ("0/0") or an unrendered placeholder
//   garbled-number  a number the page computed wrong: NaN, or floating-point noise
//
// Every finding names the Trap page's seeded defect it sits in (`data-trap`), if any.
(() => {
  /** The 12px Floor Rule (DESIGN.md). */
  const FLOOR_PX = 12;
  /** Deliberate overlays opt out with this attribute, as pairs never as containers. */
  const ALLOW_OVERLAP = "[data-allow-overlap]";
  // The copy checks are shared with the rendered-page scan (`gates/copy-checks.ts`), prepended
  // to this script as `__lpChecks`.
  const checks = window.__lpChecks;
  const RAW_TEX = new RegExp(checks.rawTex.source, checks.rawTex.flags);
  const COPY_DEFECTS = checks.copy.map((d) => ({ ...d, pattern: new RegExp(d.source, d.flags) }));
  const quote = (text) => `"${text.replace(/\s+/g, " ").trim().slice(0, 60)}"`;
  const NOT_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE"]);

  const trapOf = (el) => el?.closest?.("[data-trap]")?.getAttribute("data-trap") ?? undefined;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  /** A task posted now runs once the frame being drawn is done. */
  const nextTask = () =>
    new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(undefined);
    });
  // A frame runs its animation callbacks before its layout and its ResizeObservers, so a settle
  // that ended in one measured a layout no ResizeObserver had answered yet: on a loaded runner, the
  // gradient-descent sim's tick labels still placed for the board's old size. Each frame is waited
  // out to its end.
  const settle = async () => {
    for (let i = 0; i < 2; i++) {
      await nextFrame();
      await nextTask();
    }
  };

  /** Short, stable name for an element in a finding. */
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal || "";
    const first = cls.trim().split(/\s+/)[0];
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32);
    return `<${tag}${first ? `.${first}` : ""}>${text ? ` "${text}"` : ""}`;
  }

  function makeVisibility() {
    const clipped = new Map();
    /** Visually hidden on purpose: an ancestor clipped to a 1px box (sr-only, KaTeX's MathML). */
    const inClippedBox = (el) => {
      if (!el || el === document.body) return false;
      if (clipped.has(el)) return clipped.get(el);
      const style = getComputedStyle(el);
      let hidden = false;
      if (style.overflow !== "visible" || style.clipPath !== "none") {
        const r = el.getBoundingClientRect();
        hidden = r.width <= 1 || r.height <= 1;
      }
      hidden ||= inClippedBox(el.parentElement);
      clipped.set(el, hidden);
      return hidden;
    };
    return (el) =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) &&
      !inClippedBox(el);
  }

  /** Open every collapsible, so folded content is measured where its layout is real. */
  function expandAll() {
    let opened = 0;
    for (const details of document.querySelectorAll("details:not([open])")) {
      details.open = true;
      opened += 1;
    }
    return opened;
  }

  /** The drawn size of an element's text: its font size, times the SVG's scale for SVG text. */
  function drawnFontSize(el) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (!(el instanceof SVGElement)) return size;
    const ctm = el.getScreenCTM?.();
    return ctm ? size * Math.hypot(ctm.b, ctm.d) : size;
  }

  /** Ink: rectangles of text (KaTeX by its rendered pieces), every text-bearing element once. */
  function textMarks(visible) {
    const marks = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seenKatex = new Set();
    let node;
    while ((node = walk.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const el = node.parentElement;
      if (!el || NOT_TEXT.has(el.tagName) || !visible(el)) continue;
      const katex = el.closest(".katex");
      if (katex) {
        // A formula is one piece of ink: its own glyphs are stacked by design (scripts, fractions).
        if (el.closest(".katex-mathml") || seenKatex.has(katex)) continue;
        seenKatex.add(katex);
        for (const base of katex.querySelectorAll(".katex-html > .base")) {
          for (const r of base.getClientRects()) if (r.width > 1 && r.height > 1) marks.push({ el: katex, r, node });
        }
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) marks.push({ el, r, node });
    }
    return marks;
  }

  const overlap = (a, b) => ({
    x: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  });

  /** Inside something that moves with the viewport rather than the page. */
  function pinned(el) {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const position = getComputedStyle(a).position;
      if (position === "sticky" || position === "fixed") return true;
    }
    return false;
  }

  const hasPaint = (el) => {
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    return (
      (bg && bg !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(bg)) ||
      s.backgroundImage !== "none" ||
      parseFloat(s.borderTopWidth) + parseFloat(s.borderLeftWidth) > 0
    );
  };

  const positioned = (el) => /^(?:absolute|fixed)$/.test(getComputedStyle(el).position);

  /**
   * Whether `box` overflows with its own flow: a line of its text, or a descendant laid out in its
   * flow (not positioned, nor inside something positioned), reaching more than 8px past its bottom.
   */
  function inFlowOverflow(box) {
    const bottom = box.getBoundingClientRect().top + box.clientTop + box.clientHeight + 8;
    const range = document.createRange();
    const reaches = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.nodeValue.trim()) return false;
        range.selectNodeContents(node);
        return [...range.getClientRects()].some((r) => r.bottom > bottom);
      }
      if (!(node instanceof Element) || positioned(node)) return false;
      if (node.getClientRects().length > 0 && node.getBoundingClientRect().bottom > bottom) return true;
      return !(node instanceof SVGElement) && [...node.childNodes].some(reaches);
    };
    return [...box.childNodes].some(reaches);
  }

  const FIGURES = "svg, img, canvas, video";
  /**
   * What a figure draws as ground rather than ink: the sheet's grid, a plot's sheet-coloured field,
   * and its dashed guides, construction lines a label may break.
   */
  const BACKDROP = "[data-backdrop]";
  const SHAPES = "path, line, polyline, polygon, circle, ellipse, rect";

  const paints = (value) => value && value !== "none" && !/^rgba\([^)]*,\s*0\)$/.test(value) && value !== "transparent";

  /**
   * What of `figure`'s ink the rectangle `r` lies on, if any: the figure's box for a picture, video
   * or canvas; for an SVG, its text and its painted shapes, sampled every 1px: a 2px grid steps
   * clean over a 1px line (a dashed guide) when the line falls between its samples.
   */
  function inkCovered(r, figure, visible) {
    const box = figure.getBoundingClientRect();
    const o = overlap(r, box);
    if (o.x <= 3 || o.y <= 3) return undefined;
    if (!(figure instanceof SVGSVGElement)) return `${Math.round(o.x)}×${Math.round(o.y)}px`;
    const left = Math.max(r.left, box.left) + 1;
    const right = Math.min(r.right, box.right) - 1;
    const top = Math.max(r.top, box.top) + 1;
    const bottom = Math.min(r.bottom, box.bottom) - 1;
    const near = (b) => b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom;
    const texts = [...figure.querySelectorAll("text")]
      .filter((t) => !t.closest(BACKDROP) && visible(t))
      .map((t) => ({ t, b: t.getBoundingClientRect() }))
      .filter(({ b }) => near(b));
    // Text boxes carry their font's ascent and descent: 4px of slack, as for colliding text.
    for (const { t, b } of texts) {
      const to = overlap(r, b);
      if (to.x > 2 && to.y > 4) return `the label "${(t.textContent || "").trim().slice(0, 24)}"`;
    }
    const shapes = [...figure.querySelectorAll(SHAPES)]
      .filter((g) => !g.closest(BACKDROP) && !g.closest("defs, clipPath, mask, marker") && visible(g))
      .map((g) => {
        const style = getComputedStyle(g);
        return { g, stroke: paints(style.stroke), fill: paints(style.fill), m: g.getScreenCTM()?.inverse() };
      })
      .filter(({ g, stroke, fill, m }) => (stroke || fill) && m && near(g.getBoundingClientRect()));
    let hits = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        for (const { g, stroke, fill, m } of shapes) {
          const p = new DOMPoint(x, y).matrixTransform(m);
          if ((stroke && g.isPointInStroke(p)) || (fill && g.isPointInFill(p))) {
            if (++hits >= 2) return `its ${g.tagName} (${g.getAttribute("class") || "drawn ink"})`;
            break;
          }
        }
      }
    }
    return undefined;
  }

  /** The layout and text checks on the page as it is now. */
  function scan() {
    const visible = makeVisibility();
    const layout = [];
    const text = [];
    const add = (list, kind, detail, el) => list.push({ kind, detail, trap: trapOf(el) });
    const root = document.documentElement;
    const coverage = { texts: 0, figures: 0, formulas: document.querySelectorAll(".katex").length };

    // page-scroll
    if (root.scrollWidth > root.clientWidth + 1)
      add(
        layout,
        "page-scroll",
        `the page scrolls sideways: ${root.scrollWidth}px wide in a ${root.clientWidth}px viewport`,
      );

    const marks = textMarks(visible);
    coverage.texts = new Set(marks.map((m) => m.node)).size;

    // tiny-text: every drawn text node at its drawn size.
    const sized = new Set();
    for (const { el, node } of marks) {
      if (sized.has(node)) continue;
      sized.add(node);
      const owner = node.parentElement;
      const px = drawnFontSize(owner);
      if (px < FLOOR_PX - 0.05)
        add(layout, "tiny-text", `${describe(owner)} is drawn at ${px.toFixed(1)}px, under the 12px floor`, el);
    }

    // above-viewport: anything drawn above the top of the page.
    for (const { el, r } of marks) {
      if (r.top + scrollY < -2) {
        add(layout, "above-viewport", `${describe(el)} sits ${Math.round(-(r.top + scrollY))}px above the page`, el);
        break;
      }
    }

    // text-collision: two elements' text on the same pixels. A line rect includes leading, so
    // HTML pairs need 4px of vertical overlap; SVG text rects are tight, so 2px.
    const sorted = [...marks].sort((a, b) => a.r.top - b.r.top);
    const collided = new Set();
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.r.top >= a.r.bottom - 2) break;
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (a.el.closest(ALLOW_OVERLAP) || b.el.closest(ALLOW_OVERLAP)) continue;
        // A pinned bar passes over the page's content as it scrolls: by design.
        if (pinned(a.el) !== pinned(b.el)) continue;
        const o = overlap(a.r, b.r);
        const svgPair = a.el instanceof SVGElement && b.el instanceof SVGElement;
        if (o.x > 2 && o.y > (svgPair ? 2 : 4)) {
          const key = `${describe(a.el)}|${describe(b.el)}`;
          if (collided.has(key)) continue;
          collided.add(key);
          add(
            layout,
            "text-collision",
            `${describe(a.el)} and ${describe(b.el)} overlap by ${Math.round(o.x)}×${Math.round(o.y)}px`,
            a.el.closest("[data-trap]") ? a.el : b.el,
          );
        }
      }
    }

    // covers-figure: anything positioned over a figure's ink. A figure's own labels sit on its
    // blank ground by design; one laid on a trace, a tick or a point covers it (value chips buried
    // the traces they annotated). An SVG is judged by its drawn strokes and fills, sampled, with
    // the sheet's grid as backdrop; a picture, video or canvas by its whole box.
    // A deliberate overlay (the red pen's ring round an iterate) is skipped as a pair, whichever
    // of the two lies on top.
    const figures = [...document.querySelectorAll(FIGURES)].filter(
      (f) =>
        !f.closest(".katex") &&
        !f.closest(ALLOW_OVERLAP) &&
        !(f instanceof SVGElement && f.ownerSVGElement) &&
        visible(f),
    );
    coverage.figures = figures.length;
    for (const el of document.body.querySelectorAll("*")) {
      const position = getComputedStyle(el).position;
      if (position !== "absolute" && position !== "fixed") continue;
      if (el.closest(".katex") || el.closest(ALLOW_OVERLAP) || el.closest("dialog") || !visible(el)) continue;
      if (el instanceof SVGElement && el.ownerSVGElement) continue;
      const ink = [];
      if (el.matches(FIGURES) || hasPaint(el)) ink.push(el.getBoundingClientRect());
      else for (const m of marks) if (el.contains(m.node.parentElement) && !m.el.closest(ALLOW_OVERLAP)) ink.push(m.r);
      if (ink.length === 0) continue;
      for (const figure of figures) {
        if (figure === el || figure.contains(el) || el.contains(figure)) continue;
        const covered = ink.map((r) => inkCovered(r, figure, visible)).find((c) => c);
        if (covered) {
          add(layout, "covers-figure", `${describe(el)} covers ${covered} of ${describe(figure)}`, el);
          break;
        }
      }
    }

    // height-overflow: a box whose content is taller than the box. Font metrics can run a few px
    // past a line box, so 8px of slack; a row that wrapped when it shouldn't is tens. Only content
    // in the box's flow counts: a positioned mark hung over its edge (the red pen's high-yield
    // ring round a sheet number) is drawn there on purpose.
    for (const el of document.body.querySelectorAll("*")) {
      if (el instanceof SVGElement || el.closest(".katex") || NOT_TEXT.has(el.tagName)) continue;
      if (/^(?:VIDEO|AUDIO|IMG|CANVAS|IFRAME|INPUT|TEXTAREA|SELECT|DIALOG)$/.test(el.tagName)) continue;
      if (el.clientHeight === 0 || el.scrollHeight <= el.clientHeight + 8) continue;
      const style = getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll" || !visible(el)) continue;
      if (!inFlowOverflow(el)) continue;
      add(
        layout,
        "height-overflow",
        `${describe(el)} holds ${el.scrollHeight}px of content in a ${el.clientHeight}px box`,
        el,
      );
    }

    // The live page's text: what the islands rendered once they hydrated, not the server's HTML.
    for (const el of document.querySelectorAll(".katex-error")) {
      if (visible(el))
        add(text, "katex-error", `a KaTeX error on the page: ${el.getAttribute("title") || describe(el)}`, el);
    }
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const value = node.nodeValue || "";
      const el = node.parentElement;
      if (!value.trim() || !el || NOT_TEXT.has(el.tagName) || el.closest(".katex") || !visible(el)) continue;
      const raw = RAW_TEX.exec(value);
      if (raw && !el.closest(".katex-error")) add(text, "raw-tex", `raw TeX on the page: ${quote(value)}`, el);
      for (const { kind, what, pattern } of COPY_DEFECTS)
        if (pattern.test(value)) add(text, kind, `${what} on the page: ${quote(value)}`, el);
    }
    return { layout, text, coverage };
  }

  /**
   * One sweep at the current width: every collapsible open, then the page as loaded and in every
   * other tab of each visible tab list (the plot behind a Worked example's Table | Plot tabs).
   */
  async function sweep() {
    const opened = expandAll();
    await settle();
    const results = [scan()];
    let views = 1;
    for (const list of document.querySelectorAll('[role="tablist"]')) {
      const tabs = [...list.querySelectorAll('[role="tab"]')].filter((t) => t.checkVisibility() && !t.disabled);
      const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true");
      for (const tab of tabs) {
        if (tab === selected) continue;
        tab.click();
        expandAll();
        await settle();
        results.push(scan());
        views += 1;
      }
      if (selected) {
        selected.click();
        await settle();
      }
    }
    const coverage = { collapsibles: opened, views, texts: 0, figures: 0, formulas: 0 };
    for (const r of results)
      for (const key of ["texts", "figures", "formulas"]) coverage[key] = Math.max(coverage[key], r.coverage[key]);
    return {
      layout: results.flatMap((r) => r.layout),
      text: results.flatMap((r) => r.text),
      coverage,
      collapsiblesOnPage: document.querySelectorAll("details").length,
    };
  }

  window.__lpSweep = { sweep, scan, expandAll, settle };
})();
