// The Trap page: a hidden page of seeded defects in every preview build. A browser run that misses
// any of them is void. Never linked, noindex like every page, and left out of production builds.

export const TRAP_ROUTE = "/trap/";

/** The seeded defects, each wrapped in an element marked `data-trap="<id>"`. */
export const TRAP_DEFECTS = {
  "tiny-font-figure": "a figure labelled under the 12px floor, inside a collapsed section",
  "katex-error": "a KaTeX error",
  overlap: "a value chip laid over a figure",
  "wrong-number": "a wrong number the page computes as it loads",
} as const;
export type TrapDefect = keyof typeof TRAP_DEFECTS;

/** Whether a build ships the Trap page: every build except Vercel's production deploy. */
export const shipsTrapPage = (env: Record<string, string | undefined> = process.env) => env.VERCEL_ENV !== "production";
