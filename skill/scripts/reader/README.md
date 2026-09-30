# Materials reader

Turns one Materials file into what a Blind reader looks at. Every Blind reader reads Materials
through it, never by opening a PDF's text layer or unzipping a deck by hand.

```bash
"$HOME/.claude/learn-premium/venv/Scripts/python.exe" \
  "$HOME/.claude/skills/learn-premium/scripts/materials_reader.py" \
  read --materials <Materials folder> --private <Private folder> <file> \
  [--whisper-model large-v3-turbo] [--language ar]
```

`<file>` is relative to the Materials folder (as the Build ledger's inventory spells it). The
command prints one JSON document (`{"ok": true, "kind", "manifest"}` or `{"ok": false, "error"}`)
and exits:

| Exit | Meaning |
| --- | --- |
| 0 | read; `manifest` is its path inside the Private folder |
| 1 | a page or slide with content rendered to one flat colour: the render can't be trusted, nothing is written |
| 2 | bad flags, a file outside the Materials folder, a kind it doesn't read, a file it can't open, or a Private folder too deep for PowerPoint |
| 3 | refused: the Private folder is inside the Materials folder or inside a repo; nothing written |
| 4 | internal error (a bug; the stack is on stderr) |
| 5 | PowerPoint (or Windows PowerShell, which drives it) is not installed, won't start, failed on the deck or ran out of time; the error names which, nothing is written |

## What it writes

Everything goes under `<Private folder>/reader/<file>/`, replacing an earlier read of the same file
only when the new read succeeds (a failed read leaves the last good one). Nothing is written
anywhere else: the Private folder must sit beside the Materials and outside any repo, so no
render, narration or deck video can reach a Course project or the next hash diff.

- **PDF** (`kind: "pdf"`): `pages/page-001.png`… at 200 dpi, and the manifest's `pages`
  (`number`, `image`, `empty`). Every render is looked at: a page with text, an image or an
  annotation that renders to one flat colour fails the whole read (exit 1). A page that renders
  flat with none of those (nothing at all, or the lone white fill Word and PowerPoint export for a
  blank page) is `empty: true`.
- **.pptx deck** (`kind: "deck"`): the manifest's `slides`, each with `image`
  (`slides/slide-001.png`…, rendered by PowerPoint at 200 dpi), `empty`, `title`, `text` (the other
  text boxes and tables, in shape order), `notes`, and:
  - `audio`: each clip's `file` (in `media/`), `narration` (PowerPoint recorded it as narration)
    and `transcript` (in `transcripts/`: `text`, timed `segments`, `language`, `model`);
  - `video`: each embedded video's `file` (in `media/`), `sourceOnly: true`. Deck videos are
    source only: watched as Material, never re-hosted, never copied into a Course project.
  - A clip the deck only links to has `linked` (its target) instead of `file`.

## Slides

Every slide is rendered through PowerPoint's own export (COM automation from Windows PowerShell,
`powerpoint.ps1`), so a deck's figures, diagrams and shape-drawn equations look as they do in
PowerPoint. A .pptx read needs PowerPoint on the machine: without it the read fails (exit 5) and
says so; it never skips the renders.

- Every render is looked at, as PDF pages are: a slide whose own shapes draw something (a picture,
  table, chart, drawn shape, ink, equation, or a placeholder with text) that renders to one flat
  colour fails the whole read (exit 1). A slide that renders flat with none of those (only empty
  placeholders) is `empty: true`.
- PowerPoint never opens the Materials file. It opens a copy in `<Private folder>/reader/~powerpoint-…`,
  so decks past 260 characters render and nothing (not even PowerPoint's lock file) is written beside
  the Materials; the copy is deleted after the read. PowerPoint takes no long-path prefix and
  expands 8.3 names, so a Private folder deeper than about 210 characters is refused (exit 2).
- PowerPoint is quit after each read, even a failed one, and if the process the read started is
  still running 15 s later, it is ended. Only that process: never a PowerPoint the Owner opens
  meanwhile. A PowerPoint that was already running is left running, and so is one holding another
  presentation (the Owner opened PowerPoint during the read and got the read's instance); only the
  deck is closed. The one exception: a read that runs out of time ends its PowerPoint even if the
  Owner opened a presentation in it during the read.
- PowerPoint is one process per machine, so reads take turns with it (a lock in `%TEMP%`), even
  across Courses. A read that runs past 10 minutes, or waits that long for its turn, fails (exit 5).

## Narration

Audio is transcribed locally by faster-whisper with `large-v3-turbo` (CPU, int8): multilingual,
and it holds up on Arabic narration where `small` doesn't. On CPU it takes about as long as the
audio plays. The model (about 1.6 GB) downloads into the Hugging Face cache on the first read that
has audio; a deck with no audio never loads it. The language is detected per clip; pass
`--language ar` when short clips full of English terms get detected as English. Transcripts are
Material, kept in the Private folder only; the audio is never published.

## Long paths

Materials unzipped from archives often pass Windows' 260-character limit, and long paths are off
in the registry by default. The reader expands 8.3 short names (`C:\Users\ALAAYO~1\...`) to the
full user folder and opens everything with the `\\?\` long-path prefix, handing audio to
faster-whisper as an open file.

Tests: `uv run --project skill --with pytest pytest tests` from the repo root (synthetic
Materials only). The deck tests drive the real PowerPoint and are skipped where it isn't
installed. `LEARN_PREMIUM_WHISPER=1` adds a real faster-whisper run on synthesised speech.
