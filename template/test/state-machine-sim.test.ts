// The state-machine sims where students meet them: inline in their Worked examples (W14.1, W14.2),
// in the Lab and in the Tool gallery, on the built Fixture Course; then in a real browser (Chromium):
// Clock the '101' detector and the drill's GRAFCET through their examples with their captions, the token
// travelling the taken edge, the table's row and the equations following, the timing strip growing over
// the key, a toggle deviating from the example, reduced motion jumping the token, and on a phone drawn
// at its own size with every text 12px or more and every control 44px square.
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCourse, FIXTURE_COURSE } from "./build-course";
import { serve } from "./serve";

const MODULE = "14-state-machines";
const build = buildCourse(FIXTURE_COURSE);

/** A Worked example's article on a built page, with the sim card that follows it up to the next example. */
const articleOf = (page: string, code: string) => {
  const start = page.indexOf(`<article id="worked-${code}"`);
  const next = page.indexOf('<article id="worked-', start + 1);
  return start < 0 ? "" : page.slice(start, next < 0 ? undefined : next);
};

/** One state's group in a built article: from its `data-state` to the next state's. */
const stateGroup = (article: string, id: string) => {
  const start = article.indexOf(`data-state="${id}"`);
  const next = article.indexOf('data-state="', start + 1);
  return article.slice(start, next < 0 ? undefined : next);
};

const DETECTOR_OPENING = "S0 at reset, z = 0. Set x and press Clock.";
const DETECTOR = [
  "Clock 1: x = 0 takes S0 to S0.",
  "Clock 2: x = 1 takes S0 to S1.",
  "Clock 3: x = 1 takes S1 to S1.",
  "Clock 4: x = 0 takes S1 to S2.",
  "Clock 5: x = 1 takes S2 to S3; z = 1.",
  "Clock 6: x = 0 takes S3 to S2; z = 0.",
  "Clock 7: x = 1 takes S2 to S3; z = 1.",
  "Clock 8: x = 0 takes S3 to S2; z = 0.",
  "Clock 9: x = 0 takes S2 to S0. The example's 9 clocks are done.",
];
const DRILL_OPENING = "Step 0 active at the start. Set m, a and b and press Clock.";
const DRILL = [
  "Clock 1: no receptivity holds; step 0 stays active.",
  "Clock 2: m·a holds, so step 0 → step 1 fires; KM1 = 1.",
  "Clock 3: no receptivity holds; step 1 stays active.",
  "Clock 4: no receptivity holds; step 1 stays active.",
  "Clock 5: b holds, so step 1 → step 2 fires; KM1 = 0, KM2 = 1.",
  "Clock 6: no receptivity holds; step 2 stays active.",
  "Clock 7: no receptivity holds; step 2 stays active.",
  "Clock 8: a holds, so step 2 → step 0 fires; KM2 = 0.",
  "Clock 9: no receptivity holds; step 0 stays active. The example's 9 clocks are done.",
];

