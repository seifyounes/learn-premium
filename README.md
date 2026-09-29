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
- `src/` — the v2 skill (empty until the spec is locked).

## How to run

The Site template builds the Fixture Course (Node 24.16+):

```bash
cd template && npm ci && npm run build
```

`npm test` builds it again with its negative controls; see `template/README.md`.
