// How a 3D viewer starts without ever holding up the page's scroll (story 86, DESIGN.md Live 3D
// Viewers). Starting three.js is main-thread work: loading it, making the WebGL context, building the
// object, compiling the first frame. A browser serves a wheel or a swipe from the same thread when
// the page is busy (WebKit does so almost always), so a start that begins while a student is scrolling
// holds the scroll up, and on a loaded phone or runner for seconds.
//
// So a viewer starts in slices, and takes each one only while the page is quiet: it waits until nothing
// has scrolled, touched or pressed a key for `QUIET_MS`, and it yields to the browser between slices, so
// an event that came during a slice is served before the next one begins and puts the viewer back to
// waiting. Nothing here adds an event listener that can cancel a scroll: all of them are passive.

/** The page has to have stayed this still before a slice of the start begins. */
export const QUIET_MS = 500;

/**
 * How long still to wait before the page has been quiet for `quiet`: 0 when it has. Pure (the clock
 * is passed in), so the rule is tested without a browser.
 */
export function quietIn(lastActivity: number, now: number, quiet: number = QUIET_MS): number {
  return Math.max(0, lastActivity + quiet - now);
}

/** When the page was last scrolled, touched or typed on (`performance.now()` time), shared by every viewer. */
let lastActivity = -Infinity;
let watching = false;

function watch(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const mark = () => {
    lastActivity = performance.now();
  };
  // Capturing, so a scroll of any box on the page counts (scroll doesn't bubble). Passive: never a reason for
  // the browser to wait on this page before it scrolls.
  const options = { passive: true, capture: true } as const;
  for (const type of ["scroll", "touchstart", "touchmove", "pointerdown", "keydown"] as const)
    window.addEventListener(type, mark, options);
}

// Listening from the moment a viewer's island loads, so the scroll that brought it near counts.
watch();

/** Gives the browser the thread, so input that arrived is served first (`scheduler.yield` where there is one). */
export function yieldToInput(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Resolves once the page has been quiet for `quiet` ms, after yielding to input. Resolves `false` when
 * `cancelled()` says the viewer left in the meantime (nothing more to start).
 */
export async function whenQuiet(cancelled: () => boolean, quiet: number = QUIET_MS): Promise<boolean> {
  watch();
  await yieldToInput();
  for (;;) {
    if (cancelled()) return false;
    const wait = quietIn(lastActivity, performance.now(), quiet);
    if (wait === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
