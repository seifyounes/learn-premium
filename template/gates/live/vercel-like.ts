// Serves a built site the way Vercel serves it under the Site template's vercel.json, for the live
// gates when they have no live URL (their negative controls, and template CI before a deploy):
// static files only, `/route/` from `route/index.html`, the config's `trailingSlash` redirects and
// `headers`, and Brotli (or gzip) on text when the request accepts it. Nothing outside the site.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { CONTENT_TYPES, type ServedSite } from "../browser/serve.ts";
import type { VercelConfig } from "../vercel-config.ts";

/** Vercel compresses text types; images, fonts and media go as they are. */
const COMPRESSED = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

/** A Vercel `source` pattern as a regex: literal paths, `:name` segments and `(regex)` groups. */
export function sourcePattern(source: string): RegExp {
  let pattern = "";
  for (let at = 0; at < source.length;) {
    const char = source[at] ?? "";
    if (char === "(") {
      let depth = 0;
      let end = at;
      for (; end < source.length; end++) {
        if (source[end] === "(") depth++;
        else if (source[end] === ")" && --depth === 0) break;
      }
      pattern += source.slice(at, end + 1);
      at = end + 1;
    } else if (char === ":") {
      const name = /^:\w+/.exec(source.slice(at))?.[0] ?? ":";
      pattern += "([^/]+)";
      at += name.length;
    } else {
      pattern += char.replace(/[.*+?^${}|[\]\\]/g, "\\$&");
      at++;
    }
  }
  return new RegExp(`^${pattern}$`);
}

export async function serveLikeVercel(distDir: string, config: VercelConfig): Promise<ServedSite> {
  const root = normalize(distDir);
  const headerRules = (config.headers ?? []).map((rule) => ({
    test: sourcePattern(rule.source),
    headers: rule.headers,
  }));
  const fileAt = (path: string): string | undefined => {
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return undefined;
    return existsSync(file) && statSync(file).isFile() ? file : undefined;
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://site");
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return void response.writeHead(400).end("bad request");
    }
    const headers: Record<string, string> = {};
    for (const rule of headerRules)
      if (rule.test.test(path)) for (const { key, value } of rule.headers) headers[key.toLowerCase()] = value;

    const redirect = (to: string) =>
      response.writeHead(308, { ...headers, location: `${to}${url.search}` }).end(`Redirecting to ${to}`);
    if (config.trailingSlash === true && !path.endsWith("/") && !fileAt(path) && fileAt(`${path}/index.html`))
      return void redirect(`${path}/`);
    if (config.trailingSlash === false && path !== "/" && path.endsWith("/") && fileAt(`${path}index.html`))
      return void redirect(path.slice(0, -1));

    const file = fileAt(path.endsWith("/") ? `${path}index.html` : path) ?? fileAt(`${path}/index.html`);
    if (file === undefined) {
      const notFound = fileAt("404.html");
      response.writeHead(404, { ...headers, "content-type": CONTENT_TYPES[".html"] ?? "text/html" });
      return void response.end(notFound === undefined ? "not found" : readFileSync(notFound));
    }
    // A Content-Type the config sets wins, as on Vercel, and decides whether the file is compressed.
    const type = headers["content-type"] ?? CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    let body = readFileSync(file);
    const accepts = String(request.headers["accept-encoding"] ?? "");
    if (COMPRESSED.test(type) && /\bbr\b/.test(accepts)) {
      body = brotliCompressSync(body);
      headers["content-encoding"] = "br";
    } else if (COMPRESSED.test(type) && /\bgzip\b/.test(accepts)) {
      body = gzipSync(body);
      headers["content-encoding"] = "gzip";
    }
    response.writeHead(200, { ...headers, "content-type": type, "content-length": body.length });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
