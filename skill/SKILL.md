---
name: learn-premium
description: >-
  Turns a course's Materials (lecture PDFs, slides, board photos, sheets, past exams, notes) into a
  premium interactive Study site for any engineering subject (math, logic and electric circuits,
  heat transfer, machinery, chemistry, ML…), with verified content, worked examples, live sims,
  video cards and timed exam sittings, deployed with every accuracy gate green. Use whenever Seif
  types /learn-premium or /crash-course, asks for a "study site", "exam prep site", "crash course
  for X", wants lectures/PDFs/notes turned into a site, says "help me ace the X final", or names any
  subject with course materials to study, even without saying "website". Also use to resume or
  extend a Course already built ("continue the circuits site", "add Module 5", "upgrade my site to
  the new release").
argument-hint: <Materials path>
---

# learn-premium

Turns one Course's Materials into a Study site. The words used here (Course, Materials, Template
release, Build ledger, Owner…) are defined in the repo's `CONTEXT.md`.

This skill folder is `~/.claude/skills/learn-premium`, a junction into
`~/.claude/learn-premium/release/skill`: a git worktree detached at one Template release tag. The
skill, the Site template (`../template/`) and the gates are all read from that worktree, so they
always come from the same tag. Never read them from `main`, from the Owner's development clone, or
from any other checkout.

## Run start

Do these in order on every run, before touching the Materials.

### 1. Check the install

Run:

```bash
uv run --no-project --python ">=3.12" "$HOME/.claude/skills/learn-premium/scripts/machine_install.py" check
```

The first line is a summary for the Owner; the JSON after it is the full report.

- **Exit 1 (something is missing):** show the Owner the summary line and each `missing` entry, and
  offer to run the installer named in `installer` (`powershell -ExecutionPolicy Bypass -File
  <installer>`). Run it only on the Owner's yes, then check again. Don't continue the run on a
  broken install.
- **`releases_behind` > 0:** tell the Owner the summary line as is ("N commits / M releases
  behind…"). Moving to a newer release is the Owner's call: never pull, check out or re-run the
  installer on your own, and never while a Module, Sitting or Upgrade wave is under way. Carry on
  at the installed release.
- **`fetch_error` set:** say origin couldn't be reached, so "behind" may be stale, and carry on.

Note `installed_release`: the Build ledger records it for each wave this run starts.

### 2. Read the Build ledger and take the lock

The Build ledger is read and written only through its commands (`scripts/ledger/README.md`); never
edit `build-ledger.json` or the pages generated from it. Pick a holder id for this run (for example
`run-<date>-<time>`) and use it on every write.

The Course project is found from the Materials path through the Course registry:

```bash
I="$HOME/.claude/skills/learn-premium/scripts/intake.ts"
node "$I" find --materials "<Materials path>"
```

`project` null means no Course project has these Materials yet: that's intake (below), with nothing
to lock. But when `skipped` lists registered Courses whose ledger couldn't be read, one of them may
be this Course: show them to the Owner and start intake only once they're ruled out. Otherwise:

```bash
L="$HOME/.claude/skills/learn-premium/scripts/ledger.ts"
node "$L" next --project <Course project>
```

If `next` says `intake`, there is no ledger yet and nothing to lock: intake's `init` creates the
ledger with this run holding the lock. Otherwise claim it before anything else:

```bash
node "$L" lock claim --project <Course project> --holder <id>
```

- **Exit 3 on the claim:** another session drives this Course. Tell the Owner who holds it and
  since when, and stop. Take it over (`--take-over "<reason>"`) only when the Owner says that
  session is dead.
- **Exit 2:** the ledger fails its schema. Show the Owner the error; don't repair the file by hand.
- Release the lock (`lock release`) when the run ends.

### 3. Pick the path

`next` says which: `intake` (no ledger), `resume` (an unfinished wave), or `waves` (new Materials
to map and the Module waves the hash diff implies). Module waves run as the Module wave section
says. When `next` says `waves`, offer the Upgrade wave first if the installed release is newer than
the Course's pinned one (the Upgrade wave section below); `resume-upgrade` means one is under way.

Run `next` on every run, also while waves are running. `resume` lists the running waves, `toStart`
(the Module waves that can start alongside them, as many as the cap leaves room for: three at once,
`LEARN_PREMIUM_MAX_WAVES` changes it) and, as `waves` does, `newMaterials` with a `proposal`: the
Module map addition for the new files (each into the Module its name numbers, or as a new Module;
unnumbered files unmapped). Show the proposal to the Owner; on his word, `$L map --input <file>` takes
it (a file he edits is taken as he edits it), then `next` again. A changed or deleted Materials file
flags its Module (`materials-changed`, `materials-deleted`) for a fresh wave; when every file of a
Module is deleted, ask the Owner whether to supersede the Module or rebuild it, and start no wave
without his word.

"Sitting X is complete" is the Owner's command, never a question you ask: when he says it, record it
and run the Sitting wave as that section says. `next` never proposes a Sitting wave.

## Intake

A new Course gets one interview up front, so later questions come only at the step that needs them.
The commands are in `scripts/intake/README.md`; `$I` is `intake.ts` as above.

1. **Read the Materials first.** `node "$I" propose --materials "<Materials path>"` gives the hashed
   Materials inventory and a proposed Module map. Look at the file names and first pages (through the
   Materials reader) enough to suggest the Course's Disciplines from the starting list (ML, maths,
   electric circuits, logic circuits, heat transfer, machinery, engineering chemistry, automation and
   control) and to give the proposed Modules real titles.
