# Brief: Media fact check

You fact-check one downloaded media item of Module `<NN>` of `<Course>`: a video, an audio or an
infographic NotebookLM made. It was generated from the Professor's Materials but it is a model's
retelling, and what it says becomes teaching on the Study site, so you hunt what it got wrong: a
number, a symbol, a claim. You never saw it being made and you are launched fresh for every item and
attempt: no earlier check, no earlier finding.

**You are given:** the evidence folder `<Private folder>/media/evidence/<item>-<attempt>/` (its
`evidence.json`, and for an audio or a video the `transcript.json`, and for a video the sampled
`frames/frame-NNN.png`; for an infographic, the image itself, named in `evidence.json`'s `image`); the
Module's verified content, `content/modules/<NN>-<slug>/`, and its build records,
`content/build-records/<kind>/<NN>-<slug>/` (the recompute logs hold the checked numbers); the Course
style sheet `content/style-sheet.yaml`; and the one file you write:
`<Private folder>/media/checks/<item>-<attempt>.json`. Write nothing anywhere else. Never quote the
Professor's Materials in anything you write (the check file may be read where they must not be).

1. **Take it in.** Read the transcript beside the content. Look at every sampled frame, and at the
   infographic, with your own eyes (the image viewer, not a guess from the file name): read off any
   text, numbers, labels and symbols on it.
2. **Every number said or shown.** List each one, written as digits or as words ("point two five",
   "twenty-five percent"), as a `number` claim with its `value` as a plain number (`25` for
   "twenty-five percent" if the Module writes 25, `0.25` if it writes 0.25: the value the media
   means). The judge also reads the transcript's own digits, so a number you leave out is still
   caught, but a number only you can read (spoken, or drawn on a frame) is yours to list. Say where
   (`at`): `m:ss` into the narration, a frame (`frames/frame-002.png`), or `infographic`.
3. **Every symbol and term.** Each symbol the media uses against the style sheet's `notation`: the
   `write` form, never one of its `not` forms (`R_{th}` for `R`, `\dot{q}` for `\dot{Q}`); each term
   against its `definitions`. A symbol is a `symbol` claim, a wrong form is `wrong` with the style
   sheet's own form in `why`.
4. **Every claim.** Each statement of fact or method the media makes (a rule, a direction, a
   condition, a step order, a unit) is a `claim`, with the content file that backs it in `content`
   (relative to `content/`), or null when no file does. Verdict:
   - `matches`: the content says the same, in meaning. Different words are fine;
   - `wrong`: the content says otherwise (a reversed direction or sign, series for parallel, a
     dropped condition, a rule credited to the wrong case, the Professor's printed Slip value
     where the content ships the corrected one);
   - `unsupported`: nothing in the Module's content says it. A media item that teaches beyond the
     Module teaches what nobody checked.
   `why` is one sentence naming the content line or value you compared it with.
5. **The readings.** `readings` has one `{at, text}` per sampled frame (its `at` is the frame's
   path, `frames/frame-002.png`, or just `frame-002.png`) with the text you read on it ("" when it
   shows none), and for an infographic one reading at `infographic` with all the text on it. A frame
   without its reading refuses the whole check.
6. **An infographic's `alt`**: one or two plain sentences saying what it shows for someone who can't
   see it, 300 characters at most, in English, no number the Module doesn't hold. Null for a video
   and an audio.
7. Write `{"check": "learn-premium media check v1", "item": "<item>", "attempt": <n>, "masterHash":
   "<evidence.json's masterHash>", "alt": …, "readings": […], "claims": […]}`, each claim
   `{at, said, kind: number|symbol|claim, value: number|null, verdict, content, why}`, then return a
   short report: frames looked at, claims by verdict. Quote nothing from the Materials in it.

The main agent does not re-verify your `wrong` and `unsupported` verdicts. They fail the item, which
costs one regeneration (and a second failure drops it), so be exact: mark `wrong` only what you can
point at in the content, and `unsupported` only after you searched the Module for it. A miss ships
wrong teaching, so a claim you couldn't check is not `matches`.
