# learn-premium — project rules

Inherits the global standards in `../CLAUDE.md`.

## What this is

v2 of the `/crash-course` skill, renamed **learn-premium**. It takes a course's materials and
produces a premium, interactive study website for any engineering subject (math, logic circuits,
electric circuits, heat transfer, machinery, …). It replaces v1 (`~/.claude/skills/crash-course/`,
snapshot in `v1-reference/`), learning from it without being bound to it.

## Owner decides

Seif is the product owner. Every product/project decision goes to him for approval; agents
research, prototype and recommend, never decide on his behalf.

## Standing constraints (decided 2026-09-25)

- Repo is **private** (github.com/seifyounes/learn-premium).
- **Pilot course:** the v1 Machine Learning build (`D:\Claude Os\machine learning`). Course
  materials stay **outside** the repo, referenced by path — never commit a professor's material.
- v2 keeps v1's **verification discipline** (accuracy gates, real-browser QA of the output), even
  where engines and design are replaced.
- The output design must NOT be the generic default Claude look.
- NotebookLM has no API: it is driven through browser/computer automation on Seif's account.

## Workflow

- Effort phases: wayfinder → spec → tickets → implement → code review (mattpocock skills).
- Work is split so **parallel sessions** can run: each session loads the `wayfinder:map` issue,
  claims one ticket, and records its answer on the ticket. Seif runs `/handoff` if a session
  breaks mid-ticket.

## Test temp folders (2026-10-10)

- Tests used to copy courses and repos into the system temp folder and never remove them: by
  2026-10-09 some 13,000 `lp-*` folders (~25 GB) had filled Seif's C: drive and crashed programs.
  Those leftover copies were deleted from `%TEMP%`; nothing in them was needed.
- Now `test/temp-dir.ts` (Vitest global setup, in `skill/` and `template/`) gives each run its own
  temp folder and removes it when the run ends. Keep it in both configs, and don't create test
  scratch anywhere it doesn't cover. `LP_KEEP_TEST_TMP=1` keeps a run's folder for debugging.
- Keep test temp on C: (SSD). On D: (a slow HDD) tests time out; `LP_TEST_TMP` exists, but don't
  point it there.

## Agent skills

### Issue tracker

GitHub issues on seifyounes/learn-premium via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Open items

- Stack, design direction, discipline toolkits, NotebookLM route — being decided on the map.