2. **Ask once, in one batch:** Course name and code, the Professor and University (for the Credit
   line), the Owner's name as the About page should show it, the Disciplines you suggest (the Owner
   confirms or edits; the main one first), the Arabic-notes toggle, the known Exam sittings (name,
   and date if known), and how many Modules the Owner expects this semester. Propose the project
   folder name (`slug`, lower-case-dashes). A Discipline off the starting list is added only here, at
   intake, with its own Toolkit: read `references/discipline-tools.md` (§3 matrix, §5 licences), pick
   the nearest listed Discipline, and write a proposal as a JSON file in the scratchpad (the intake
   README's shape): its interactions, each with the Agent-built tools the template ships (the default
   first; none when no engine is built) and the ready-made candidates the matrix names, with the
   evidence for each of the five eligibility checks. A non-commercial-only licence (the Desmos API
   trial, GeoGebra) fails "embeddable", since a Course project can go public. PhET and Falstad are
   never a tool, only credited links. Run `node "$I" toolkit --input <file>` and post its `question`
   in the batch; the Owner judges feel on each eligible candidate on its own demo beside the
   Agent-built tool. Then put the Toolkit he confirmed, his feel picks (`chosen`) and his words in
   `added` in the answers file: `create` refuses a Discipline off the list without them, and only then
   writes it into `content/course.yaml` and the ledger. A ready-made tool he picks is recorded, but the
   template ships none, so the Agent-built tool is built meanwhile. The Discipline stays **unproven**
   (see Tool assignment) until he says it met the bar.
