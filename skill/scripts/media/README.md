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
- **The Chrome profile**, `chrome.json` in the machine state folder: the name of the dedicated Chrome
  profile (as Claude in Chrome lists the browser) the Media pass drives NotebookLM in.

The media file also records the **Course notebook**: its address, and each Material uploaded to it at
the hash its Module was built from, so a pass extends the notebook and re-uploads only what changed.
Downloaded media wait in the Course project's **media inbox**, `media-inbox/`, which ignores itself in
git; `ingest` keeps each one's master in the Private folder and never in the Course project.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/media.ts" <command> [--state <machine state folder>] [flags]
```

`--state` defaults to the installed machine state folder, `~/.claude/learn-premium/state`. Each
command prints one JSON document (`{"ok": true, ...}` or `{"ok": false, "error": "..."}`) and exits
0 (done), 1 (open work: `check` found a wrong number or claim, `encode` dropped an oversize file, `ready`
has problems), 2 (bad flags or input, or a file that fails its schema), 3 (refused: a quota limit, or the
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
| `checked --project P --item I` | `downloaded → checked`: the fact check passed. (`check` below does it, after judging.) |
| `placed --project P --item I --file F [--unencoded]` | `checked → placed`. `F` is the published copy, a path inside the Course project that must already exist. An item with no re-encode is refused (3) unless `--unencoded` says `F` is a file the Owner made by hand, placed as it is. For an item with a re-encode, `F` must also hash to the recorded `encoded.hash` and be committed at the project's HEAD (the same bytes) with the project on `main`: refused (2) otherwise, so a rejected output can't be taken for the placed one. |
| `evidence --project P --item I --private D [--python X] [--whisper-model M]` | A downloaded item's evidence for the fact check: the kit transcribes an audio or video locally (English) and samples a video's frames (t = 0, then every 15 s, at most 40) into `D/media/evidence/<item>-<attempt>/`, or takes an infographic as it is. Returns the paths and `check`, the file the fact-check subagent writes. Refused (3): item not `downloaded`, a sitting audio (no Module content to check it against yet), no master. |
| `check --project P --item I --private D` | The judge (below) of that check file. Pass: `downloaded → checked`, exit 0. Fail: `fail` with the findings as the reason, exit 1, `{verdict, findings, state, regenerations}`. Refused (3), nothing moves: the check or evidence is missing, of another item, attempt or master, or incomplete (a frame with no reading, an infographic with no `alt`). |
| `encode --project P --item I --private D [--python X]` | A `checked` item's web copy in `D/media/web/`: H.264 up to 720p with faststart and 64 kbps mono AAC, 64 kbps mono MP3, or an optimised PNG. Over 100 MiB (GitHub's push limit) it is encoded harder once (CRF 34, up to 540p, 48 kbps; 32 kbps mono mp3; a 256-colour PNG); still over, `fail --final` and exit 1. Returns `{file, bytes, masterBytes, harder, tries}`; the sizes also go in the media page. A kit failure is exit 2 and leaves the item as it was. |
| `stage --project P --tree T --item I --private D` | Copies a `checked`, encoded item's web copy into the media branch's worktree `T` as `content/modules/<folder>/media/<explainer.mp4\|deep-dive.mp3\|infographic.png>` and writes its slot into the Module's `media.yaml`, block by block (the infographic with the check's alt text; captions dropped; any other block, `youtube:` included, kept as it was). Never commits. Returns `{file, bytes, slot, module}`. Refused (3): the Module is being rebuilt or isn't live, its content changed since the item's fact check (a rebuilt Module's pending media is checked again: `fail` it), `T` isn't on a `media/…` branch, the item isn't checked or its re-encode is missing or changed. |
| `ready --project P --tree T --module NN` | The media branch's merge gate: `{ready, problems}`, exit 1 with problems. It changes only the Module's media, `media.yaml` and its Gate reports; each file in `media/` is that Module's checked item of that kind, in every commit, with no merge commit; `media.yaml` changes only its three slots; the tree is clean; the template's gates are green for HEAD (job, module and deploy); `main` hasn't moved; and the Module is live with no Module, Sitting or Upgrade wave running. |
| `fail --project P --item I --reason R [--final]` | A failed generation, download, fact check or re-encode, from any of `generating`, `downloaded`, `checked`. The first failure queues it to be made again (`regenerations` 1); the second drops it. `--final` drops it at once, for a failure a regeneration can't fix (a file still over 100 MB after the harder re-encode). Returns `{state, regenerations}`. |
| `limit --kind 5-hour\|weekly [--until ISO] [--project P --item I]` | NotebookLM said a limit is reached: no generation starts until `--until` (default: 5 hours, or 7 days, from now). With the item it refused, that item goes back to `queued` first and its generation is then voided, so it is never counted (after a crash in between, its next `start` reuses the spend, and NotebookLM's next refusal voids it). |
| `quota [--limit-5-hour N] [--limit-weekly N] [--cost-video N] [--cost-audio N] [--cost-infographic N] [--cost-sitting-audio N]` | Records the Owner's measured numbers from NotebookLM's Settings → Usage, in the unit it shows. Flags left out keep their value; a cost over a limit is refused, since that item could never start. Returns `{limits, costs}`. |
| `notebook --project P [--url U]` | The Course notebook as recorded (`{notebook}`, null until made), or, with `--url`, records its address (`https://notebook.google.com/notebook/<id>`). A different address starts a new notebook with no sources. |
| `source --project P --material M --title T` | Records Material `M` (its path in the Materials folder) as uploaded to the Course notebook, under the title NotebookLM shows. Refused (3) before `notebook --url`, and when the file changed since its Module was built (rebuild the Module first). |
| `recipe --project P --item I` | The Notebook recipe for one Module's item (below). Makes the media inbox. A sitting audio is refused (3): the ledger doesn't say yet which Modules a sitting covers. |
| `ingest --project P --private DIR` | Takes each file in the media inbox named `<item id><extension>` (`module-01-video.mp4`): keeps it as `DIR/media/masters/<item>-<attempt><ext>`, then moves the item to `downloaded`. A `queued` item (made by hand ahead of the pass) is counted as started first, whatever the limits say. Returns `{ingested, cleared, ignored}`: files it can't take stay in the inbox with the reason; an inbox copy of a master already taken is cleared. `DIR` must sit outside the Course project. |
| `chrome [--profile NAME]` | The dedicated Chrome profile's name, or records it. Returns `{profile}` (null until set). |

