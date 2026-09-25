# Source extraction — from raw materials to a verified source-of-truth

Read at Phase 3. The goal: every fact the site will teach traces back to a
source you actually read, and every answer key is verified BEFORE content
authoring starts. This is what made the exemplar trustworthy.

## 1. Inventory

Catalog everything into MEMORY.md's inventory table: file, location, page/item
count, what it covers, and whether it's digital text, scanned, or handwritten.
Unzip archives into `_sources/` inside the project (never ship or link
`_sources/` paths in the site). The material folders themselves are
**read-only inputs — never move, rename or delete anything in them**, and
document rather than "fix" what is misfiled (a classmate's notebook page in
the professor's board folder stays where it is, with a note in the
source-of-truth). Note which decks are merged duplicates of others so their
one real exercise is not extracted twice.

## 2. Reading each source type

**Text extraction is blind to figures.** `pdftotext` returns prose and nothing
else: every waveform, circuit and equation-image is silently absent, and it also
drops Greek letters and unit prefixes (α β θ ω φ Ω μ °) without warning — a
"3 s" that is really 3 μs. So a text-only extraction leaves you blind in exactly
the places the sketch marks live. **You must render the pages and look.**

### The render ladder — try in order, stop at the first that works

1. **Read tool on the PDF** (`pages:` param). Needs `pdftoppm`; often absent.
2. **`pdftoppm -png -r 150 file.pdf out/page`** if poppler is installed.
3. **Windows: the bundled `.claude/pdf2png.ps1`** — uses `Windows.Data.Pdf`,
   built into Windows 10/11, **needs no install at all**. Call it through the
   **PowerShell tool**, not Bash — via `-File` the `-Pages` list arrives as one
   string and fails `[int[]]` coercion:
   ```powershell
   & .claude\pdf2png.ps1 -Pdf "lectures\Lec 02.pdf" -Out out\lec02 -Pages @(5,9,12,16) -Scale 2
   ```
   Use `-Scale 4` for a figure you must reproduce exactly.

   **Then check the files are non-empty before you trust them.**
   ```powershell
   (Get-ChildItem out\lec02 | Where-Object Length -gt 0).Count
   ```
   WinRT's `GetFileFromPathAsync` requires an **absolute** path; handed a relative
   one it returns null, the write throws — and an early version of this script
   still printed `WROTE …` for all 37 pages. Every PNG was 0 bytes. An empty
   render reads exactly like "no figure on this slide", which quietly licenses
   authoring a diagram nobody looked at, so the script now reports `FAILED` and
   prints the byte count. Keep the file **ASCII-only**: PowerShell 5.1 reads
   `.ps1` as ANSI, so one em-dash in a string breaks the parse.
4. **Node + pdfjs** (`npm i @napi-rs/canvas pdfjs-dist`) — last resort, needs a
   network install and native build.

Then **Read the PNGs**. For a dense figure, crop and magnify it — the template
also ships nothing for this, so a 15-line `System.Drawing` / canvas crop is fine.

- **Handwritten notes / photos** — Read tool on the images; they reveal how the
  professor explains and what they emphasize — mine them for written-question
  style, the ORDER he teaches things in (it drives the video hunt), and exam
  predictions, and say so when a question is inferred from them. Zoom-crop
  any figure you will reproduce and any number you will ship.
- **Decks with no text layer** (screenshots pasted into slides — half of a
  typical post-midterm deck): rasterise the whole deck and read every page;
  keep a **page-coverage ledger** in the source-of-truth so a later session can
  see which pages were read and which were blank.
- **Blank "Solution" pages** are common (the professor solves on the board).
  The key is then DERIVED: derive it, verify it by an independent path (a
  small Node recompute), label it derived on the site and flag it for the
  owner. Never present a derived key as official.
- Keep every Read under ~2000px per image when batching multiple images.

## 2a. Two rules earned by getting this wrong

**A. Never author a figure you have not looked at.** Reasoning a waveform from
its formula feels rigorous and is not. On a real build the professor's integral
limits (∫ from α to π+α over period π) correctly implied the *voltage* trace —
and said nothing at all about the *current*, which his slide drew with visible
ripple where the site had drawn a flat line. The formula constrains one trace and
leaves its neighbours unconstrained; only the picture shows you the rest.
Render the slide, put it beside your builder's output, and compare trace by
trace: **every** trace, its zero regions, its jumps, and its labels.

**B. Copy the professor's WRITTEN FORM, not an algebraic equivalent.** Record
formulas in `source-of-truth.md` exactly as they appear on the slide. Two
expressions can be identical mathematically and still cost a student time and
confidence: a rearrangement the marker has never seen reads as a different
formula. (Observed: slides wrote `√[1 − α/π + sin(2α)/(2π)]`; the site shipped
the equivalent `√[(1/π)(π − α + sin 2α/2)]` and had to be switched back at 16
sites.) When the same quantity appears on several slides, check they agree —
and use the form he repeats.

## 3. docs/source-of-truth.md

Author it as you read — it is the accuracy backbone:

- **Global conventions** — symbols, sign conventions, units, the professor's
  notation quirks (e.g. which formula variant they use when two exist).
- **A figure manifest** — one row per source figure the site will reproduce:
  slide/page, what it shows, and the trace-by-trace description you read off the
  render (which intervals are positive/negative/zero, where the jumps are, which
  devices are labelled conducting when). Author every `figures.js` builder from
  THIS table, never from a formula. It is also what a later session diffs
  against when a builder changes.
- **Per-sheet verified answer keys** — for every problem with an official
  solution: the final answer AND the method line ("Thévenin first, then KVL").
  Where you re-derived to confirm, note it. Discrepancies between lecture and
  solution sheet: record both, flag which the professor uses. Derived keys
  (blank solution pages) are marked DERIVED.
- **Every table the source draws** — the professor's solving tables (columns,
  fill order, where the circle goes) AND the data tables a question is posed
  with. The first become `table:` contracts, the second `given:` tables; a
  dataset the source drew as a table must never reach the site as prose.
- **Course conventions that override the textbook** — e.g. a `1/2m` in the
  cost, rows = Predicted in the confusion matrix, `j` = digit count of the
  largest value in decimal scaling, the augmented `[x1, x2, 1]` route in an
  SVM. Record each once here and obey it everywhere; two sources using
  different routes for the same quantity are noted so they are never mixed.
- **Source slips** — a miscopied row, a momentary board slip, a typo in a
  guide: ship the corrected value, document both readings, and list them in a
  "for the owner to confirm" section. Boards control scope and method;
  independent mathematics controls correctness.
- **Past-paper decode** (when papers exist) — per question: topic/module, marks,
  the figure (rendered), the answer, the method signature. This table feeds the
  Phase 4 weighting analysis directly.

## 4. Weighting evidence (feeds Phase 4)

From the decode table: per-module share of total marks across papers, repeated
question signatures, and anything the professor announced. Module `weight`
(high/med/low) and the mock-exam composition must cite this evidence in
MEMORY.md — weights from vibes are how marks get lost.
