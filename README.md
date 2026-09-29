# learn-premium

A Claude Code skill that turns an engineering course's raw materials (lectures, slides, sheets,
past papers, notes) into a premium, interactive study website. It is v2 of `/crash-course` and
will replace it.

**Status:** scaffolded 2026-09-25. No code yet. The effort is in the **wayfinder** phase: product
decisions are being charted as GitHub issues (see the `wayfinder:map` issue).

Pipeline for this effort: wayfinder → spec → tickets → implement → code review.

## Layout

- `v1-reference/` — frozen snapshot of the `/crash-course` v1 skill (read-only reference).
- `docs/agents/` — issue-tracker and domain-doc conventions for the agent skills.
- `CONTEXT.md` — domain glossary.
- `template/` — the Site template (Astro 7) that every Study site is built from.
- `fixture-course/` — the synthetic Fixture Course the template builds on every change.
- `skill/` — the skill Claude Code loads (`SKILL.md`, scripts, the machine venv's lock file).
- `install.ps1` — the re-runnable installer (Windows); see `docs/install.md`.
- `tests/` — installer and install-check tests (synthetic repos only).

## How to run

The Site template builds the Fixture Course (Node 24.16+):

```bash
cd template && npm ci && npm run build
```

`npm test` builds it again with its negative controls; see `template/README.md`.

Install learn-premium (needs a Template release tag):
`powershell -ExecutionPolicy Bypass -File install.ps1`. Then type `/learn-premium <Materials path>`
in Claude Code. Installer tests: `uv run --no-project --with pytest pytest tests`.
