# Driving NotebookLM

How the Media pass makes one Module's media in NotebookLM: through Claude in Chrome in the dedicated
Chrome profile, or, when that fails, through the Notebook recipe the Owner follows by hand. Both end the
same way: the downloaded file is saved in the Course project's media inbox and `ingest` moves the item
on. The state commands are in `scripts/media/README.md`; `M` below is
`node "$HOME/.claude/skills/learn-premium/scripts/media.ts"`.

NotebookLM is now also called Gemini Notebook; its app is at `https://notebook.google.com`.

## Rules

- Only the dedicated Chrome profile, on the Owner's AI Pro account. Never sign in, type a password,
  or solve a CAPTCHA: at a login page or a CAPTCHA, stop and ask the Owner to clear it in that window,
  then carry on.
- Never share the Course notebook or any output, and never make anything public: the notebook holds
  the Professor's Materials.
- Media are English only. Never change the account's output language to anything else.
- `start` the item before you click Generate, so every generation is counted.

## Before the first item of a pass

1. `M chrome` gives the profile's name. Call `list_connected_browsers` and `select_browser` the one with
   that name. If the name isn't set, ask the Owner which listed browser is the dedicated profile and
   record it (`M chrome --profile <name>`). If none is connected, use the Notebook recipe for the pass.
2. Open a new tab at `https://notebook.google.com`. In Settings, check Output language is English.

## One Module's media

Take the Module's three items together: start each one's generation, then poll. A video can take over
30 minutes, so the audio and infographic are made while it renders.

1. **Recipe.** `M recipe --project P --item <item>` for each item. The three share `notebook` and
   `sources`.
2. **Notebook.** With `notebook.url` set, open it. Otherwise create a notebook, name it
   `notebook.title`, and record its address at once: `M notebook --project P --url <address>`.
3. **Sources.** For each source whose `action` isn't `select`:
   - `replace`: remove the source titled `replaces` from the notebook first.
   - Upload: Add source → upload, and give the file to the page's file input with `file_upload`
     (one file per call; Claude in Chrome takes at most 10 MB per call).
   - `viaDrive`: the file is over that limit. It must reach Google Drive outside Chrome: copy it into
     the Owner's Google Drive for desktop folder if there is one, else ask the Owner to upload it to
     Drive. Then Add source → Google Drive and pick it.
   - Once NotebookLM lists it, record it under the title it shows:
     `M source --project P --material <material> --title "<title>"`.
4. **Select.** In the sources list, tick only the recipe's sources (by title) and untick every other.
   Check the count of ticked sources before each Generate.
5. **Generate**, per item: `M start --state … --project P --item <item>`, then in Studio open the
   output's customise (pencil) control and set the recipe's `output`:
   - Video Overview: format Explainer, visual style Custom with `output.style`, and `output.prompt` as
     the focus.
   - Audio Overview: Deep Dive, default length, `output.prompt` as the focus.
   - Infographic: landscape, standard detail; `output.style` as its style (where there is no style
     field, put it at the start of the prompt), then `output.prompt`.

   If NotebookLM says a limit is reached instead, run
   `M limit --kind 5-hour|weekly [--until <the reset time it shows>] --project P --item <item>` and stop
   the pass: every other item waits too.
6. **Poll.** Check the Studio list every few minutes until each output is ready. Do something useful
   between checks (the next item's sources, the fact check of one already in).
7. **Download.** Each output's menu → Download. Chrome saves it in the profile's download folder: move
   the newest file to `save.folder` as `save.name` + one of `save.extensions`
   (`media-inbox/module-01-video.mp4`), then `M ingest --project P --private <Private folder>`.

The pass then goes on as in the README: fact check, `checked` or `fail`, re-encode, place.

## When Chrome fails

The extension drops, a control can't be found after a fresh look at the page, or NotebookLM's page
has changed past what these steps describe. Try once more (reconnect, reload); if it fails again:

1. Leave the item `generating`.
2. Show the Owner the recipe's `steps` for each item still to make, in order, with the inbox path.
3. When the Owner says the files are in the inbox, `M ingest --project P --private <Private folder>`,
   and record any notebook address and sources they report (`notebook`, `source`).

Files the Owner makes ahead of the pass can go in the inbox too: `ingest` counts a `queued` item's
generation as it takes the file.

## Measuring the costs

On the first real media run, NotebookLM's Settings → Usage is read before and after one video, one
audio and one infographic. The Owner reads the numbers and records them, in the unit Usage shows:
`M quota --cost-video N --cost-audio N --cost-infographic N` (and `--limit-5-hour`, `--limit-weekly`
when Usage shows them). From then on `status` prices the demand against what is left.
