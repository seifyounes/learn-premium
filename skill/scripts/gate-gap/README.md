# Gate-gap step

Files a gate gap the Build ledger recorded (`ledger.ts record gate-gap`, `../ledger/README.md`) on
learn-premium's own tracker, as one GitHub issue labelled `gate-gap`.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/gate-gap.ts" file --project <Course project> --holder <id> --id <gate gap id>
```

It prints one JSON document, `{"ok": true, "issue": N, "url": "...", "alreadyFiled": false}` or
`{"ok": false, "error": "..."}`, and exits 0 (filed), 2 (bad flags, or no such gate gap), 3
(refused: another session holds the lock, a fixture that isn't synthetic, an override that's no
longer valid, or GitHub refused or didn't answer) or 4 (internal error).

## What the issue carries

- Its title: the gate gap's `--title`.
- `Course: <Course name>` and one ``Course override: `<template path>` `` line per override it
  declares: the lines the release notes read (`docs/release.md`), so the release that closes it
  lists the overrides each Upgrade wave retires.
- The Template release the Course is on, and the defect (`--defect`).
- The synthetic minimal broken fixture: every file of `build-records/gate-gaps/<id>/`, inlined.

Filing records the issue number on the gate gap and records each declared override against it.

## Never the Materials

Before GitHub is asked anything, every fixture file is checked. Each is refused, and nothing is
filed, if it:

- is a Materials file: its hash matches a file in the Materials folder now, or one the ledger
  inventoried;
- is a Private-folder file (a transcription, a quote, a crop);
- isn't text (it's inlined in the issue);
- has a `Course:` or `Course override:` line, which the release notes would read as the issue's.

The fixture also has to fit in 40,000 characters: a minimal one does. Write it by hand from the
defect, the way the Fixture Course is written: no Professor's wording, numbers or figures.

## Safe to run again

The issue body carries a hidden line naming the Course and the gate gap. A filing that opened the
issue but never got GitHub's answer finds it on the next run instead of opening a second, and a
gate gap already filed returns its issue with `alreadyFiled: true`.

GitHub is reached through `gh`, signed in as the Owner. The `gate-gap` label already exists on
the repo. Tests use a fake tracker (`../../test/fake-tracker.ts`) and never file a real issue.
