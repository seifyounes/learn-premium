# learn-premium

The skill that turns an engineering course's materials into a premium, interactive study site.
This glossary fixes the words agents and humans use for its concepts.

## Language

**Course**:
One university subject a student sits an exam in (e.g. Machine Learning, Power Electronics).
_Avoid_: subject (when you mean a specific course), class

**Materials**:
Everything the student supplies about a Course — lecture PDFs, slides, board photos, sheets,
solutions, past papers, handwritten notes, media. Read-only inputs; never moved, never published.
_Avoid_: sources (ok informally), files, content

**Study site**:
The website learn-premium produces for one Course.
_Avoid_: crash course site, website (alone), app

**Site template**:
The versioned site code learn-premium carries and copies into every Course project. It is the
same for every Course.
_Avoid_: theme, boilerplate, starter

**Course project**:
The repo for one Course's Study site: a copy of the Site template, plus that Course's content
and course config. One per Course, deployed on its own.
_Avoid_: site repo, Course folder (when you mean the Materials folder)

**Template release**:
A tagged version of learn-premium: the skill, the Site template and its gates together, under one
number. A Course project is pinned to one release and moves to a newer one only on the Owner's
word. Only a release that passed the template's own checks and the Owner's real-phone pass
reaches a Course.
_Avoid_: template version (when you mean an untagged state), update, build

**Course override**:
A local fix to Site template code that one Course project needs before a Template release carries
it. It shadows the template file, is tied to the Gate gap it works around, and is retired when a
release closes that gap. Template code is never edited in a Course project any other way.
_Avoid_: patch, hotfix, local edit

**Owner**:
The student who runs learn-premium for their own Course and studies from the Study site first.
_Avoid_: user (ambiguous with site visitors)

**Classmates**:
Other students of the same Course whom the Owner sends the Study site link. They get no
accounts and no per-person features.
_Avoid_: users, audience

**Professor**:
The person who teaches the Course. They wrote most of the Materials, the Study site reproduces
their method and notation, and they review the finished site as the Owner's bonus project.
_Avoid_: doctor, dr (informal in Materials), instructor

**Discipline**:
An engineering field a Course's topics belong to (e.g. heat transfer, logic circuits, machinery).
A Course has one or more, suggested by the agent and confirmed by the Owner at intake; each
topic draws on one of them. A Discipline selects the Course's pad and its Toolkit.
_Avoid_: subject type (v1's four generic kinds), subject, field

**Toolkit**:
The interactive tools a Discipline uses by default for its Worked examples and Lab: one named
tool per kind of interaction. The starting Disciplines (circuits, logic, automation, maths, ML,
heat transfer, machinery, engineering chemistry) use Agent-built sims throughout, picked on feel
over the ready-made tools; a Discipline added later at intake gets a ready-made tool where one
wins on feel, with an Agent-built sim as the fallback.
_Avoid_: tool stack, widgets

**Agent-built sim**:
An interactive the agent writes itself, drawn in the pad's inks, instead of embedding someone
else's tool: the default for every starting Discipline (preferred on feel over the ready-made
tools) and the fallback wherever no tool fits. It draws on the shared core: JSXGraph for 2D,
three.js for 3D, SVG for schematics, Plotly only for heatmaps and 3D surfaces. It shows the
Professor's figure only; students tune it but never rewire it. It ships only if its model can be recomputed
independently at build; otherwise the figure gets a step-through animation instead.
_Avoid_: custom widget, demo, generated sim

**Layout hints**:
What a sim builder reads off the Professor's figure so the layout engine can redraw it: each part's
coarse grid cell, turn and label side (for a state diagram, each state's cell and self-loop side).
The builder never writes drawing coordinates; the engine places, straightens and routes from the
hints. Used by schematic-type sims (circuits, automation, FSMs), not by plots or mechanisms.
_Avoid_: coordinates, manual layout, auto-layout

**Drawing gate**:
The checks every Agent-built sim's drawing must pass: drawing ↔ model (parts, connectivity read
from the drawing's geometry alone, labels, conventions, legibility, tidiness), model ↔ figure (the
model's nets equal an independent Blind reader's), and drawing ↔ figure (arrangement, turn, label
side, symbols, junction dots). All checks block, and a negative control of deliberately broken
drawings must be caught on every build.
_Avoid_: layout check, visual QA

**Pilot course**:
The Course whose v1 build is rebuilt first in v2 to prove the new pipeline end to end.
Currently Machine Learning.
_Avoid_: test course, demo

