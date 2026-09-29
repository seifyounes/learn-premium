# Site template

The site code every Study site is built from: Astro 7 static output with React 19 islands,
Tailwind v4 on the DESIGN.md tokens, and KaTeX 0.18 (with mhchem) run at build.

## Content

The template reads a Course's content from `CONTENT_DIR` (default `../fixture-course`, the
Fixture Course). The shape is content contract v0 in `src/content/contract.ts`; the Fixture
Course's README lists the files. Agents write JSON/YAML and Markdown only, never JSX or MDX:
the page templates place the components.

Every file is read by `src/content/loaders.ts`. Bad LaTeX anywhere, or content that breaks the
contract, fails the build and names the file (and, for LaTeX, the line).

## Scripts

| Script                 | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Dev server on the Fixture Course                              |
| `npm run build`        | Static build into `dist/`                                     |
| `npm run check`        | `astro check` (TypeScript strictest, `.astro` files included) |
| `npm run lint`         | ESLint                                                        |
| `npm run format:check` | Prettier                                                      |
| `npm test`             | Vitest: builds the Fixture Course and its negative controls   |

Dependencies are pinned to exact versions (`.npmrc` has `save-exact`); commit the lockfile with
any change to them. CI (`.github/workflows/template-ci.yml`) runs all of the above.
