// The live gates: per deploy, after Vercel deploys `main`, on the live URL (`--url`). A red run
// rolls Vercel back to the last green deployment and tells the Owner (`deploy/`). Every route the
// build made answers 200 with the build's own page and the hubs are there; every response carries
// X-Robots-Tag: noindex, and pages, scripts and stylesheets come Brotli-compressed; Materials and
// evidence paths answer 404.
//
// The pages to expect are listed from the same build (`--dist`, built at the deployed commit). With
// no URL the gates serve that build the way Vercel would under vercel.json (`live/vercel-like.ts`):
// how their negative controls run, and how template CI checks the config before anything deploys.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { course } from "../src/content/contract.ts";
import { readStructured } from "../src/content/loaders.ts";
import { LICENCES_ROUTE } from "../src/licences/file.ts";
import { navItems } from "../src/site/nav.ts";
import type { ServedSite } from "./browser/serve.ts";
import { courseCopy, slashes } from "./course-files.ts";
import { serveLikeVercel } from "./live/vercel-like.ts";
import { copySite, sitePages } from "./pages.ts";
import {
  allFiles,
  LEDGER_FILE,
  readLedgerMaterials,
  readVercelConfig,
  siteFilesWith,
  templateWith,
} from "./private-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";

/** The live site: the URL given, or the build served the way Vercel would serve it. */
async function liveSite(input: GateInput): Promise<ServedSite> {
  if (input.siteUrl !== undefined) return { url: input.siteUrl.replace(/\/+$/, ""), close: async () => {} };
  if (input.distDir === undefined) throw new Error("no live URL and no built site to serve (distDir)");
  return serveLikeVercel(input.distDir, readVercelConfig(input));
}

async function withLiveSite<T>(input: GateInput, check: (url: string) => Promise<T>): Promise<T> {
  const site = await liveSite(input);
  try {
    return await check(site.url);
  } finally {
    await site.close();
  }
}

/** A request as a browser makes it: compression accepted, redirects not followed. */
const get = (url: string) =>
  fetch(url, {
    redirect: "manual",
    headers: { "accept-encoding": "br, gzip", "user-agent": "learn-premium live gates" },
  });

/** Every page the build made, by route, with its title: the whole Course, whatever the scope. */
function builtPages(input: GateInput) {
  const whole: GateInput = {
    contentDir: input.contentDir,
    ...(input.distDir === undefined ? {} : { distDir: input.distDir }),
  };
  return sitePages(whole).map((page) => ({ ...page, title: titleOf(readFileSync(page.path, "utf8")) }));
}

const titleOf = (html: string) => /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim();

/** The hubs every Study site has: home, Master Rules, Lab, About, and each complete sitting's Revision. */
function hubRoutes(contentDir: string): string[] {
  const path = join(contentDir, "course.yaml");
  const config = course.parse(readStructured(readFileSync(path, "utf8"), "course.yaml", () => {}));
  return navItems(config.sittings).map((item) => item.href);
}

export const liveRoutes: Gate = {
  id: "live-routes",
  checks:
    "every route the build made answers 200 on the live site with the build's own page, every hub is there, and so is the Licences file",
  points: ["live"],
  async run(input) {
    const pages = builtPages(input);
    if (pages.length === 0) throw new Error("the build has no page to look for on the live site");
    const routes = new Set(pages.map((p) => p.route));
    const hubs = hubRoutes(input.contentDir);
    const findings: Finding[] = [];
    const block = (at: string, message: string) => findings.push({ outcome: "block", at, message });
    for (const hub of hubs) if (!routes.has(hub)) block(hub, "the hub is missing from the build");

    await withLiveSite(input, async (url) => {
      for (const page of pages) {
        const response = await get(`${url}${page.route}`);
        const body = await response.text();
        if (response.status !== 200) {
          const to = response.headers.get("location");
          block(page.route, `answers ${response.status}${to ? ` (to ${to})` : ""}, not 200`);
        } else if (titleOf(body) !== page.title) {
          block(page.route, `serves "${titleOf(body) ?? "a page with no title"}", not the build's "${page.title}"`);
        }
      }
      const licences = await get(`${url}${LICENCES_ROUTE}`);
      await licences.arrayBuffer();
      if (licences.status !== 200) block(LICENCES_ROUTE, `answers ${licences.status}, not 200`);
    });
    return { coverage: { routes: pages.length + 1, hubs: hubs.length }, findings };
  },
  controls: [
    {
      defect: "a hub missing from the build (no Lab)",
      plant: (good, scratch) => {
        const distDir = copySite(good, scratch, { whole: true });
        rmSync(join(distDir, "lab"), { recursive: true });
        return { ...good, distDir };
      },
    },
    {
      defect: "vercel.json that redirects every route away from its trailing slash",
      plant: (good, scratch) => templateWith(good, scratch, (config) => ({ ...config, trailingSlash: false })),
    },
  ],
};