**Second pilot**:
The live-semester Course built after the Pilot course to prove the Disciplines Machine Learning
never touches, on Materials that arrive lecture by lecture. It has its own exit criteria, and the
Cut-over does not wait for it. Currently Automation. Every other Discipline is proven by its first
real Course build, flagged unproven with extra Owner review until it meets the same bar.
_Avoid_: second Pilot course, test course, pilot 2

**v1**:
The `/crash-course` skill as it stood on 2026-09-25 (vanilla-JS single-file engines). Reference
only; learn-premium replaces it. After the Cut-over it stays installed only to resume or fix a
Study site it built.
_Avoid_: old skill, legacy (alone)

**Cut-over**:
The moment learn-premium becomes the main skill for building Study sites: when the Pilot
course's v2 Study site is deployed with every Gate passing. Before it, learn-premium runs only
when called by name.
_Avoid_: launch, release, switch

**Machine install**:
learn-premium set up on the Owner's machine: the release worktree (a checkout of one Template
release that Claude Code loads the skill from, by a junction), the machine state folder, the
machine venv and Playwright's browsers. Only an installer run the Owner asks for moves it to a
newer Template release; each run starts with the install check, which reports what's missing and
how far behind it is.
_Avoid_: setup, deployment, update (for moving to a newer release)

### The Study site

**Module**:
One teaching unit of a Course (usually one lecture or topic block), with its own page: Watch,
Summary, Worked examples, Practice. The unit the build works in.
_Avoid_: chapter, lesson, lecture (when you mean the page)

**Exam sitting**:
One exam the Course is assessed in (e.g. midterm, final), covering a set of Modules.
_Avoid_: exam (alone), test, paper

**Sitting complete**:
The Owner's word that every Module an Exam sitting covers is in. Only the Owner says it; until
then that sitting's Exam room and Revision don't exist.
_Avoid_: exam ready, closed

**Exam room**:
The hub for one Exam sitting: past-paper vault, mocks and question bank, timed. Built only
from the sitting's past papers, so a sitting without them has no Exam room.
_Avoid_: exam suite, finals page

**Revision**:
The hub for one Exam sitting that assembles its Modules' summaries and key rules in exam-weight
order. Never written separately.
_Avoid_: cheat sheet, review

**Master Rules**:
The Course's reference list of the main rules its problems actually use, in solving order.
_Avoid_: formula sheet, rules bank

**Lab**:
The Course hub that collects every interactive tool for free play.
_Avoid_: playground, sandbox

**Mastery**:
A Module's progress measure, from practice done and worked examples gone through; a sitting's
readiness is its Modules' average Mastery plus the best mock score.
_Avoid_: XP, score, streak

**Course notebook**:
The one NotebookLM notebook per Course that holds its Materials and grows as Modules arrive.
_Avoid_: notebook (alone)

**Module media**:
The NotebookLM outputs a Module gets: Explainer video, Deep Dive audio, infographic. Never
blocks the Module going live. Re-encoded for the web and published from the Course project; the
master copies stay in the Private folder.
_Avoid_: videos, assets

**Notebook recipe**:
The step-by-step instructions the skill prints for the Owner to make Module media by hand when
driving NotebookLM fails.
_Avoid_: manual mode

### The build

