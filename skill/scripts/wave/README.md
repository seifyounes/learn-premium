# Module and Sitting wave commands

The steps of a Module wave (and a Sitting wave) that need a tool rather than judgement: reconciling
the two Blind readers, the batched Checkpoint, and the merge gate. The wave's order and the
subagents' briefs are in `../../SKILL.md` (Module wave, Sitting wave) and `../../briefs/`.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/wave.ts" <command> --project <Course project> [flags]
```

Node 24.16+ runs the TypeScript directly; nothing is installed. Each command prints one JSON
document (`{"ok": true, ...}` or `{"ok": false, ...}`) and exits:

| Exit | Meaning |
| --- | --- |
| 0 | done (settled, gathered, ready to merge) |
| 1 | open work: disputes to settle on their crops, or a wave not ready to merge (`problems`) |
| 2 | bad flags or input (a reading or ruling that fails its shape, a crop that isn't there) |
| 3 | refused: the ledger's state doesn't allow it (a wave that already ended) |
| 4 | internal error (a bug; the stack is on stderr) |

## Commands

| Command | Does |
| --- | --- |
| `reconcile --module NN` | Compares the two Blind readers' readings of Module `NN` in the Private folder. Exit 1 lists the `disputes` (key, file, page, box, what A and B read) still to settle. Once `resolutions.json` rules on every dispute, each on a crop in the Private folder, it writes the settled reading and returns `{agreed, disputes, settled, checkpointItems}`: an `unreadable` region and a quantity the Materials give two values for (a CONFLICT) are Checkpoint items. |
| `reconcile --sitting ID` | The same, for a Sitting wave's Blind readers: the two readings of the sitting's past papers in `<Private folder>/sittings/<ID>/` (each reading says `"sitting": "<ID>"`), settled into `reading.json` there. Its Checkpoint items are keyed `<ID>/unreadable/…`. |
| `checkpoint --module NN [--preview URL]` | The Module's batched Checkpoint: `open` (each with a stable `key`, the `question`, `sheet: true` when it needs a Slip or Divergence ruling, and its `link` on the preview or the `crop` of an unreadable region), `unapplied` (ruled, but the gate still raises it: the content doesn't carry the ruling yet), `answered`, and `markdown`, the batch to post in chat as is. Items come from the Module's Gate reports (job and module points, and the deploy point's whole-Course ones, such as a licence, keyed `course/…`) from the settled reading, and from any job of the running wave recorded with `--result checkpoint` (its `--detail` is the question); the preview is where the module point ran unless `--preview` says. What the Build ledger already answers is never asked again. An `unproven` item (`kind: "unproven"`) is raised for each tool of the running wave whose Discipline the Course added at intake and the Owner hasn't proven (`ledger.ts proven`): it asks him to check that tool on the preview, and asks again when what the tool ships changes. |
| `ready --wave W` | The merge gate for Module wave `W`. `{ready, problems}`: exit 0 only when every job ran and none is blocked (the first Module's wave also owes `style-sheet`), the Course style sheet and the Module's content exist, both readings and the settled reading are in the Private folder, the template's `verify` calls the job, module and deploy Gate reports green for HEAD, the module point ran on an `https://` preview, every Checkpoint item is answered (a sheet one with a ruling the content carries), every Slip and Divergence the content ships (the template's `gates -- rulings`) matches a stored Owner ruling on a sheet item of this Module about that sheet value, and `core.hooksPath` is the template's pre-commit gate. It reads the wave's own checkout: the worktree git lists for its branch (the Course project itself when none does). It also refuses a worktree whose committed Build ledger lacks a Materials hash the live ledger has (the deploy gates there read the Materials inventory from it), a branch that is behind `main` (rebase, re-gate, run it again), one that changes the Build ledger's files (written only in the main checkout, which must be on `main`) or another Module's files, and readings or a review older than the Module's Materials (a re-run wave runs them again). |
| `checkpoint --sitting ID [--preview URL]` | A sitting's batched Checkpoint, in the same shape: the sitting and deploy Gate reports' items (the sitting point's `past-papers` ones need a Slip or Divergence ruling, or, for a key-less paper, the Owner's confirmation of the build's own answers), the settled reading's, any job of the running Sitting wave recorded `--result checkpoint`, and, when the Owner named an announced format, one item `<ID>/announced/<hash>` asking him to confirm `format.yaml` (a changed format is asked again). |
| `review --module NN` | The fresh reviewer's review of Module `NN` (`../../briefs/reviewer.md`): exit 0 once every finding has the main agent's verdict and none is confirmed. Exit 1 lists `problems` (no review yet; screenshots of another Module or commit, a view `shots.json` lists that isn't there, or no phone or laptop shot), the `unverified` findings (each with its `key`), and the `confirmed` ones (each with the job that fixes it); `next` says what to do. |
| `relaunch open --holder H --wave W --job J [--files P…]` | A subagent relaunched after its predecessor died: re-gates the predecessor's files (paths in the wave's worktree, or `private:<path>` in the Private folder; a folder is every file in it) and returns each with `covered` and its `findings`, then records the relaunch open in the Build ledger. Content files go through the template's per-job gates on the Module; a Blind reader's reading is checked on its shape. A Blind reader (`blind-reader-a`/`-b`) is given its own reading only: naming any other file (the other reading, the settled one) is refused (2), and the output carries nothing of the other reader's. |
| `relaunch close --holder H --wave W --job J --outcomes FILE` | `{"files": [{"path", "outcome": "kept"\|"fixed"\|"discarded"}]}` for every predecessor file. Exit 1 with `problems` unless each holds as the files are now: kept = unchanged and clean at the re-gate; fixed = changed, and clean on a fresh re-gate; discarded = deleted. Then the ledger records each file's outcome (and hash) and the relaunch closes. |
| `videos verify --module NN` | Re-verifies the YouTube candidates Module `NN`'s hunters proposed (`waves/NN/youtube/hunt-<topic>.json`, `../../briefs/youtube-hunter.md`) and writes `verified.json`: the cards, paste-ready for `media.yaml`, each rejection with its reasons, and each dropped moment. A match below 9/10 is rejected and never probed; so is a video on the do-not-use list or one oEmbed doesn't answer 200 (the template's `gates -- videos probe`). Title, channel and length are YouTube's own. A moment is kept only when its quote (4 words or more) is heard in the saved transcript (`transcripts/<id>.txt`, saved by the main agent) within 20 s of its time. Exit 1 lists the candidates still `waiting` (no transcript saved, or YouTube not reachable); exit 2: no hunt file, or one that fails its shape. |
| `videos never --id ID --reason TEXT` | Puts a video the main agent ruled off the Professor's method on the Course-wide do-not-use list (`<Private>/youtube/do-not-use.json`); `verify` and `ready` refuse it from then on. The list only grows. |
| `videos hide --report FILE` | After a production deploy: removes the cards the live report's `live-videos` items name dead from their `media.yaml` (the template's `gates -- videos hide`), lists each on the do-not-use list, and returns `{hidden, markdown}`, the report for the Owner. Refused (3) unless the project is on `main`. The commit and the deploy are the main agent's (SKILL.md, step 10). |

`ready` also refuses a wave whose committed `media.yaml` carries a YouTube card that `verified.json` doesn't hold as written (its title, channel, duration or match differs; a card's `why` and its moment labels may be reworded), that cites a moment `verify` dropped, or that is on the do-not-use list. It reads the cards through the template's `gates -- videos list`; a Module with no YouTube card asks the template nothing.