3. **The pad:** `node "$I" pad --discipline "<main Discipline>"`; suggest it (say when it's the
   nearest listed Discipline's, or the Graphite-grey fallback) and the Owner confirms or swaps it,
   from the catalogue or by naming any colour (`#RRGGBB`). If the main Discipline is one you added,
   take the pad from `toolkit`'s answer.
4. Write the confirmed answers to a JSON file in the scratchpad (the README's shape) and run the
   **media budget check**: `node "$I" budget --answers <file>`. Report this Course's demand against
   the remaining capacity in a line or two; on `over` or `unknown`, say why, and go on only on the
   Owner's word.
5. **Create the Course project:** `node "$I" create --answers <file> --workspace "<workspace>"
   --release <installed_release> --holder <id>`. The workspace is the folder holding the Owner's
   projects and the MEMORY.md project catalog (`D:\Claude Os`). Report the project and Private
   folder paths.
6. **The Module map:** show the refined proposal (each Module with its Materials, and the unmapped
   files). Once the Owner confirms or edits it, write it with `ledger.ts map --project <Course
   project> --holder <id> --input <file>`, and commit `build-ledger.json` and `build-records/` in the
   Course project (`chore: map the Modules`).
7. **GitHub and Vercel (Owner step):** say what `host` will make (the private repo `<owner>/<slug>`,
   the Vercel project `<slug>` building `template/` from `content/`, the first deploy of `main`) and
   run `node "$I" host --project <Course project>` only on the Owner's yes, with `VERCEL_TOKEN` set.
   Report the live URL, or each finding when the site isn't noindex (exit 1), and never retry by
   deleting anything: a re-run makes nothing twice.
8. Release the ledger lock. The next run's `next` picks up Module 01.

## Module wave

One Module from its Materials to live: read, reconcile, write, recompute, gate, Checkpoint, merge.
On a new Course, Module 01's wave runs alone and writes the Course style sheet, and the ledger
refuses any other Module's wave until it merges. After that, ready Modules run in parallel, each its
own wave on its own branch. A Module waiting at its Checkpoint never holds up the others. `$W` is
`scripts/wave.ts` (`scripts/wave/README.md`), `$L` is the ledger, and `<P>` is the Course project.
The Private folder is `<Materials folder>-private`. Record every job with `$L record job --wave
<W> --job <name> --result … --started-at <when you launched it>`, timed by you, not self-reported.
A blocked job gets two fix rounds, then its fallback, else a Checkpoint item.

**Its own worktree.** Once Module 01's wave has merged, each wave runs in its own git worktree of
`<P>`, on its own branch, so several waves run at once without sharing files (Module 01's wave runs
alone, in `<P>` itself on its branch, and is the one wave that commits the ledger on its branch, step 10):
`git -C <P> worktree add -b module/NN-<slug> <P>-waves/NN-<slug> main`, then `npm ci` in its
`template/` (the template layer's gates run there). Call that worktree `<T>`. Every file, gate,
commit and push of the wave is in `<T>`; the ledger and `wave.ts` commands keep `--project <P>`, the
main checkout, which stays on `main`: the Build ledger is read and written only there (a command
given `<T>` as `--project` exits 2). A re-run wave (a Module's files changed) takes the branch
`module/NN-<slug>-<n>`, `<n>` being the wave's number. At most three waves run at once by default
(each worktree holds its own `npm ci`): start the next when one merges. Remove `<T>` once its wave
ends, merged or failed (`git -C <P> worktree remove <T>`).

1. **Start:** make the worktree first, then `$L wave start --kind module --target NN --branch
   module/NN-<slug>` for that branch. The Module's Materials are in `$L status` (its `materials`).
2. **Two Blind readers** (`briefs/blind-reader.md`), launched together as subagents. Each is given
   only the Module's Materials, the Private folder and its own output file
   (`<Private>/waves/NN/reading-a.json` or `reading-b.json`), and neither ever sees the other's.
3. **Reconcile:** `node "$W" reconcile --project <P> --module NN`. While it exits 1, settle each dispute
   on its rendered region. Cut the crop with the Materials reader's `crop` (the render path is in that
   file's reader manifest, the box in the dispute) into `<Private>/waves/NN/crops/`, look at it, and
   rule in `<Private>/waves/NN/resolutions.json`: `a`, `b`, `read` (with the value the render shows),
   or `unreadable` when the render can't decide. Never use the text layer, and never guess.
4. **Module 1 only, the Course style sheet** (`briefs/style-sheet.md`): `content/style-sheet.yaml`,
   with its machine-readable notation and units.
5. **The writer and the recompute**, as parallel subagents: the content writer (`briefs/writer.md`)
   writes `content/modules/NN-<slug>/`, and the independent recompute (`briefs/recompute.md`) writes
   `content/build-records/recompute/NN-<slug>/worked-<n>.json`, never seeing the writer's files. An
   Agent-built sim gets its own sim builder and its own recompute log.

   **Tool assignment and the sim builders** (`Tool assignment and sim builders` below): write the
   assignment, `node "$W" assign --project <P> --holder <id> --wave <W> --input <file>`. Exit 1 asks
   the Owner about a Discipline now, in chat, before any builder starts. Then launch one sim builder
   per `builders` entry (`briefs/sim-builder.md`), note when you launched each, and when it hands back,
   `node "$W" handback …`, then `record job --job <sim-… or tool-…> --started-at <launch>`.

   **The YouTube hunters** (`briefs/youtube-hunter.md`), one subagent per topic, launched with the
   writer. Each is given the settled reading's topics in the Professor's order, the do-not-use list
   and its own output file (`<Private>/waves/NN/youtube/hunt-<topic>.json`). Record each as job
   `youtube-<topic>`, `passed` even when it finds nothing at 9. **Video cards:** a card ships only at
   a 9/10 match, and only once you have checked it yourself.
   1. Save each candidate's transcript at `<Private>/waves/NN/youtube/transcripts/<id>.txt` yourself,
      from the video's transcript panel in the built-in browser. Never use the hunter's.
   2. Run `node "$W" videos verify --project <P> --module NN` until it exits 0 (1 means a transcript is
      still to save). It asks YouTube's oEmbed, takes the title, channel and length from YouTube, and
      keeps a moment only where its quote is heard within 20 s of the time. It writes `verified.json`.
      A re-run wave hunts again if the Module's Materials changed: `verify` refuses a hunt file
      older than them, and `ready` a `verified.json` older than them.
   3. Copy only `verified.json`'s `cards` into `media.yaml`'s `youtube` block, in the Professor's
      teaching order. `ready` refuses a card it didn't pass or one that differs from it.
   4. A video that yields the Professor's answer by another method: `node "$W" videos never --project
      <P> --id <id> --reason "<why>"` puts it on the do-not-use list for the whole Course.
6. **Per-job gates**, from `<P>/template` (after `npm ci`), always on the Course's content. First build the Module's molecules, if it has any: `npm run molecules -- --module NN-<slug>` in the machine venv, then `npm run pubchem -- --module NN-<slug>` online (offline it leaves a Checkpoint item). Then:
   `npm run gates -- run --point job --module NN-<slug> --content ../content`. A block goes back to
   the job that made it. Re-verify every finding before blocking on it.
7. **Your consistency pass:** read the Module through against the style sheet and the settled
   reading: the Professor's order of working, voice, notation, nothing contradicting another Module.
   Fix what you find. A contradiction in another Module is not edited in this wave (`ready` refuses a
   branch that changes another Module's files): name it in this wave's Checkpoint batch, and the Owner
   decides whether that Module gets a fresh wave.
8. **Commit, then gate the commit.** A Gate report taken on uncommitted changes binds to no commit
   and never verifies, so: commit the content (the pre-commit gate checks every commit), re-run the
   job gates on it, and commit the job report. Push the branch and wait for its Vercel preview of
   that commit. **Per-Module gates on the preview:** build the same commit first
   (`CONTENT_DIR=../content npm run build`, into `dist/`; the page gates read it), then `npm run gates
   -- run --point module --module NN-<slug> --content ../content --dist dist --url <preview URL>`.
   Then the **deploy gates** on a production build of the
   Course's content: `CONTENT_DIR=../content VERCEL_ENV=production npm run build -- --outDir
   dist-production`, then `npm run gates -- run --point deploy --content ../content --dist
   dist-production`. In a wave's worktree the deploy gates' `no-materials` check reads the Materials
   hashes from the nearest `build-ledger.json`: the copy committed in `<T>`, not the live one in
   `<P>`. So whenever Materials were added or changed (`map`, or `wave start` of a re-run wave),
   commit the ledger files on `main` before cutting `<T>` (or after, then rebase `<T>` onto `main`):
   `ready` refuses a worktree whose ledger lacks a Materials hash the live ledger has. That is the
   only time the ledger is committed on `main` while another wave runs. Commit the Gate reports (only build records change, so they still prove the
   content commit). Any content change after this re-runs all three points.

   **The fresh reviewer**, once the module gates are green. Take its screenshots of the preview:
   `npm run gates -- shots --module NN-<slug> --url <preview URL> --commit <the content commit>
   --out <Private>/waves/NN/review/shots`. Launch a new reviewer subagent (`briefs/reviewer.md`;
   never one that saw the writing or an earlier review) with that commit. It compares the screenshots
   with the Materials' rendered pages and reads the content adversarially against them, into
   `<Private>/waves/NN/review/review.json`. Then `node "$W" review --project <P> --module NN`.
   **Re-verify every finding yourself before it blocks:** crop its Materials region (or open its
   screenshot), look, and record a verdict in `<Private>/waves/NN/review/verdicts.json`
   (`scripts/wave/README.md`): `confirmed`, on that crop, naming the job that fixes it, or
   `rejected`, with the reason. A confirmed finding blocks the `review` job: its job fixes it, the
   gates re-run on the new commit, and a fresh reviewer reviews again. Record `review` passed once
   `review` exits 0.
9. **The Checkpoint:** `node "$W" checkpoint --project <P> --module NN`. Post its `markdown` in chat as
   one batch: every item links to its exact spot on the preview, or names its crop. Store each
   answer: `$L record checkpoint --wave <W> --key <key> --question "<the item's question, exactly as
   the Checkpoint gives it>" --answer "<the Owner's words>"`, adding `--ruling slip|divergence` for
   a sheet-vs-recompute item. Only the Owner rules Slip or Divergence: `ready` holds every Slip and
   Divergence the content ships to a stored ruling on the sheet value its question names. One no gate
   raised (a Practice answer, a Summary value) is asked like any other item and recorded under
   `NN/ruling/<name>` with the question `<content file>: … prints <value>, but …`. A job that can't go
   on without the Owner records `--result checkpoint --detail "<what it needs>"`, and joins the batch. Apply each answer: a Slip ships the corrected value with `provenance.slips`, a
   Divergence keeps the Professor's value with `provenance.divergences`, an unreadable region takes
   the Owner's reading, a conflict follows the Owner's pick. Re-run the gates and the Checkpoint until
   nothing is open or unapplied.
10. **Merge only on green + answered:** `node "$W" ready --project <P> --wave <W>` must exit 0. It
    reads the wave's own checkout, `<T>` (the worktree git lists for its branch), with nothing
    uncommitted there. The ledger and build records are not committed on a worktree's branch: they
    live in `<P>` and are committed on `main` after the merge (below). (Module 01's wave runs in `<P>`
    itself: commit the ledger and build records on its branch first, as they live there.) If `main` has moved since the branch
    was cut (another Module merged), `ready` says so: rebase `<T>` onto `main` (a conflict only in
    `content/build-records/gate-reports/`: take main's, finish the rebase, and re-run the gates; any
    other conflict: stop and tell the Owner), re-run the gates, and run `ready` again. A Gate report is
    bound to the commit it checked. Then `git -C <P> merge --ff-only <branch>` (the wave's branch, as `$L status` lists it) (Module 01's
    wave: `<P>` is on its branch, so `git -C <P> checkout main` first) and push
    `main`. Record `$L wave end --wave <W> --result merged --commit <full sha>`, then commit the
    ledger files on `main` (`git -C <P> add build-ledger.json build-records`, commit, push). Do that
    only now, or when no wave runs: every move of `main` makes the other waves rebase and re-gate. Then
    `git -C <P> worktree remove <T>` (Module 01 has none). Once Vercel deploys `main`, run the live gates on the live URL
    (`run --point live --url <live URL>`). A red live run rolls Vercel back (`template/README.md`,
    Deploy) and goes to the Owner.

    **A dead video card** never turns the live run red: the `live-videos` gate raises it as a
    Checkpoint item ("is dead"), and it is hidden after the deploy. For each such item in the live
    report: (1) `node "$W" videos hide --project <P> --report <live report>` (on `main`; it removes
    the card and lists it on the do-not-use list); (2) post its `markdown` to the Owner; (3) build for
    production and run `--point deploy`; (4) commit `fix: hide dead video cards` with the deploy
    report and push `main` (this falls in the post-merge window above); (5) after the deploy, run the
    live gates again: no "is dead" item may remain. A "couldn't check" item is only told to the Owner.

### Fix rounds and fallbacks

A job is blocked when its gates or the fresh reviewer find a problem it made. Record each blocked
result: `record job` answers with its `fixRounds` and, once both are spent, what comes `next`. The
first block sends the job back to fix it (fix round 1); a second block, fix round 2; a third block
spends them. Then name the job by what it makes so its fallback is known, and take it:

- `sim-<name>`: the figure gets a step-through animation instead of the sim;
- `tool-<name>`: the next tool in the Discipline's Toolkit;
- `media-<kind>`: the media item is dropped, and the Module goes live without it.

Record `--result fell-back --detail "<what it fell back to>"`. A job with no fallback (the writer,
the recompute, a gate run) records `--result checkpoint --detail "<what it needs>"` and joins the
batched Checkpoint. The ledger refuses another try once the rounds are spent, and `ready` refuses
any job of the wave left blocked: a Module never merges red, and never stalls on one job.

A builder job of the tool assignment (`sim-<name>`, `tool-<name>`) takes its fallback with `node "$W"
fallback --holder <id> --wave <W> --job <job> --started-at <launch>` instead, which records
`fell-back` and the new `ships` in the assignment together.

### A subagent that dies

When a subagent dies mid-job (no report, a broken session), relaunch it, but never on top of
unchecked work. First re-gate what its predecessor left: `node "$W" relaunch open --project <P>
--holder <id> --wave <W> --job <name> --files <paths…>` (paths in the wave's worktree `<T>`, or
`private:<path>` in the Private folder; a folder means every file in it). It returns each file with
what the re-gate found. Give that to the relaunched subagent with its brief and
`briefs/relaunch.md`: it reviews each file and leaves it kept, fixed or discarded before building
on it. Record the outcomes with `relaunch close --outcomes <file>`; the ledger keeps them per file
and the build report lists them, and `ready` waits for every relaunch to close and for the relaunched job to record its own result. A relaunched Blind
reader takes no `--files`: it gets its own predecessor's reading only, never the other reader's
output.

### Tool assignment and sim builders

Each Module wave decides which tool each Worked example and Lab item gets, from the Toolkits of the
Course's confirmed Disciplines (`scripts/wave/toolkits.ts`: the Disciplines' interactions and the
tool built for each; the Owner may change them). You write the assignment once the settled reading
is in: each Worked example is `computable` (it gets a tool) or an `illustration` (its figure stays
`static`, `animate`s or has `none`), and each tool names its file's `name`, its `worked` example (null:
Lab only), its `discipline`, its `interaction` and the Toolkit `tool` it is built as. `assign` refuses
a computable example with no tool, an illustration with one, and a tool its Discipline's Toolkit lacks
(2). A Discipline the intake didn't list exits 1 with the question to put to the Owner now, in
chat, not in the batched Checkpoint: record his answer with `node "$W" discipline --holder <id> --wave
<W> --name <D> --confirmed yes|no --answer "<his words>"` (it also becomes a Checkpoint row), then run
`assign` again. A Discipline the Toolkit doesn't list and the intake didn't add is refused (3): it is
added only at intake. A Discipline the intake added needs no answer, and `assign` and `fallback` use
the Toolkit the Owner confirmed for it. PhET and Falstad are refused as a tool (2).

A Discipline added at intake is **unproven**: every Checkpoint of a Module with its tools asks the
Owner to review each of those tools on the preview (a `kind: "unproven"` item), and the build report
lists it as unproven. Once a Module with its tools has merged, ask the Owner whether it met the bar
and record his word with `node "$L" proven --project <Course project> --holder <id> --discipline "<D>"
--answer "<his words>"` (refused until then); from that point the report says proven and no item asks.

One sim builder runs per tool, in parallel, each given `briefs/sim-builder.md`. It writes its tool
file only and leaves its hand-back in `<Private>/waves/NN/builders/<name>.json`: the figure it read,
its files, part and net counts, assumptions, unreadable regions and its self-check. It reports no
time: you measure it, so record the job with `--started-at` from when you launched it. `handback`
checks it. A failed self-check, an unreadable region (settle it on its crop yourself, or record the
job `checkpoint`) or counts that disagree with the sim's model go back (exit 1, nothing stored). Only
its counts reach the Build ledger and the build report, never its text.

After two fix rounds a sim falls back to a step-through of the Professor's figure, and a tool to the
next tool in its Discipline's Toolkit; one with none goes to the Owner (`fallback`, above). `ready`
holds the Module's content to the assignment (every example and tool in the content has its entry,
and each tool is what it ships), every builder job passed and timed, and every subagent job timed.
`build-report.md` lists every assignment and fallback, the measured time, and the pad's contrast
auto-fixes from the deploy Gate report, for the Owner to overrule.

## Sitting wave

One Exam sitting from the Owner's word to live: its past-paper vault, mocks and question bank (the
Exam room), and Revision. Only the Owner starts it: "sitting X is complete" is his command, and you
never ask whether a sitting is. `next` never proposes one, and the ledger refuses `wave start --kind
sitting` without his recorded word. `$W` is `scripts/wave.ts`, `$L` the ledger, `<P>` the Course
project, `<ID>` the sitting's id; the Private folder is `<Materials folder>-private`. Record every job
with `$L record job --wave <W> --job <name> …` as the Module wave does (two fix rounds, then a Checkpoint
item). The template's side (the pages, the `sitting` gate point) is in `template/README.md`.