## The fact check and the placement

Everything the pass makes from a master lives in the Private folder, `D/media/`, and none of it is ever
committed: `masters/<item>-<attempt><ext>` (ingest), `evidence/<item>-<attempt>/` (`evidence.json`,
`transcript.json`, `frames/`), `checks/<item>-<attempt>.json` (the subagent's file,
`briefs/media-check.md`) and `web/<item>-<attempt>[-harder]<ext>` (the re-encodes). Only the web copy
of a checked item reaches the Course project, on a `media/NN-<slug>-<n>` branch in a worktree of its
own, merged by fast-forward through the normal gates.

The judge (`check`) has no model in it. Every number said (the transcript's segments), read on a
frame or the infographic, or given as a claim's `value`, must round, to the digits it was written with,
from a number in the Module's verified text: its content (not its media), its build records except the
Gate reports, and the style sheet; a whole number up to 10 and the Module's own number are exempt, and
a match may differ by ×100 or ×1000 (a percentage, k or m). The Professor's Slips are subtracted first
(the value the sheet prints is the wrong one), so media repeating a Slip fails. Each number with no match
is a `number` finding (a power of ten, `1.2 × 10^-3`, is one number; an infographic's alt text is held to the same rule, `at: alt`), and each claim the subagent marked `wrong` or `unsupported` is a `claim` finding.
The command line needs the Course project's template layer for the Slips (`node template/gates/cli.ts
rulings`), as the Module wave's `ready` does.

The kit is `scripts/media_kit.py` (`encode`, `evidence`), run with the machine venv's Python: PyAV's
FFmpeg for video and audio, Pillow for the PNG, faster-whisper for the transcript. It refuses (3) to
write inside a git repo. `--python` points the commands at another interpreter.

## The Notebook recipe (`recipe`)

What to do in NotebookLM for one item, as data for the Chrome driver and as `steps` the Owner follows
by hand when Chrome fails:

- `notebook`: `{title, url}`: the Course notebook, named after the Course; `url` is null until it is
  made.
- `sources`: the Module's current Materials, each `{material, path, title, bytes, action, replaces,
  viaDrive}`. `action` is `add`, `select` (already in the notebook at this hash) or `replace`
  (delete the older upload titled `replaces`, then add). `viaDrive` is set over 10 MB, Claude in
  Chrome's upload limit: upload to Google Drive, then add from Drive. Only these are ticked.
- `skipped`: Materials NotebookLM can't take (video), with the reason.
- `output`: `{studio, settings, style, language, prompt}`: an Explainer Video Overview in the Custom
  visual style, a Deep Dive Audio Overview at the default length, or a landscape Infographic at the
  standard detail; `style` describes the Course pad (null for audio); always English.
- `save`: `{folder, name, extensions}`: the media inbox and the file name to save the download as.

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
  Both are counted as rolling windows (the last 5 hours, the last 7 days), an assumption until the
  first real media run shows how NotebookLM resets them; a reset time NotebookLM shows goes in `limit
  --until`.
  `used` and `remaining` are null until the numbers are measured; `generations` is always counted.
- `skipped`: registered Courses that couldn't be read, with the reason.

## Running a Media pass

Repeat: `gather`, then move `next` one step (`start`; generate it from its `recipe`, save the download
in the media inbox and `ingest`; `evidence`, the fact-check subagent, `check`; `encode`; `stage` on a
media branch, `ready`, merge, then `placed`), until `next` is null. Generating is the same whether Claude in Chrome drives NotebookLM
(`../../notebooklm.md`) or the Owner follows the recipe's `steps` by hand: either way the file lands
in the inbox and `ingest` moves the item on. If NotebookLM refuses a
generation, run `limit` with that item. When `next` is null and `stopped` is set, the pass is done for
now: tell the Owner when it lifts, and the next pass resumes from the files. Nothing is left half-done:
items under way need no quota, so `next` offers them until they are placed, dropped or queued again,
and a stopped pass leaves every item queued, placed or dropped.

Tests: `npm test` in `skill/` (Vitest, synthetic fixture Courses, NotebookLM and the Python media kit
faked, so no Node test needs Python); the kit's own: `uv run --project skill --with pytest pytest
tests/test_media_kit.py` (the Fixture Course's media and synthetic HD clips made in a temp folder,
Whisper faked, nothing downloaded; local only, as for the Materials reader).
