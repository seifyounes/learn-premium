# Research: web stack for an agent-generated Study site

Ticket: [#9](https://github.com/seifyounes/learn-premium/issues/9), part of map #1.
Researched 2026-09-25. Findings only. The delivery model (hosted vs offline single file) is still
open, so every criterion is judged under both.

**Method.** Primary sources only: official docs, source repos, specs and the npm registry. Each
claim links to the page it came from. Library sizes are my own measurements of the published
package files on jsDelivr (method in §9). Nothing here was benchmarked on a real Course: build
times per Course are **not measured**. See "Open questions".

**Reference point (v1).** v1 is vanilla-JS engines plus `data/*.js` globals. Routing is hash-based
(`#/`), and a hand-written `build-single.mjs` inlines every CSS/JS file and CSS-referenced image
into one `dist/index.html` (`v1-reference/assets/template/build-single.mjs`,
`v1-reference/references/engine-api.md` §1).

---

## Key findings

1. **The delivery model decides more than the framework does.** A single offline HTML file
   and "heavy islands loaded only where needed" pull in opposite directions. Single-file tooling
   turns code splitting off, so every island ships in the one file (§6).
2. **Astro 7 fits the hosted model best.** It ships zero JS by default, hydrates islands per
   component (`client:visible` etc.), and has zod-validated content collections and first-party
   i18n routing. But it has **no supported single-file mode**. Its PWA integration
   (`@vite-pwa/astro` 1.2.0) declares peer support only up to Astro 5, with open issues for
   Astro 6 and 7 (§2, §3, §7).
3. **SvelteKit is the only candidate with a first-party single-file mode**:
   `output.bundleStrategy: 'inline'` (since 2.13) plus `router.type: 'hash'` (since 2.14). The
   docs say the result is "usable without a server". It also ships a built-in service-worker
   module. The cost is the house motion default: Motion (Framer Motion) has no Svelte
   integration, so motion would be anime.js v4 or Svelte's built-in `svelte/motion` (§1, §6, §7).
4. **Vite + React** is closest to v1's delivery and to the owner's React/Framer Motion default.
   `vite-plugin-singlefile` 2.3.3 supports Vite 8. Hosted builds keep code splitting through
   `React.lazy`/`import()`. You assemble the rest yourself: routing, prerendering, content
   validation (zod) and i18n (§6).
5. **Next.js 16 static export** is well documented, and next-intl works with it only in a
   restricted mode: the locale prefix is always required and there is no locale detection. It
   has no single-file path. `@next/mdx` under Turbopack (the default) accepts only
   serializable plugin options (§3, §4, §8).
6. **Math: KaTeX pre-rendered at build time is the lightest option.** No math JS ships, only CSS
   plus about 260 KB of woff2 fonts, which must be inlined for single-file. MathJax 4's
   browser bundle is about 1.85 MB. MathJax's SVG output needs no web fonts (§4, §9).
7. **Offline caching through a service worker is impossible from `file://`.** The Service Worker
   spec rejects registration for any scheme other than http/https. "Offline" means either a
   hosted PWA or a single file opened locally, never both mechanisms at once (§7).
8. **Playwright can test every candidate.** Its service-worker tooling is Chromium-only, which
   matters if the PWA route is chosen (§10).

---

## 1. Current versions (npm `latest`, fetched 2026-09-25)

Source for every row: `https://registry.npmjs.org/<package>/latest`.

| Package | Version | Note |
| --- | --- | --- |
| astro | 7.3.5 | Astro 7.0 released 2026-06-22 ([blog](https://astro.build/blog/astro-7/)) |
| @astrojs/mdx | 8.0.2 | peer `astro ^7.2.10` |
| @astrojs/react / @astrojs/svelte | 7.0.0 / 9.0.1 | |
| next | 16.3.6 | Next 16 released 2025-10-21 ([blog](https://nextjs.org/blog/next-16)) |
| next-intl | 4.14.7 | |
| @sveltejs/kit / svelte | 2.70.3 / 5.57.1 | kit peer `vite ^5 … ^8` |
| @sveltejs/adapter-static | 3.0.10 | |
| vite | 8.3.1 | Vite 8 released 2026-03-12 ([blog](https://vite.dev/blog/announcing-vite8)) |
| react / react-dom | 19.3.0 | |
| react-router | 8.4.0 | |
| @tanstack/react-start | 1.168.58 | |
| tailwindcss | 4.3.3 | |
| motion (= framer-motion) | 13.4.4 | both names publish the same version |
| animejs | 4.5.0 | |
| katex | 0.18.9 | |
| mathjax | 4.1.3 | |
| zod | 4.6.5 | Astro re-exports Zod 4 as `astro/zod` |
| vite-plugin-singlefile | 2.3.3 | peer `vite ^5.4.21 … ^8.0.0` |
| vite-plugin-pwa | 1.3.0 | peer `vite ^3.1 … ^8.0.0` |
| @vite-pwa/astro | 1.2.0 | peer `astro ^1.6 … ^5.0.0` only (published 2025-11-27) |
| @vite-pwa/sveltekit | 1.1.0 | |
| serwist / @serwist/next | 9.5.12 | |
| @playwright/test | 1.63.0 | |
| three | 0.186.1 | |
| velite | 0.4.0 | |

---

## 2. Premium custom design and motion

- **Tailwind v4** runs as a Vite plugin (`@tailwindcss/vite`, `@import "tailwindcss"`), so it
  works in every Vite-based candidate (Astro, SvelteKit, Vite+React). Next.js ships Tailwind in
  its `create-next-app` template
  ([Tailwind Vite guide](https://tailwindcss.com/docs/installation/using-vite);
  [Next 16 blog](https://nextjs.org/blog/next-16)).
- **Motion (formerly Framer Motion)** supports React, vanilla JavaScript and Vue. There is no
  Svelte integration ([Motion docs](https://motion.dev/docs)). The React import is
  `motion/react`. For the Next.js App Router, `motion/react-client` reduces client JS
  ([Motion React install](https://motion.dev/docs/react-installation)). `motion` and
  `framer-motion` publish the same version (13.4.4) on npm.
- **anime.js v4** is framework-agnostic ES modules. It has timeline, draggable, layout, SVG,
  text and scroll modules, plus a WAAPI path and a Three.js adapter, and documents both vanilla
  JS and React usage ([anime.js docs](https://animejs.com/documentation/)). It works identically
  in all candidates, including Astro `<script>` blocks and Svelte components.
- **Svelte** has built-in motion primitives: `Spring` and `Tween` (since 5.8.0) and
  `prefersReducedMotion` (since 5.7.0)
  ([svelte/motion](https://svelte.dev/docs/svelte/svelte-motion)).
- **Astro** has page transitions built in. `<ClientRouter />` provides SPA-style animated
  navigation, `transition:persist` keeps an island's state across navigations, and native
  cross-document View Transitions are supported. The router respects `prefers-reduced-motion`
  ([Astro view transitions](https://docs.astro.build/en/guides/view-transitions/)).
- **Next.js 16** ships React 19.2 View Transitions through the App Router's canary React
  ([Next 16 blog](https://nextjs.org/blog/next-16)).

**Under the house rules:** React stacks (Next, Vite+React, Astro+React islands) keep Framer
Motion. SvelteKit falls under the "anime.js v4 elsewhere" branch. Astro can mix both: Motion in
React islands, anime.js in `.astro` scripts.

## 3. Heavy islands without bloating every page

- **Astro:** components ship **zero JS** unless given a `client:*` directive. `client:visible`
  hydrates on entering the viewport, `client:idle` after load, `client:media` on a media query,
  and `client:only` skips server rendering (useful for WebGL/three.js)
  ([directives](https://docs.astro.build/en/reference/directives-reference/)). Each island
  hydrates independently, and React, Preact, Svelte, Vue and Solid can be mixed
  ([islands](https://docs.astro.build/en/concepts/islands/)). Framework components work inside
  MD/MDX content with a `client:` directive
  ([Markdown guide](https://docs.astro.build/en/guides/markdown-content/)).
  - Caveat: framework **context does not cross islands**. Astro recommends Nano Stores (under
    1 KB) for shared state, for example quiz progress
    ([sharing state](https://docs.astro.build/en/recipes/sharing-state-islands/)).
  - Caveat: children passed from `.astro` into React arrive as plain strings unless
    `experimentalReactChildren` is set. Astro 7 replaced Babel with Oxc in `@astrojs/react`
    ([React integration](https://docs.astro.build/en/guides/integrations-guide/react/)).
- **Next.js:** Server Components are code-split automatically. Client components lazy-load
  through `next/dynamic` or `React.lazy`. `ssr: false` is allowed only inside Client
  Components. When a Server Component dynamically imports a Client Component, automatic code
  splitting "is currently **not** supported"
  ([lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)).
- **SvelteKit:** the default `bundleStrategy: 'split'` "splits the app up into multiple .js/.css
  files so that they are loaded lazily as the user navigates"
  ([config](https://svelte.dev/docs/kit/configuration)).
- **Vite + React:** dynamic `import()` is code-split, and shared chunks are preloaded in
  parallel. `import.meta.glob` is lazy by default and splits each match into its own chunk
  ([Vite features](https://vite.dev/guide/features)).

## 4. Agent-authored content with schema validation

- **Astro content collections** live in `src/content.config.ts`. The `glob()` loader reads
  directories of Markdown, MDX, Markdoc, JSON, YAML or TOML, and `file()` reads many entries
  from one file. Schemas are Zod 4 (`import { z } from "astro/zod"`), violations fail the build,
  types are generated, and `reference()` links entries across collections
  ([content collections](https://docs.astro.build/en/guides/content-collections/)). This is the
  closest built-in match to v1's `data/*.js` contracts (engine-api.md), made enforceable.
- **Astro 7 Markdown change:** the default processor is now **Sätteri** (Rust). It does **not**
  run remark/rehype plugins; the unified pipeline stays available via `@astrojs/markdown-remark`
  ([Markdown guide](https://docs.astro.build/en/guides/markdown-content/);
  [Astro 7 blog](https://astro.build/blog/astro-7/)). MDX extends the Markdown config by
  default. The default processor also does not support recma plugins
  ([MDX integration](https://docs.astro.build/en/guides/integrations-guide/mdx/)).
- **Next.js:** `@next/mdx` compiles local `.mdx` and needs `mdx-components.tsx`. It has **no
  frontmatter support by default** and no built-in collection or schema layer. Under Turbopack,
  remark/rehype plugins must be given as strings with serializable options, because "JavaScript
  functions can't be passed to Rust". The Rust MDX compiler (`mdxRs`) is experimental
  ([Next MDX guide](https://nextjs.org/docs/app/guides/mdx)). Schema validation means bringing
  your own layer: Zod directly, or Velite, a "type-safe data layer … with Zod schema" that is
  framework-agnostic and self-described as "mostly stable" with possible significant changes
  ([Velite](https://velite.js.org/guide/introduction)).
- **SvelteKit / Vite + React:** no built-in content layer. Validate JSON/TS data with Zod at
  build time. Load files with `import.meta.glob`
  ([Vite features](https://vite.dev/guide/features)).

## 5. Math typesetting

- **KaTeX 0.18.9:** `katex.renderToString` generates HTML "on the server"
  ([API](https://github.com/KaTeX/KaTeX/blob/main/docs/api.md)). Build-time rendering therefore
  ships no KaTeX JS, only CSS and fonts. The `output` option chooses `html`, `mathml` or
  `htmlAndMathml` (default, adds MathML for accessibility). `throwOnError` (default `true`) and
  `strict` let a build fail on bad LaTeX, which suits an accuracy gate
  ([options](https://github.com/KaTeX/KaTeX/blob/main/docs/options.md)). Fonts ship as
  ttf/woff/woff2 ([font docs](https://github.com/KaTeX/KaTeX/blob/main/docs/font.md)).
- **MathJax 4.1.3:** SVG output "does not rely heavily on CSS" and uses SVG data instead of font
  files ([SVG output](https://docs.mathjax.org/en/latest/output/svg.html)). No font inlining
  problem in a single file, but the browser bundle is large (§9).
- **Native MathML Core** is Baseline widely available since January 2023
  ([MDN MathML](https://developer.mozilla.org/en-US/docs/Web/MathML)), so KaTeX `output:
  'mathml'` is a zero-font option, with less visual control.
- **Wiring per stack:**
  - Astro 7's Sätteri parses `$…$`/`$$…$$` when `features.math` is enabled. The docs do not
    say how it renders, and remark-math/rehype-katex need the unified processor
    ([Sätteri features](https://satteri.bruits.org/docs/features/);
    [Astro Markdown](https://docs.astro.build/en/guides/markdown-content/)).
  - Next's docs show `['rehype-katex', { strict: true, throwOnError: true }]` as a
    Turbopack-compatible string plugin ([Next MDX](https://nextjs.org/docs/app/guides/mdx)).
  - SvelteKit and Vite+React call KaTeX directly or use mdsvex/MDX with remark-math and
    rehype-katex (current versions 6.0.0 / 7.0.1 on npm).

## 6. Delivery: hosted static vs offline single file

### Constraints that apply to every stack

- ES module scripts loaded from `file://` hit CORS errors ([MDN modules guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)).
  A single file must therefore **inline** its modules. Separate `.js` chunks beside the HTML
  will not load when the file is double-clicked.
- `vite-plugin-singlefile` 2.3.3 inlines all JS/CSS into `dist/index.html`. Its recommended
  config sets `assetsInlineLimit` to always inline and `cssCodeSplit: false`, and on Vite 8
  sets `codeSplitting: false` ([source](https://github.com/richardtallent/vite-plugin-singlefile/blob/main/src/index.ts)).
  The README says it "_will not work_ or _will not be optimized for_" multiple HTML entry
  points. History-API routing and cookies do not work under `file://`, but hash routing and
  `localStorage` do. `public/` files and SVGs are not inlined
  ([README](https://github.com/richardtallent/vite-plugin-singlefile)).
- **Consequence:** in a single file, every island (three.js, simulators, KaTeX fonts) sits in
  the one document. Lazy *execution* is still possible, but lazy *download* is not. §9 has the
  sizes.

### Per stack

| Stack | Hosted static | Single offline file |
| --- | --- | --- |
| **Astro 7** | Default output is static. Vercel needs no config ([Astro on Vercel](https://docs.astro.build/en/guides/deploy/vercel/)). | **No supported mode.** Output is one HTML per page (multi-entry). Processed scripts become `type="module"`, and only small ones are auto-inlined ([client scripts](https://docs.astro.build/en/guides/client-side-scripts/)). `build.inlineStylesheets: 'always'` covers CSS only ([config reference](https://docs.astro.build/en/reference/configuration-reference/)). Getting one file would need a custom post-build step. |
| **Next.js 16** | `output: 'export'` writes `out/` with one HTML per route. Unsupported: Proxy, rewrites, redirects, headers, Server Actions, ISR, default image loader, and dynamic routes without `generateStaticParams` ([static exports](https://nextjs.org/docs/app/guides/static-exports)). | **No documented path.** The docs target "any web server". |
| **SvelteKit 2** | `adapter-static` with `export const prerender = true` in the root layout. `strict` checks that every page prerendered ([adapter-static](https://svelte.dev/docs/kit/adapter-static)). | **First-party.** `output.bundleStrategy: 'inline'` "inlines all JavaScript and CSS of the entire app into the HTML. The result is usable without a server (i.e. you can just open the file in your browser)". Assets need `build.assetsInlineLimit: Infinity` ([source doc comment](https://github.com/sveltejs/kit/blob/main/packages/kit/src/exports/public.d.ts)). Pair with `router.type: 'hash'`, which disables SSR and prerendering, and all links must start with `#/` ([config](https://svelte.dev/docs/kit/configuration)). |
| **Vite + React** | Plain SPA, or React Router framework mode with `ssr: false` plus `prerender` for per-route HTML ([RR pre-rendering](https://reactrouter.com/how-to/pre-rendering)). | **Via `vite-plugin-singlefile`** with hash routing: the same model as v1, generated by a bundler instead of `build-single.mjs`. |

**One source, two outputs:** in SvelteKit, two configs (hosted `split` + pathname vs offline
`inline` + hash) are a documented switch. In Vite+React it is two Vite configs over the same
app. In Astro and Next, the offline artifact would be a separate build target.

## 7. PWA and offline caching (hosted model only)

- The Service Worker spec: "If scriptURL's scheme is not one of "http" and "https", reject
  promise with a TypeError" ([spec](https://w3c.github.io/ServiceWorker/)). **A single file on
  `file://` cannot use a service worker.** Serving requires HTTPS, with `localhost` as the dev
  exception ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)).
- **SvelteKit:** built in. `src/service-worker.js` is auto-registered and bundled for
  production. `$service-worker` exposes `build`, `files` and `version` for precaching. The docs
  warn that "stale data might be worse than data that's unavailable while offline"
  ([service workers](https://svelte.dev/docs/kit/service-workers)).
- **Vite + React:** `vite-plugin-pwa` 1.3.0 generates a Workbox service worker with offline
  support and update prompts for React, Svelte, Solid, Preact and Vue
  ([README](https://github.com/vite-pwa/vite-plugin-pwa)).
- **Astro:** `@vite-pwa/astro` 1.2.0 peer range ends at `astro ^5.0.0` (npm). Open issues:
  vite-pwa/astro #72 "Astro 6 peer dependency range blocks installation" (2026-03-11) and #74
  "Astro 7 support" (2026-07-11) ([issues](https://github.com/vite-pwa/astro/issues)). A
  hand-written or Workbox-CLI service worker over `dist/` remains possible (workbox-build 7.4.1).
- **Next.js:** built-in `app/manifest.ts`. For "full service-worker-based offline caching" the
  docs point to Serwist, with Turbopack and webpack examples. The experimental `useOffline` hook
  only covers connectivity-aware UI
  ([Next PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)). Serwist has a
  separate Turbopack guide ([Serwist](https://serwist.pages.dev/docs/next/getting-started)).
  Its compatibility with `output: 'export'` was not confirmed in its docs.

## 8. Bilingual Arabic RTL

None of the frameworks sets `dir="rtl"` for you. In every stack the author sets `<html lang dir>`
per locale.

- **Astro:** i18n routing (`locales`, `defaultLocale`, `routing.prefixDefaultLocale`,
  `fallback`), `getRelativeLocaleUrl()` and `Astro.currentLocale`. The docs cover URLs only,
  not text direction ([Astro i18n](https://docs.astro.build/en/guides/internationalization/)).
- **Next.js:** `app/[lang]` segments and `generateStaticParams` for static locales. The
  documented root layout sets `<html lang>`, and `dir` is up to you
  ([Next i18n](https://nextjs.org/docs/app/guides/internationalization)). next-intl with static
  export requires a locale prefix, has no server locale negotiation and no localized pathnames,
  and "static rendering is required"
  ([next-intl proxy docs](https://next-intl.dev/docs/routing/middleware)).
- **SvelteKit:** the `sv add paraglide` add-on (Paraglide JS: compiled, tree-shakable,
  type-safe messages) updates the `lang` and text-direction attributes in `app.html`
  ([Paraglide add-on](https://svelte.dev/docs/cli/paraglide)).
- **Tailwind v4 in all stacks:** `rtl:`/`ltr:` variants compile to
  `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)`, and `motion-reduce`/`motion-safe` exist
  ([Tailwind states](https://tailwindcss.com/docs/hover-focus-and-other-states)). The workspace
  rule of logical properties (`ms-*`, `ps-*`) is stack-independent.
- **Single-file + bilingual:** with hash routing there are no `/ar` and `/en` path prefixes. The
  locale becomes a hash segment or in-app state, which departs from the workspace's
  locale-prefixed-routes convention. Hosted builds keep `/ar` and `/en`.

## 9. Size budget of the heavy parts (for single-file and first-load planning)

Measured 2026-09-25 by downloading the published files from `cdn.jsdelivr.net/npm/...` and
counting bytes (raw / gzip -c). These are untree-shaken distribution builds, so real bundles can
be smaller.

| Asset | Raw | gzip |
| --- | --- | --- |
| three.js 0.186.1 `three.module.min.js` + `three.core.min.js` (module imports core) | 809 KB | 195 KB |
| MathJax 4.1.3 `tex-svg.js` | 1.85 MB | 617 KB |
| KaTeX 0.18.9 `katex.min.js` (not needed if pre-rendered) | 273 KB | 76 KB |
| KaTeX `katex.min.css` + 20 woff2 fonts | 25 KB + 260 KB | — |
| anime.js 4.5.0 `anime.esm.min.js` (full bundle) | 119 KB | 41 KB |

A single file is not gzip-served when opened from disk. Raw sizes are what the student's browser
parses. Inlined binaries (fonts, images) grow by about a third as base64.

## 10. Testability in a real browser (Playwright 1.63.0)

- `webServer` in the config starts a dev or preview server before tests (`command`, `url`,
  `reuseExistingServer`) ([webServer](https://playwright.dev/docs/test-webserver)). This works
  for every hosted build.
- Emulation of `locale`, viewport and `colorScheme` is built in, so AR/EN × mobile/desktop
  matrices are config ([test options](https://github.com/microsoft/playwright/blob/main/docs/src/test-use-options-js.md)).
- Visual regression uses `expect(page).toHaveScreenshot()`, with the warning that rendering
  varies by OS and hardware, so baselines must be generated where tests run
  ([visual comparisons](https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md)).
- `browserContext.setOffline()` exists (since 1.8). **Service workers are only supported on
  Chromium-based browsers**, and can be blocked with `serviceWorkers: 'block'`
  ([service workers](https://github.com/microsoft/playwright/blob/main/docs/src/service-workers-js-python.md);
  [BrowserContext](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-browsercontext.md)).
- A single file is tested by loading its `file://` URL, which exercises the real offline
  artifact. The PWA route needs an HTTPS or localhost server.
- Next 16 lists `@playwright/test` as an optional peer and ships a DevTools MCP for agents
  ([npm](https://registry.npmjs.org/next/latest); [Next 16 blog](https://nextjs.org/blog/next-16)).

## 11. Build speed (vendor claims, not measured on a Course)

- **Astro 7** (Vite 8 + Rolldown + Sätteri): "overall build times improved by 15–61%"; Sätteri
  "shaved over a minute" off the Astro and Cloudflare docs builds
  ([Astro 7](https://astro.build/blog/astro-7/)).
- **Vite 8** (Rolldown + Oxc): "up to 10-30x faster builds"; Linear went from 46 s to 6 s
  ([Vite 8](https://vite.dev/blog/announcing-vite8)). This applies to SvelteKit and Vite+React
  too.
- **Next 16** (Turbopack default): "2–5× faster production builds". The React Compiler is
  stable but off by default because it relies on Babel and raises compile times
  ([Next 16](https://nextjs.org/blog/next-16)).
- A Study site is roughly 10–30 modules plus exam pages. At that scale all four likely build
  in seconds to tens of seconds. That is an inference, **not measured**, and a prototype
  ticket should time the Pilot course.

## 12. Other candidates checked

- **TanStack Start** (1.168.58): static prerendering with link crawling, "for deploying static
  sites to platforms that do not support server-side rendering"
  ([docs](https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering)).
  It covers the same ground as React Router framework mode and offers no content layer or
  single-file mode.
- **React Router 8 framework mode:** `ssr: false` + `prerender` writes `[url].html` plus
  `[url].data` per route to `build/client` ([pre-rendering](https://reactrouter.com/how-to/pre-rendering)).
  This is a middle ground between plain Vite+React and Next.

---

## Comparison matrix

Ratings summarize the sections above: ● strong / first-party, ◐ possible with extra work or
caveats, ○ not supported.

| Criterion | Astro 7 | Next.js 16 export | SvelteKit 2 | Vite 8 + React 19 |
| --- | --- | --- | --- | --- |
| Tailwind v4 | ● | ● | ● | ● |
| Framer Motion (house default for React) | ● in React islands | ● | ○ (anime.js / svelte/motion) | ● |
| anime.js v4 | ● | ● | ● | ● |
| Per-component lazy islands (hosted) | ● zero-JS default | ◐ client-component split only | ● route split | ◐ manual `lazy()` |
| Schema-validated content | ● content collections + Zod | ◐ BYO (Zod/Velite) | ◐ BYO | ◐ BYO |
| MDX | ● (Sätteri default; unified for remark/rehype) | ◐ Turbopack plugin limits | ◐ mdsvex (not researched) | ● @mdx-js |
| Build-time KaTeX | ◐ unified pipeline | ● rehype-katex string plugin | ● | ● |
| Hosted static on Vercel/Netlify | ● | ● | ● | ● |
| Single offline file | ○ | ○ | ● `bundleStrategy: 'inline'` | ● vite-plugin-singlefile |
| PWA/offline (hosted) | ◐ plugin lags Astro 7 | ◐ Serwist | ● built-in SW | ● vite-plugin-pwa |
| i18n routing / RTL | ● routing; dir manual | ◐ next-intl restricted in export | ◐ Paraglide add-on | ◐ BYO |
| Playwright | ● | ● | ● | ● |

## Open questions (not answerable from docs)

- Real build time and output size for the Pilot course in each stack. This needs a prototype.
- Whether SvelteKit `inline` + hash routing keeps a large site (many modules, quizzes, 3D) within
  an acceptable parse and first-paint time on a mid-range phone.
- Whether `@vite-pwa/astro` works on Astro 7 despite the peer range (issue #74 is open).
- How Sätteri renders math and whether a KaTeX-compatible Sätteri plugin is official. Its docs
  only describe parsing.
- Whether circuit simulators the owner wants (e.g. Falstad-style) embed as JS modules or only
  as iframes. Iframes pointing at separate HTML files break the single-file model.

## Implications for learn-premium

Options only. The owner decides, and the delivery model decision (hosted vs offline) comes
first because it narrows the rest.

1. **Astro 7 + React islands (Motion) + content collections: hosted-first.**
   - For: best island isolation, first-party Zod content schema (a natural home for v1's data
     contracts, validated at build), i18n routing, View Transitions, fast builds.
   - Against: no single-file output. PWA needs a hand-rolled service worker until
     `@vite-pwa/astro` supports Astro 7. Math needs the unified pipeline or a Sätteri plugin.
     Island state needs Nano Stores.
2. **SvelteKit 2 + Tailwind + anime.js v4: dual-target.**
   - For: the only first-party single-file mode plus a built-in service worker, so one codebase
     can ship hosted (split + pathname + SW) and offline (inline + hash). Svelte's built-in
     motion.
   - Against: breaks the React/Framer Motion default (anime.js per house rules), no built-in
     content schema (BYO Zod), hash-mode offline build loses `/ar`/`/en` path routing and
     prerendering.
3. **Vite 8 + React 19 + vite-plugin-singlefile: closest to v1, modernised.**
   - For: keeps the owner's React/Framer Motion default. Offline output works like v1's proven
     single-file build. Hosted variant via `lazy()` + vite-plugin-pwa.
   - Against: you assemble routing, prerendering/SEO, content validation and i18n yourself. The
     single file carries every heavy island (§9).
4. **Next.js 16 static export + next-intl: workspace-default stack.**
   - For: matches the workspace tech default and existing agency muscle memory, strong
     React/Motion story, Vercel-native.
   - Against: no single-file path, next-intl restricted under export, `@next/mdx` Turbopack
     plugin limits, no built-in content schema, PWA through Serwist.
5. **Hybrid: hosted Study site on one stack plus a slim offline "exam-night" file.** Keep the
   heavy interactive site hosted (any of 1–4) and generate a separate single-file digest
   (formulas, worked tables, pre-rendered KaTeX, no 3D) from the same validated content. This
   costs two render targets but avoids the §6 tension.

Any option benefits from a prototype ticket: build one Pilot-course module end to end and
measure build time, output size and Playwright AR/EN × mobile/desktop runs.
