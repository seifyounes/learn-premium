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

## Agent skills

### Issue tracker

GitHub issues on seifyounes/learn-premium via `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Open items

- Stack, design direction, discipline toolkits, NotebookLM route — being decided on the map.
