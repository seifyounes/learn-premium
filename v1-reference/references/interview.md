# Intake interview — Phase 1

Ask ONE batched message (AskUserQuestion where available, grouped sensibly —
not an interrogation). Harvest answers already present in the user's message
first; ask only what's missing; apply the defaults for non-answers. Persist
every answer into the project's CLAUDE.md + MEMORY.md immediately after
(Phase 2) — the interview must never need repeating.

## The questions

1. **Materials.** Where are they (folder / zips / paths)? What's in there —
   lecture PDFs or slides, problem sheets (with official solutions?), past
   exams, handwritten notes, external resources (videos, textbook chapters)?
   Anything scanned or handwritten?
   *Default: scan the named folder and inventory everything found.*

2. **Subject & type.** Subject name, and confirm the classification you propose
   after skimming one lecture (math-heavy / code-heavy / memorization-heavy /
   diagram-heavy / mixed — see subject-types.md). The type drives the figure
   toolkit, walkthrough flavor and demo set.

3. **Exam.** Date or days-remaining (drives the study plan and urgency bias)?
   Format announced (sections, marks, duration)? **Nature: problems only, written
   theory + problems, or MCQ?** Are past papers included — and should the mock
   clone their structure? Is there a *second* exam later (a midterm now, a final
   after) — the site is then split by exam part (`SITE.parts`).
   *Default: general weighted mock only, plan sized to the stated time left.*

3b. **Practice format.** Written-only drills (model answer + "what earns the
   mark") or MCQ quizzes too? MCQ exists on the site only when the exam has MCQ
   — a written exam gets written practice, and a problems-only exam gets
   problems. *Default: written-only; add MCQ only if the exam has it.*

4. **Professor fidelity.** Reproduce the professor's exact methods, notation and
   numbers where the sources show them (the exemplar default — it's what makes
   the site feel like the actual exam), or standard-textbook style? Professor's
   name in the site copy, or keep it out? A named professor is credited
   respectfully AND the site states it is a student-built study aid, not
   reviewed or endorsed by them (`SITE.credit`); the voice is professor-STYLE,
   never first-person as them.
   *Default: full fidelity when solution sheets or boards exist; name included
   with the disclaimer.*

4b. **Source priority.** When a board photo, a handwritten note and a PDF
   disagree, which wins? Are more photos coming, or is this everything?
   *Default: boards/notes control scope, method and weighting; independent
   maths controls correctness; "this is everything" is recorded so PDF-only
   topics get a second independent read.*

5. **Language.** English-only, or English + Egyptian-Arabic explanatory notes
   with the topbar toggle?
   *Default: Arabic notes ON — technical terms stay in English, numbers stay LTR.*

6. **Code & demos** (ask when the type is code-adjacent, e.g. ML). Course
   language (Python/NumPy…)? Include per-step code walkthroughs? Which
   interactive demos from the type's menu (subject-types.md lists them — e.g.
   ML's gradient-descent fit, k-means, decision boundary)? Demos are vanilla-JS
   ports that run offline — confirm that's acceptable versus static figures.
   *Default: code walkthroughs ON + the 2–3 highest-yield demos.*

7. **Priorities & scope.** Topics the professor emphasized; anything announced
   as off-syllabus or skippable; the passing/target grade context.
   *Default: weight by past-paper analysis; skip nothing.*

8. **Video cards.** One audited YouTube explainer per lecture topic that solves
   it the professor's way (≥ 9/10 match, any subject, link-outs)? *Default: ON —
   hunts run in Phase 6b; topics without a 9/10 stay honestly "pending".*

9. **Branding & deployment.** Site name (*default: "{Subject} Crash Course"*),
   accent color (*default: keep the template accent; pick a subject-appropriate
   one if the user wants variety*), deploy target (*default: local + single-file
   build; Vercel with `outputDirectory` scoped to `dist/` or Netlify Drop —
   never a root deploy, the material folders are the professor's copyrighted
   work; repo private*). Where does the backup copy of the single file live?
   (*default: the project root, so the project stays self-contained*).

## After the answers

- Restate the locked decisions in one short block (they go into MEMORY.md
  verbatim).
- State the classification and the figure-toolkit plan in one sentence each.
- Then start Phase 2 without waiting further.
