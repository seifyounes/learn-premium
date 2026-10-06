# Build ledger commands

The Build ledger is `build-ledger.json` at the root of a Course project: the one source of resumable
state. Nothing edits it by hand. The skill and its subagents use only these commands, and every
read checks the file against its schema (`model.ts`), so a hand edit is refused, naming the field.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/ledger.ts" <command> --project <Course project> [flags]
```

Node 24.16+ runs the TypeScript directly; nothing is installed. Each command prints one JSON
document (`{"ok": true, ...}` or `{"ok": false, "error": "..."}`) and exits:

| Exit | Meaning |
| --- | --- |
| 0 | done |
| 1 | a check found problems (`integrity`) |
| 2 | bad flags, bad input, or a ledger file that fails its schema |
| 3 | refused: the lock is someone else's, or the ledger's state doesn't allow it |
| 4 | internal error (a bug; the stack is on stderr) |

## Reading (no lock needed)

| Command | Returns |
| --- | --- |
| `next` | `{action: "intake"}` with no ledger; `{action: "resume", waves}` while a wave is unfinished; else `{action: "waves", newMaterials, waves}`: files to put in the Module map, and the Module waves to run, each with its `reasons` (`planned`, `failed`, `materials-added` for a file mapped into a live Module, `materials-changed`, `materials-deleted`), in Module order. A new Course gets Module 01 alone until its wave merges. |
| `diff` | The Materials hash diff: `new` (path, kind), `changed` and `deleted` (path, kind, the Module they feed). |
| `status` | Course, Materials path, template (release, file hashes, current overrides), lock, Modules with their Materials, Exam sittings with their state (`open`, `building`, `live`, from their Sitting waves), current waves, jobs and Checkpoint answers, every `superseded` row, and `media`: the media items as the Media pass last wrote them (read only; see `../media/README.md`), with `mediaError` set, and `media` empty, when that file fails its schema. |
| `checkpoint --key K` | The Owner's current answer to Checkpoint item `K`, or `null`. Look here before asking. |
| `integrity` | The template layer against its pinned hashes: `modified`, `added`, `missing`. Exit 1 if any. |

## Writing (only the lock holder; `--holder <id>` on every one)

`<id>` names the driving session; pick one at run start and use it for the whole run.

| Command | Does |
| --- | --- |
| `init --holder H --release TAG --intake FILE` | At intake: creates the ledger with the intake answers (JSON: `courseName`, `materialsPath`, `disciplines`, `pad`, `arabicNotes`, `sittings: [{id, name, date or null}]`, and `expectedModules`, the Modules expected this semester, 1–99 or null; left out, it reads as null), the release tag and a hash of every file under `template/`. `H` holds the lock. Intake's `create` (`../intake/README.md`) runs it for a new Course project. |
| `map --holder H --input FILE` | Records the Owner-confirmed Module map, or an addition to it: `{modules: [{id: "01", slug, title, materials: [paths]}], unmapped: [paths]}`. Paths are relative to the Materials folder; each must be on disk and not mapped yet. |
| `lock claim --holder H [--take-over REASON]` | Takes the lock. Refused (3) while another session holds it; `--take-over` breaks a dead session's lock, only on the Owner's word, and the ledger keeps who had it and why. |
| `lock release --holder H` | Frees the lock at the end of a run. |
| `wave start --holder H --kind module\|sitting --target ID --branch B` | Starts a wave at the pinned release; returns `{wave}`. A Module wave takes in its changed and deleted Materials (old rows superseded). Until a Module wave has merged, only the first Module's wave starts (refused, 3, for any other): Module 1 builds alone and writes the Course style sheet. |
| `wave end --holder H --wave W --result merged\|failed [--commit SHA]` | Ends a wave; `merged` needs the full commit SHA it merged. The Module goes `live` or `failed`. |
| `record job --holder H --wave W --job NAME --result passed\|blocked\|fell-back\|checkpoint [--started-at ISO] [--detail TEXT]` | A job's result. `--started-at` is when the main agent launched it, so the report's times are measured, not self-reported. Recording the same job again supersedes the old row. |
| `record checkpoint --holder H --wave W --key K --question Q --answer A [--ruling slip\|divergence]` | The Owner's answer to a Checkpoint item. Keys are stable across runs (`01/sheet2-q3`). |
| `record override --holder H --path P --gate-gap N` | A Course override of template file `P` (a path under `template/`), with its gate-gap issue on learn-premium. |
| `supersede --holder H --row material\|module\|wave\|job\|checkpoint\|override --id ID --reason R` | Marks a row superseded; it stays as history. A superseded Module's Materials come back as new. A running wave, or a Module with one, is refused: end the wave first. |

## Generated pages

Every write regenerates `build-records/status.md` (Modules, sittings, running waves, Checkpoint
answers, overrides, unmapped Materials) and `build-records/build-report.md` (each wave's branch,
release, commit and measured times, and its jobs). Commit them with the ledger; don't edit them.

## Layout it assumes in a Course project

- `build-ledger.json`: the ledger.
- `build-media.json`: its media file, written only by the Media pass (`../media/README.md`).
- `template/`: the template layer, read-only; its hashes are pinned at `init`. The folders its own
  `.gitignore` names (`node_modules/`, `dist/`…) are a local install or build, not template files,
  so they're never hashed; nor is any `.git/` folder, in the template layer or the Materials.
- `build-records/`: committed, never deployed.

Tests: `npm test` in `skill/` (Vitest, synthetic fixture Materials only).
