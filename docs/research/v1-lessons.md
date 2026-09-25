# What v1 earned that v2 must keep

Research for issue #10 (wayfinder:research, parent map #1). Date: 2026-09-25.

**Question.** Which hard-won rules, verification gates and user corrections did v1 (`/crash-course`)
earn across its four builds, and which should a v2 with a new stack and a new design keep? What
does the pilot course's current v1 site contain, as the baseline v2 must beat? What does the owner
keep complaining about or asking for in design and UX?

**Status of this document.** Findings, not decisions. Every keep / adapt / drop below is a
**recommendation** for the owner to accept or reject.

## How to read this

**Recommendation codes**

- **KEEP**: stack-independent; carry over as written.
- **ADAPT**: keep the principle, re-implement it for the new stack or design (the v1 mechanism is
  tied to vanilla JS or the single-file build).
- **DROP**: the lesson only exists because of a v1 implementation detail that a new stack removes.
  Recorded so nobody re-imports it by accident.

**Source keys** (every path is a primary source read for this ticket; line numbers are from
2026-09-25)

| Key | File |
|---|---|
| SK | `v1-reference/SKILL.md` |
| VER, MET, EXT, VID, INT, API, SUB | `v1-reference/references/` `verification.md`, `method.md`, `extraction.md`, `videos.md`, `interview.md`, `engine-api.md`, `subject-types.md` |
| TC, GS, FO | `v1-reference/assets/template/.claude/` `table-checker.mjs`, `glitch-scan.js`, `figure-overlap.mjs` |
| TPL | `v1-reference/assets/template/CLAUDE.md.tpl` and `MEMORY.md.tpl` |
| EL | `D:\Claude Os\electronics website\MEMORY.md` (build 1, June 2026) |
| ML-M, ML-C | `D:\Claude Os\machine learning\MEMORY.md`, `CLAUDE.md` (build 2, Aug to Sep 2026) |
| ML-git | commit messages in the ML repo (`git log`), cited by hash |
| PE-M, PE-C | `D:\Claude Os\Power electronics\MEMORY.md`, `CLAUDE.md` (build 3, Aug to Sep 2026) |
| AI-M, AI-C | `D:\Claude Os\Ai\MEMORY.md`, `CLAUDE.md` (build 4, Aug to Sep 2026) |
| OBS n | Observation n in `C:\Users\ALAA YONES\.claude\skill-observations\log.md` (read only) |

The four builds, in order: **Electronics** (Electronic Devices final, June 2026), **ML** (midterm
2026-08-10, final 2026-09-07), **Power Electronics** (midterm 2026-08-11, final early September),
**AI** (midterm 2026-08-12, final extension 2026-09-08). Each one was used the night before a real
exam (SK:25-27).

---

## 1. Rules, gates and corrections, grouped

### 1A. Accuracy