1. **His word.** Show him what you propose, then record it: the Modules the sitting covers (each
   must be live before the wave merges), the past papers (Materials files, each with a short name
   such as `2025`) and, if the Professor announced the exam's format, the Owner's own words for it.
   `$L sitting complete --holder <id> --input <file>`, the file `{"sitting": "<ID>", "modules":
   ["01"], "papers": [{"slug": "2025", "path": "<Materials path>"}], "announced": "<his words>" or
   null, "answer": "<what he said>"}`. It doesn't start the wave, and a later word supersedes it.
   No past papers means Revision only: name none, and no mocks or format get built.
2. **Start.** `git -C <P> worktree add -b sitting/<ID> <P>-waves/sitting-<ID> main`, `npm ci` in its
   `template/`, then `$L wave start --kind sitting --target <ID> --branch sitting/<ID>`. Everything
   below happens in that worktree `<T>`; the ledger commands keep `--project <P>`.
3. **course.yaml.** In `<T>`, set `complete: true` on the sitting's entry in `content/course.yaml`
   and make its `modules` the Modules he named (by folder). That is the only change the wave makes to
   it, and the only Course-wide file a Sitting wave may touch.
4. **Two Blind readers on the papers** (`briefs/blind-reader.md`, its past-paper section), launched
   together, one file each: `<Private>/sittings/<ID>/reading-a.json` and `reading-b.json`, with the key
   scheme `<name>/q<n>/text|marks|key`, `<name>/total`, `<name>/minutes`. Then `node "$W" reconcile
   --project <P> --sitting <ID>` and settle disputes exactly as a Module's (crops under
   `<Private>/sittings/<ID>/crops/`, rulings in `resolutions.json`).
