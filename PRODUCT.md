# Product

<!-- impeccable:product-schema 1 -->

Sources: the spec (issue #38), synthesised from the closed wayfinder map (issue #1) and its tickets,
`CONTEXT.md`, `DESIGN.md` and `docs/adr/0001`–`0003`. Every fact below was decided by Seif on
those tickets; where this file disagrees with the spec or those documents, they win. Refreshed
for ticket #39.

## Platform

web

## Stack

Astro 7 static output with React 19 islands loaded on demand (ADR 0002); Next.js 16 static export
is the named fallback, used only if something the bake-off (ticket #17) didn't prove fails in the
Pilot course's build and can't be fixed in Astro. Online only, one Vercel project and unlisted URL
per Course (ADR 0001). Each Course project is a copy of the versioned Site template plus that
Course's content and course config. Math renders at build time through our own KaTeX 0.18 step
(mhchem, `throwOnError`) as stacked, paper-like notation.

## Users

- **Owner:** the student who runs learn-premium on their own Course and studies from the Study
  site first, often the night before an exam, laptop-first with the phone treated as equal.
- **Classmates:** get the unlisted link; no accounts, per-browser progress, hidden from search
  engines.
- **Professor:** reviews the finished site (bonus project) and sees their own method and notation
  reproduced. The site is shown to people whose opinion matters.

## Product Purpose

Turn one engineering Course's Materials into a Study site that teaches the Professor's way: short
visual summaries, worked examples solved on the Professor's own solving artefact (a table that fills
step by step, a tree, a redrawn circuit), practice, rules in solving order, past papers and mocks.
Success is a student who can reproduce the Professor's method on paper under exam time.

## Positioning

Not a generic course platform: every Study site is built from one Professor's Materials and
reproduces that Professor's method, notation and order, with independently recomputed numbers.
Accuracy is gated (every table recomputed, figures checked against the source).

## Operating Context

Late-night, time-pressured revision. The student has paper beside them and copies the method.
A Course has one or more Disciplines; the starting ones are ML, maths, electric circuits, logic
circuits, heat transfer, machinery, engineering chemistry, and automation and control. Heavy tools
(three.js, Pyodide, Plotly) load only when opened or scrolled to, inside a light shell.

## Experience Model

- **Spine:** Module pages plus Course hubs, under a fixed nav: Modules · Master Rules · Lab ·
  Exam room · Revision · About.
- **Home:** a "continue where you left off" card, then one numbered Module list with each
  Module's Mastery and Exam sitting tags. No study plan.
- **Module page:** one scroll with a sticky section rail (side rail on a laptop, chips on a phone)
  that shows which sections are done, in a fixed order: **Watch → Summary → Worked examples →
  Practice**.
- **Watch:** whatever Module media exists (the Explainer video first, then the Deep Dive audio),
  then YouTube cards, shown only when they match the Professor's method at 9/10 or better.
- **Worked examples:** the Professor's artefact stays pinned while the steps reveal beside it;
  read-through by default, with an optional try-first toggle.
- **Practice:** numeric answers auto-checked with a tolerance; prose and derivations self-marked
  against the model answer and "what earns the mark".
- **Tools:** interactive tools inline at the point of use, preloaded with that problem's values; the
  Lab lists every tool for free play.
- **Hubs:** Master Rules is a reference list of the main rules in solving order (no test mode, no
  search). An Exam sitting's hubs appear only after the Owner declares it Sitting complete; until
  then they are hidden, with no stub. Revision assembles the sitting's Module summaries and key
  rules in exam-weight order. The Exam room (past-paper vault, pattern-matched mocks,
  announced-format sim, question bank, timed mode) is built only from the sitting's past papers,
  so a sitting without them gets Revision only.
- **Progress:** Mastery per Module and a readiness meter per Exam sitting, kept per browser, with
  satisfying micro-feedback. No flashcards, no XP, badges or streaks.

## Capabilities and Constraints

- Worked examples are the core surface; "get me to the work fast" beats study plans.
- The thing being watched (table, figure) must stay on screen while stepping; nothing may cover a
  figure; wide figures keep natural size and scroll rather than shrink.
- Legibility floor: nothing rendered under 12px on a phone, table values at 14px or above.
- Math looks like paper: stacked fractions with a long bar, no raw `_` / `^` markup.
- Data is drawn the way the source drew it (tables stay tables).
- Arabic notes: an intake toggle per Course, default off; right-to-left with numbers kept
  left-to-right. Module media stays in English only. Logical properties everywhere so RTL always
  works.
- Materials never enter any repo; Professor-derived evidence stays in the Private folder.
- The Professor gets one Credit line in the footer of every page, naming them, the Course and the
  University. It claims no endorsement and carries no disclaimer or removal contact.

## Brand Commitments

- One house identity, the Computation Pad (`DESIGN.md`); only the pad colour changes per Course.
  Light only.
- Must NOT be the generic default Claude look (standing constraint).
- Voice: respectful toward the Professor, direct with the student; no slang, in-jokes or
  first-person voice as the Professor.

## Evidence on Hand

Pilot course = Machine Learning (v1 build at `D:\Claude Os\machine learning`, outside the repo):
11 modules, 30 worked examples all with solving tables, 102 flashcards (v2 drops flashcards),
57 written questions, 88 rule cards, 0 MCQ. Second pilot = Automation. No testimonials, usage
numbers or endorsements exist; never invent them.

## Product Principles

1. The Professor's method is the interface: the solving artefact is the page's centre.
2. Keep the student's eyes on one place: the artefact never scrolls away from its step.
3. Paper fidelity: what is on screen is what they will write in the exam.
4. Short beats over walls of text.
5. Never claim what is not there (no dead tabs, fake scores, wrong labels).

## Accessibility & Inclusion

Phone at 320px must work without horizontal page scroll; every tool fully usable by touch; reduced
motion respected (motion collapses to instant); legibility floor above. RTL Arabic notes must
always work.
