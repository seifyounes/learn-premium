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
| `checkpoint --module NN [--preview URL]` | The Module's batched Checkpoint: `open` (each with a stable `key`, the `question`, `sheet: true` when it needs a Slip or Divergence ruling, and its `link` on the preview or the `crop` of an unreadable region), `unapplied` (ruled, but the gate still raises it: the content doesn't carry the ruling yet), `answered`, and `markdown`, the batch to post in chat as is. Items come from the Module's Gate reports (job and module points, and the deploy point's whole-Course ones, such as a licence, keyed `course/…`) and from the settled reading; the preview is where the module point ran unless `--preview` says. What the Build ledger already answers is never asked again. |
| `ready --wave W` | The merge gate for Module wave `W`. `{ready, problems}`: exit 0 only when every job ran and none is blocked (the first Module's wave also owes `style-sheet`), the Course style sheet and the Module's content exist, both readings and the settled reading are in the Private folder, the template's `verify` calls the job, module and deploy Gate reports green for HEAD, the module point ran on an `https://` preview, every Checkpoint item is answered (a sheet one with a ruling the content carries), every Slip and Divergence the content ships (the template's `gates -- rulings`) matches a stored Owner ruling on a sheet item of this Module about that sheet value, and `core.hooksPath` is the template's pre-commit gate. |

The jobs `ready` expects, recorded with `ledger.ts record job` (with `--started-at`): `blind-reader-a`,
`blind-reader-b`, `reconcile`, `style-sheet` (Module 1's wave only), `writer`, `recompute`,
`job-gates`, `consistency`, `module-gates`, `deploy-gates`.

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
  `{"resolutions": [{"key", "crop": "waves/NN/crops/<key>.png", "ruling": "a"|"b"|"read"|"unreadable",
  "value"}]}`; `value` is the reading for `read`, else null.
- `reading.json` (the settled reading every writer and the recompute work from, with `inputs`, a
  hash of the readings and rulings it was settled from) and `checkpoint-items.json`, written by
  `reconcile`. A reconcile left with unsettled disputes deletes both, and `ready` refuses a settled
  reading whose readings or rulings have changed since. A Checkpoint item's key hashes the values
  and places it asks about, so a changed question is asked again.

Gate reports are read from the Course's `content/build-records/gate-reports/`, where `npm run gates`
writes them.

Tests: `npm test` in `skill/` (Vitest, synthetic readings, the template's verify faked).
