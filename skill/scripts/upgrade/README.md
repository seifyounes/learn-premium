# Upgrade wave commands

The steps of an Upgrade wave that need a tool rather than judgement: the offer, the branch, the
template re-copy, the migrations and the merge gate. The wave's order is in `../../SKILL.md`
(Upgrade wave); the release flow that produces what it upgrades to is `../../../docs/release.md`.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/upgrade.ts" <command> --project <Course project> [flags]
```

Node 24.16+ runs the TypeScript directly; nothing is installed. `--source <release repo>` names the
git repo the Template releases are read from (their annotated tags and the `template/` they tag); it
defaults to the release worktree the script runs from, which is the installed release. Each command
prints one JSON document (`{"ok": true, ...}` or `{"ok": false, ...}`) and exits:

| Exit | Meaning |
| --- | --- |
| 0 | done (an offer made or held, a step done, ready, merged) |
| 1 | open work: the wave is not ready or didn't merge (`problems`), or a migration threw (`problem`) |
| 2 | bad flags or input (no `--answer`, a release whose notes can't be read, an unknown gate gap) |
| 3 | refused: the lock, the exam freeze, a wave already running, a tree that isn't clean, a template layer that isn't the pinned release's, GitHub |
| 4 | internal error (a bug; the stack is on stderr) |

## Commands

| Command | Does |
| --- | --- |
| `offer --to TAG` | Compares the Course's pinned release with `TAG`, the installed one. `{offer, held, reason}`. `offer` is the plan: `releases` in between, `gateGapsClosed` (from each release's notes, the annotated tag's message), `overridesRetired` (the Course's overrides whose gate gap one of them closes), `closesOwnGaps` (the gate gaps this Course filed that they close), `freeze`, and `lastFailed` (an earlier wave to the same release that ended red, with its gate gap). `offer` is null with a `reason` when `TAG` isn't a newer release, and null with `held` set inside the freeze: no offer within 7 days before an Exam sitting (up to and including the day) unless a release closes a gate gap this Course filed. A sitting with no date never freezes. A release in the way that is a lightweight tag, or whose notes lack the gate gaps section, is refused (2). Changes nothing. |
| `start --holder H --to TAG --answer TEXT` | On the Owner's yes (`TEXT`, in their words). Refused (3) in the freeze, while any wave runs, off `main`, on a tree with uncommitted changes, or when the template layer isn't the pinned release's. Records the wave in the ledger (`upgrades`), commits that on `main` (`chore: start the Upgrade wave to TAG`), sets the project's `core.autocrlf` to false and switches to the wave's branch `upgrade/TAG-N`. From here `ledger.ts next` says `resume-upgrade`, and no Module wave starts and the Course can't be marked done. |
| `apply --holder H` | On the wave's branch: writes every file of `TAG`'s `template/` as the tag has it, deletes every file the release dropped, and drops the Course overrides the release retires (a `keep`t one stays). An install or build in the template layer is left alone. Safe to run again. Refused (3) when the release repo's `TAG` isn't the release `start` recorded. |
| `migrate --holder H` | Runs the migrations the release ships for each major after the pinned release, oldest first, on `content/` (`template/migrations/runner.ts`): the only thing that may change content or course config. Refused (3) before `apply`, a second time, or when content differs from the wave's start (`git checkout <base> -- content` restores it). Exit 1 with `problem` when a migration throws: the wave is red. Records what ran and the content's hashes. |
| `keep --holder H --path P --reason R` | A retired override `P` whose gates fail without it: reopens its gate gap on learn-premium's tracker (the release didn't close it for this Course), then puts the Course's override file back byte for byte. Refused (3) for a path the release doesn't retire, one already kept, or a file the release no longer has (it can't be kept: the wave is red). |
| `ready` | The merge gate. `{ready, problems}`, exit 0 only when: the wave's branch is checked out and the tree clean; `main` is behind it; the template layer is `TAG`'s file for file; the overrides area is the Course's minus the retired ones, each kept one byte for byte; the migrations ran and the content is as they left it; and, only when the template layer holds, the template's own `verify` calls the per-job and per-Module gates green for every Module, the per-deploy gate green, and each Module's module point ran on an `https://` preview, and every Checkpoint item the Gate reports raise is answered (an answer an earlier wave stored counts; a new item gets the Owner's answer through `ledger.ts record checkpoint --wave <upgrade id>`, with a Slip or Divergence ruling for a sheet-vs-recompute one). |
| `merge --holder H` | `ready`, and then `main` fast-forwards to the branch tip (compare-and-swap), the branch is checked out as `main` and the ledger moves to `TAG`: its template hashes are the release's and each retired-not-kept override's row is history. Exit 1 with `problems` and `main` untouched when anything is red. The skill then commits the ledger and pushes `main`. |
| `end --holder H --result failed --gate-gap ID` | Ends a red wave, from `main`, after the branch is committed. Refused (3) unless `main`'s template layer, overrides and content are untouched, and gate gap `ID` is filed on the tracker and was recorded after the wave started. The Course stays on its release; the next offer shows `lastFailed`. |

`keep` reaches GitHub (`gh`, signed in as the Owner); tests use `../../test/fake-tracker.ts`.
The gate gap a red wave files goes through `../gate-gap/README.md`.
