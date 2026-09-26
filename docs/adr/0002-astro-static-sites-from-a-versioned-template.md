# Study sites are Astro 7 static sites built from a versioned Site template

The workspace default for web work is Next.js, but learn-premium generates every Study site in
Astro 7 (React 19 islands, static output). In the Pilot course bake-off (ticket #17) Astro built
in half the time, shipped 0 KB of JS on static pages against Next's ~130 KB, scored 98–100
Lighthouse on mobile, produced a third of the files, and a blind agent extended it faster and
with fewer failures. Next.js 16 static export stays the named fallback. The switch happens only
if something the bake-off did not prove (a Vercel deploy, a real phone, Arabic RTL, view
transitions, a page with many heavy islands) fails in the Pilot build and can't be fixed inside
Astro. Keeping the islands in React keeps that switch cheap.

learn-premium carries a versioned **Site template**. Each Course is its own **Course project**:
a copy of the template, plus the Course's content and one course config, in a private GitHub
repo per Course that deploys through Vercel's Git integration as plain static files.

## Consequences

- Agents never write JSX or MDX. Structured content is JSON/YAML checked by Zod schemas, prose
  is plain Markdown, and page templates place the components. This avoids MDX's `{ }` brace
  trap and agent-written component errors.
- Math goes through our own KaTeX 0.18 build step with `throwOnError` and mhchem, not the stock
  rehype-katex, which silently renders bad LaTeX and pins KaTeX 0.16 (no `\ce`).
- Astro doesn't type-check on build, so the template adds `astro check` alongside TypeScript
  strict, ESLint, Prettier, Vitest and Playwright.
- Upgrading a Course means re-copying the template layer at a new version. The Course's content
  and config are left alone.
