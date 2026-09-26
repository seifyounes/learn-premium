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
tool per kind of interaction. Circuit and automation Disciplines use Agent-built sims throughout;
elsewhere a ready-made tool is named where one fits, with an Agent-built sim as the fallback.
_Avoid_: tool stack, widgets

**Agent-built sim**:
An interactive the agent writes itself, drawn in the pad's inks, instead of embedding someone
else's tool: the default for circuit and automation Disciplines (preferred on feel over the
ready-made simulators) and the fallback wherever no tool fits. It shows the Professor's figure
only; students tune it but never rewire it. It ships only if its model can be recomputed
independently at build; otherwise the figure gets a step-through animation instead.
_Avoid_: custom widget, demo, generated sim

**Pilot course**:
The Course whose v1 build is rebuilt first in v2 to prove the new pipeline end to end.
Currently Machine Learning.
_Avoid_: test course, demo

**v1**:
The `/crash-course` skill as it stood on 2026-09-25 (vanilla-JS single-file engines). Reference
only; learn-premium replaces it.
_Avoid_: old skill, legacy (alone)