| `assign --holder H --wave W --input FILE` | The wave's tool assignment: `{module, worked: [{n, model: "computable"\|"illustration", figure: null\|"none"\|"static"\|"animate"}], tools: [{name, worked: n or null, discipline, interaction, tool}]}`. Checked against each Discipline's Toolkit (`toolkits.ts`): exit 2 for a computable example with no tool, an illustration with one (or no figure kind), a repeated or non-file name, a tool or interaction the Toolkit lacks, or a Discipline whose Toolkit (or the interaction's tool list) is empty. PhET and Falstad are refused (2) as a tool: they are credited links only. A Discipline the intake added is read from the Toolkit the Owner confirmed (`intake.added` in the ledger), and `fallback` follows that Toolkit too. Exit 1 with `ask` (`key`, `question`, `discipline`, `tools`) while a tool's Discipline isn't the Course's: nothing is recorded, the Owner is asked at once, and no builder starts. Exit 0 returns `builders` (the job, name, tool and Worked example of each) and records the assignment in the Build ledger; assigning again supersedes it and keeps the fallbacks and hand-backs of unchanged tools. |
| `discipline --holder H --wave W --name D --confirmed yes\|no --answer TEXT` | The Owner's answer on a Discipline the intake didn't list, kept as a Discipline row and as the Checkpoint row `NN/discipline/<name>`. A later answer supersedes. A Discipline the Toolkit doesn't list and the intake didn't add is refused (3): a Discipline is added only at intake, with its Toolkit (`intake.ts toolkit`); one the intake added is already the Course's and is refused (3) too. |
| `handback --holder H --wave W --name N` | Checks a sim builder's hand-back (`builders/N.json`, below) and stores only its counts on the tool's row. Exit 2 for a hand-back that carries a time (any key naming one: the main agent measures it), names a file outside the Module's content folder or `build-records/`, lacks the tool's own file, or isn't the tool's. Exit 1, nothing stored, for a failed self-check, an unreadable region (settle it on its crop, or record the job `--result checkpoint`) or a schematic sim's part or net counts that differ from its model's. |
| `fallback --holder H --wave W --job J --started-at ISO` | Falls a builder job of the assignment back once its two fix rounds are spent (3 before): a `sim-` job to its step-through (an `stl`, `scl` or `ladder` sim has none: its contract is always live), a `tool-` job to the next tool in its Discipline's Toolkit. One with none is refused (3): record it `--result checkpoint`. Records `fell-back` and the new `ships` together. |

`ready` also holds the Module's content to the tool assignment (the template's `gates -- tools`
lists the content's Worked examples and tools): a tool no assignment names, a computable example
without its tool, an illustration with the wrong figure, a tool that isn't what it ships, a builder
job not passed or without a hand-back, and any subagent job (`blind-reader-a`/`-b`, `style-sheet`,
`writer`, `recompute`, `review`, a builder) recorded without `--started-at`.

`ready --wave W` on a **Sitting wave** judges it by `sitting.ts`, in the wave's own checkout, and returns problems for: the checkout, an uncommitted tree, `main` moved, the template's integrity and hook, and what the branch changes (its own sitting's files and course.yaml's entry for the sitting, nothing of a Module's or another sitting's); a Module the Owner named that isn't `live`; content (`gates -- sitting`) whose course.yaml doesn't mark the sitting complete over the Modules he named, or changes more than that entry, whose past papers aren't exactly the ones he named, or that has mocks or a format with no paper, or a format.yaml he didn't announce (or none when he did); a settled reading that is missing or stale, and a content paper that isn't faithful to it (`faithfulProblems`: text, order, marks, total, minutes, and a key exactly where the Professor printed one); missing or blocked jobs (with papers: `blind-reader-a`, `blind-reader-b`, `reconcile`, `vault-writer`, `mock-writer`, `recompute`, `sitting-gates`, `deploy-gates`, and `solver` for a `key: solved` paper; without papers: the last two); the template's `verify` of the `sitting` and `deploy` reports for HEAD, the sitting report on an `https://` preview; an open or unapplied Checkpoint item, and a ruling the content ships that no stored Owner answer covers; and a past paper's Materials file that changed since the Owner named it.

`ready` also refuses a wave with any job left blocked (a sim builder's, a tool's, a media item's
too), a relaunch not closed, or a review that isn't settled for HEAD: the fresh reviewer's
`review.json` must be of a commit where everything the Module page renders from is HEAD's
(`content/modules/NN-<slug>/`, its `build-records/oracle/` and `build-records/parts/` records, `content/course.yaml`, `content/style-sheet.yaml`, `template/`,
`overrides/`), with every finding re-verified and none confirmed.

The jobs `ready` expects, recorded with `ledger.ts record job` (with `--started-at`): `blind-reader-a`,
`blind-reader-b`, `reconcile`, `style-sheet` (Module 1's wave only), `writer`, `recompute`,
`job-gates`, `consistency`, `module-gates`, `deploy-gates`.
And `review`, the fresh reviewer's, recorded passed once `review` exits 0.
Each tool in the assignment adds its builder's job: `sim-<name>` (passed, or fell-back to its
step-through) or `tool-<name>` (passed), recorded with `--started-at`.

## Files in the Private folder

Everything the Blind readers and reconcile touch carries the Professor's text, so it lives under
`<Private folder>/waves/<NN>/`, never in a repo or the scratchpad:

- `reading-a.json`, `reading-b.json`: each Blind reader's reading, written without seeing the other:
  `{"reading": "learn-premium blind reading v1", "reader": "a"|"b", "module": "NN", "items": [...]}`.
  Each item has every key: `key` (the same thing gets the same key from both readers, e.g.
  `L01.pdf#p3/eq-2`), `file` (as the Build ledger names it), `page` (or null), `box` (`[x0, y0, x1,
  y1]` as fractions of the render, or null), `quantity` (what a number or formula is, e.g. `learning
  rate`, or null), `kind` (`number`, `formula`, `text`, `annotation`, `figure`) and `value` (as
  written; null where the reader couldn't read it). Values agree when they match with spacing and
  trailing zeros aside.
- `crops/<key>.png`: the rendered region of each dispute, cut with the Materials reader's `crop`.
- `resolutions.json`, written by the main agent after looking at each crop:
  `{"resolutions": [{"key", "a", "b", "crop": "waves/NN/crops/<key>.png", "ruling": "a"|"b"|"read"|"unreadable",
  "value"}]}`; `a` and `b` copy what the dispute listed (a ruling stands only while the readers still
  read that), and `value` is the reading for `read`, else null.
- `reading.json` (the settled reading every writer and the recompute work from, with `inputs`, a
  hash of the readings and rulings it was settled from) and `checkpoint-items.json`, written by
  `reconcile`. A reconcile left with unsettled disputes deletes both, and `ready` refuses a settled
  reading whose readings or rulings have changed since. A Checkpoint item's key hashes the values
  and places it asks about, so a changed question is asked again.
- `youtube/hunt-<topic>.json` (a hunter's, `../../briefs/youtube-hunter.md`), `youtube/transcripts/<id>.txt`
  (saved by the main agent from the video's transcript panel: a line `m:ss text`, or an `m:ss` line
  followed by its text) and `youtube/verified.json` (`videos verify`'s). The Course-wide do-not-use list
  is `<Private folder>/youtube/do-not-use.json`: `{"list": "learn-premium do-not-use v1", "videos":
  [{"id", "reason", "at"}]}`, appended to by `videos never` and `videos hide`, never rewritten.
- `review/shots/`: the preview's screenshots and `shots.json` (the commit they show), from the
  template's `npm run gates -- shots`.
- `review/review.json`, the fresh reviewer's: `{"review": "learn-premium review v1", "module": "NN",
  "commit": "<sha>", "findings": [...]}`. Each finding has every key: `kind` (`meaning`, the
  adversarial read, or `visual`, the eyes loop), `content` (the content file, relative to
  `content/`; a meaning finding needs it), `screenshot` (relative to the Private folder; a visual
  finding needs it), `materials` (`{file, page, box}`; a meaning finding needs it), `site`,
  `source` and `why`.
- `review/verdicts.json`, the main agent's, after looking at each finding itself:
  `{"verdicts": [{"key", "verdict": "confirmed"|"rejected", "evidence", "fix", "reason"}]}`. `key`
  is the finding's, as `review` lists it (a hash of the finding and the commit reviewed, so a verdict stands only for the
  finding it was made on). A confirmed one names its `evidence` (the crop or screenshot it was
  re-verified on, in the Private folder) and `fix`, the job that fixes it.

- `builders/<name>.json`, a sim builder's hand-back: `{"handback": "learn-premium sim builder v1",
  "module": "NN", "name", "tool", "figure": {"file", "page", "box", "label"}, "files": [...],
  "counts": {"parts", "nets"}, "assumptions": [{"value", "why"}], "unreadables": [{"where", "what"}],
  "selfCheck": {"ran": [...], "passed", "notes"}}`. `files` are relative to the Course project and
  include the tool's own file. It quotes the Professor and never leaves the Private folder: the
  ledger and the build report keep its counts only.

A sitting's readings sit under `<Private folder>/sittings/<ID>/` (`reading-a.json`, `reading-b.json`,
`resolutions.json`, `crops/`, then `reading.json` and `checkpoint-items.json` from `reconcile --sitting`), with
the same shapes but `"sitting": "<ID>"` in place of `"module"`. Their items are keyed `<name>/q<n>/text|marks|key`,
`<name>/total` and `<name>/minutes`, `<name>` being the short name the Owner gave the paper.

Gate reports are read from the Course's `content/build-records/gate-reports/`, where `npm run gates`
writes them.

Tests: `npm test` in `skill/` (Vitest, synthetic readings, the template's verify faked).
