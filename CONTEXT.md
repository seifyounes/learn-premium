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

**v1**:
The `/crash-course` skill as it stood on 2026-09-25 (vanilla-JS single-file engines). Reference
only; learn-premium replaces it.
_Avoid_: old skill, legacy (alone)

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
blocks the Module going live.
_Avoid_: videos, assets

**Notebook recipe**:
The step-by-step instructions the skill prints for the Owner to make Module media by hand when
driving NotebookLM fails.
_Avoid_: manual mode

### The build

**Build ledger**:
The record of one Course's build state, kept in its Course project: intake answers, Materials
inventory, Module map, the state of every Module, sitting, job and media item, and the Owner's
checkpoint answers. What a broken session resumes from.
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

**Build evidence**:
The transcriptions, recompute logs and gate reports behind a Course's content, kept with the
Course project and never published.
_Avoid_: scratch, artefacts

**Media pass**:
The separate, resumable run that makes Module media and sitting audio, spanning days on quota.
_Avoid_: media phase

**Media queue**:
The one queue of pending Module media shared by all the Owner's Courses, drained nearest Exam
sitting first within the plan's daily quota.
_Avoid_: backlog
