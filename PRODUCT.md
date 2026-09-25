# Product

<!-- impeccable:product-schema 1 -->

Sources: the wayfinder map (issue #1) and its closed tickets #2, #5–#10, `CONTEXT.md`,
`docs/adr/0001`, `docs/research/v1-lessons.md` (branch `research/v1-lessons`). Written for ticket
#4; every fact below was decided by Seif on those tickets unless marked OPEN.

## Platform

web

## Stack

OPEN (ticket #11). Hosted on Vercel, one project per Course (ADR 0001). Math renders at build time
(KaTeX-class) as stacked, paper-like notation.

## Users

- **Owner:** the student who runs learn-premium on their own Course and studies from the Study
  site first, often the night before an exam, laptop-first with the phone treated as equal.
- **Classmates:** get an unlisted link; no accounts, per-browser progress.
- **Professor:** reviews the finished site (bonus project) and sees their own method and notation
  reproduced. The site is shown to people whose opinion matters.

## Product Purpose

Turn one engineering Course's Materials into a Study site that teaches the Professor's way: short
visual summaries, worked examples solved on the Professor's own solving artefact (a table that fills
step by step, a tree, a redrawn circuit), drills, rules in solving order, past papers and mocks.
Success is a student who can reproduce the Professor's method on paper under exam time.

## Positioning

Not a generic course platform: every Study site is built from one Professor's Materials and
reproduces that Professor's method, notation and order, with independently recomputed numbers.
Accuracy is gated (every table recomputed, figures checked against the source).

## Operating Context

Late-night, time-pressured revision. The student has paper beside them and copies the method.
Disciplines vary: math, logic circuits, electric circuits, heat transfer, machinery, ML. Heavy
tools (circuit simulators, 3D parts, plots) load on demand inside a light shell.

## Capabilities and Constraints

- Worked examples are the core surface; "get me to the work fast" beats study plans.
- The thing being watched (table, figure) must stay on screen while stepping; nothing may cover a
  figure; wide figures keep natural size and scroll rather than shrink.
- Legibility floor: no rendered text or figure node below ~9px, on a 320px phone.
- Math looks like paper: stacked fractions with a long bar, no raw `_` / `^` markup.
- Data is drawn the way the source drew it (tables stay tables).
- Arabic notes: asked per Course, default off (ticket #2). Choices must not preclude RTL.
- Materials never enter the repo; the Professor's name appears only with a non-endorsement note.
- OPEN: experience model and surface list (ticket #3).

## Brand Commitments

- Must NOT be the generic default Claude look (standing constraint).
- Voice: respectful toward the Professor, direct with the student.

## Evidence on Hand

Pilot course = Machine Learning (v1 build at `D:\Claude Os\machine learning`, outside the repo):
11 modules, 30 worked examples all with solving tables, 102 flashcards, 57 written questions,
88 rule cards, 0 MCQ. No testimonials, usage numbers or endorsements exist; never invent them.

## Product Principles

1. The Professor's method is the interface: the solving artefact is the page's centre.
2. Keep the student's eyes on one place: the artefact never scrolls away from its step.
3. Paper fidelity: what is on screen is what they will write in the exam.
4. Short beats over walls of text.
5. Never claim what is not there (no dead tabs, fake scores, wrong labels).

## Accessibility & Inclusion

Phone at 320px must work without horizontal page scroll; reduced motion respected; legibility floor
above. Future RTL (Arabic notes) must remain possible.
