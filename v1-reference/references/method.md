# The method — content standards & exam-suite playbook

Distilled from the Electronics Crash Course build (the exemplar): what earned
the marks, in the order it was earned. Read at Phases 4–8.

## The content pieces per module (every module)

1. **Summary — visual-first.** ≤ 5 `<h3>` beats × ≤ 90 words, each wrapped
   around ONE figure/demo (`data-figure` / `data-graph` / `data-calc` /
   `data-anim`), each ending with a one-line **"say it aloud"** viva sentence.
   Define every term the first time it appears; intuition before formalism. No
   walls of text — the ML final build replaced 400-word sections with five
   beats and the student actually read them. Numbered headings read best.
2. **Key rules & formulas** — every equation the worked examples use, in the
   professor's written form: what each symbol means, units, when it applies,
   the sign/assumption traps. These power the module's active-recall rule
   cards and the master sheet. Divisions are stacked `{a}/{b}`.
3. **Worked examples — THE TABLE METHOD.** Step-reveal walkthroughs drawn from
   the professor's sheets and boards. **Every example ships the professor's
   `table:`**, drawn empty and filled column by column as the steps run
   (`fill`), with the headline number circled (`mark`) and a fresh table for a
   second iteration. The question's data ships as a `given:` table when the
   source posed it as one. Each step states *why* it happens; highlight the
   figure part the step uses (`hl`), and REDRAW complex figures into simpler
   equivalents mid-solution (per-step `circuit:` — the morph). The table is
   what the student copies onto the exam paper — it IS the marking scheme.
4. **Flashcards** — definitions, formulas, rules; short fronts, complete backs.
5. **Written questions (professor-style)** — open prompts modeled on the
   professor's phrasing from sheets/notes, each with a model answer and a
   marking note ("what earns the mark"); `given:` tables where the data is
   tabular. Label inferred questions `inferred`. **MCQ quizzes exist only when
   the exam has MCQ** — then instant grading with a one-line why for EVERY
   option and length-balanced options (see "MCQ fairness" below).
6. **Common mistakes & exam tips** — the traps that actually lose marks on this
   topic, including a table-first tip ("draw the table before any number").
7. **Video cards** — one audited YouTube explainer per topic that solves it the
   professor's way, ≥ 9/10 match, verified before linking; otherwise an honest
   `pending` card. Method: `references/videos.md`.

## THE TABLE METHOD — how the professor solves everything

Watch the boards: gradient descent, z-score, min-max, binning, KNN, Naive
Bayes, ridge comparison, splits, the derivations — the professor never solves
in prose. He draws a table with his numbers as rows and his computed
quantities as columns, fills it in a fixed order, sums the column, circles the
answer. So the site does exactly that:

- The skeleton appears empty (`pre` marks what was already on the board), then
  fills as the steps run — the order of `fill` selectors is the order the
  student should write on paper.
- A second iteration is a **fresh table** carried forward like a redrawn figure.
- Sums are recomputed by the checker from the displayed cells; a Σ that does
  not add up fails the build.
- **`given` ≠ `table`.** `given` is the question's DATA, static, drawn the way
  the source drew it; `table` is the SOLUTION, dynamic. A worked example may
  carry both.
- A problem stated as a run of tuples ("1: T,T,+ · 2: T,T,+ …") was rejected
  by the real user as "not understandable at all" — the checker now fails it.
  Coordinates that came as coordinates ((0,1), (1,2) …) stay coordinates.

## Master Rules — a retrieval tool, not an inventory

- Only rules the worked examples use, each carrying the professor's own
  numbers ("m = 1000 → 700 / 150 / 150"). Group by topic in solving order.
- **Every division is a stacked fraction** — write `{numerator}/{denominator}`
  and the engine draws a big horizontal bar; a bare `a/b` in a rule formula
  fails the checker. The user's words: "I want to see the dividend and the
  divisor underneath each other, a long horizontal line, not like this '/'".
- **Problems-only exam → computational rules only.** When the professor
  announces no theory, remove definitions, comparisons, "what X is" rows and
  skeleton-only groups from the Master Rules — and from nowhere else (the
  summaries and revision keep their theory unless told otherwise). Retitle the
  page via `SITE.rules`.
