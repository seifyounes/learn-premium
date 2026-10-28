// The pneumatic sim where students meet it: inline in its Worked example (W12.1), in the Lab and in
// the Tool gallery, on the built Fixture Course; then in a real browser (Chromium): Press S and step
// the cascade through its captions, the live diagram inking itself over the key, playing in real time,
// Hold S cycling, reduced motion stopping the clock, and on a phone drawn at its own size with every
// text 12px or more and every control 44px square.
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "12-cascade";
const build = buildCourse(FIXTURE_COURSE);

/** The `<article>` holding a Worked example (by its code) on a built page. */
const articleOf = (page: string, code: string) =>
  page.split('<article class="mbe-10"').find((a) => a.includes(`&quot;code&quot;:[0,&quot;${code}&quot;]`)) ?? "";

/** What the page's caption says after Press S and each Step, in the order of the cycle. */
const CAPTIONS = [
  "S pressed: CV shifts to 14; line I on, line II off; VA shifts to 14; A extends (A+); S let go",
  "A out: a1 made; VB shifts to 14; B extends (B+)",
  "B out: b1 made; CV shifts to 12; line I off, line II on; VB shifts to 12; B retracts (B−)",
  "B back: b0 made; VA shifts to 12; A retracts (A−)",
  "A back: a0 made; back at rest, the cycle is done",
];
const REST = "At rest: line II on. Press S to run A+ B+ B− A−.";

