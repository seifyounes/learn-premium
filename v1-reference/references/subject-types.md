# Subject-type adaptation — classify, then follow the row

Classify at Phase 1 (confirm with the user); execute the row at Phases 5–6.
Mixed subjects: pick the PRIMARY type, borrow rows per module. The engines never
change per type — only `js/figures.js`, the graphs/demos you add, and the
flavor of the walkthrough steps.

## The matrix

### Figure toolkit (what replaces the sample builders in figures.js)

- **math-heavy** — annotated derivation diagrams, geometry constructions,
  labeled axes/regions. Highlight the term being manipulated (`p-term1`…).
- **code-heavy (ML…)** — computation-graph / network-architecture / pipeline
  builders with `id="p-…"` per node and edge so steps light up the layer being
  computed; matrix-shape boxes ([m×n] labels); simplified-equivalent variants
  for the redraw morph (full network → the single neuron being computed;
  full pipeline → the folded stage).
- **memorization-heavy** — labeled concept maps, timelines, anatomy-style
  labeled figures (parts get `p-…` ids so quizzes/walkthroughs can point).
- **diagram-heavy** — the main investment: faithful reproductions of the
  professor's figures (the electronics circuits.js is the reference for how
  far to go); re-render past-paper figures at 4–6× and match exactly.

### Walkthrough flavor

- **math-heavy** — equation per step; `hl` the term; chips carry intermediate
  values; state WHY each manipulation is legal.
- **code-heavy** — two-track steps: the math + a short `<pre><code>` snippet
  per step (protected from mathify automatically); per-step `circuit:` morphs
  the architecture as the forward/backward pass advances; chips show tensor
  shapes or loss values.
- **memorization-heavy** — recall-recipe steps (name → define → example →
  distinguish-from).
- **diagram-heavy** — the professor's redraw method verbatim: full figure →
  simplified equivalent per step (this is the exemplar's signature move).

### Interactive demos (add to Calc/Anim registries or a new js/demos.js,
embedded via data-calc / data-anim style hydration)

- **math-heavy** — calculators per formula (Calc._.widget), slider-driven plots.
- **code-heavy / ML menu** (all buildable on `Graphs._` + plain events, zero deps):
  1. **Gradient-descent fit** — 1-D loss curve, learning-rate slider, ▶ animates
     steps toward the minimum; diverges visibly when η too big.
  2. **k-means** — click canvas to drop points, buttons step assign/update,
     cluster colors update live.
  3. **Decision boundary** — tiny perceptron/logistic trained on 2-D points,
     boundary line redraws each epoch.
  4. **Least-squares** — drag points, fitted line + residuals update live.
  5. **Overfitting** — polynomial-degree slider vs train/test error curves.
  Pick the 2–3 the syllabus actually tests.
- **memorization-heavy** — flashcards carry the load (bigger decks); RulesUI
  test mode is the drill.
- **diagram-heavy** — SMIL animations morphing the figures (Anim._ helpers).

### Flashcard emphasis

- math: formula ↔ name ↔ when-to-apply triples.
- code/ML: definitions, "what does this hyperparameter do", complexity/shape
  facts, predict-the-output-of-this-snippet cards.
- memorization: the core drill — big decks, Leitner boxes carry the load.
- diagram: figure-recognition cards (front = inline SVG figure, back = name).

### Exam analysis focus

- math: mine solution sheets for the professor's step conventions; clone
  numeric patterns with new numbers.
- code/ML: split past papers into theory MCQ vs "trace this code / compute one
  GD step / draw the boundary"; verify every computed answer by actually
  running the arithmetic.
- memorization: frequency-count recalled facts across papers; weight decks.
- diagram: question signatures ARE figures — reproduce them faithfully.

## Worked example — machine learning (the next subject)

- **Type**: code-heavy with a math spine (mixed; primary = code-heavy).
- **figures.js**: `pipeline` (data→features→model→loss→update, p- per stage),
  `netArch` (input/hidden/output layers, p- per layer + weight edges),
  `matShapes` (X[m×n]·W[n×k]=Z[m×k] boxes), `neuronZoom` (redraw morph target
  for netArch), `treeSplit` (decision tree), `confusion` (2×2 matrix with p-
  per cell).
- **Walkthroughs**: forward pass (netArch morphing layer by layer, chips carry
  shapes), one gradient-descent update by hand (numbers verified by running the
  arithmetic), bias/variance reasoning, one metrics computation on a confusion
  matrix.
- **Demos**: gradient-descent fit + overfitting slider (+ k-means if clustering
  is on the syllabus).
- **Code steps**: NumPy-flavored 3–6-line snippets in `<pre><code>`, one concept
  per snippet; predict-the-shape and predict-the-loss quiz questions.
- **Not just math and graphs**: every algorithm gets (a) intuition paragraph,
  (b) the picture (figure/anim), (c) the math, (d) the code, (e) a drill.
