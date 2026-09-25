# Video cards — one audited YouTube explainer per lecture topic

Read at Phase 6b. Every module ships `videos[]`: for each topic the professor
teaches, the one video that solves it **his way**. The student watches it the
night before the exam, so a mismatched video costs more than no video.

## The bar

- **Score the MATCH, not the video.** 10 = works the professor's LITERAL
  example (same table / numbers / formula, same method). 9 = same method and
  formulas, different numbers. 8 = same topic and notation, some detours.
  ≤ 7 = broader or different framing.
- **Ship only ≥ 9/10.** Anything lower stays `{topic, status:"pending"}` —
  the card says "no match met the bar yet", which is honest and useful. Never
  pad a rail with an 8 relabelled as a 9.
- **Any subject is allowed.** The match is to the *method*: a control-systems
  or statistics channel that fills the same table in the same order beats an
  on-topic lecture that solves differently. Search by the method's shape
  ("distance → rank → vote solved example", "fill the h−y column then square"),
  not only by the course name.
- **The professor's teaching ORDER is part of the match.** A video that opens
  with the table when he opens with the drawing is off-pattern even if every
  number agrees (a Decision-Tree rail was rejected for exactly this and
  re-hunted: draw the tree → impurity intuition → IG → tiny example). Read the
  board photos for the order before writing the hunt brief.
- Notation pins the source: a professor whose slides say θ_j and 1/2m is
  teaching from a specific course's original lectures; the same author's later
  remake (w, b) is a notation mismatch and scores lower.

## The hunt — one retrieve-mode agent per lecture (or per topic)

Dispatch them in parallel, one per module; a module with two distinct topics
(KNN + Naive Bayes) gets two hunts. The agent never touches the repository.

Prompt skeleton (fill the bracketed parts from `docs/source-of-truth.md`):

```
You are a RETRIEVAL agent (retrieve mode, not inference mode): find real,
existing YouTube videos and verify them. Never invent a URL, title or channel.
Do NOT read or modify any files; you only need WebSearch and WebFetch.

## Mission
Find the best YouTube video(s) for [Lecture N — title] of [course], taught by
[professor]. The student watches them the night before the exam. The ONLY
thing that matters is that the video teaches the SAME content the SAME way the
professor does. English strongly preferred; other languages only if they match
far better. Any subject is acceptable if the METHOD matches.

## What the professor teaches (match THIS — from his slides/board)
1. [topic A: the exact example, table, numbers, formula in his written form,
   and the ORDER he does things in]
2. [topic B …]

## Search plan
- WebSearch queries such as: [5–8 queries phrased by the method's shape and
  by the literal example's data].
- VERIFY every candidate with the oEmbed endpoint:
  https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json
  → exact title + channel (author_name). No oEmbed → discard (except a 401,
  which means embedding is disabled — note it; a link-out still works).
- Learn the content via r.jina.ai/https://www.youtube.com/watch?v=ID (flaky,
  retry once) or search snippets; transcripts are usually blocked. Storyboard
  frames are readable when everything else is blocked.
- Prefer < 25 min, plain watch URLs (no playlists, no shorts).

## Scoring rubric (be strict and honest)
10 = solves the professor's LITERAL example with his method · 9 = same method
and formulas, different numbers · 8 = same topic and notation, detours ·
≤ 7 = different framing. Justify every score with evidence you actually saw.

## Deliverable
Per topic: the pick + up to 2 runner-ups. For each: url, exact title (oEmbed),
channel (oEmbed), length, match /10, a 2–3 sentence "why" written FOR THE
STUDENT saying precisely what matches the professor's example, timestamps you
can evidence, and the verification evidence. JSON block + short prose. If no
9–10 exists, say so plainly and give the best real match with its honest score.
```

## Your own verification — before a URL ships

The agent's report is evidence, not proof. For every winner:

1. **oEmbed** again yourself (title/channel). 401 = embedding disabled, not
   dead — check the watch page's `playabilityStatus` is OK.
2. **Duration** from the watch page (`"lengthSeconds"` via curl) — the card
   states it.
3. **Thumbnail** read visually: `i.ytimg.com/vi/<id>/maxresdefault.jpg`
   (fallbacks `hq720.jpg`, `hqdefault.jpg`). A whiteboard/table frame confirms
   the format; a talking head over slides contradicts an "hand-worked" claim.
   Read it via the CDN when the browser pane cannot open youtube.com.
4. **Spot-check the solving timestamps** the agent cited, when frames or
   chapters are readable. Timestamps you cannot evidence do not go on the card.
5. **Record dead IDs** in MEMORY.md ("never ship") so a later hunt does not
   re-surface them; record the oEmbed-401-but-playable ones too.

## Card authoring rules

- The engine builds cards with `textContent` (external metadata is never
  injected as HTML), so **card text is NOT mathified**: write subscripts and
  superscripts as Unicode — θ₀, x₁, ², ⱼ — never `θ_0` / `^2`.
- `why` names exactly what matches ("the same nine height/weight rows and the
  same (170, 57) query, solved distance → rank → vote") and states every
  deviation the student must know ("says 60/20/20 where the board says
  70/15/15"; "writes w₀/w₁ and drops the 1/m"). Honest ceilings are stated:
  "no video works the literal 4…34 dataset".
- Order the rail in the professor's teaching order; label a heavier treatment
  "heavier than the exam" and put it last.
- Link-outs only (`Open on YouTube ↗`), never an iframe — the single-file
  build must stay offline-safe.
- The DO-NOT-USE list is content too: when a candidate yields the professor's
  answer by a method he does not use, or contradicts his convention (his √2-free
  form, his rows-vs-columns confusion-matrix layout), record it in MEMORY.md so
  nobody links it later.

## Re-hunt triggers

- The user rejects a card as "not how he teaches it" → re-read the board for
  the order and the emphasis, rewrite the brief, re-hunt that topic only.
- A module is re-taught or extended (`tag: "re-taught before the final"`) →
  its videos are re-scored against the new board.
- A rail with 0 pending is the target, but a pending card is always better
  than an 8 dressed as a 9.