describe("the pneumatic sim on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sits below W12.1 on its Module's page, once in the Lab and once in the gallery", () => {
    const card = `id="sim-${MODULE}-cascade"`;
    const article = articleOf(build.page(MODULE), "W12.1");
    expect(article).toContain(card);
    expect(article).toContain('data-sim-kind="pneumatic"');
    expect(build.page("lab").match(new RegExp(card, "g"))).toHaveLength(1);
    expect(build.page("tool-gallery").match(new RegExp(card, "g"))).toHaveLength(1);
  });

  it("is a client:visible island with every control off until it hydrates", () => {
    const article = articleOf(build.page(MODULE), "W12.1");
    expect(article).toMatch(/component-url="\/_astro\/PneumaticSim\.[^"]+\.js"[^>]*client="visible"/);
    // The sim's own section: the Worked example around it has its own buttons.
    const sim = article.slice(article.indexOf('class="sim pneumatic-sim"'));
    const buttons = [...sim.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => /note-button/.test(b));
    // Press S, Hold S, Step, Pause and Reset.
    expect(buttons).toHaveLength(5);
    for (const button of buttons) expect(button).toContain("disabled");
    expect(article).toContain('data-sim="pneumatic"');
    expect(article).not.toContain("data-viewer");
  });

  it("draws the figure at build: every part labelled, A's marks, control lines dashed, working lines not", () => {
    const article = articleOf(build.page(MODULE), "W12.1");
    expect(article).toMatch(/<svg class="schematic" width="\d+" height="\d+"/);
    for (const label of ["A", "B", "VA", "VB", "CV", "a0", "a1", "b0", "b1", "S"])
      expect(article).toContain(`>${label}</text>`);
    // A's two marks, set over its stroke-end ticks, are values (notes), never labels.
    expect(article.match(/class="schematic-label schematic-note"[^>]*>(a0|a1)</g)).toHaveLength(2);
    const wires = [...article.matchAll(/<polyline class="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(wires.some((c) => c.includes("is-pilot"))).toBe(true);
    // The pencil wires of working lines (the cylinder ports and the supply) are drawn solid.
    expect(wires.filter((c) => c === "schematic-wire").length).toBeGreaterThan(0);
  });

  it("opens inked on exactly the lines the cascade holds at rest, every spool on its 12 side", () => {
    const article = articleOf(build.page(MODULE), "W12.1");
    const inked = [...article.matchAll(/class="[^"]*is-high[^"]*"[^>]*data-net="([^"]+)"/g)].map((m) => m[1]);
    expect([...new Set(inked)].sort()).toEqual(["Arod", "Brod", "II", "P", "a0out", "b0out"]);
    // A working line is never drawn dashed, even inked.
    for (const m of article.matchAll(/<polyline class="([^"]*)"[^>]*data-net="(Acap|Arod|Bcap|Brod|P)"/g))
      expect(m[1]).not.toContain("is-pilot");
    for (const valve of ["VA", "VB", "CV"])
      expect(article).toMatch(
        new RegExp(`data-spool="${valve}"[^>]*data-side="12"|data-side="12"[^>]*data-spool="${valve}"`),
      );
  });

  it("has the diagram's four rows in pencil over the key, nothing run yet, and the rest caption", () => {
    const article = articleOf(build.page(MODULE), "W12.1");
    expect(article.match(/data-key-row="/g)).toHaveLength(4);
    const live = [...article.matchAll(/data-live-row="[^"]+"[^>]*d="([^"]*)"|d="([^"]*)"[^>]*data-live-row="/g)];
    expect(live).toHaveLength(4);
    for (const m of live) expect(m[1] ?? m[2] ?? "").toBe("");
    expect(article.match(/data-step-box="/g)).toHaveLength(5);
    const caption = /data-caption[^>]*>([^<]*)</.exec(article)?.[1];
    expect(caption).toBe(REST);
  });
});

describe("the pneumatic sim in a browser", () => {
  let site: Awaited<ReturnType<typeof serve>>;
  let browser: Browser;

  beforeAll(async () => {
    site = await serve(build.outDir);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await site?.close();
  });

  /** A fresh tab on the cascade page, hydrated, with its console watched. */
  async function open(options: { width?: number; height?: number; touch?: boolean; reduced?: boolean } = {}) {
    const context = await browser.newContext({
      viewport: { width: options.width ?? 1280, height: options.height ?? 800 },
      hasTouch: options.touch ?? false,
      ...(options.reduced ? { reducedMotion: "reduce" as const } : {}),
    });
    const tab = await context.newPage();
    const errors: string[] = [];
    tab.on("pageerror", (e) => errors.push(e.message));
    tab.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await tab.goto(`${site.url}/${MODULE}/`);
    const sim = tab.locator('[data-sim="pneumatic"]').first();
    await sim.scrollIntoViewIfNeeded();
    await tab.locator('[data-sim="pneumatic"][data-ready="true"]').first().waitFor();
    return { context, tab, sim, errors };
  }
  const attr = (sim: ReturnType<Page["locator"]>, name: string) => sim.getAttribute(name);
  const caption = (sim: ReturnType<Page["locator"]>) => sim.locator("[data-caption]").innerText();

  it("steps through the cycle with its captions: Press S, then Step four times", async () => {
    // Under reduced motion no clock runs, so each Step is the only thing that moves the circuit.
    const { context, sim, errors } = await open({ reduced: true });
    expect(await caption(sim)).toBe(REST);
    await sim.getByRole("button", { name: "Press S" }).click();
    await expect.poll(() => caption(sim)).toBe(CAPTIONS[0]);
    for (const [i, text] of CAPTIONS.slice(1).entries()) {
      // Step moves exactly to the next stroke end, whatever the clock has done.
      await sim.getByRole("button", { name: "Step" }).click();
      await expect.poll(() => caption(sim), { message: `after step ${i + 2}` }).toBe(text);
    }
    expect(await attr(sim, "data-step")).toBe("5");
    expect(await attr(sim, "data-still")).toBe("true");
    expect(await attr(sim, "data-cycles")).toBe("1");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("inks the live diagram over the key: each live path equals its key path once the cycle is run", async () => {
    const { context, sim } = await open({ reduced: true });
    await sim.getByRole("button", { name: "Press S" }).click();
    for (let i = 0; i < 4; i++) await sim.getByRole("button", { name: "Step" }).click();
    await expect.poll(() => attr(sim, "data-step")).toBe("5");
    const paths = await sim.locator("[data-key-row]").evaluateAll((keys) =>
      keys.map((k) => {
        const id = k.getAttribute("data-key-row");
        const live = k.parentElement?.querySelector(`[data-live-row="${id}"]`);
        return { id, key: k.getAttribute("d"), live: live?.getAttribute("d") };
      }),
    );
    expect(paths.map((p) => p.id)).toEqual(["A", "B", "I", "II"]);
    for (const p of paths) {
      expect(p.key, p.id ?? "").not.toBe("");
      expect(p.live, p.id ?? "").toBe(p.key);
    }
    await context.close();
  });

  it("plays in real time: the piston travels, Pause holds it", async () => {
    const { context, sim } = await open();
    await sim.getByRole("button", { name: "Press S" }).click();
    const travel = async () => Number(await sim.locator('[data-piston="A"]').getAttribute("data-travel"));
    await expect.poll(travel, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(travel).toBeLessThan(1);
    await sim.getByRole("button", { name: "Pause" }).click();
    const held = await travel();
    await new Promise((r) => setTimeout(r, 300));
    expect(await travel()).toBe(held);
    await sim.getByRole("button", { name: "Resume" }).click();
    await expect.poll(travel, { timeout: 10_000 }).toBeGreaterThan(held);
    await context.close();
  });

  it("Hold S keeps it cycling until it is let go; Reset is disabled again at rest", async () => {
    const { context, sim } = await open();
    const hold = sim.getByRole("button", { name: "Hold S" });
    await hold.click();
    expect(await hold.getAttribute("aria-pressed")).toBe("true");
    await expect.poll(() => attr(sim, "data-cycles"), { timeout: 10_000 }).not.toBe("0");
    // Another cycle has begun by itself: the circuit isn't still.
    expect(await attr(sim, "data-still")).toBe("false");
    await hold.click();
    expect(await hold.getAttribute("aria-pressed")).toBe("false");
    // Let go, it runs out the cycle in hand and stops back at rest.
    await expect.poll(() => attr(sim, "data-still"), { timeout: 10_000 }).toBe("true");
    const reset = sim.getByRole("button", { name: "Reset" });
    await reset.click();
    expect(await caption(sim)).toBe(REST);
    expect(await reset.isDisabled()).toBe(true);
    await context.close();
  });

  it("reduced motion stops the clock where it is", async () => {
    const { context, tab, sim } = await open();
    await sim.getByRole("button", { name: "Press S" }).click();
    const travel = async () => Number(await sim.locator('[data-piston="A"]').getAttribute("data-travel"));
    await expect.poll(travel, { timeout: 10_000 }).toBeGreaterThan(0);
    await tab.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => attr(sim, "data-reduced")).toBe("true");
    const t1 = await travel();
    await new Promise((r) => setTimeout(r, 500));
    expect(await travel()).toBe(t1);
    expect(await sim.getByRole("button", { name: "Pause" }).isDisabled()).toBe(true);
    await context.close();
  });

  it("opened under reduced motion it never plays, and Step moves a whole stroke", async () => {
    const { context, sim } = await open({ reduced: true });
    expect(await attr(sim, "data-reduced")).toBe("true");
    await sim.getByRole("button", { name: "Press S" }).click();
    await new Promise((r) => setTimeout(r, 600));
    const piston = sim.locator('[data-piston="A"]');
    expect(await piston.getAttribute("data-travel")).toBe("0.000");
    await sim.getByRole("button", { name: "Step" }).click();
    await expect.poll(() => piston.getAttribute("data-travel")).toBe("1.000");
    expect(await sim.getByText("Motion is reduced: Step moves each cylinder its whole stroke at once.").count()).toBe(
      1,
    );
    await context.close();
  });

  it("on a phone: drawn at its own size, every text at 12px or more, every control 44px square, the circuit scrolling inside its box", async () => {
    const { context, tab, sim, errors } = await open({ width: 375, height: 812, touch: true });
    // The schematic is drawn at its own width, never scaled to fit.
    const drawn = await sim.locator("svg.schematic").evaluate((svg) => ({
      width: svg.getBoundingClientRect().width,
      attribute: Number(svg.getAttribute("width")),
    }));
    expect(drawn.width).toBeCloseTo(drawn.attribute, 0);
    // Every text in the sim draws at 12px or more, as the browser gates measure it.
    const small = await sim.locator("svg text").evaluateAll((texts) =>
      texts.flatMap((t) => {
        const el = t as SVGTextElement;
        const m = el.getScreenCTM();
        const px =
          Number(el.getAttribute("font-size") ?? getComputedStyle(el).fontSize.replace("px", "")) *
          Math.hypot(m?.b ?? 0, m?.d ?? 1);
        return px < 12 ? [`${el.textContent}: ${px.toFixed(1)}px`] : [];
      }),
    );
    expect(small).toEqual([]);
    const boxes = await sim.locator(".pneumatic-controls button").evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { name: b.textContent, w: r.width, h: r.height };
      }),
    );
    expect(boxes).toHaveLength(5);
    for (const b of boxes) {
      expect(b.w, `${b.name} width`).toBeGreaterThanOrEqual(44);
      expect(b.h, `${b.name} height`).toBeGreaterThanOrEqual(44);
    }
    // Both drawings scroll sideways inside their boxes; the page itself doesn't.
    for (const stage of await sim.locator(".logic-stage").all())
      expect(await stage.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeGreaterThan(0);
    expect(await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await context.close();
  });
});
