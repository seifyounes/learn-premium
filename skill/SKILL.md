---
name: learn-premium
description: learn-premium v2, run only when the Owner types /learn-premium <Materials path>. It claims no natural-language triggers until the Cut-over; v1 /crash-course stays the default until then.
argument-hint: <Materials path>
disable-model-invocation: true
---

# learn-premium

Turns one Course's Materials into a Study site. The words used here (Course, Materials, Template
release, Build ledger, Owner…) are defined in the repo's `CONTEXT.md`.

This skill folder is `~/.claude/skills/learn-premium`, a junction into
`~/.claude/learn-premium/release/skill`: a git worktree detached at one Template release tag. The
skill, the Site template (`../template/`) and the gates are all read from that worktree, so they
always come from the same tag. Never read them from `main`, from the Owner's development clone, or
from any other checkout.

## Run start

Do these in order on every run, before touching the Materials.

### 1. Check the install

Run:

```bash
uv run --no-project --python ">=3.12" "$HOME/.claude/skills/learn-premium/scripts/machine_install.py" check
```

The first line is a summary for the Owner; the JSON after it is the full report.

- **Exit 1 (something is missing):** show the Owner the summary line and each `missing` entry, and
  offer to run the installer named in `installer` (`powershell -ExecutionPolicy Bypass -File
  <installer>`). Run it only on the Owner's yes, then check again. Don't continue the run on a
  broken install.
- **`releases_behind` > 0:** tell the Owner the summary line as is ("N commits / M releases
  behind…"). Updating is the Owner's call: never pull, fetch into, check out or re-run the
  installer on your own, and never in the middle of a wave. Carry on at the installed release.
- **`fetch_error` set:** say origin couldn't be reached, so "behind" may be stale, and carry on.

Note `installed_release`: the Build ledger records it for the wave.

### 2. Read the Build ledger and take the lock

Not built yet (ticket #65).

### 3. Pick the path

Intake, resume, an Upgrade wave offer or a hash diff. Not built yet (tickets #67, #68, #75).
Until they land, stop after step 1 and tell the Owner which ticket the run is waiting on.