| # | Rule / gate | Origin (build, incident) | Source | Rec. |
|---|---|---|---|---|
| A1 | **Accuracy is non-negotiable.** Every number is verified against the official solutions before it ships; unsure means flag, never guess. | Electronics (a wrong formula costs real marks); stated as principle 1 of the skill. | SK:29-33, EL CLAUDE §5 | **KEEP** |
| A2 | **Boards and notes control scope, method and weighting; independent mathematics controls correctness.** A source slip ships corrected, with both readings documented and listed for the owner. | ML midterm: a student guide's typo and a TA sheet off by 10x were caught by recomputing; board readings shipped (6 discrepancies logged). | SK:31-33, EXT:240-243, ML-M:24,121-122, OBS 23 | **KEEP** |
| A3 | **...except where the professor's own divergence IS the exam's truth.** Record it, never "correct" it; quote his form and note the exam is marked that way. | PE (4 textbook divergences + one found in the final's material); AI (hill-climbing trace that breaks her own rule, three names for one cut, a fuzzy value that changes the answer). | PE-C §3a, AI-C §2c, PE-M:35-43 | **KEEP**. Note the tension with A2: v2 needs one explicit rule for "slip (fix it) vs divergence (keep it)". Today that line is drawn per build. |
| A4 | **Recompute, don't re-read.** A second, independent path (a Node checker that recomputes every shipped number from the raw data) beats a spot-check. | ML: 124 + 487 recomputations; PE 108 then 460 checks; AI found four printed slips only by recomputing. | VER:344-346, VER:421-425, ML-M:30,40, AI-M:430-438 | **KEEP** |
| A5 | **Assert the SHIPPED text, not a twin of the computation.** A checker that compares computed values to hard-coded expectations can pass while the page text is wrong. | PE: Codex review found "108/108 PASS" coexisting with wrong page text; pass 2 `shipped()`/`absent()` added. | SK:291-292, PE-M:494-497 | **KEEP** (stack-independent; in v2 assert against rendered output, see C9) |
| A6 | **Blank solution pages mean the key is DERIVED:** derive, verify independently, label "derived" on the site, flag for the owner. Never present a derived key as official. | ML final: every post-midterm deck's solution pages were blank. PE: no official solutions at all ("derived, not official"). | SK:134-137, EXT:188-191, ML-M:62, PE-C §3d | **KEEP** |
| A7 | **Never invent content the sources don't support;** inferred questions labelled inferred. Never fill an unknown (AI: not her name, not the exam weight). | All builds; AI made it a provenance tag on every claim: [slide] / [derived] / [unknown]. | SK:345-346, AI-C §2a | **KEEP**; recommend v2 adopt AI's three-tag provenance as the standard |
| A8 | **Record formulas in the professor's WRITTEN form,** not an algebraic equivalent. | PE: an RMS bracket shipped as an equivalent rearrangement at 16 sites and had to be switched back. | SK:379-383, EXT:205-212, PE-M:440-443 | **KEEP** |
| A9 | **Course conventions override the textbook,** recorded once in the source-of-truth and obeyed everywhere (e.g. a cost-function constant, a confusion-matrix orientation, an augmented-vector route). | ML final. | EXT:235-239, ML-M:62 | **KEEP** |
| A10 | **PDF-only topics get a second independent read** of every number. | ML final: three topics had no board or notes ("this is everything"). | SK:138-139, ML-M:55 | **KEEP** |
| A11 | **Text extraction is blind** to figures, and silently drops Greek letters and unit prefixes (a "3 s" that is 3 μs). Render the pages and look. | PE midterm (unit loss); AI (38 of 82 pages image-only; a "clean" text layer still lost tree topology). | SK:122-132, EXT:143-147, OBS 25, OBS 31, AI-C §3 | **KEEP** |
| A12 | **Verify a renderer produced pixels.** A rasteriser that reports success on 0-byte files reads as "no figure on this slide". | PE: `pdf2png.ps1` printed WROTE for 37 empty PNGs. | SK:371-372, EXT:162-172, PE-M:335-341 | **KEEP** |
| A13 | **Exam-weight and endorsement claims stay honest.** A classmate's "worth 10 marks" is a labelled prediction. | ML final (the SVM prediction). | SK:145-149, SK:397-400, ML-C:51 | **KEEP** |
| A14 | **When trimming text for a metric, re-check meaning against the source.** Dropping one hedge word ("just") inverted an answer key and contradicted the professor's quoted sentence; both gates stayed green. | AI final (second reviewer pass). | AI-M:168-182, OBS 59 | **KEEP** |
| A15 | **A checker must load content in the page's own order.** Alphabetical loading validated an empty mock exam as green. | AI final. | AI-C §6, AI-M:392-402, TC:26-37 | **ADAPT** (the principle: the gate must see exactly what the page sees; in v2 test the built output) |

### 1B. Teaching method

| # | Rule | Origin | Source | Rec. |
|---|---|---|---|---|
| B1 | **Teach the professor's way.** Reproduce how THIS professor solves, notates and asks, mined from sheets, boards, solutions and past papers. | Electronics: the owner did not trust divergences, so worked examples were rebuilt to reproduce the sheets' method, notation and numbers. | SK:34-38, EL:113-117, INT Q4 | **KEEP** |
| B2 | **THE TABLE METHOD.** Every worked example ships the professor's solving table, drawn empty and filled in the order he writes it, with the result circled; a second iteration gets a fresh table. | ML midterm, owner's call after review ("the doctor never solves in prose"); became the site's organising principle. | SK:179-183, MET:40-59, ML-M:33-44,123-126 | **KEEP as a principle, ADAPT as a rule**: it is ML/PE-shaped. AI solved in trees; the checker already accepts a `tree:` instead (TC:104). v2 should generalise to "ship the professor's solving artefact" (table, tree, redrawn circuit). |
| B3 | **The professor's ORDER is part of the answer.** Minimax is bottom-up, one whole row at a time; alpha-beta's unit is a whole node, never a leaf. A program's recursion order is not the professor's. | AI final, two explicit owner corrections ("you were solving from up to down... the doctor solves it from down to up"). | AI-C §2b rules 4-5, AI-M:72-76,202-233,418-428 | **KEEP** |
| B4 | **The right ARTEFACT, not just the right answer.** She never solves on the messy graph; she redraws it as a search tree. Right answers on the wrong artefact were rejected. | AI midterm, the build's biggest content correction. | AI-M:612-633 | **KEEP** |
| B5 | **The redraw morph.** Complex figures get redrawn into simpler equivalents step by step (full circuit, then Thevenin, then small-signal). | Electronics final, the announced format. | SK:36-38, EL:196-203 | **KEEP** |
| B6 | **Question figure first, redraw second.** Open every trace on the figure exactly as the question gives it. | AI midterm, owner correction. | AI-M:518-532 | **KEEP** |
| B7 | **Visual-first summaries:** at most 5 beats of at most 90 words, each wrapped around one figure or demo, each ending with a "say it aloud" line. | ML final: 400-word sections were replaced by five beats "and the student actually read them". | SK:187-188, MET:8-13 | **KEEP** |
| B8 | **Beginner-true, exam-first framing;** define every term at first use, intuition before formalism. | Electronics (the owner started from zero). | MET:124-126, EL CLAUDE §5 | **KEEP** |
| B9 | **Derivation ritual** (PE): write the integral definition first, cut limits to the conduction interval, evaluate, simplify; never open with the closed form. | PE midterm board proofs. | PE-C §3c | **ADAPT**: subject-specific instance of B1; v2 should capture "the professor's derivation ritual" per course, not this one. |
| B10 | **Level ceiling per exam part.** Never teach above the professor's lecture+sheet level; the ceiling moves when his material moves. | PE: a blanket "no Fourier" rule written for the midterm would have mis-scoped the final. | PE-C §3b | **KEEP** |
| B11 | **Question DNA before any exam question:** mine the sheets for structure (types and frequency, multi-part order, verbatim phrase bank, number families, clustering). Reverse/inverse questions run about 30% of real papers; naive mocks under-weight them. | PE midterm (5 of 17 reverse); PE final (4 of 11). | SK:239-250, MET:147-191, PE-M:45-50,449-467 | **KEEP**. Copyright note for v2: the "verbatim phrase bank" lives in project docs, never in the repo (see F4). |
| B12 | **Mocks mirror the DNA, not just the syllabus;** an announced format becomes the primary mock and matches it exactly. | Electronics final (announced 4-question format); PE; ML. | SK:252-266, MET:193-218 | **KEEP** |

### 1C. QA and verification

| # | Gate / rule | Origin | Source | Rec. |
|---|---|---|---|---|
| C1 | **Three loops, all mandatory:** automated geometry sweep, screenshot loop (eyes), figure fidelity against the rendered source. Each catches what the others miss; the owner reports all three as "glitches". | Consolidated across PE and ML. | VER:7-19 | **KEEP** |
| C2 | **Figure fidelity:** compare every figure to the rendered source slide trace by trace (zero regions, jumps, labels, matrix orientation). A crisp, legible, physically wrong figure is a CRITICAL defect, same as a wrong number. | PE: a rail drawn through every device (short circuit), a "flat" current that has ripple, a zero region where the slide shows conduction. ML: confusion matrix flipped to rows-Predicted. | SK:162-167, VER:259-295, PE-M:426-447,469-480 | **KEEP** |
| C3 | **Never author a figure you have not looked at.** A formula constrains one trace and leaves its neighbours unconstrained. | PE (owner insisted on checking the slides). | SK:368-372, EXT:196-203, OBS 30 | **KEEP** |
| C4 | **Never report a loop you did not run.** A blocked screenshot means "not visually verified", said in the handoff every time. | PE: three visual defects shipped while the build was reported "verified". | SK:389-390, VER:208-221, PE-M:410-413, AI-M:62-63 | **KEEP** |
| C5 | **Screenshots ARE possible headless.** Local headless Chrome with its own profile dir, a driver page that steps the walkthrough, animation durations zeroed. Found two bugs every assertion had passed. | AI midterm, after three sessions of "visual appearance unverified". | AI-M:449-466 | **ADAPT** into v2's standard QA harness (e.g. a scripted browser). Note: this never reached the v1 skill (see §1H). |
| C6 | **When a check passes, ask what it was allowed to look at.** A gate over hidden content is not a gate (the sweep skipped every figure in a collapsed section). Read `covered` and check the page count. | PE final: `expandAll()` did not open `.sum-sect`; teaching it surfaced three real bugs. | SK:373-376, VER:63-66,142-160, PE-M:342-347 | **KEEP** |
| C7 | **A fix for a timing symptom can silently shrink what a check sees;** re-prove any gate change with a deliberate regression. | PE: `settle:0` made the sweep re-scan the home page on every route; every earlier "0 findings" measured one page. | SK:377-378, VER:68-93, PE-M:292-314 | **KEEP** |
| C8 | **Prove a detector by reintroducing the bug.** A detector that has only seen passing pages is not known to detect anything. A finding is a hypothesis until measured. | PE (occlusion check), AI (a tree detector that could never fire). | VER:130-140, AI-M:667-672 | **KEEP** |
| C9 | **Assert on rendered output, not source strings.** The checker renders every shipped string through the real formatter and fails on prose that became a fraction. | AI midterm ("Player 1 / Player 2" shipped as a fraction). | AI-M:468-477 | **KEEP** (stack-independent; in v2, test the built pages) |
| C10 | **Add a LEGIBILITY gate, not only overflow gates.** A rendered node or font below a floor (about 9px) is a defect even with no overflow and a clean console. Scaling a figure to fit its column is what destroys it; wide figures render at natural size and scroll. | AI midterm: "I cannot even see the animation" (16px nodes in a 173px host); explainers at 8.4px on a phone. | AI-M:576-582,635-658 | **KEEP**. Never folded into v1's scanner (§1H). |
| C11 | **Phones first, many widths.** Sweep at 320 / 375 / 390 / 430 / 700 / 768 / 1280 on source AND built output; 320 found a real grid overflow the wider sweeps missed. | PE (owner found a phone bug by screenshot), AI (320 px). | SK:280-283, PE-C §6, AI-M:194-200 | **KEEP** the width set; ADAPT the tool |
| C12 | **Static elements stack too:** checks for content above the viewport, text-node collisions and height-locked overflow, not only absolute overlays. | PE: topbar nav wrapped into 3 rows inside a fixed 60px bar; first row at y = -40. | VER:38-61, PE-M:213-252 | **KEEP** the defect classes |
| C13 | **Anything absolutely positioned over a figure will eventually cover it.** Chips live in a flow strip under the figure. | PE, owner-reported and recurring. | SK:391-393, PE-M:391-409 | **KEEP** |
| C14 | **Static figure collision check** across option values, so a figure is checked even when no page embeds it. | PE final: 20 real label collisions. | FO, PE-M:236-248 | **ADAPT** (figure tooling changes with the stack) |
| C15 | **Content gate** (schema, table selectors resolve, sums recompute, data drawn as tables, no bare `/` in a rule, exam marks sum) runs after EVERY module and every single added example. | ML midterm to final; checker grew 124 to 1122 checks. | SK:191-198,273-277, TC, VER:299-346 | **ADAPT**: keep every rule; re-target to v2's content schema |
| C16 | **MCQ fairness is measured:** correct-is-longest near the 25% chance rate (fail above 40%), length ratio at most 1.25x, spread at most 18 chars; exactly one correct option. | PE: owner spotted correct-is-longest at 81%. AI: 39% before rebalancing, then a structural gate. | SK:387-388, MET:82-114, PE-M:501-515, AI-M:144-151, OBS 29 | **KEEP** (and ship the checker in the template, which v1 never did, see §1H) |
| C17 | **Engines must never hardcode copy that assumes a content shape.** Derive tabs, section labels and score tiles from the data. | ML midterm: a dead Quiz tab, "Section A MCQ theory" on a written exam, a hollow "0/0". | SK:394-396, ML-M:127-134 | **KEEP** |
| C18 | **Every derived metric degrades gracefully** when an optional piece is absent (mastery capped at 55% on a written-only build). | ML midterm. | ML-M:120, OBS 24 | **KEEP** |
| C19 | **Adversarial reviewer pass** with fresh eyes (Codex review, reviewer agents, DOER/CHECKER loop), findings re-verified before acting, the artefact frozen while it is reviewed. | ML P9 DOER/CHECKER; PE Codex review (11 issues); AI two reviewer passes (rank selection shipped invented data). | ML-M:30, PE-M:469-499, AI-M:122-151, OBS 52 | **KEEP** |
| C20 | **Verify the shipped artefact,** not only the source tree; rebuild after every shipping edit. | Electronics and ML: dist-only breakage. | SK:341-342, VER:428-439 | **KEEP** the principle; v1's "single file" specifics are DROP if v2 changes the build |
| C21 | **The page caches edits** (reload, cache-bust CSS); **a hidden pane reports `innerWidth` 0** and throttles timers; never hand-roll the route walk. | ML, PE, AI browser sessions. | VER:381-405, AI-C §6, AI-M:404-416,512-516 | **ADAPT**: harness facts, keep them in v2's QA docs |

### 1D. Content shape

| # | Rule / correction | Origin | Source | Rec. |
|---|---|---|---|---|
| D1 | **A question's data is drawn the way the source drew it.** A table in the source is a table on the site; a run of tuples is "not understandable at all" (owner's words). Coordinates stay coordinates. | ML final, owner rejection. | SK:184-186,350-352, MET:54-59, ML-M:69 | **KEEP** |
| D2 | **Every division is a stacked fraction** in rules, "the way you write it on paper" (owner: dividend over divisor with a long horizontal line, not "/"). | ML final. | SK:353-354, MET:65-69, ML-M:72 | **KEEP** |
| D3 | **Math renders everywhere** (no raw subscript or power markup anywhere on the page), and the formatter never turns prose into fractions or touches figures. | ML midterm (summaries injected raw), Electronics (formatter broke SVG), AI (prose fractions). | VER:199-201, EL:166-179, ML-git 8bd56dc, AI-M:468-477 | **ADAPT**: v1's regex `mathify` is DROP; the rule is KEEP. v2's math renderer choice must meet it. |
| D4 | **Practice is written unless the exam has MCQ;** a problems-only exam gets problems. | ML (written-only locked); PE (MCQ exists). | SK:189-190, INT Q3b | **KEEP** |
| D5 | **A problems-only exam cuts theory from the Master Rules and nowhere else.** The owner's scope is the scope; never widen a cut. | ML final (owner: do not remove theory elsewhere). | SK:355-357, ML-M:58 | **KEEP** |
| D6 | **Rules sheets ship in solving order with a comparison "solve sheet"** (variants as columns, differing quantities as rows, shared rules once, circuits above). | PE final: owner sent his own hand-drawn table and asked why rules were "each one a random rule somewhere". | SK:224-230, MET:74-77, PE-C §5, OBS 55 | **KEEP** |
| D7 | **Master Rules = only rules the worked examples use,** each carrying the professor's own numbers. | ML, PE. | MET:61-64 | **KEEP** |
| D8 | **Per-module pieces:** summary, rules, worked examples, flashcards, written questions with "what earns the mark", tips, video cards (MCQ only if the exam has it). | Electronics defined the seven pieces; later builds refined. | MET:6-38, TPL CLAUDE §4 | **ADAPT**: keep as the content checklist; v2's student-journey tickets (#2, #3) may reshape surfaces |
| D9 | **Exam suite:** general bank + past-paper vault (faithful reproduction) + pattern-matched mock + announced-format sim; results per variant; a written paper reports "sat, mark it yourself", never 0/0. | Electronics final (vault, mock, sim); ML (per-variant results). | SK:252-266, MET:193-218 | **KEEP** |
| D10 | **Split by exam part, never mix;** an archived part is frozen, added alongside, never rewritten. | PE: the midterm left the final's scope. | PE-C §0, PE-M:55-88,359-374 | **ADAPT**: data model concern for v2 (midterm/final parts) |
| D11 | **Revision = the whole course in one professor-voice read, ordered by exam weight;** plan sized to real time left. | Electronics, ML, PE. | SK:231-235, MET:220-226 | **ADAPT**: the plan part was removed by the owner twice (see §3) |
| D12 | **Voice and respect:** professor-STYLE, never first person as him; named professor gets credit plus a "student-built, not reviewed or endorsed" disclaimer; no bare pronouns, no attributed trick intent, when the site is shared with the class. | PE: the site was shared with the cohort and the professor was in the group (241 occurrences fixed). | SK:74-77,397-400, PE-C §4a, PE-M:254-270 | **KEEP** |
| D13 | **Byline "by Seif Younes"** on everything the skill builds. | Owner credit. | SK:95-98, ML-git 8bd56dc | **KEEP** (ask owner if the rename changes it) |
| D14 | **Arabic notes** (Egyptian dialect, technical terms in English, numbers LTR) when the owner's English is the barrier. | Electronics (added); declined in ML, PE, AI. | EL:208-215, INT Q5, SK:199-201 | **ADAPT**: v1's default says ON, but three of four builds declined; recommend asking, default off |

