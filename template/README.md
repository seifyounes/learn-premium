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

## Gates

`gates/` is the gate runner: one entry (`npm run gates -- <command>`) for every gate point.

- `run --point job|module|deploy [--module NN-slug]` runs the point's gates and writes a Gate report
  to the Course's `build-records/gate-reports/`, bound to the commit it checked. It exits 1 unless
  the report is green.
- `verify --point … [--module …] [--commit SHA]` accepts a report only if it is green for that
  commit (HEAD by default). A report for another commit, or taken on uncommitted changes, is red.
- `controls` runs every gate on its positive fixture (the Course as it is) and on each of its
  negative controls. A negative control that passes is a failure.

Every finding either blocks or raises a Checkpoint item; there is no warning level. Every gate
reports its coverage, and a gate that crashed, didn't run or covered nothing counts as failed.
A new gate goes in `gates/index.ts` with at least one negative control that plants its defect.

| Gate                 | Points         | Checks                                                                |
| -------------------- | -------------- | --------------------------------------------------------------------- |
| `content-contract`   | job, deploy    | every content file against the Zod schemas                            |
| `katex`              | job, deploy    | every formula through KaTeX with `throwOnError`                       |
| `rendered-page-scan` | module, deploy | no `.katex-error` or raw TeX on a built page, islands' props included |

The gates run on Node's own TypeScript support, so files they import use `.ts` extensions and
erasable syntax only (`erasableSyntaxOnly` in `tsconfig.json` enforces it).

## Scripts

| Script                 | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `npm run dev`          | Dev server on the Fixture Course                              |
| `npm run build`        | Static build into `dist/`                                     |
| `npm run check`        | `astro check` (TypeScript strictest, `.astro` files included) |
| `npm run lint`         | ESLint                                                        |
| `npm run format:check` | Prettier                                                      |
| `npm test`             | Vitest: builds the Fixture Course and its negative controls   |
| `npm run gates -- …`   | The gate runner (see Gates)                                   |

Dependencies are pinned to exact versions (`.npmrc` has `save-exact`); commit the lockfile with
any change to them. CI (`.github/workflows/template-ci.yml`) runs all of the above.