5. **The writers and the recompute**, as parallel subagents. The vault writer
   (`briefs/vault-writer.md`) puts each past paper in the content verbatim from the settled reading,
   in `content/sittings/<ID>/papers/<name>.yaml`. For a paper the Professor printed no key for, the
   solver (`briefs/solver.md`) solves it and the paper says `key: solved`; where he printed keys for only some numeric answers, the paper stays `key: professor` and the solver answers the rest. The mock writer
   (`briefs/mock-writer.md`) writes the pattern-matched mocks (two by default) and, when a format was
   announced, `format.yaml` and the announced-format mock, in `content/sittings/<ID>/mocks/` and
   `format.yaml`. The independent recompute (`briefs/recompute.md`, its past-paper section) writes
   `content/build-records/recompute/sittings/<ID>/<name>.json` for every paper and mock, and never
   sees the writers' or the solver's files.
6. **Gates.** Commit, push `sitting/<ID>` and wait for its Vercel preview. Build the same commit
   (`CONTENT_DIR=../content npm run build`), then `npm run gates -- run --point sitting --sitting <ID>
   --content ../content --dist dist --url <preview URL>`: the papers' numbers three ways (answer, key,
   recompute), their marks and faithfulness, the mocks' DNA and the announced format, Revision's
   Modules in exam-weight order, and the page gates on the Exam room and Revision. Then the deploy
   gates on a production build, as a Module wave's. A block goes back to the job that made it.
   Record `sitting-gates` and `deploy-gates`; `ready` refuses a Gate report taken on uncommitted changes.
