# Module wave commands

The steps of a Module wave that need a tool rather than judgement: reconciling the two Blind
readers, the batched Checkpoint, and the merge gate. The wave's order and the subagents' briefs are
in `../../SKILL.md` (Module wave) and `../../briefs/`.

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
| `checkpoint --module NN [--preview URL]` | The Module's batched Checkpoint: `open` (each with a stable `key`, the `question`, `sheet: true` when it needs a Slip or Divergence ruling, and its `link` on the preview or the `crop` of an unreadable region), `unapplied` (ruled, but the gate still raises it: the content doesn't carry the ruling yet), `answered`, and `markdown`, the batch to post in chat as is. Items come from the Module's Gate reports (job and module points, and the deploy point's whole-Course ones, such as a licence, keyed `course/…`) from the settled reading, and from any job of the running wave recorded with `--result checkpoint` (its `--detail` is the question); the preview is where the module point ran unless `--preview` says. What the Build ledger already answers is never asked again. |
| `ready --wave W` | The merge gate for Module wave `W`. `{ready, problems}`: exit 0 only when every job ran and none is blocked (the first Module's wave also owes `style-sheet`), the Course style sheet and the Module's content exist, both readings and the settled reading are in the Private folder, the template's `verify` calls the job, module and deploy Gate reports green for HEAD, the module point ran on an `https://` preview, every Checkpoint item is answered (a sheet one with a ruling the content carries), every Slip and Divergence the content ships (the template's `gates -- rulings`) matches a stored Owner ruling on a sheet item of this Module about that sheet value, and `core.hooksPath` is the template's pre-commit gate. |
| `review --module NN` | The fresh reviewer's review of Module `NN` (`../../briefs/reviewer.md`): exit 0 once every finding has the main agent's verdict and none is confirmed. Exit 1 lists `problems` (no review yet; no phone or laptop screenshot of the commit it reviewed), the `unverified` findings (each with its `key`), and the `confirmed` ones (each with the job that fixes it); `next` says what to do. |
| `relaunch open --holder H --wave W --job J [--files P…]` | A subagent relaunched after its predecessor died: re-gates the predecessor's files (paths in the Course project, or `private:<path>` in the Private folder; a folder is every file in it) and returns each with `covered` and its `findings`, then records the relaunch open in the Build ledger. Content files go through the template's per-job gates on the Module; a Blind reader's reading is checked on its shape. A Blind reader (`blind-reader-a`/`-b`) is given its own reading only: naming any other file (the other reading, the settled one) is refused (2), and the output carries nothing of the other reader's. |
| `relaunch close --holder H --wave W --job J --outcomes FILE` | `{"files": [{"path", "outcome": "kept"\|"fixed"\|"discarded"}]}` for every predecessor file. Exit 1 with `problems` unless each holds as the files are now: kept = unchanged and clean at the re-gate; fixed = changed, and clean on a fresh re-gate; discarded = deleted. Then the ledger records each file's outcome (and hash) and the relaunch closes. |

`ready` also refuses a wave with any job left blocked (a sim builder's, a tool's, a media item's
too), a relaunch not closed, or a review that isn't settled for HEAD: the fresh reviewer's
`review.json` must be of a commit whose `content/modules/NN-<slug>/` is HEAD's, with every finding
re-verified and none confirmed.

The jobs `ready` expects, recorded with `ledger.ts record job` (with `--started-at`): `blind-reader-a`,
`blind-reader-b`, `reconcile`, `style-sheet` (Module 1's wave only), `writer`, `recompute`,
`job-gates`, `consistency`, `module-gates`, `deploy-gates`.
And `review`, the fresh reviewer's, recorded passed once `review` exits 0.

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
  is the finding's, as `review` lists it (a hash of the finding, so a verdict stands only for the
  finding it was made on). A confirmed one names its `evidence` (the crop or screenshot it was
  re-verified on, in the Private folder) and `fix`, the job that fixes it.

Gate reports are read from the Course's `content/build-records/gate-reports/`, where `npm run gates`
writes them.

Tests: `npm test` in `skill/` (Vitest, synthetic readings, the template's verify faked).
