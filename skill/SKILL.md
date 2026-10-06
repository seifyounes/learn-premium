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
  behind…"). Moving to a newer release is the Owner's call: never pull, check out or re-run the
  installer on your own, and never while a Module, Sitting or Upgrade wave is under way. Carry on
  at the installed release.
- **`fetch_error` set:** say origin couldn't be reached, so "behind" may be stale, and carry on.

Note `installed_release`: the Build ledger records it for each wave this run starts.

### 2. Read the Build ledger and take the lock

The Build ledger is read and written only through its commands (`scripts/ledger/README.md`); never
edit `build-ledger.json` or the pages generated from it. Pick a holder id for this run (for example
`run-<date>-<time>`) and use it on every write.

The Course project is found from the Materials path through the Course registry:

```bash
I="$HOME/.claude/skills/learn-premium/scripts/intake.ts"
node "$I" find --materials "<Materials path>"
```

`project` null means no Course project has these Materials yet: that's intake (below), with nothing
to lock. Otherwise:

```bash
L="$HOME/.claude/skills/learn-premium/scripts/ledger.ts"
node "$L" next --project <Course project>
```

If `next` says `intake`, there is no ledger yet and nothing to lock: intake's `init` creates the
ledger with this run holding the lock. Otherwise claim it before anything else:

```bash
node "$L" lock claim --project <Course project> --holder <id>
```

- **Exit 3 on the claim:** another session drives this Course. Tell the Owner who holds it and
  since when, and stop. Take it over (`--take-over "<reason>"`) only when the Owner says that
  session is dead.
- **Exit 2:** the ledger fails its schema. Show the Owner the error; don't repair the file by hand.
- Release the lock (`lock release`) when the run ends.

### 3. Pick the path

`next` says which: `intake` (no ledger), `resume` (an unfinished wave), or `waves` (new Materials
to map and the Module waves the hash diff implies). The Module wave and the Upgrade wave offer
aren't built yet (tickets #68, #75): until they land, report what `next` returned, tell the Owner
which ticket the run is waiting on, and release the lock.

## Intake

A new Course gets one interview up front, so later questions come only at the step that needs them.
The commands are in `scripts/intake/README.md`; `$I` is `intake.ts` as above.

1. **Read the Materials first.** `node "$I" propose --materials "<Materials path>"` gives the hashed
   Materials inventory and a proposed Module map. Look at the file names and first pages (through the
   Materials reader) enough to suggest the Course's Disciplines from the starting list (ML, maths,
   electric circuits, logic circuits, heat transfer, machinery, engineering chemistry, automation and
   control) and to give the proposed Modules real titles.
2. **Ask once, in one batch:** Course name and code, the Professor and University (for the Credit
   line), the Owner's name as the About page should show it, the Disciplines you suggest (the Owner
   confirms or edits; the main one first), the Arabic-notes toggle, the known Exam sittings (name,
   and date if known), and how many Modules the Owner expects this semester. Propose the project
   folder name (`slug`, lower-case-dashes). A Discipline off the starting list waits for ticket #79:
   record it as the Owner names it.
3. **The pad:** `node "$I" pad --discipline "<main Discipline>"`; suggest it (say when it's the
   nearest listed Discipline's, or the Graphite-grey fallback) and the Owner confirms or swaps it,
   from the catalogue or by naming any colour (`#RRGGBB`).
4. Write the confirmed answers to a JSON file in the scratchpad (the README's shape) and run the
   **media budget check**: `node "$I" budget --answers <file>`. Report this Course's demand against
   the remaining capacity in a line or two; on `over` or `unknown`, say why, and go on only on the
   Owner's word.
5. **Create the Course project:** `node "$I" create --answers <file> --workspace "<workspace>"
   --release <installed_release> --holder <id>`. The workspace is the folder holding the Owner's
   projects and the MEMORY.md project catalog (`D:\Claude Os`). Report the project and Private
   folder paths.
6. **The Module map:** show the refined proposal (each Module with its Materials, and the unmapped
   files). Once the Owner confirms or edits it, write it with `ledger.ts map --project <Course
   project> --holder <id> --input <file>`, and commit `build-ledger.json` and `build-records/` in the
   Course project (`chore: map the Modules`).
7. **GitHub and Vercel (Owner step):** say what `host` will make (the private repo `<owner>/<slug>`,
   the Vercel project `<slug>` building `template/` from `content/`, the first deploy of `main`) and
   run `node "$I" host --project <Course project>` only on the Owner's yes, with `VERCEL_TOKEN` set.
   Report the live URL, or each finding when the site isn't noindex (exit 1), and never retry by
   deleting anything: a re-run makes nothing twice.
8. Release the ledger lock. The next run's `next` picks up Module 01.

## Media pass

"Run media" is an explicit Owner command, separate from any Module wave and needing no ledger lock:
it drains the one Media queue across every Course in the Course registry, within the NotebookLM
quota. Its state commands are in `scripts/media/README.md`; NotebookLM is driven as `notebooklm.md`
says, through Claude in Chrome in the dedicated Chrome profile, falling back to the Notebook recipe
the Owner follows by hand. Start by reporting `media.ts status`: the queue, the demand against the
remaining capacity, and any limit in force. The fact check, re-encode and placement steps aren't
built yet (ticket #78): carry an item as far as `downloaded`, and tell the Owner the rest waits on it.

## Reading Materials

Every Blind reader reads a PDF or .pptx through the Materials reader (`scripts/reader/README.md`),
never through a PDF's text layer: it renders the pages and slides it looks at into the Private
folder (slides through PowerPoint, which the machine needs), fails loudly on a render with no
pixels, and transcribes a deck's narration there. Give a Blind reader
only the Private folder's path for what it writes.

## Going public

Only when the Owner asks to make a Course project public. This step reports; flipping the
repo's visibility is the Owner's, so never run `gh repo edit --visibility` or change it any other
way, even on a clear report.

1. Check out the default branch, and fetch everything the remote holds, pull request refs
   included, since each becomes public with the repo:

   ```bash
   git -C <Course project> fetch origin --tags "+refs/heads/*:refs/remotes/origin/*" "+refs/pull/*:refs/remotes/origin/pull/*"
   ```

2. Run the check (`scripts/go-public/README.md`), giving it the Private folder:

   ```bash
   node "$HOME/.claude/skills/learn-premium/scripts/go-public.ts" --project <Course project> --private <Private folder>
   ```

3. Report to the Owner:
   - **`clear` (exit 0):** say so, with what it scanned. The Owner flips the visibility.
   - **`blocked` (exit 1):** list each finding with its path and commits. A file in history stays
     found until the history is rewritten; offer the rewrite, but run it (and the force-push it
     needs) only on the Owner's word, then fetch and check again. A missing Licences file is
     fixed by generating it, not by hand.
   - **`review` (exit 1, only Checkpoint items):** show each one; the Owner decides whether it's a
     secret.
   - **Exit 2:** show the error; the check didn't run.