7. **Checkpoint, then ready, then merge.** `node "$W" checkpoint --project <P> --sitting <ID>`, and post
   its `markdown` as one batch. It holds the Professor's key where the answer and the recompute
   disagree (a Slip or a Divergence, ruled only by the Owner), the build's own solution of a key-less
   paper (he confirms its answers), the announced format (he confirms `format.yaml` is what the
   Professor announced) and any job that escalated. Store each answer as a Module's. Then `node "$W"
   ready --project <P> --wave <W>` must exit 0: the Modules he named are live, the papers in the
   content are exactly the ones he named and faithful to the settled reading (text, order, marks, key),
   both Gate reports are green for HEAD on a preview, every item is answered, and nothing else in the
   Course changed. Merge as a Module wave does (`git -C <P> merge --ff-only sitting/<ID>`, push, `$L wave
   end --result merged --commit <sha>`, commit the ledger files on `main`, remove the worktree). Once
   merged the sitting is live: its Deep Dive audio joins the Media queue, so tell the Owner it is queued
   for the next "run media".

## Gate gaps and Course overrides

A gate gap is a new kind of defect that no gate caught (the Owner, the fresh reviewer or you found
it on a page the gates passed). Every one is filed on learn-premium, so it becomes a gate for every
Course. `$G` is `scripts/gate-gap.ts` (`scripts/gate-gap/README.md`).

A gate gap and its override belong to the whole Course, not to one wave: do every step below in `<P>`,
the main checkout (never in a wave's worktree), commit on `main` (step 5), and rebase each running
wave onto `main` so it picks the override up. The ledger commands take `<P>` only.

1. **Write a synthetic minimal broken fixture** in `<P>/build-records/gate-gaps/<id>/`: the smallest
   content (or page) that shows the defect, written by hand like the Fixture Course. Never copy a
   Materials file, a Private-folder file, or the Professor's wording, numbers or figures into it.
2. **The Course override, if the Course needs the fix now:** never edit `template/`. Copy the template
   file to `<P>/overrides/<same path>` and fix it there; the build loads it in place of the template
   file. Only site code and styles under `src/` can be overridden, never a gate, a script or the config.
3. **Record it at once**, before anything else can break the session: `$L record gate-gap --id <id>
   --title "<what no gate caught>" --defect "<what shipped, and which gate should have caught it>"
   [--override <template path>]…`.
4. **File it:** `node "$G" file --project <P> --holder <id> --id <id>`. It opens one issue labelled
   `gate-gap` with the fixture, the Course and each override, and records the overrides in the ledger.
   Exit 3 on a fixture file that matches the Materials or the Private folder: rewrite the fixture,
   record again and file again. A run that failed on GitHub is safe to repeat.
5. Commit the fixture, the override and the ledger. The integrity check (`$L integrity`, and `ready`)
   refuses a file in `overrides/` that no recorded override names, and any edit to `template/`.

Filing is not the Owner's call: it is how every Course's lesson reaches the others. Report each
issue number to the Owner; triaging it (its own patch release, or the next one) is the Owner's.

**Course done:** when the Owner calls the Course build done, record it with `$L done`. It is
refused while a gate gap is unfiled: file each first.

## Upgrade wave

Moves a Course to a newer Template release: the template layer re-copied, the shipped migrations run,
the overrides the release retires dropped, and every Module's gates run again on that, merged to
`main` only when all green. Nothing happens without the Owner's yes, and a red wave leaves the Course
on its release. `$U` is `scripts/upgrade.ts` (`scripts/upgrade/README.md`), `<P>` the Course project,
`$L` the ledger.

1. **Offer.** When `next` says `waves`: `node "$U" offer --project <P> --to <installed_release>`.
   `offer` null with `reason` means no newer release: carry on to the Module waves. `held` set means
   a sitting is within 7 days and the release closes none of this Course's gate gaps: say so, make no
   offer, carry on. Otherwise post the offer: the releases it crosses, each gate gap closed, the
   overrides it retires, the migrations (none unless a major), and `lastFailed` if an earlier wave
   to this release ended red (with its gate gap). Ask. No means the Module waves run as they are and
   the offer comes again next run.
2. **On the Owner's yes:** `node "$U" start --project <P> --holder <id> --to <installed_release>
   --answer "<their words>"`, then `apply`, then `npm ci` in `<P>/template`, then `migrate`
   (exit 1 is a migration that threw: the wave is red, go to Red below). Commit everything (the
   pre-commit gate checks it).
3. **Gate it, on every Module.** Push the branch and wait for its Vercel preview. Then for each Module
   folder, from `<P>/template`: the per-job gates (`npm run gates -- run --point job --module
   NN-<slug> --content ../content`); build the commit (`CONTENT_DIR=../content npm run build`); the
   module gates on the preview (`--point module … --dist dist --url <preview URL>`). Then the deploy
   gates on a production build, once for the Course (`--point deploy`, as the Module wave's step 8).
   Commit the Gate reports. Then `node "$U" ready --project <P>`. An item a gate newly raises is the
   Owner's: ask as in the Module wave's Checkpoint, and store the answer with `$L record checkpoint
   --wave <upgrade id> …`.
4. **Red.** Read `problems`. If dropping an override is the suspect, restore the retired overrides
   in a scratch run and see which fail; for each that does, `node "$U" keep --project <P> --holder
   <id> --path <override> --reason "<which gate fails>"` (it reopens that gate gap on learn-premium
   and restores the file), commit, and gate again. Still red, or a migration threw, or a file can't
   be kept: the wave fails. Commit the branch, `git switch main`, write the synthetic minimal
   fixture of the defect (the gate-gap section's step 1), `$L record gate-gap`, file it with the
   gate-gap step, and `node "$U" end --project <P> --holder <id> --result failed --gate-gap <id>`.
   Commit the ledger. The Course stays on its release. Report the gate gap's issue to the Owner.
5. **Green.** `node "$U" merge --project <P> --holder <id>` (it fast-forwards `main` and moves the
   ledger to the release), commit the ledger and `build-records/`, push `main`, and once Vercel deploys
   it run the live gates (`run --point live --url <live URL>`). A red live run rolls Vercel back
   (`template/README.md`) and goes to the Owner.

`resume-upgrade` from `next`: `git switch` to its `branch` and carry on from whichever step the
ledger and `ready` show. Content and course config change only through a shipped migration: never
hand-edit them in the wave, and never touch `template/` or `overrides/` beyond these commands.

## Media pass

"Run media" is an explicit Owner command, separate from any Module wave and needing no ledger lock:
it drains the one Media queue across every Course in the Course registry, within the NotebookLM
quota. Its state commands are in `scripts/media/README.md`; NotebookLM is driven as `notebooklm.md`
says, through Claude in Chrome in the dedicated Chrome profile, falling back to the Notebook recipe
the Owner follows by hand. Start by reporting `media.ts status`: the queue, the demand against the
remaining capacity, and any limit in force. `$M` is `scripts/media.ts`, `<P>` the Course project and
`<D>` its Private folder. The Python commands run with the machine venv (`--python` defaults to it;
its PyAV is the re-encoder, so no ffmpeg is installed). Move each downloaded item (`ingest` leaves
it `downloaded`, its master in `<D>/media/masters/`) through the rest of the pass:

1. **Evidence:** `node "$M" evidence --project <P> --item <I> --private <D>` transcribes an audio or a
   video locally and samples its frames (or takes the infographic itself), into
   `<D>/media/evidence/<I>-<n>/`. It returns the paths and the one file to write.
2. **The fact check** (`briefs/media-check.md`): launch a fresh subagent per item and attempt, given
   the evidence folder, the Module's content and build records and the style sheet. It writes the
   check file `evidence` named, in `<D>/media/checks/`.
3. **The judge:** `node "$M" check --project <P> --item <I> --private <D>`. It is deterministic: every
   number said or shown must round from a number the Module holds (the Professor's Slips don't count
   as held), and any claim the subagent marked `wrong` or `unsupported` fails. Exit 0 is `checked`;
   exit 1 is a failure, which sends the item back to `queued` for one regeneration and drops it the
   second time. You don't re-verify the subagent's verdicts. Exit 3 refuses (a missing or stale
   file): fix what it names and run it again.
4. **Re-encode:** `node "$M" encode --project <P> --item <I> --private <D>` writes the web copy
   (H.264 up to 720p with faststart, 64 kbps mono audio, an optimised PNG) in `<D>/media/web/`. A file
   over 100 MiB is encoded harder once; still over, the item is dropped. Sizes are reported, never
   capped, and the media page lists them. Masters, evidence, checks and encodes stay in the Private
   folder and are never committed.
5. **Place, once the Module's checked items are encoded and no wave or upgrade runs:** make a media
   worktree on its own branch, `git -C <P> worktree add -b media/NN-<slug>-<n> <P>-media/NN-<slug>-<n>
   main` (call it `<T>`; `<n>` counts the passes), then `node "$M" stage --project <P> --tree <T> --item
   <I> --private <D>` for each item: it copies the web copy into the Module's `media/` folder and
   writes the item's slot into `media.yaml` (the infographic with the check's alt text; every other
   block, a `youtube:` card for one, is kept as it was). Commit in `<T>`, then gate the commit as
   Module wave step 8 does (job, module and deploy points; the content didn't change, so the
   reports are the Module's media only). `node "$M" ready --project <P> --tree <T> --module NN` must
   exit 0: the branch changes media and nothing else, every file is a checked item's re-encode, the
   gates are green for HEAD, and no Module, Sitting or Upgrade wave runs. Then `git -C <P> merge
   --ff-only media/NN-<slug>-<n>`, push `main`, run `placed --file content/modules/<folder>/media/<file>`
   for each item (it refuses a file that isn't the recorded re-encode, committed on `main`; `--unencoded` places a file the Owner made by hand, as it is), and commit
   `build-media.json` and `build-records/` on `main`. Remove `<T>`. Placed media never blocks a
   Module: it was live already, and an item that can't be placed is dropped, not waited on.

A sitting audio isn't made yet: it stays in the queue (and in `demand`), and `next` never proposes it.
A Module rebuilt after its media was placed keeps that media; it isn't checked again.

## Reading Materials

Every Blind reader reads a PDF or .pptx through the Materials reader (`scripts/reader/README.md`),
never through a PDF's text layer: it renders the pages and slides it looks at into the Private
folder (slides through PowerPoint, which the machine needs), fails loudly on a render with no
pixels, and transcribes a deck's narration there. Give a Blind reader
only the Private folder's path for what it writes.

## Going public

Only when the Owner asks to make a Course project public. This step reports; flipping the
repo's visibility is the Owner's, so never run `gh repo edit --visibility` or change it any other
way, even on a clear report.

1. Check out the default branch, and fetch everything the remote holds, pull request refs
   included, since each becomes public with the repo:

   ```bash
   git -C <Course project> fetch origin --tags "+refs/heads/*:refs/remotes/origin/*" "+refs/pull/*:refs/remotes/origin/pull/*"
   ```

2. Run the check (`scripts/go-public/README.md`), giving it the Private folder:

   ```bash
   node "$HOME/.claude/skills/learn-premium/scripts/go-public.ts" --project <Course project> --private <Private folder>
   ```

3. Report to the Owner:
   - **`clear` (exit 0):** say so, with what it scanned. The Owner flips the visibility.
   - **`blocked` (exit 1):** list each finding with its path and commits. A file in history stays
     found until the history is rewritten; offer the rewrite, but run it (and the force-push it
     needs) only on the Owner's word, then fetch and check again. A missing Licences file is
     fixed by generating it, not by hand.
   - **`review` (exit 1, only Checkpoint items):** show each one; the Owner decides whether it's a
     secret.
   - **Exit 2:** show the error; the check didn't run.