/** Files at least this big must come Brotli-compressed; a CDN may send a smaller one as it is. */
const BROTLI_FLOOR = 1024;

export const liveHeaders: Gate = {
  id: "live-headers",
  checks:
    "every page, script, stylesheet and the Licences file on the live site carries X-Robots-Tag: noindex, and pages, scripts and stylesheets of 1 KiB or more come Brotli-compressed",
  points: ["live"],
  async run(input) {
    if (input.distDir === undefined) throw new Error("no built site to list the live site's files from (distDir)");
    const assets = allFiles(input.distDir)
      .filter((f) => /\.(js|css)$/.test(f.entry))
      .map((f) => ({ route: `/${f.entry}`, path: f.path }));
    const checked = [
      ...builtPages(input),
      ...assets,
      { route: LICENCES_ROUTE, path: join(input.distDir, "licences.txt") },
    ];
    const findings: Finding[] = [];
    const block = (at: string, message: string) => findings.push({ outcome: "block", at, message });
    await withLiveSite(input, async (url) => {
      for (const { route, path } of checked) {
        const response = await get(`${url}${route}`);
        await response.arrayBuffer();
        if (!/\bnoindex\b/i.test(response.headers.get("x-robots-tag") ?? ""))
          block(route, "the response carries no X-Robots-Tag: noindex");
        const textual = route.endsWith("/") || /\.(js|css)$/.test(route);
        const encoding = response.headers.get("content-encoding");
        if (textual && readFileSync(path).length >= BROTLI_FLOOR && encoding !== "br")
          block(route, `served ${encoding ? `${encoding}-compressed` : "uncompressed"}, not Brotli`);
      }
    });
    return { coverage: { responses: checked.length }, findings };
  },
  controls: [
    {
      defect: "vercel.json without the X-Robots-Tag header",
      plant: (good, scratch) => templateWith(good, scratch, (config) => ({ ...config, headers: [] })),
    },
  ],
};

/** Paths no Course project may serve, whatever its content: config, secrets, git, build records. */
const ALWAYS_PRIVATE = [
  `/${LEDGER_FILE}`,
  "/build-records/",
  "/private/",
  "/materials/",
  "/vercel.json",
  "/package.json",
  "/.env",
  "/.git/config",
];

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Where Materials and Build evidence would be served if the deploy published more than the build:
 * every file of the Course's content (its build records included) at its path in the content
 * folder and in the repo, every Materials file the Build ledger lists, and the fixed list above.
 */
function privatePaths(input: GateInput): string[] {
  const paths = new Set(ALWAYS_PRIVATE);
  const repoRoot = gitRoot(input.contentDir);
  for (const { entry, path } of allFiles(input.contentDir)) {
    paths.add(`/${entry}`);
    if (repoRoot !== undefined) paths.add(`/${slashes(relative(repoRoot, path))}`);
  }
  for (const material of readLedgerMaterials(input.contentDir)?.materials ?? []) {
    const path = slashes(material.path).replace(/^\/+/, "");
    paths.add(`/${path}`);
    paths.add(`/${basename(path)}`);
  }
  return [...paths].map(encodePath);
}

/** The repo the content sits in (its `.git` may be a worktree's file), if any. */
function gitRoot(dir: string): string | undefined {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at;
    if (dirname(at) === at) return undefined;
  }
}

export const livePrivatePaths: Gate = {
  id: "live-private-paths",
  checks:
    "the live site answers 404 where the Course's content, build records, Materials files the Build ledger lists, config, secrets or git would sit",
  points: ["live"],
  async run(input) {
    const paths = privatePaths(input);
    const findings: Finding[] = [];
    await withLiveSite(input, async (url) => {
      for (const path of paths) {
        const response = await get(`${url}${path}`);
        await response.arrayBuffer();
        if (response.status !== 404)
          findings.push({ outcome: "block", at: decodeURI(path), message: `answers ${response.status}; it must 404` });
      }
    });
    return { coverage: { probes: paths.length }, findings };
  },
  controls: [
    {
      defect: "the course config served at /course.yaml",
      plant: (good, scratch) =>
        siteFilesWith(good, scratch, { "course.yaml": readFileSync(join(good.contentDir, "course.yaml"), "utf8") }),
    },
    {
      defect: "a Materials file the Build ledger lists, served at its path",
      plant: (good, scratch) => {
        const copy = courseCopy(good, scratch);
        const ledger = { materials: [{ path: "Lecture 3/notes.pdf", hash: "0".repeat(64) }] };
        writeFileSync(join(copy.contentDir, LEDGER_FILE), JSON.stringify(ledger));
        return siteFilesWith(copy, scratch, { "Lecture 3/notes.pdf": "%PDF-1.7 planted\n" });
      },
    },
  ],
};