**Build ledger**:
The record of one Course's build state, kept in its Course project: intake answers, Materials
inventory, Module map, the state of every Module, sitting, job and media item, and the Owner's
checkpoint answers. What a broken session resumes from. Its media item states are written only
by the Media pass.
_Avoid_: MEMORY.md (v1's ledger), status file, progress log

**Module map**:
The Owner-confirmed list of a Course's Modules and which Materials feed each one.
_Avoid_: outline, syllabus

**Module wave**:
The run that takes one Module from its Materials to live: reading, writing, sims, recompute,
gates, checkpoint, merge. Many Module waves run at once in one session.
_Avoid_: phase (v1's P-steps), batch

**Sitting wave**:
The run, started only by Sitting complete, that builds one Exam sitting's Exam room and Revision.
_Avoid_: exam phase

**Upgrade wave**:
The run, started only on the Owner's word, that moves a Course project to a newer Template
release: re-copy the template, migrate content if needed, retire Course overrides, re-run the
gates on every Module, then merge. A red Upgrade wave never merges; the Course stays where it was.
_Avoid_: update, migration (alone), re-copy (for the whole run)

**Course style sheet**:
The Professor's notation, symbols, units, table forms and voice for one Course, written from
Module 1 before any other Module is written. Every writer follows it.
_Avoid_: style guide (alone), conventions

**Blind reader**:
One of two agents that transcribe the same Materials independently, never seeing each other's
output, so their numbers can be compared.
_Avoid_: extractor, OCR agent

**Checkpoint**:
The Owner's batched confirmation of one Module's open items (sheet-vs-recompute conflicts,
scaled dimensions, new Disciplines) before it merges.
_Avoid_: review, approval gate

**Slip**:
A place where the Professor's stated result is wrong by the Professor's own method or by the real
system, which the Owner rules a mistake at a Checkpoint. The Study site ships the corrected value
and shows both.
_Avoid_: error, typo (alone)

**Divergence**:
A place where the Professor's stated result differs from the recompute or the real system and the
Owner rules it the exam's truth at a Checkpoint. The Study site ships the Professor's value as the
exam answer, with a note saying what the recompute or the real system gives; a sim still behaves
like the real system and marks the line where they part.
_Avoid_: discrepancy, conflict (alone)

**Build evidence**:
The transcriptions, crops, recompute logs and gate reports behind a Course's content, never
published. Recompute logs and gate reports are committed in the Course project; anything that
carries the Professor's text or pages (transcriptions, quotes, crops) lives in the Private folder.
_Avoid_: scratch, artefacts

**Private folder**:
The per-Course folder beside the Materials, outside any repo, holding what must never be
published or made public: the Professor-derived part of Build evidence and the master copies of
Module media. A Course project holds only what its Study site publishes plus build records free
of the Professor's text, so the repo can go public.
_Avoid_: scratch, evidence folder, Course folder

**Media pass**:
The separate, resumable run that makes Module media and sitting audio, spanning days on quota.
_Avoid_: media phase

**Media queue**:
The one queue of pending Module media shared by all the Owner's Courses, gathered afresh from
their Build ledgers at every Media pass and drained nearest Exam sitting first within the plan's
quota.
_Avoid_: backlog

**Course registry**:
The machine's list of the Owner's Course projects, which the Media pass reads to gather the Media
queue. A Course joins it at intake.
_Avoid_: course list, index

**Credit line**:
One visible line of attribution on a Study site. Each embedded tool gets one where it is used,
and the Professor gets one in the footer of every page, naming them, the Course and the
University. A Credit line claims no endorsement and carries no disclaimer.
_Avoid_: attribution (alone), about page, disclaimer

**Licences file**:
The third-party notices a Study site ships, at a URL the UI never links to, and committed with the
Course project. It is generated from the shipped packages plus hand-written entries the Site
template carries for what that generation can't see.
_Avoid_: credits page, NOTICE (alone), about

**Go-public check**:
The skill step the Owner runs before making a Course project public: it scans the whole history
for Materials, Professor-derived evidence and secrets, and confirms the Licences file is present.
The Owner flips the visibility; a public Course project carries no licence of its own.
_Avoid_: publish gate, open-sourcing

### Quality

**Gate**:
A check a build must pass. It has only two outcomes on a finding: it blocks (the job that made the
problem fixes it) or it raises a Checkpoint item (only the Owner can settle it). There is no
warning level. Gates run at three points: per job, per Module and per deploy.
_Avoid_: test (alone), lint (for the whole class), warning

**Gate report**:
What a gate run leaves behind: every gate with its result and what it covered, tied to the exact
commit it checked. A gate that didn't run counts as failed, and a Module merges only with a
green report for its final commit.
_Avoid_: test log, QA notes

**Negative control**:
Deliberately broken input a gate must catch, proving it can see what it claims to check. Every
gate has one.
_Avoid_: fault injection (alone), self-test

**Trap page**:
A hidden page of seeded defects in every preview build. If a browser run misses any of them,
the whole run is void.
_Avoid_: test page, canary

**Tool gallery**:
The page in the Site template with one of every sim kind, the 3D viewer and a Pyodide run. The
Owner tests it on a real phone before every Template release.
_Avoid_: demo page, Lab (the Course hub)

**Fixture Course**:
A small synthetic Course kept in learn-premium's own repo, written without any Professor's
material, that exercises every component, every sim kind, the Tool gallery and the Trap page.
The template's own checks build it on every change, and each major release proves its migration
by upgrading the previous release's Fixture Course.
_Avoid_: sample course, demo course, Pilot course (that one is real)

**Provenance tag**:
The origin every number, formula, dimension and sim constant carries: stated (in the Materials),
derived (worked out, no official key), scaled (measured off a drawing) or assumed (supplied by
the agent). Derived, scaled and assumed values say so on the page.
_Avoid_: source label, confidence

**Gate gap**:
A new kind of defect found while building a Course that no gate caught yet. It is filed on
learn-premium's own tracker with a broken fixture and lands as a gate in the next Template
release; until then the Course works around it with a Course override.
_Avoid_: lesson learned, fold-back note
