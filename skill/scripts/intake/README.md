# Intake commands

Intake starts a new Course: the interview's answers, the pad, the media budget check, the Course
project and its Build ledger, the hashed Materials inventory and the proposed Module map. The skill
runs these commands; nothing here is edited by hand.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/intake.ts" <command> [flags]
```

Node 24.16+ runs the TypeScript directly; nothing is installed. Each command prints one JSON
document (`{"ok": true, ...}` or `{"ok": false, "error": "..."}`) and exits:

| Exit | Meaning |
| --- | --- |
| 0 | done |
| 1 | a check found problems (`host`: the live site isn't noindex; `findings` says how) |
| 2 | bad flags or input (answers that fail their schema, a missing folder, an unknown release tag) |
| 3 | refused: what's on disk, on GitHub or on Vercel doesn't allow it (nothing was made) |
| 4 | internal error (a bug; the stack is on stderr) |

## The answers file

The interview's answers, once the Owner has confirmed them, as one JSON file:

```json
{
  "courseName": "Heat Transfer",
  "code": "MEP 321",
  "slug": "heat-transfer",
  "materialsPath": "D:\\Claude Os\\heat transfer",
  "disciplines": ["Heat transfer", "Mathematics"],
  "pad": "teal",
  "arabicNotes": false,
  "sittings": [{ "id": "midterm", "name": "Midterm", "date": "2026-11-10" }, { "id": "final", "name": "Final", "date": null }],
  "expectedModules": 12,
  "professor": "…",
  "university": "…",
  "owner": "Seif Younes"
}
```

- `slug`: the Course project's folder in the workspace, and its GitHub repo and Vercel project name
  (lower-case-dashes).
- `disciplines`: the confirmed Disciplines, the main one first (it picks the pad).
- `pad`: a catalogue key (`green`, `bluegrey`, `teal`, `violet`, `steel`, `graphite`, `indigo`) or the
  colour (`#RRGGBB`) the Owner named for a custom pad, which the template builds and auto-fixes.
- `sittings`: the Exam sittings known so far; `id` is the sitting's route (lower-case-dashes), `date`
  `YYYY-MM-DD` or null until known.
- `expectedModules`: how many Modules the Owner expects this semester (1–99), for the media budget.
- `professor`, `university`, `owner`: the Credit line and the About page.

## Commands

| Command | Does |
| --- | --- |
| `pad --discipline D` | The pad to suggest for the main Discipline: `{pad, label, match, listed}`. `match` is `catalogue` (the Discipline's own pad), `nearest` (an unmapped Discipline gets the nearest listed Discipline's pad: control and automation → Blue-grey, fluids and thermodynamics → Teal, statics and strength of materials → Steel) or `fallback` (Graphite-grey when nothing listed is close). |
| `propose --materials DIR` | The hashed Materials inventory (`inventory`: each file's `path`, `kind`, `hash`, `bytes`; OS clutter and `.git/` left out) and a proposed Module map (`proposal`) in `ledger map`'s input shape: one Module per lecture, week or chapter number found in the file and folder names, every other file `unmapped`. A starting point: refine the titles from what the Materials say, then the Owner confirms or edits it. |
| `budget --answers FILE [--state DIR]` | The media budget check: this Course's semester demand (`course`: a video, an audio and an infographic per expected Module, a sitting audio per sitting, in items and in NotebookLM's usage unit) against what the weekly cap can make from today to the last dated sitting, less what the last 7 days already spent (`window`, `capacity.used`, `capacity.units`), once every registered Course's outstanding demand is met (`others`, `capacity.committed`; a Course's demand is its expected Modules, or its mapped ones when none was recorded, less every item already started; a Course whose sittings are all past is `ended` and wants nothing). `verdict` is `fits`, `over`, or `unknown` with a `reason` (no dated sitting, a registered Course that couldn't be read, or NotebookLM's usage not measured yet). It reports; the Owner decides. |
| `create --answers FILE --workspace DIR --release TAG --holder H [--source DIR] [--state DIR]` | Creates the Course project (below). `--source` is the release repo, by default the release worktree this script runs from; `--release` is the installed Template release. Returns `{project, privateFolder, release, templateFiles, commit, registry, catalog}`. |
| `host --project P` | **Owner step: only on the Owner's yes.** Makes the private GitHub repo `<owner>/<slug>` (through `gh`, signed in as the Owner), adds it as `origin` and pushes `main`; makes the Vercel project `<slug>` linked to it (Root Directory `template`, `CONTENT_DIR=../content` for every environment) and asks for its first production deployment; waits until production serves that commit, then checks the live home page answers 200 with `X-Robots-Tag: noindex` and a robots noindex meta. Returns `{repo, vercelProject, url, commit, created, findings}`. Reads `VERCEL_TOKEN` (and `VERCEL_TEAM_ID` for a team account). Makes nothing twice, so a failed run is run again; refuses (3) a repo of that name that isn't this project's `origin`, a public repo, a Vercel project linked to another repo, or uncommitted changes. |

## What `create` makes

Everything is checked first (the Materials folder, the workspace's MEMORY.md project catalog, the
release tag, that the project folder doesn't exist and isn't inside the Materials, and that the
Private folder would sit outside any repo); the project is then built in a fresh staging folder and moved
into place whole, so a refusal leaves nothing behind.

- `<workspace>/<slug>/`, the /newproject way: `README.md`, `CLAUDE.md` (inheriting the workspace's),
  `.gitignore`, and one commit on `main`, `chore: create the <Course> Course project`.
- `template/`: every file of the Site template as the release tag holds it (from git's objects, never
  a working tree). It is read-only: the Build ledger pins the release and every file's hash, and
  `ledger integrity` reports any edit.
- `overrides/`: the Course overrides area, empty.
- `content/course.yaml` (the course config: name, code, pad, the Credit line, the owner) and
  `content/modules/`. The Exam sittings stay in the Build ledger until Modules are mapped to them: the
  template lists a sitting with the Modules it covers.
- `build-ledger.json` with the intake answers (`ledger init`), its lock held by `--holder`, and its
  generated pages in `build-records/`.
- The Private folder, `<Materials folder> (private)` beside the Materials.
- The Course in the Course registry (`media.ts register`), and a row in the workspace MEMORY.md's
  Project catalog.

The Materials are referenced by path only. Before the first commit, `create` refuses if any file it
wrote matches a Materials file's hash.

Tests: `npm test` in `skill/` (Vitest, synthetic Materials, a throwaway release repo; GitHub and
Vercel faked).
