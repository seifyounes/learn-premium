// The Site template's vercel.json: what the live site's headers and redirects come from. The
// noindex gate reads it before merge; the Vercel-like server serves a build under it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";

export const VERCEL_CONFIG = "vercel.json";

/** The path pattern that matches every route: Vercel's catch-all source. */
export const EVERY_PATH = "/(.*)";

/** A robots directive (meta tag or X-Robots-Tag) that keeps the page out of search. */
export const NOINDEX = /\bnoindex\b/i;

const vercelConfig = z.object({
  trailingSlash: z.boolean().optional(),
  headers: z
    .array(
      z.object({
        source: z.string(),
        headers: z.array(z.object({ key: z.string(), value: z.string() })),
      }),
    )
    .optional(),
});
export type VercelConfig = z.infer<typeof vercelConfig>;

export function readVercelConfig(templateDir: string): VercelConfig {
  const file = join(templateDir, VERCEL_CONFIG);
  if (!existsSync(file)) throw new Error(`the Site template has no ${VERCEL_CONFIG} at ${file}`);
  const parsed = vercelConfig.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} is not a Vercel config the gate can read`);
  return parsed.data;
}