### 1E. Video cards

| # | Rule | Origin | Source | Rec. |
|---|---|---|---|---|
| E1 | **Score the MATCH to the professor's method, not the video.** 10 = his literal example; 9 = same method, other numbers; ship only 9 or above, else an honest "pending" card. | ML final hunts; PE rubric with deductions. | VID:9-15, SK:209-216, PE `docs/final/youtube-review/rubric.md` | **KEEP** |
| E2 | **Any subject is allowed;** the match is to the method and to the professor's teaching ORDER. | ML final: a Decision Tree video rejected as table-heavy when the board opens with the drawing. | VID:16-25, ML-M:68, ML-git b297d93 | **KEEP** |
| E3 | **Notation pins the source** (the professor's notation identified the exact original course; a later remake scores lower). | ML final. | VID:26-28, ML-M:70 | **KEEP** |
| E4 | **Never fabricate** a URL, title or channel; **re-verify every winner yourself** (oEmbed, duration, thumbnail read, cited timestamps); record dead and do-not-use IDs. | ML, PE, AI. | VID:79-95, SK:363-367 | **KEEP** |
| E5 | **Do-not-use list is content:** a video that yields a different number on the professor's sheet is recorded so nobody links it. | PE final (five videos). | VID:110-113, PE-M:200-211 | **KEEP** |
| E6 | **Honest "closest match (unverified)" card** when transcripts are blocked, with its real score and every deviation named. | AI final (YouTube blocked every transcript fetch). | AI-M:88,440-447 | **ADAPT**: conflicts with E1's "pending only". v2 needs one rule. |
| E7 | **Playlist with watch-from/to times** when no single video covers a lecture at 9. | PE final (playlists scored 7 and 8 as sets). | PE `docs/final/youtube-guide.md` | **ADAPT** (optional surface) |
| E8 | **The professor's own recordings** ship as local 10/10 cards, never committed, never deployed. | AI final. | AI-C §1, AI-M:87 | **KEEP** |
| E9 | **Link-outs only, never iframes** (keeps the site offline-safe). | All. | VID:108-109 | **ADAPT**: depends on v2's offline decision (ticket #2) |
| E10 | **Transcripts: `python -m yt_dlp --impersonate chrome`** beats sleeping through 429s. | PE final. | OBS 53, OBS 54, PE-M:200-203 | **KEEP** as tooling note |

### 1F. Deployment and copyright

| # | Rule | Origin | Source | Rec. |
|---|---|---|---|---|
| F1 | **Deploy only the built output;** material folders are the professor's copyrighted work and are never served. Repo stays private. | ML (`vercel.json` scoped to `src/dist`). | SK:300-307,401-403, ML-C:26 | **KEEP** |
| F2 | **Post-deploy check:** request the public path of every source file and require 404. | Two of three deployed sites (AI, PE) were found serving lecture PDFs publicly on 2026-09-15; ML returned 404. | OBS 60 | **KEEP**, and make it a gate (it never reached v1) |
| F3 | **Materials are read-only inputs:** never moved, renamed or deleted; misfiled pages documented and left in place. | ML (classmate notebook pages in the professor's folder). | SK:134-137, EXT:133-139 | **KEEP** |
| F4 | **Never republish course material;** a private repo is a personal backup, publishing is not reversible. | AI repo note. | AI-M:337-346 | **KEEP**; for v2 this also covers what agents paste into issues and docs |
| F5 | **Keep a backup copy of the built site in the project root;** hard-refresh after every deploy. | ML (owner moved the backup inside the project). | SK:294-295, ML-M:18 | **ADAPT** (depends on v2's build output) |
| F6 | **Confirm before deleting; a "remove this" paste may be a stale cached page.** List gone vs still present, cut only what is confirmed. | ML final: cutting on an ambiguous paste would have emptied most of the rules sheet. | SK:358-362, VER:393-396 | **KEEP** |

### 1G. Process

| # | Rule | Origin | Source | Rec. |
|---|---|---|---|---|
| G1 | **Anti-drift docs before scaffold:** source-of-truth, CLAUDE.md and MEMORY.md written from the lectures before any site code. | PE and AI (owner's order, "Step 0"). | PE-M:529-530, AI-M:32-35,691-696 | **KEEP** |
| G2 | **Ledger in the artefact:** MEMORY.md build status lets any session resume losslessly; extensions append a new ledger block, never rebuild. | All builds. | SK:44-62, TPL MEMORY | **KEEP** |
| G3 | **One module fully done beats six half-done;** Module 1 end to end first, then replicate. | Electronics. | SK:174-175, MET:127-128 | **KEEP** |
| G4 | **Interview once, then run to the end;** ask mid-run only on real blockers; three answers never defaulted silently (exam nature, professor named, deployment). | v1 design. | SK:64-81, INT | **KEEP** |
| G5 | **Fold every mistake back in, once:** fix the instance AND add the class to a checker or catalogue. | Stated as the skill's memory rule. | SK:404-407 | **KEEP** |
| G6 | **Fold engine improvements back into the template** at handoff. Three builds drifted three ways; the next build would have started without the table method, given tables or video cards. | 2026-09-07 three-way merge. | SK:309-315, OBS 56, AI-M:153-166 | **KEEP** as a v2 gate. Evidence it is still failing: see §1H. |
| G7 | **Urgency must not lower quality.** | PE midterm, owner's directive (build 4 h before the exam). | PE-M:107 | **KEEP** |
| G8 | **A scope cut can silently remove a category of content** (all of Lecture 4's figures were past the boundary); re-audit the in-scope side. | AI midterm, owner noticed. | AI-M:547-567 | **KEEP** |
| G9 | **Numbers in memory files carry their source** (command + date). | A "100-check gate" in workspace memory was really 318. | OBS 61 | **KEEP** |
| G10 | **Tooling on this machine:** no poppler; Windows.Data.Pdf renders PDFs with no install (`pdf2png.ps1`, absolute paths, ASCII-only); PPTX via PowerPoint COM; page map finds image-only slides; Python now installed; long heredocs fail past about 10 KB. | PE, AI. | EXT:149-178, AI-C §3, OBS 31, OBS 57 | **ADAPT** (keep as environment notes; v2 extraction may route through NotebookLM, ticket #5) |

### 1H. Lessons earned in builds that never reached v1's skill

These were found in build notes but are absent from `v1-reference/` (checked by searching
SKILL.md, the references and the template tools on 2026-09-25). They are the strongest evidence
that G6 is still failing, and v2 should start with them:

| Lesson | Where it lives | Missing from |
|---|---|---|
| Headless-Chrome screenshot harness (C5) | AI-M:449-466 | VER § B still says screenshots may be impossible |
| Legibility gate (C10) | AI-M:635-658 | GS (no font-size or node-size check) |
| `vis()` ignores `opacity:0`; `inked()` measures drawn children; `inScrollBox()` for deliberate wide content | AI-M:500-510,660-666 | GS |
| Assert `innerWidth` before trusting a sweep | AI-C §6 | VER, GS |
| Render every shipped string through the real formatter (C9) | AI-M:468-477 | TC |
| MCQ-fairness checker (C16) | PE and AI `.claude/accuracy-check.mjs` | template ships no `accuracy-check.mjs`, yet MET:111 names it |
| Post-deploy "sources must 404" check (F2) | OBS 60 | SK Phase 10, template (no `vercel.json`) |
| PPTX-to-PDF step and the image-only page map | AI-C §3, OBS 31 | EXT render ladder is PDF-only |

---

## 2. Baseline: the ML pilot's current v1 site

Project: `D:\Claude Os\machine learning` (site in `src/`). Numbers below were counted on
2026-09-25 by loading `src/data/*.js` in `index.html` order in Node (read only), unless marked
"per MEMORY".

### 2.1 What it contains

| Surface | Contents |
|---|---|
| Stack | Vanilla HTML/CSS/JS, 16 engine files in `src/js/`, 17 data files in `src/data/`; offline; `localStorage` namespace `ml_v1_`; violet accent; English only; single-file `src/dist/index.html` (564 KB, built 2026-09-06) + backup `ml-midterm-crash-course.html` in the root. Deployed on Vercel scoped to `src/dist` (ML-C:26, `vercel.json`). |
| Routes | `#/` home (module grid in two groups, final group first), `#/lecture/N` (stepper Learn, Rules & Formulas, Worked, Practice; no Quiz step), `#/rules`, `#/revision`, `#/finals`, `#/exam` (`src/js/app.js`). |
| Modules | **11.** Midterm group: 1 ML Fundamentals, 2 Linear Regression & Gradient Descent, 3 Multiple Variables & Polynomial, 4 Overfitting/Splits/Regularization, 5 Data Preprocessing (tag "re-taught before the final"), 6 KNN & Naive Bayes (tag "expanded for the final"). Final group: 7 Logistic Regression, 8 SVM, 9 Decision Trees, 10 K-means, 11 Model Evaluation. |
| Per-module content (totals) | 30 worked examples, **all 30 with a solving table**; 102 flashcards; 57 written questions with model answers; **0 MCQ** (written-only, locked); 88 rule cards; 15 `given` data tables on worked/written items (more in finals and exams, per MEMORY P15e). Summaries: 2 to 7 `<h3>` beats per module. Final-group modules are thinner: 1 to 2 worked examples and 2 to 3 written questions each, versus 2 to 6 and 6 to 8 in the midterm group. |
| Video cards | **32 cards, 0 pending.** Match scores: 11 at 10/10, 12 at 9/10, **7 at 8/10, 2 at 7/10**. |
| Master Rules | 10 groups, 81 rules, problem-solving rules only (the final was announced problems-only); every division a stacked fraction; search, test mode, star-to-master. |
| Revision | One page: a "Verbal Exam Room" section (viva prep, all 8 final-era topics per ML-M:65), the table-method section, and **six midterm-era sections** (gradient descent, preprocessing, overfitting, KNN/NB, fundamentals, most-likely list). No final-scope revision sections. |
| Final Problems vault (`FINALS`) | 9 problems from a classmate's pre-final problem set, each as a step-reveal table walkthrough; 7 are lecture examples, 2 fresh-number clones solved and verified (ML-M:66). |
| Mock exams | `MOCK_FINAL` (primary): 3 sections, 8 written questions, 80 marks, 90 min, labelled a "minimum G2 build" (ML-M:65). `MOCK_MIDTERM`: 3 sections, 13 questions (100 marks per ML-M:29). Results stored per variant. |
| Study plan | **Empty** (`SITE.plan: []`); the home page hides the section. |
| Figures and demos | 11 midterm figure builders + 6 final ones (sigmoid, SVM margin, tree, entropy curve, k-means plot, confusion matrix); demos: gradient-descent stepper, overfitting slider, k-means demo; SVM street animation (ML-M:26,64). |
| Credit | Dr. Mahmoud Gamal credited with the not-endorsed disclaimer; "by Seif Younes" byline (`src/data/site.js`). |
| Docs | `docs/source-of-truth.md` (midterm + final extraction, answer keys, derived keys, ILLEGIBLE lists, page-coverage ledger, final-problems coverage verdict). **No `docs/question-dna.md`** (Phase 7.5 postdates this build). |

### 2.2 Verification status

- **Content gates, re-run 2026-09-25:** `node src/.claude/table-checker.mjs` gives PASS 1122,
  FAIL 0 across 11 modules; `node src/.claude/g1-recompute.mjs` gives PASS 148, FAIL 0.
- **Last recorded browser verification:** P15 gate (2026-08-30) and the P15b to P15h entries
  report 0 console errors, source and dist, and "no mobile h-scroll" (ML-M:65-72).
- **Gaps by v1's own later standard** (these are findings about coverage, not proof of defects):
  - ML still ships the early 133-line `src/.claude/glitch-scan.js`. It has none of `expandAll`,
    the occlusion, stacked, above-viewport or overflow checks, the `covered` list or the
    `hashchange` wait. Its "0 findings" sweeps therefore never scanned content inside collapsed
    summary sections (the defect class C6 describes), and nothing records the page count.
  - No `figure-overlap` run, no MCQ-fairness gate (no MCQ exists, so not needed), no
    legibility gate.
  - **P16 to P18 never ticked** (ML-M:73-75): the full-depth `MOCK_FINAL`, written
    self-scoring in the exam engine, final-scope revision sections, the runway plan, the full
    verification sweep of all routes and both exam variants, and the README.
  - `README.md` still describes the midterm site (six lectures, 18 worked examples).
  - 9 of 32 video cards sit below the 9/10 bar v1 later codified (E1); they were shipped before
    that rule existed.
  - One uncommitted line in `MEMORY.md` (the 2026-09-07 skill-sync note).

**Recommended bar for the v2 pilot** (the owner decides): match every surface above for all 11
modules; close the P16 to P18 gaps (full mock final, final-scope revision, depth in modules 7 to
11); pass v2's gates with coverage evidence (page count, both locales if bilingual, phone and
desktop, real screenshots); keep the professor's table method on every worked example.

---

## 3. The owner's recurring design and UX complaints and preferences

Each item is something the owner reported, rejected or asked for, with where it recurs.

1. **Walls of text do not get read.** Five short visual beats replaced 400-word sections
   (MET:12-13). Electronics moved to a 5-step stepper instead of 8 tabs, summaries collapsed except
   the first section, and calmer tokens (softer glow and shadow, fainter grid, smaller badges)
   (EL:74-82). The home page became an "anti-overwhelm" plan (EL:217-223).
2. **The thing I am watching must stay on screen.** The table scrolled away while the figure
   followed (ML-git 4c09dfb); stepping dragged the figure off screen and reading the step meant
   looking away from the drawing, so the step card moved onto the figure (AI-M:479-498).
3. **Nothing may cover the figure.** Value chips buried the graphs, reported repeatedly (PE-M:391-409).
4. **I cannot read it.** "I cannot even see the animation" (AI-M:635-658); illegible circled
   digits at table size (ML-M:134); tiny labels when figures are scaled down to fit. Wide figures
   should keep natural size and scroll.
5. **Math must look like paper.** Stacked fractions with a long horizontal bar (MET:67-69); raw
   subscript and power markup leaking (ML-git 8bd56dc); prose wrongly turned into fractions
   (AI-M:468-473).
6. **Data as tables, not tuple runs** ("not understandable at all", ML-M:69).
7. **Phone bugs he finds himself.** Topbar wrapping over the hero (PE-M:213-222); grids clipping
   at 320 px (AI-M:194-200). He checks on a phone, so a "clean" desktop sweep is not enough.
8. **Get me to the work fast.** "I just want to jump into the work examples" (AI-M:77-80).
   Study plans were removed from the home page twice (ML-git 4c09dfb; PE-M:185) and collapsed to
   one card once (EL:204). Recommendation: treat a plan as optional, not a home-page default.
9. **Organise it the way I solve.** Rules were "each one a random rule somewhere"; he drew his
   own comparison table as the spec (OBS 55). The TABLE METHOD skeleton group was cut from Master
   Rules at his request (ML-M:72).
10. **Order and method fidelity are UX, not just content.** Video order must follow the board
    (ML-M:68); minimax bottom-up, alpha-beta node by node (AI-C §2b); question figure first, then
    the redraw (AI-M:518-532).
11. **The page must never claim what is not there.** Dead tabs, "MCQ" labels on written exams,
    "0/0" scores (ML-M:127-134).
12. **Look and identity.** v1 ranked "functionality over looks" (Electronics `CLAUDE.md` §1, TPL CLAUDE §1). The
    look was a subject accent swap on one template: dark navy circuit theme from `theme.jpeg`
    (EL:37), violet for ML, amber for PE, with a Canva-generated hero texture on PE (PE-M:326-333)
    and an impeccable polish pass (PE-M:517-527). For v2 the owner has now set "must NOT be the
    generic default Claude look" (repo `CLAUDE.md`, standing constraints). v1 notes contain no
    specific statement of what "premium" means; that is open for ticket #4.
13. **It is shown to other people.** Shared with the cohort and read by the professor
    (PE-M:254-270); presented for bonus marks at a verbal exam (ML-M:50). Respectful voice and
    polish both matter.
14. **Language.** Arabic notes were added when English was the barrier (EL:208-215) and declined
    on the three later builds (ML-M:12, PE-M:97, AI-M:23).

---

## 4. Open points for the owner

- Slip vs divergence (A2 vs A3): one v2 rule for when a source value is corrected and when it is
  preserved as the professor's convention.
- Video fallback (E1 vs E6): "pending only", or an honest "closest match" card?
- Whether the 9 ML cards under 9/10 are re-hunted in the pilot.
- Whether study plans stay a feature (removed twice).
- Arabic notes default (v1 says ON; three of four builds declined).
- Byline wording under the learn-premium name.

## Method note

Read in full: `v1-reference/SKILL.md`, all seven `references/*.md`, the template's `CLAUDE.md.tpl`,
`MEMORY.md.tpl`, `table-checker.mjs`, and the check list of `glitch-scan.js` and
`figure-overlap.mjs`; the CLAUDE.md and MEMORY.md of all four builds; the ML README, `site.js`,
source-of-truth headings and key commit messages; the PE video rubric, reviewer brief and guide
header; observations 22-31 and 53-61 of the observation log. Professors' PDFs, slides and exam
papers were not opened, and no professor material is reproduced here.
