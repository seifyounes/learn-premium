// The performance report: reported, never a gate. For each page, the JavaScript its initial load
// fetches (compressed bytes, against the ~300 KB first-view reference) and its Largest Contentful
// Paint on a phone-sized Chromium; optionally Lighthouse's mobile performance score. Nothing here
// fails a build or a deploy.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

/** About 300 KB of first-view JavaScript: the spec's reference figure, reported but not gated. */
export const INITIAL_JS_REFERENCE_KB = 300;

/** The Lighthouse release the report runs, through npx, so the template carries no dependency on it. */
const LIGHTHOUSE = "lighthouse@13.5.0";

export interface PagePerformance {
  route: string;
  /** Compressed bytes of JavaScript fetched by the initial load, before anything is scrolled. */
  initialJsKb: number;
  lcpMs: number | null;
  lighthouse?: { score: number | null; lcpMs: number | null } | { error: string };
}

export interface PerformanceReport {
  url: string;
  referenceKb: number;
  pages: PagePerformance[];
}

/** Measures `routes` on the site at `url`. Lighthouse runs on `lighthouseRoutes` only (it is slow). */
export async function measure(
  url: string,
  routes: readonly string[],
  { lighthouseRoutes = [] }: { lighthouseRoutes?: readonly string[] } = {},
): Promise<PerformanceReport> {
  const browser = await chromium.launch();
  const pages: PagePerformance[] = [];
  try {
    for (const route of routes) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const w = window as unknown as { __lcp: number | null };
        w.__lcp = null;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      const scripts: Promise<number>[] = [];
      page.on("response", (response) => {
        if (response.request().resourceType() !== "script") return;
        scripts.push(
          response
            .request()
            .sizes()
            .then((s) => s.responseBodySize)
            .catch(() => 0),
        );
      });
      await page.goto(`${url}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      const lcp = await page.evaluate(() => (window as unknown as { __lcp: number | null }).__lcp);
      const bytes = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
      await context.close();
      pages.push({
        route,
        initialJsKb: Math.round((bytes / 1024) * 10) / 10,
        lcpMs: lcp === null ? null : Math.round(lcp),
        ...(lighthouseRoutes.includes(route) ? { lighthouse: await lighthouse(`${url}${route}`) } : {}),
      });
    }
  } finally {
    await browser.close();
  }
  return { url, referenceKb: INITIAL_JS_REFERENCE_KB, pages };
}

/**
 * Lighthouse's mobile performance score and LCP for one page, run through npx. Async: the page may
 * be served from this same process. Lighthouse finds the installed Chrome (CHROME_PATH overrides).
 */
async function lighthouse(pageUrl: string): Promise<NonNullable<PagePerformance["lighthouse"]>> {
  const command = [
    "npx --yes",
    LIGHTHOUSE,
    JSON.stringify(pageUrl),
    "--quiet --output=json --output-path=stdout --only-categories=performance --form-factor=mobile",
    '--chrome-flags="--headless=new --no-sandbox"',
  ].join(" ");
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, { shell: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("close", () => resolve({ stdout: out, stderr: err }));
    child.on("error", (error) => resolve({ stdout: out, stderr: `${err}\n${error.message}` }));
  });
  try {
    const result = JSON.parse(stdout) as {
      categories: { performance: { score: number | null } };
      audits: Record<string, { numericValue?: number }>;
    };
    const lcp = result.audits["largest-contentful-paint"]?.numericValue;
    const score = result.categories.performance.score;
    return {
      score: score === null ? null : Math.round(score * 100),
      lcpMs: lcp === undefined ? null : Math.round(lcp),
    };
  } catch {
    const reason = stderr.split("\n").find((line) => /error/i.test(line)) ?? "Lighthouse produced no report";
    return { error: reason.trim() };
  }
}

/** The report as Markdown, for a CI job summary. */
export function performanceMarkdown(report: PerformanceReport): string {
  const heaviest = Math.max(0, ...report.pages.map((p) => p.initialJsKb));
  const lines = [
    `### Performance (reported, never blocking): ${report.url}`,
    "",
    `Heaviest first view: ${heaviest} KB of JavaScript, against the ~${report.referenceKb} KB reference${heaviest > report.referenceKb ? " (over it)" : ""}.`,
    "",
    "| Page | Initial JS (KB, compressed) | LCP (ms, phone) | Lighthouse (mobile) |",
    "| --- | ---: | ---: | --- |",
    ...report.pages.map((p) => {
      const lh =
        p.lighthouse === undefined
          ? ""
          : "error" in p.lighthouse
            ? `not run: ${p.lighthouse.error}`
            : `${p.lighthouse.score ?? "?"} (LCP ${p.lighthouse.lcpMs ?? "?"} ms)`;
      return `| \`${p.route}\` | ${p.initialJsKb} | ${p.lcpMs ?? "n/a"} | ${lh} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