describe("the state-machine sims on the built pages", () => {
  it("builds", () => {
    expect(build.ok, build.output).toBe(true);
  });

  it("sit below W14.1 and W14.2 on their Module's page, once in the Lab and once in the gallery", () => {
    for (const [name, code, kind] of [
      ["detector", "W14.1", "fsm"],
      ["drill", "W14.2", "grafcet"],
    ] as const) {
      const card = `id="sim-${MODULE}-${name}"`;
      const article = articleOf(build.page(MODULE), code);
      expect(article, code).toContain(card);
      expect(article, code).toContain(`data-sim-kind="${kind}"`);
      expect(build.page("lab").match(new RegExp(card, "g"))).toHaveLength(1);
      expect(build.page("tool-gallery").match(new RegExp(card, "g"))).toHaveLength(1);
    }
  });

  it("are client:visible islands with every control off until they hydrate", () => {
    for (const [code, buttons] of [
      ["W14.1", 3],
      ["W14.2", 5],
    ] as const) {
      const article = articleOf(build.page(MODULE), code);
      expect(article).toMatch(/component-url="\/_astro\/StateMachineSim\.[^"]+\.js"[^>]*client="visible"/);
      const sim = article.slice(article.indexOf('class="sim state-machine-sim"'));
      const found = [...sim.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => /note-button/.test(b));
      // The inputs, Clock and Reset.
      expect(found, code).toHaveLength(buttons);
      for (const button of found) expect(button).toContain("disabled");
      expect(article).not.toContain("data-viewer");
    }
  });

  it("draw the detector at build: four states, the accepting one a double circle, eight edges and labels, one start arrow", () => {
    const article = articleOf(build.page(MODULE), "W14.1");
    expect(article).toMatch(/<svg class="schematic state-diagram" width="\d+" height="\d+"/);
    for (const label of ["S0/0", "S1/0", "S2/0", "S3/1"]) expect(article).toContain(`>${label}</text>`);
    const circles = (id: string) => stateGroup(article, id).match(/class="schematic-circle"/g)?.length;
    expect([circles("S0"), circles("S1"), circles("S2"), circles("S3")]).toEqual([1, 1, 1, 2]);
    expect(article.match(/data-edge="\d+"/g)).toHaveLength(8);
    expect(article.match(/class="schematic-label diagram-edge-label"/g)).toHaveLength(8);
    expect(article.match(/data-start/g)).toHaveLength(1);
    // The loops sit where the hints put them: S0's below its centre, S1's above.
    const centre = (id: string) => {
      const m = /translate\(([\d.]+) ([\d.]+)\)/.exec(stateGroup(article, id));
      return { x: Number(m?.[1]), y: Number(m?.[2]) };
    };
    const edges = [...article.matchAll(/<g data-edge="(\d+)"[^>]*><path class="diagram-edge" d="([^"]+)"/g)];
    const apexY = (index: number) => {
      const numbers = (edges[index]?.[2] ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
      // M x0 y0 C x1 y1 x2 y2 x3 y3: the cubic's middle in y.
      const [, y0 = 0, , y1 = 0, , y2 = 0, , y3 = 0] = numbers;
      return (y0 + 3 * y1 + 3 * y2 + y3) / 8;
    };
    expect(apexY(0)).toBeGreaterThan(centre("S0").y + 40);
    expect(apexY(2)).toBeLessThan(centre("S1").y - 40);
  });

  it("have their strip's rows in pencil over the key, nothing run yet, and the opening caption", () => {
    const detector = articleOf(build.page(MODULE), "W14.1");
    const drill = articleOf(build.page(MODULE), "W14.2");
    for (const [article, rows, opening] of [
      [detector, 4, DETECTOR_OPENING],
      [drill, 8, DRILL_OPENING],
    ] as const) {
      expect(article.match(/data-key-row="/g)).toHaveLength(rows);
      const live = [...article.matchAll(/data-live-row="[^"]+"[^>]*d="([^"]*)"|d="([^"]*)"[^>]*data-live-row="/g)];
      expect(live).toHaveLength(rows);
      for (const m of live) expect(m[1] ?? m[2] ?? "").toBe("");
      expect(article.match(/data-step-box="/g)).toHaveLength(10);
      expect(/data-caption[^>]*>([^<]*)</.exec(article)?.[1]).toBe(opening);
    }
    for (const name of ["D1", "D0", "z"]) expect(detector).toContain(`data-equation="${name}"`);
  });

  it("draw the drill's GRAFCET: the initial step a double square, the actions in boxes beside steps 1 and 2", () => {
    const article = articleOf(build.page(MODULE), "W14.2");
    expect(stateGroup(article, "X0")).toContain("M-16 -16H16V16H-16Z");
    expect(stateGroup(article, "X1")).not.toContain("M-16 -16H16V16H-16Z");
    expect(article.match(/class="diagram-action-box"/g)).toHaveLength(2);
    expect(article).toContain(">KM1</text>");
    expect(article).toContain(">KM2</text>");
    expect(article.match(/data-edge="\d+"/g)).toHaveLength(3);
    expect(article.match(/class="diagram-bar"/g)).toHaveLength(3);
  });
});

describe("the state-machine sims in a browser", () => {
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

  /** A fresh tab on the Module's page, the sim hydrated, with its console watched. */
  async function open(
    kind: "fsm" | "grafcet",
    options: { width?: number; height?: number; touch?: boolean; reduced?: boolean } = {},
  ) {
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
    const sim = tab.locator(`[data-sim="${kind}"]`).first();
    await sim.scrollIntoViewIfNeeded();
    await tab.locator(`[data-sim="${kind}"][data-ready="true"]`).first().waitFor();
    return { context, tab, sim, errors };
  }
  type Sim = ReturnType<Page["locator"]>;
  const attr = (sim: Sim, name: string) => sim.getAttribute(name);
  const caption = (sim: Sim) => sim.locator("[data-caption]").innerText();
  const clock = (sim: Sim) => sim.getByRole("button", { name: "Clock", exact: true });
  /** Clocks once and waits for the token to arrive. */
  async function tick(sim: Sim, period: number) {
    await clock(sim).click();
    await expect.poll(() => attr(sim, "data-period")).toBe(String(period));
    await expect.poll(() => attr(sim, "data-travelling"), { timeout: 5_000 }).toBe("false");
  }

  it("the detector clocks through its example with its captions", async () => {
    const { context, sim, errors } = await open("fsm");
    expect(await caption(sim)).toBe(DETECTOR_OPENING);
    for (const [i, text] of DETECTOR.entries()) {
      await tick(sim, i + 1);
      expect(await caption(sim), `after Clock ${i + 1}`).toBe(text);
    }
    expect(await attr(sim, "data-period")).toBe("9");
    expect(await clock(sim).isDisabled()).toBe(true);
    expect(await sim.locator(".machine-controls .sim-readout").last().innerText()).toBe("All 9 periods clocked");
    expect(errors).toEqual([]);
    await context.close();
  });

  it("the token travels the taken edge", async () => {
    const { context, sim } = await open("fsm");
    await tick(sim, 1);
    await clock(sim).click();
    // Clock 2 takes edge 1, S0 → S1: the token is seen strictly between its ends, on the edge's curve.
    const seen = await sim.evaluate(async (root) => {
      const readings: { t: number; edge: string | null; distance: number }[] = [];
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline) {
        const token = root.querySelector("[data-travel]");
        if (token) {
          const t = Number(token.getAttribute("data-travel"));
          const edge = token.getAttribute("data-travel-edge");
          const path = root.querySelector(`[data-edge="${edge}"] path.diagram-edge`) as SVGPathElement | null;
          const cx = Number(token.getAttribute("cx"));
          const cy = Number(token.getAttribute("cy"));
          let distance = Infinity;
          if (path)
            for (let at = 0; at <= path.getTotalLength(); at += 2) {
              const p = path.getPointAtLength(at);
              distance = Math.min(distance, Math.hypot(p.x - cx, p.y - cy));
            }
          readings.push({ t, edge, distance });
          if (t > 0.2 && t < 0.8) break;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return readings.at(-1);
    });
    expect(seen?.edge).toBe("1");
    expect(seen?.t).toBeGreaterThan(0);
    expect(seen?.t).toBeLessThan(1);
    expect(seen?.distance).toBeLessThanOrEqual(2);
    await expect.poll(() => attr(sim, "data-travelling")).toBe("false");
    expect(await attr(sim, "data-active")).toBe("S1");
    await context.close();
  });

  it("the table's row and the equations follow", async () => {
    const { context, sim } = await open("fsm");
    for (let k = 1; k <= 4; k++) await tick(sim, k);
    // After four Clocks the machine is in S2, with x = 0 shown for period 5... the example's fifth bit is 1.
    expect(await attr(sim, "data-active")).toBe("S2");
    const row = sim.locator('tr[data-row="S2"]');
    expect(await row.getAttribute("data-current")).toBe("true");
    const cell = sim.locator('[data-cell="S2:1"]');
    expect(await cell.getAttribute("data-next")).toBe("true");
    expect(await cell.innerText()).toBe("S3");
    // D1 = Q0·x' + Q1·Q0'·x: in S2 (Q1 Q0 = 10) with x = 1, only the second term is true.
    expect(await sim.locator('[data-equation="D1"] [data-term="0"]').getAttribute("data-true")).toBeNull();
    expect(await sim.locator('[data-equation="D1"] [data-term="1"]').getAttribute("data-true")).toBe("true");
    const value = (name: string) => sim.locator(`[data-equation="${name}"] [data-value]`).innerText();
    expect([await value("D1"), await value("D0"), await value("z")]).toEqual(["= 1", "= 1", "= 0"]);
    await context.close();
  });

  it("the live strip grows over the key", async () => {
    const { context, sim } = await open("fsm");
    for (let k = 1; k <= 9; k++) await tick(sim, k);
    const paths = await sim.locator("[data-key-row]").evaluateAll((keys) =>
      keys.map((k) => {
        const id = k.getAttribute("data-key-row");
        const live = k.parentElement?.querySelector(`[data-live-row="${id}"]`);
        return { id, key: k.getAttribute("d"), live: live?.getAttribute("d") };
      }),
    );
    expect(paths.map((p) => p.id)).toEqual(["x", "Q1", "Q0", "z"]);
    for (const p of paths) {
      expect(p.key, p.id ?? "").not.toBe("");
      expect(p.live, p.id ?? "").toBe(p.key);
    }
    await context.close();
  });

  it("a toggle deviates from the example; Reset puts everything back and is disabled again", async () => {
    const { context, sim } = await open("fsm");
    const toggle = sim.getByRole("button", { name: /^x \d$/ });
    const reset = sim.getByRole("button", { name: "Reset", exact: true });
    expect(await reset.isDisabled()).toBe(true);
    await toggle.click();
    expect(await toggle.getAttribute("aria-pressed")).toBe("true");
    expect(await reset.isDisabled()).toBe(false);
    await tick(sim, 1);
    expect(await caption(sim)).toBe("Clock 1: x = 1 takes S0 to S1.");
    // The live x row's first interval is high where the key's is low.
    const d = (selector: string) => sim.locator(selector).getAttribute("d");
    expect(await d('[data-live-row="x"]')).not.toBe(await d('[data-key-row="x"]'));
    await reset.click();
    expect(await caption(sim)).toBe(DETECTOR_OPENING);
    expect(await toggle.getAttribute("aria-pressed")).toBe("false");
    expect(await attr(sim, "data-period")).toBe("0");
    expect(await reset.isDisabled()).toBe(true);
    await context.close();
  });

  it("under reduced motion the token jumps and nothing runs while idle", async () => {
    const { context, sim } = await open("fsm", { reduced: true });
    expect(await attr(sim, "data-reduced")).toBe("true");
    await clock(sim).click();
    await clock(sim).click();
    expect(await attr(sim, "data-period")).toBe("2");
    expect(await attr(sim, "data-active")).toBe("S1");
    expect(await sim.locator("[data-travel]").count()).toBe(0);
    expect(await attr(sim, "data-travelling")).toBe("false");
    expect(await sim.getByText("Motion is reduced: the token jumps to where the clock takes it.").count()).toBe(1);
    await context.close();
  });

  it("the drill clocks through its example", async () => {
    const { context, sim, errors } = await open("grafcet");
    expect(await caption(sim)).toBe(DRILL_OPENING);
    await tick(sim, 1);
    expect(await caption(sim)).toBe(DRILL[0]);
    // After Clock 1 the example moves on to period 2 (m = 1, a = 1): row 0 is enabled and firable.
    const row = sim.locator('tr[data-row="0"]');
    expect(await row.getAttribute("data-enabled")).toBe("true");
    expect(await row.getAttribute("data-firable")).toBe("true");
    for (const [i, text] of DRILL.entries().drop(1)) {
      await tick(sim, i + 1);
      expect(await caption(sim), `after Clock ${i + 1}`).toBe(text);
    }
    expect(await attr(sim, "data-active")).toBe("X0");
    expect(await sim.locator('[data-token="X0"]').count()).toBe(1);
    expect(await clock(sim).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("on a phone: drawn at its own size, every text at 12px or more, every control 44px square, the diagram scrolling in its stage", async () => {
    const { context, tab, sim, errors } = await open("fsm", { width: 375, height: 812, touch: true });
    const drawn = await sim.locator("svg.state-diagram").evaluate((svg) => ({
      width: svg.getBoundingClientRect().width,
      attribute: Number(svg.getAttribute("width")),
    }));
    expect(drawn.width).toBeCloseTo(drawn.attribute, 0);
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
    const boxes = await sim.locator(".machine-controls button").evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { name: b.textContent, w: r.width, h: r.height };
      }),
    );
    expect(boxes).toHaveLength(3);
    for (const b of boxes) {
      expect(b.w, `${b.name} width`).toBeGreaterThanOrEqual(44);
      expect(b.h, `${b.name} height`).toBeGreaterThanOrEqual(44);
    }
    const stage = sim.locator(".logic-stage").first();
    expect(await stage.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeGreaterThan(0);
    expect(await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // A tap on Clock moves the machine: every enabled control changes the page.
    await clock(sim).tap();
    await expect.poll(() => attr(sim, "data-period")).toBe("1");
    expect(errors).toEqual([]);
    await context.close();
  });
});