- For a topic with 2–3 parallel variants ship a **solve sheet** group
  (`groups[].figures` + `groups[].table`): circuits above, a comparison table
  whose rows are the quantities that DIFFER, shared rules once underneath,
  each variant's rules numbered in computation order.
- Cutting requests come as pastes of the rendered page. Check the paste against
  the live file first: names that no longer exist mean a cached render. List
  what is already gone versus still present and confirm before deleting.

## MCQ fairness — the answer must never be guessable from its shape

**The failure mode.** Writing an MCQ, the natural instinct is to make the
correct option unambiguously correct — so it grows a qualifying clause ("…—
it has no control terminal") — while the three distractors stay as terse
stubs. Do that 40 times and the correct answer is the longest option ~80% of
the time. A student who knows nothing scores ~80% by picking the tallest box,
believes they are ready, and meets a real paper with even-length options.
**A length-biased quiz is worse than no quiz: it manufactures false confidence.**
This shipped once, undetected, until a student noticed the pattern by eye.

**The rules:**

- Keep all four options within ~15 characters of each other. The explanation
  belongs in `why`, never in the option text — the option states the claim only.
- Trim the correct option to its bare claim, then raise the distractors to
  match that specificity. Never pad with filler; a distractor should read as a
  real belief someone holds.
- Deliberately let a distractor be the longest option in roughly a quarter of
  questions, so "longest" carries no information at all.
- The same applies to other shape cues: don't let the correct option be the
  only one that is grammatical, the only specific one among vague ones, the
  only one with a unit or a number, or the only one hedged with "usually".
- Absolutes ("always", "never", "cannot") in distractors only are another tell.
- Formula/symbol options are naturally short — parity still applies, and a
  near-miss formula makes a far better distractor than an obviously wrong one.

**Verify by measuring, not by eye** — the bias is invisible while authoring
because you are reading meaning, not counting characters. The project's
accuracy checker (`.claude/accuracy-check.mjs`) gates it: correct-is-longest
must sit near the 25% chance rate (fail above 40%), mean correct/distractor
length ratio ≤ 1.25x, and per-question spread ≤ 18 chars. Extend that checker
into every new build and run it before shipping any quiz.

## Quality bar

- **Verify before publishing.** Every formula and numeric answer is checked
  against `docs/source-of-truth.md`, which is itself checked against the
  official solution sheets. Unsure → flag, don't guess.
- **Quizzes must be unbeatable by shape.** Run the MCQ fairness check above
  before shipping; a quiz that rewards pattern-spotting over knowledge is a
  defect, not a stylistic preference.
- **Exam-first framing.** For each concept, say how it tends to be tested.
- **Beginner-true.** No assumed background, ever. If a concept needs another
  concept, teach that one first or link to where it's taught.
- **One module fully done beats six half-done.** Module 1 end-to-end first,
  then replicate.

## Professor fidelity (when enabled)

- Reproduce the professor's exact method, notation AND numbers where sources
  show them. The worked tab carries a "Solved the professor's way" callout
  (`SITE.methodNote`).
- Mine the sheets and handwritten notes for how they explain and what they
  emphasize — that's where written questions and exam predictions come from.
- Never invent content the sources don't support.
- Name the professor respectfully with the "student-built study aid — not
  reviewed or endorsed" disclaimer (`SITE.credit`). Professor-STYLE voice,
  never first-person as them.
- Exam-weight claims stay honest: a classmate's "SVM is 10 marks" is a
  prediction and is labelled as one everywhere it appears.
- Source slips ship corrected with both readings documented in the
  source-of-truth (a miscopied row, a 10⁴ that should be j = 5) — the sheet is
  the scope, the mathematics is the truth.

## Question DNA — mine the SHAPE before writing any exam question

**Do this before Phase 8, always, without being asked.** Getting the physics
right is not enough: a mock only rehearses the real paper if the questions are
*built the way this professor builds them*. Content fidelity is
`source-of-truth.md`; **form fidelity is this step**, and it is the one people skip.

Read every sheet/past-paper question for structure, not answers, and write
`docs/question-dna.md` recording:

1. **Question types and their observed frequency.** Count them. Typical families:
   the multi-part *Arc* (one system, lettered parts walking name → sketch →
   derive → property → numbers), the *Chained follow-up* ("for the previous
   question, if X is replaced with Y"), the *plain numerical*, the **reverse /
   inverse** (gives the OUTPUT, asks for the input parameter), and the
   *two-case* (same setup, two parameter values, forcing discrimination).
2. **The Arc's exact part ordering**, and where it differs per topic (e.g. part
   (d) is "PIV" for rectifiers but "device currents" for AC controllers — asking
   the wrong one for the topic is off-pattern).
3. **A verbatim phrase bank.** Copy his sentences exactly — "What is the name of
   the converter?", "For one complete cycle of the source voltage, sketch…",
   "in addition to the input power factor and output power", "in terms of Vm and
   α". Reusing his wording is most of what makes a mock feel real.
4. **His number conventions** — which source voltages pair with which
   frequencies, which resistances and angles recur. Fresh numbers should come
   from *his* value families, not arbitrary ones.
5. **Clustering** — which quantities he always asks for together.

Then build the banks to that distribution, and state the frequency you matched.

**The reverse/inverse trap.** Naive mocks are almost entirely forward plug-ins,
while real papers run backwards far more often than expected (≈30% in the
observed set: given the RMS find α; given RMS and m find n; given P and V find R
then α; given "25% of the maximum", find α). Build these by choosing the answer
first, then working back to a clean given. Under-weighting them trains the wrong
reflex — students who can only substitute forwards stall on the real paper.

**Structural rules that usually hold:** every written question is multi-part and
lettered; sketches come before derivations; numbers come last; derivations name
their variables ("in terms of…"); at least one question chains off the previous.
Check the mock against each, and mark anything unobserved (e.g. no MCQ sample in
the sources) as `inferred` rather than inventing a style.

Gate it in the accuracy checker with `shipped()` assertions on his signature
phrases, so a later edit cannot quietly drift the mock off his voice.

## Exam-suite playbook (Phase 8)

- **Mirror the DNA, not just the syllabus.** Question count, mark split, part
  lettering, type distribution and phrasing all come from `docs/question-dna.md`.
- **General bank** (`EXAM_BANK`): MCQ section + written section, weighted by the
  P4 analysis (high-weight modules get proportionally more questions).
- **Past-exam vault** (`FINALS`): reproduce each real paper faithfully —
  statements, `given` tables, figures, mark splits — as step-reveal
  walkthroughs with the professor's tables, redraw morphs and (if enabled)
  Arabic glosses. Decode papers at high resolution; re-render any figure you're
  unsure of and match it exactly. A circulating **pre-exam problem set** (a
  classmate's revision sheet, photographed) lives in the same vault relabelled
  ("Final Problems"): map each problem to the lecture example it copies, solve
  the genuinely new ones and verify them independently, document the sheet's
  slips, and state the coverage verdict.
- **Pattern-matched mock** (`MOCK_FINAL`): the professor's structure and
  question signatures with NEW numbers — same rhythm, fresh practice.
- **Announced-format sim** (`FINAL_SIM`): when the professor announces the
  format, build a mock matching it exactly and make it the primary variant.
- Every bank question carries `module:` so the score report can link weak topics.
- Results are stored **per variant key** (`Progress.examResult(key)`); a written-only
  paper reports "sat — mark it yourself", never `0/0`; the exam intro lists the
  sections the bank ACTUALLY ships.
- A mock's questions state tabular data as `given` tables and demand the table
  in the model answer — "check that each answer's TABLE is drawn, not just the
  final number" is the marking note.

## Study plan & revision (Phase 7)

- Revision page = the whole course in one sitting, professor-voice, ordered by
  exam weight, ending with "what's most likely on the paper" (evidence-based).
- Plan checklists sized to real time left: 1 day → one 24-hour ordered plan
  hitting the announced questions in order; a week → staged days ending in the
  timed mock. Every task links into the site (`href`).

## UX conventions (already built into the template)

- Lecture path: Learn → Rules & Formulas → Worked → Practice (→ Quiz only when
  the module ships one; the stepper is derived from the data).
- Progress = 40% sections read + 45% best quiz + 15% cards known; a module
  without a quiz uses 70% sections + 30% cards.
- Video cards render above the summary as link-outs; the professor's table pins
  under the topbar while stepping, the figure scrolls away.
- Flags (☆) collect on the home page for the final sweep.
- Site works by double-clicking index.html — never add a dependency that
  breaks offline use.
