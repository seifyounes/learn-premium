// The Module page's own script: the section rail marks the sections done and the one being read,
// and the page records what counts as done for Watch (a video or audio played to its end, or a
// YouTube card played) and Summary (read to its last beat). Worked examples and Practice record
// their own progress from their islands.
import { doneSections, markSummaryRead, markWatched, SECTIONS, type PageShape, type Section } from "./progress.ts";
import { onProgress, readProgress, updateProgress } from "./store.ts";

const isSection = (value: string | undefined): value is Section => (SECTIONS as readonly unknown[]).includes(value);

function start(page: HTMLElement) {
  const module = page.dataset.module ?? "";
  const shape = JSON.parse(page.dataset.shape ?? "{}") as PageShape;
  const links = [...page.querySelectorAll<HTMLAnchorElement>("a[data-rail-link]")];

  // A section already done when the page opens is ticked at once; one done while reading is drawn.
  const paintDone = (draw: boolean) => {
    const done = doneSections(readProgress().modules[module], shape);
    for (const link of links) {
      const section = link.dataset.section;
      const isDone = isSection(section) && done.has(section);
      if (isDone && !link.hasAttribute("data-done")) link.toggleAttribute("data-draw", draw);
      link.toggleAttribute("data-done", isDone);
    }
  };
  paintDone(false);
  onProgress(() => paintDone(true));

  const watched = () => updateProgress((p) => markWatched(p, module));
  for (const player of page.querySelectorAll<HTMLMediaElement>("video, audio")) {
    player.addEventListener("ended", watched);
  }
  page.addEventListener("learn-premium:video-card-played", watched);

  const summaryEnd = page.querySelector("[data-summary-end]");
  if (summaryEnd) {
    const read = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      read.disconnect();
      updateProgress((p) => markSummaryRead(p, module));
    });
    read.observe(summaryEnd);
  }

  // The section being read: the last one whose top has passed the upper third of the screen.
  const sections = links
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter((s): s is HTMLElement => s !== null);
  const paintCurrent = () => {
    const line = window.innerHeight / 3;
    const current = sections.filter((s) => s.getBoundingClientRect().top <= line).pop() ?? sections[0];
    for (const link of links) {
      if (link.hash === `#${current?.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paintCurrent();
    });
  };
  paintCurrent();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
}

const page = document.querySelector<HTMLElement>("[data-module-page]");
if (page) start(page);
