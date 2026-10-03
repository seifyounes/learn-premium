# Driving NotebookLM

How the Media pass makes one Module's media in NotebookLM: through Claude in Chrome in the dedicated
Chrome profile, or, when that fails, through the Notebook recipe the Owner follows by hand. Both end the
same way: the downloaded file is saved in the Course project's media inbox and `ingest` moves the item
on. The state commands are in `scripts/media/README.md`; `M` below is
`node "$HOME/.claude/skills/learn-premium/scripts/media.ts"`.

NotebookLM is now called Gemini Notebook; its app is at `https://notebook.google.com`. What follows
was checked on its live UI on 2026-10-03.

## Rules

- Only the dedicated Chrome profile, on the Owner's AI Pro account. Never sign in, type a password,
  or solve a CAPTCHA: at a login page or a CAPTCHA, stop and ask the Owner to clear it in that window,
  then carry on.
- Never share the Course notebook or any output, and never make anything public: the notebook holds
  the Professor's Materials.
- Media are English only, set on each output's own language picker. Leave the account's Settings →
  Output language alone (it shows "Default", the Google account's language).
- `start` the item before you click Generate, so every generation is counted.

## Before the first item of a pass

1. `M chrome` gives the profile's name. Call `list_connected_browsers` and `select_browser` the one with
   that name. If the name isn't set, ask the Owner which listed browser is the dedicated profile and
   record it (`M chrome --profile <name>`). If none is connected, use the Notebook recipe for the pass.
2. The Materials folder must be one this session can read, or `file_upload` refuses its files: ask for
   it with `request_directory` (never copy Materials somewhere else to get round it).
3. Open a new tab at `https://notebook.google.com`.

## One Module's media

Take the Module's three items together: start each one's generation, then poll. A video can take over
30 minutes, so the audio and infographic are made while it renders.

1. **Recipe.** `M recipe --project P --item <item>` for each item. The three share `notebook` and
   `sources`.
2. **Notebook.** With `notebook.url` set, open it. Otherwise create a notebook, name it
   `notebook.title`, and record its address at once: `M notebook --project P --url <address>`.
3. **Sources.** For each source whose `action` isn't `select`:
   - `replace`: remove the source titled `replaces` from the notebook first.
   - Upload: Add sources → Upload files. The page makes its file input only on that click and opens the
     system file picker, which Claude in Chrome can't drive. Before the click, keep the input in the
     page instead, then give it the file with `file_upload` (one file per call; at most 10 MB):

     ```js
     HTMLInputElement.prototype.click = ((click) => function () {
       if (this.type !== "file") return click.call(this);
       this.setAttribute("aria-label", "lp file input");
       if (!this.isConnected) document.body.appendChild(this);
     })(HTMLInputElement.prototype.click);
     ```

     Click Upload files, `find` "lp file input", and upload to that ref. A source shows a spinner,
     then its tick, once it is read.
   - `viaDrive`: the file is over that limit. It must reach Google Drive outside Chrome: copy it into
     the Owner's Google Drive for desktop folder if there is one, else ask the Owner to upload it to
     Drive. Then Add source → Google Drive and pick it.
   - Once NotebookLM lists it, record it under the title it shows:
     `M source --project P --material <material> --title "<title>"`.
4. **Select.** In the sources list, tick only the recipe's sources (by title) and untick every other.
   Check the count of ticked sources before each Generate.
5. **Generate**, per item: `M start --state … --project P --item <item>`, then click the output's
   Studio tile. It opens a "Customize …" dialog (nothing is made until Generate); set the recipe's
   `output`, with the dialog's language on English and its Sources on the recipe's count:
   - Video Overview: the format defaults to **Cinematic, about 7× an Explainer's cost**: pick
     Explainer. In the visual-style carousel pick the pencil card (Custom), put `output.style` in
     "Describe a custom visual style", and `output.prompt` in "Custom topic".
   - Audio Overview: Deep Dive (the default), length Default, `output.prompt` as the focus.
   - Infographic: Landscape and Standard (the defaults). It has no custom style: keep Auto-select
     and put `Style: ${output.style}` then `output.prompt` in "Describe the infographic".

   The dialog's AI Usage meter shows what is used and what this output will take, as a share of the
   5-hour window (in the page, `.meter-used` and `.meter-expected` widths). If the estimate is well
   above the recorded cost, stop and ask the Owner. Then Generate now. ("Generate later" queues it
   outside the current limit, cheaper and ready in hours; use it only on the Owner's word.)

   If NotebookLM says a limit is reached instead, run
   `M limit --kind 5-hour|weekly [--until <the reset time it shows>] --project P --item <item>` and stop
   the pass: every other item waits too.
6. **Poll.** Check the Studio list every few minutes until each output is ready. Do something useful
   between checks (the next item's sources, the fact check of one already in).
7. **Download.** The output's ⋮ menu → Download. Chrome saves it in the profile's download folder
   under NotebookLM's title (`Machine_Learning_Fundamentals_Prep_Sheet.png`), slowly: wait until no
   `.crdownload` is left, then move it to `save.folder` as `save.name` + one of `save.extensions`
   (`media-inbox/module-01-video.mp4`) and `M ingest --project P --private <Private folder>`.

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

Settings → Usage shows each limit as a whole-percent share used, with when it resets: "Current … usage"
(the 5-hour window) and "Weekly limit". Both reset times move with the clock, so both are rolling
windows. A Customize dialog's meter gives the 5-hour share to two decimals (`.meter-used`), so read
costs there: each output's cost is the rise in `.meter-used` its generation caused, charged as it
starts. Record them in that unit, with the 5-hour limit as 100:
`M quota --limit-5-hour 100 --cost-video N --cost-audio N --cost-infographic N`.

The weekly limit, in the same unit, is 100 × (rise in "Current usage") ÷ (rise in "Weekly limit"). Usage
shows whole percents, so take it only once the week has risen by 10% or more, then add
`--limit-weekly N`. Until then `status` prices the demand against the 5-hour window only.

First measured on 2026-10-03 (AI Pro, one 2 MB lecture PDF): infographic 2.68, Deep Dive audio 11.03,
Explainer video 10.92; a Cinematic video was estimated at 78. One Module's three outputs used 24.33 of
the window and about 2% of the week.
