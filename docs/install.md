# Installing learn-premium

Only the Owner's Windows machine builds Study sites, so the installer is Windows only.

## Prerequisites

- git
- uv: `winget install astral-sh.uv` (it also fetches Python 3.13 for the venv if needed)
- Node.js LTS, for `npx playwright install`

## Install, or move to a newer release

From a clone of `github.com/seifyounes/learn-premium`:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

It fetches origin and brings the Machine install to origin's **latest Template release tag**
(`vX.Y.Z`). A tag that exists only in the clone doesn't count, and a tag re-pointed on origin is
followed. The install refuses and changes nothing when origin can't be reached or has no release
tag yet.

It runs in two stages. The clone's copy of `skill/scripts/machine_install.py` only moves the release
worktree to the tag. It then hands over to the release's own copy, which does everything else, so
the machine is always set up by release code, never by whatever the clone has checked out.

Running it again is safe. An install already on the latest release stays as it is, and an older one
moves to the newest release. That re-run is the only way the install ever changes.

| Path | What |
|---|---|
| `~/.claude/learn-premium/release` | a git worktree of the clone, detached at the release tag |
| `~/.claude/learn-premium/state` | machine state: the Course registry, the quota/usage log, the Chrome profile name |
| `~/.claude/learn-premium/venv` | the machine Python venv, synced from `skill/uv.lock` at that tag |
| `~/.claude/skills/learn-premium` | a junction to `release/skill`, which is how Claude Code finds the skill |
| Playwright's cache | Chromium + WebKit for the Playwright version pinned in the release's `machine_install.py` |

The installed worktree belongs to the clone it was made from, so keep that clone where it is.
The installer won't move a release worktree that has local edits, and it won't replace a real
folder at `~/.claude/skills/learn-premium`. Move either aside first.

## The install check every run starts with

`/learn-premium` starts by running `skill/scripts/machine_install.py check`. It reports each missing
piece and offers the installer:

- the release worktree, or it being off a release tag or carrying local edits;
- the state folder;
- a venv that is missing or out of step with the lock file;
- the skill junction;
- any browser build the pinned Playwright version needs.

It also fetches origin and reports how far behind the install is, e.g.
`3 commits / 1 release behind: v0.1.0 installed, v0.2.0 is out`. It never pulls: the run carries on
at the installed release, and the Owner decides when to re-run the installer.

## Changing the venv

Edit `skill/pyproject.toml`, run `uv lock --project skill`, and commit both files. The change
reaches the machine with the next Template release and the installer run after it.

## Tests

```bash
uv run --no-project --with pytest pytest tests
```

They build a synthetic tagged repo, a throwaway Claude folder and a fake `npx`, and never touch
`~/.claude` or download browsers.

## For the Owner: the claude-skills pointer step

claude-skills holds a pointer to learn-premium, not a copy. Add this step to its README and to its
device-setup installer, after the step that installs the user skills:

```powershell
# learn-premium (private repo; clone once, then pull, then run its own installer)
$lp = "D:\Claude Os\crash course skill"
if (Test-Path "$lp\.git") { git -C $lp pull --ff-only } else { git clone https://github.com/seifyounes/learn-premium.git $lp }
powershell -ExecutionPolicy Bypass -File "$lp\install.ps1"
```

The pull only updates the development clone. The installed release still moves only when
`install.ps1` finds a newer release tag on origin.
