// The fresh reviewer's screenshots: one Module page, on the Vercel preview (or a served build), at
// phone and laptop width, every collapsible open and every island scrolled into view, once per tab
// view (the plot behind a Worked example's Table | Plot tabs). The reviewer compares them with the
// rendered pages of the Materials; `shots.json` names the commit they show, which the review cites.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { serveSite } from "./browser/serve.ts";

export const SHOTS = "learn-premium review shots v1";

export const DEVICES = [
  { device: "phone", width: 375, height: 812 },
  { device: "laptop", width: 1280, height: 800 },
] as const;

export interface ShotsManifest {
  shots: typeof SHOTS;
  module: string;
  url: string;
  commit: string;
  files: { device: (typeof DEVICES)[number]["device"]; width: number; view: number; file: string }[];
}

export interface ShotsOptions {
  /** The Module's folder, which is its route (`01-thermal-resistance`). */
  module: string;
  /** Where the screenshots and `shots.json` go: the wave's review folder in the Private folder. */
  out: string;
  /** The commit the pages were built from. */
  commit: string;
  /** The Vercel preview to open; without it, `distDir` is served locally. */
  url?: string;
  distDir?: string;
}

/** How long the page gets to settle after each change (islands hydrating, a tab's plot drawing). */
const SETTLE_MS = 400;

export async function takeShots(options: ShotsOptions): Promise<ShotsManifest> {
  const served = options.url === undefined ? await serveSite(options.distDir ?? "dist") : null;
  const base = (options.url ?? served?.url ?? "").replace(/\/+$/, "");
  const browser = await chromium.launch();
  const files: ShotsManifest["files"] = [];
  try {
    mkdirSync(options.out, { recursive: true });
    for (const { device, width, height } of DEVICES) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        const response = await page.goto(`${base}/${options.module}/`, { waitUntil: "load" });
        if (response === null || !response.ok())
          throw new Error(`the Module page /${options.module}/ answered ${response?.status() ?? "nothing"}, not 200`);
        await openEverything(page);
        const views = await page.evaluate(() =>
          Math.max(
            1,
            ...[...document.querySelectorAll('[role="tablist"]')].map((l) => l.querySelectorAll('[role="tab"]').length),
          ),
        );
        for (let view = 1; view <= views; view++) {
          if (view > 1) {
            // Every tab list shows its view-th tab where it has one.
            await page.evaluate((n) => {
              for (const list of document.querySelectorAll('[role="tablist"]'))
                (list.querySelectorAll('[role="tab"]')[n - 1] as HTMLElement | undefined)?.click();
            }, view);
            await openEverything(page);
          }
          const file = `${device}${view === 1 ? "" : `-view${view}`}.png`;
          await page.screenshot({ path: join(options.out, file), fullPage: true });
          files.push({ device, width, view, file });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await served?.close();
  }
  const manifest: ShotsManifest = {
    shots: SHOTS,
    module: options.module,
    url: options.url ?? `a local build of ${options.distDir ?? "dist"}`,
    commit: options.commit,
    files,
  };
  writeFileSync(join(options.out, "shots.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Opens every collapsible and scrolls the page through, so every island hydrates; ends at the top. */
async function openEverything(page: Page) {
  await page.evaluate(async (settle) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const details of document.querySelectorAll("details:not([open])")) (details as HTMLDetailsElement).open = true;
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await wait(50);
    }
    window.scrollTo(0, 0);
    await wait(settle);
    // An island that rendered more collapsibles once hydrated gets them opened too.
    for (const details of document.querySelectorAll("details:not([open])")) (details as HTMLDetailsElement).open = true;
  }, SETTLE_MS);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
    // A page still fetching (a live tool's download) is shot as it stands.
  });
}
