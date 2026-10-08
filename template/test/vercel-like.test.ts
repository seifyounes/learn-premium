import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serveLikeVercel } from "../gates/live/vercel-like.ts";
import type { VercelConfig } from "../gates/vercel-config.ts";

/** A tiny build: home, one page, one stylesheet, the 404 page. */
function tinySite(): string {
  const dist = mkdtempSync(join(tmpdir(), "lp-vercel-like-"));
  writeFileSync(join(dist, "index.html"), "<title>Home</title>");
  mkdirSync(join(dist, "lab"));
  writeFileSync(join(dist, "lab", "index.html"), "<title>Lab</title>");
  writeFileSync(join(dist, "site.css"), "body{}");
  writeFileSync(join(dist, "404.html"), "<title>Not found</title>");
  return dist;
}

const NOINDEX = [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];

/** What the site answers at each path: status, and where a redirect goes. */
async function answers(config: VercelConfig, paths: string[]) {
  const site = await serveLikeVercel(tinySite(), { headers: NOINDEX, ...config });
  try {
    const out: Record<string, string> = {};
    for (const path of paths) {
      const response = await fetch(`${site.url}${path}`, { redirect: "manual" });
      const to = response.headers.get("location");
      out[path] = `${response.status}${to === null ? "" : ` ${to}`}`;
    }
    return out;
  } finally {
    await site.close();
  }
}

// The expected answers are what the live Fixture site answered under `trailingSlash: true` (ticket
// #125), and what Vercel's docs give for `false` and for no `trailingSlash` at all.
describe("the Vercel-like server", () => {
  it("under trailingSlash: true redirects every path without a slash or a file extension, file or not", async () => {
    expect(
      await answers({ trailingSlash: true }, [
        "/lab",
        "/lab/",
        "/.git/config",
        "/Lecture%203/notes",
        "/.env",
        "/site.css",
        "/nothing.txt/",
        "/.well-known/x",
      ]),
    ).toEqual({
      "/lab": "308 /lab/",
      "/lab/": "200",
      "/.git/config": "308 /.git/config/",
      "/Lecture%203/notes": "308 /Lecture%203/notes/",
      "/.env": "404",
      "/site.css": "200",
      "/nothing.txt/": "308 /nothing.txt",
      "/.well-known/x": "404",
    });
  });

  it("sends a trailing-slash redirect before the config's headers, as Vercel does", async () => {
    const site = await serveLikeVercel(tinySite(), { trailingSlash: true, headers: NOINDEX });
    try {
      const response = await fetch(`${site.url}/lab`, { redirect: "manual" });
      expect(response.status).toBe(308);
      expect(response.headers.get("x-robots-tag")).toBeNull();
    } finally {
      await site.close();
    }
  });

  it("under trailingSlash: false redirects every path that ends in a slash, file or not", async () => {
    expect(await answers({ trailingSlash: false }, ["/", "/lab", "/lab/", "/nothing/"])).toEqual({
      "/": "200",
      "/lab": "200",
      "/lab/": "308 /lab",
      "/nothing/": "308 /nothing",
    });
  });

  it("with no trailingSlash serves a page with or without its slash and redirects nothing", async () => {
    expect(await answers({}, ["/lab", "/lab/", "/.git/config", "/nothing/", "/nothing.txt/", "/site.css"])).toEqual({
      "/lab": "200",
      "/lab/": "200",
      "/.git/config": "404",
      "/nothing/": "404",
      "/nothing.txt/": "404",
      "/site.css": "200",
    });
  });
});
