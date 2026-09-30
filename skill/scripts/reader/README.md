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
| 1 | a page with content rendered to one flat colour: the render can't be trusted, nothing is written |
| 2 | bad flags, a file outside the Materials folder, a kind it doesn't read, or a file it can't open |
| 3 | refused: the Private folder is inside the Materials folder or inside a repo; nothing written |
| 4 | internal error (a bug; the stack is on stderr) |

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
- **.pptx deck** (`kind: "deck"`): the manifest's `slides`, each with `title`, `text` (the other
  text boxes and tables, in shape order), `notes`, and:
  - `audio`: each clip's `file` (in `media/`), `narration` (PowerPoint recorded it as narration)
    and `transcript` (in `transcripts/`: `text`, timed `segments`, `language`, `model`);
  - `video`: each embedded video's `file` (in `media/`), `sourceOnly: true`. Deck videos are
    source only: watched as Material, never re-hosted, never copied into a Course project.
  - A clip the deck only links to has `linked` (its target) instead of `file`.

Slides are not rendered: there is no slide renderer on the machine, so a deck's figures are read
from the deck in PowerPoint until one is added.

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
Materials only). `LEARN_PREMIUM_WHISPER=1` adds a real faster-whisper run on synthesised speech.
