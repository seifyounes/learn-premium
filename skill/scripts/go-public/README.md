# Go-public check

Run before the Owner makes a Course project public. It scans everything git holds for the project
(every commit on every ref, local and remote) and reports; it never changes the repo, rewrites
history or touches the repo's visibility. Flipping the visibility is the Owner's.

```bash
node "$HOME/.claude/skills/learn-premium/scripts/go-public.ts" --project <Course project> [--private <Private folder>]
```

Node 24.16+ runs the TypeScript directly; nothing is installed. It needs the Course project's Build
ledger (read only, no lock). It prints one JSON document and exits:

| Exit | Meaning |
| --- | --- |
| 0 | `verdict: "clear"`: nothing found |
| 1 | `verdict: "blocked"` (a finding that blocks) or `"review"` (only Checkpoint items for the Owner) |
| 2 | bad flags, not the root of a git repo, a shallow clone, nothing committed, no Build ledger, or a `--private` that isn't a folder |
| 4 | internal error (a bug; the stack is on stderr) |

## What it checks

| `check` | Blocks when |
| --- | --- |
| `materials` | a blob's sha256 matches a Materials file: every Build ledger row (superseded ones too), the Materials folder as it is now (files not mapped yet) and, with `--private`, the Materials reader's output in the Private folder. Any other Private-folder match is a Checkpoint item: a Module media master committed as is publishes nothing new. A text file also matches with its line endings normalised; empty files match nothing. |
| `evidence` | a path is evidence-shaped (`evidence.ts`): inside a Private folder (`private`, `…-private`), the Materials reader's output (`reader/…/pages`, `media`, `transcripts`), a `page-NNN.png` render, a transcription, a `crops/`, `quotes/` or `blind-readings/` folder, a `materials/` folder, or an `evidence/` folder. |
| `secret` | a file that is a secret by its name (`.env*` other than `.env.example`, `.env.sample` and `.env.template`; SSH keys, `.pem`/`.key`/`.p12`…), or text holding a token with a known format (private keys, AWS, GitHub, Anthropic, OpenAI, Google, Slack, Stripe live, npm, Hugging Face, `.npmrc` auth, credentials in a URL), in a file or in a commit or annotated tag's message. An assignment that only looks like a secret (`api_key = "…"`, 16+ random characters) is a Checkpoint item (`severity: "checkpoint"`). The value is never printed: a finding carries the lines and the first characters. |
| `licences-file` | `public/licences.txt` (the Licences file, served at a URL the UI never links to) is missing or empty at HEAD. |
| `own-licence` | HEAD has a licence of its own at the root (`LICENSE*`, `LICENCE*`, `COPYING*`, `UNLICENSE`): a public Course project carries none. |
| `unscanned-ref` | a remote holds a ref at a commit that was never fetched, so it couldn't be scanned. |
| `remote-unreachable` | a remote's refs can't be listed. |

Each finding names its `path` and the `commits` that put that file there (or the `tag`), which is
what a history rewrite needs. Findings from history stay found until the history is rewritten:
deleting the file in a new commit doesn't clear them.

The report also gives `head` (where the Licences file was looked for: run it on the default branch,
which is what the public repo shows), `scanned` (commits, paths, blobs, text blobs, messages,
remote refs), and `materials` (how many hashes it matched against, and which folders it read).

The Licences file's path is the Site template's `public/licences.txt` (#47: every build writes it
and the `licences-file` deploy gate blocks a stale committed copy). The evidence-shaped path rules
are shared with the template's deploy gates (`template/gates/evidence.ts`, an identical copy the
template's tests hold to this one). They are still provisional, for #68's pre-commit gate to
confirm or narrow. Git LFS content isn't seen, only its pointer files; Course projects don't use
LFS (ADR 0003).

Tests: `npm test` in `skill/` (Vitest, throwaway repos and synthetic Materials only).
