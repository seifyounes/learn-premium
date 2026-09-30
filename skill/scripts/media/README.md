# Media pass commands

The Media pass's state lives in three files, and nothing edits them by hand:

- **The media file**, `build-media.json` beside `build-ledger.json` in each Course project: every media
  item's state. It is part of the Build ledger, but only the Media pass writes it. A driving session
  reads it (ledger `status` returns it as `media`) and never writes it, so the Media pass never needs
  or waits on the ledger lock. Each write regenerates `build-records/media.md`; commit both.
- **The Course registry**, `courses.json` in the machine state folder: every Course project the
  Media pass gathers from. A Course joins it at intake.
- **The quota/usage log**, `media-usage.json` in the machine state folder: the Owner's measured
  NotebookLM numbers, every generation started, and every limit NotebookLM reported.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/media.ts" <command> [--state <machine state folder>] [flags]
```

`--state` defaults to the installed machine state folder, `~/.claude/learn-premium/state`. Each
command prints one JSON document (`{"ok": true, ...}` or `{"ok": false, "error": "..."}`) and exits
0 (done), 2 (bad flags or input, or a file that fails its schema), 3 (refused: a quota limit, or the
item's state doesn't allow the step) or 4 (internal error; the stack is on stderr).

## The item states

```text
queued → generating → downloaded → checked → placed
   ↑          │            │           │
   └─ fail (first time) ───┴───────────┘   fail again, or fail --final → dropped
```

A Module gets a `video`, an `audio` and an `infographic` once it is `live`; an Exam sitting gets a
`sitting-audio` once its Sitting wave has merged. Item ids are stable: `module-01-video`,
`sitting-final-audio`.

## Commands

| Command | Does |
| --- | --- |
| `register --project P` | Adds a Course project (it must have a Build ledger) to the Course registry. Returns `{course, added}`; `added` is false when it was already there. |
| `gather` | Gathers the Media queue afresh from every registered Course: new items join as `queued` in their media file, and every item's `nearestSitting` is refreshed. Returns `{queue, next, stopped, demand, capacity, skipped}` (below). |
| `status` | The same report as `gather`, without writing anything. |
| `start --project P --item I` | `queued → generating`: logs the generation in the usage log, then moves the item. Refused (3, with `stopped`) while a limit stops new generations. Repeating it after a crash counts the generation once. |
| `downloaded --project P --item I` | `generating → downloaded`. |
| `checked --project P --item I` | `downloaded → checked`: the fact check passed. |
| `placed --project P --item I --file F` | `checked → placed`. `F` is the published copy, a path inside the Course project that must already exist. |
| `fail --project P --item I --reason R [--final]` | A failed generation, download, fact check or re-encode, from any of `generating`, `downloaded`, `checked`. The first failure queues it to be made again (`regenerations` 1); the second drops it. `--final` drops it at once, for a failure a regeneration can't fix. Returns `{state, regenerations}`. |
| `limit --kind 5-hour\|weekly [--until ISO] [--project P --item I]` | NotebookLM said a limit is reached: no generation starts until `--until` (default: 5 hours, or 7 days, from now). With the item it refused, that item goes back to `queued` and its generation is voided, so it is never counted. |
| `quota [--limit-5-hour N] [--limit-weekly N] [--cost-video N] [--cost-audio N] [--cost-infographic N] [--cost-sitting-audio N]` | Records the Owner's measured numbers from NotebookLM's Settings → Usage, in the unit it shows. Flags left out keep their value. Returns `{limits, costs}`. |

## The report (`gather` and `status`)

- `queue`: every wanted item not yet placed or dropped, as `{project, course, item, module, sitting,
  kind, state, regenerations, nearestSitting}`. Items already under way come first (their quota is
  spent), then nearest Exam sitting first (an item with no dated sitting ahead goes last), then by
  Course, then Module order and video, audio, infographic. A Module that is being rebuilt drops out
  until it is live again.
- `next`: the item to move next, or null when the queue is drained or a limit stops what's left.
- `stopped`: `{limit, until, observed}` when a limit stops the first queued item: one NotebookLM
  reported (`observed: true`), or one the recorded numbers predict (`observed: false`). `until` is
  null only when the item costs more than the whole limit.
- `demand`: queued items by kind, and `units`, their cost (null until every kind in it is measured).
- `capacity`: for the `5-hour` window and the `weekly` cap, `{limit, used, remaining, generations}`.
  `used` and `remaining` are null until the numbers are measured; `generations` is always counted.
- `skipped`: registered Courses that couldn't be read, with the reason.

## Running a Media pass

Repeat: `gather`, then move `next` one step (`start` and generate it; `downloaded`; fact check, then
`checked` or `fail`; re-encode and place, then `placed`), until `next` is null. If NotebookLM refuses a
generation, run `limit` with that item. When `next` is null and `stopped` is set, the pass is done for
now: tell the Owner when it lifts, and the next pass resumes from the files. Nothing is left half-done:
items under way need no quota, so `next` offers them until they are placed, dropped or queued again,
and a stopped pass leaves every item queued, placed or dropped.

Tests: `npm test` in `skill/` (Vitest, synthetic fixture Courses, NotebookLM faked).
