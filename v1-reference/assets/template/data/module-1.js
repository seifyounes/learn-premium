/* module-1.js — SAMPLE MODULE: "How this site works".
   A self-documenting demo that exercises EVERY engine path (summary
   sections + TOC, figure/graph/calc/anim hydration, rules, formulas,
   step-reveal walkthrough with highlight + chip + redraw morph,
   flashcards, written question, quiz). Replace with the subject's
   real Module 1 during the content phase — keep the same shape. */
(function () {
  window.MODULES = window.MODULES || {};

  window.MODULES["1"] = {
    id: "1",
    title: "How this site works",
    short: "Site tour",
    subtitle: "A 10-minute tour of every study tool — then replace this module with the real Lecture 1.",
    weight: "med",
    estMinutes: 15,
    counts: "2 quiz · 2 cards · 1 worked",
    sectionKeys: ["summary", "tips", "rules", "formulas", "worked", "flashcards", "written", "quiz"],

    /* audited video cards (module.videos[]) — link-outs rendered above the summary.
       Only a real, verified URL may ship (references/videos.md: retrieve-mode hunt,
       ≥ 9/10 match, oEmbed + duration + thumbnail re-verified). Until a hunt clears
       the bar the topic stays "pending" — never a placeholder URL. */
    videos: [{ topic: "Site tour", status: "pending" }],

    summaryHtml: `
<p>This sample module shows every tool the site gives you. Each lecture is a <b>5-step path</b>:
Learn → Rules &amp; Formulas → Worked Examples → Practice → Quiz. Progress is saved on this
device automatically.</p>

<h3>1. Reading the summary</h3>
<p>Summaries are split into collapsible sections with a table of contents on top. Scrolling
through a section marks it read. Concepts can embed <b>figures</b> drawn as SVG:</p>
<div data-figure="sampleFlow"></div>
<p>…and live <b>graphs</b> built from data:</p>
<div data-graph="linePlot" data-opts='{"xlabel":"x","ylabel":"y","series":[{"pts":[[0,0],[1,1],[2,4],[3,9]],"label":"y = x^2"}],"marks":[{"x":2,"y":4,"label":"Q"}],"caption":"A sample plot — replace with subject graphs"}'></div>

<h3>2. Interactive helpers</h3>
<p>Calculators let you plug numbers into the lecture's formulas and see the result instantly:</p>
<div data-calc="sample"></div>
<p>Animations show moving concepts (current flow, algorithm steps…):</p>
<div data-anim="sample"></div>

<h3>3. Drilling for the exam</h3>
<p>After the summary: drill the <b>rules</b> in test mode, watch the <b>worked examples</b> build
step by step (press ▶ Play), flip the <b>flashcards</b>, answer the <b>written question</b>, then
take the <b>quiz</b>. The mock exam on the home page pulls everything together under a clock.</p>`,

    tips: [
      "Use ▶ Play on worked examples and watch WHERE each value comes from before reading the algebra.",
      "Flag (☆) anything shaky — flagged questions collect on the home page for a final sweep."
    ],

    rules: [
      { name: "The 5-step path", formula: "Learn -> Rules -> Worked -> Practice -> Quiz", note: "Do the steps in order; the quiz score feeds your mastery %." },
      { name: "Flag it or lose it", formula: "☆ flag ⇒ home-page review list", note: "Anything you hesitate on gets flagged, then re-drilled before the exam." },
      { name: "Mastery blend", formula: "40% read + 45% best quiz + 15% cards", note: "The home-page bar per lecture — get all three up." }
    ],

    formulas: [
      { big: "mastery = 0.4·seen + 0.45·quiz + 0.15·cards", meaning: "How the per-lecture mastery % on the home page is computed. It only moves when you actually study." }
    ],

    worked: [
      {
        id: "w1",
        title: "Worked example — the professor's TABLE fills as you step",
        statement: "Press ▸ to reveal each step (or ▶ Play to watch). A worked example carries the question's DATA as a table (given — drawn exactly as the source drew it, never a run of tuples), the professor's SOLVING table (table — filled column by column by fill, circled by mark), and a figure that steps can highlight or REDRAW into a simpler equivalent.",
        given: { cap: "Given (the question's data)", cols: ["x", "y"], rows: [["2", "3"], ["3", "4"], ["4", "5"]], note: "A given table is static — it is the question, not the solution." },
        circuit: { fn: "sampleFlow" },
        table: {
          cap: "The solving table (fills as the steps run)",
          cols: ["x", "y", "h = 2x", "h − y"],
          rows: [["2", "3", "4", "1"], ["3", "4", "6", "2"], ["4", "5", "8", "3"]],
          sum: ["Σ", "", "", "6"],
          pre: ["c0", "c1"],
          note: "Selectors are 0-indexed: c2 = third column, r0c3 = first row / fourth column, sum:c3 = the Σ cell."
        },
        steps: [
          { k: "Copy the givens", html: "The x and y columns are already on the board (pre). Compute the model column h = 2x → <b>4, 6, 8</b>.", fill: ["c2"], hl: ["p-in"], chip: "h column" },
          { k: "Subtract", html: "Fill the error column h − y row by row: <b>1, 2, 3</b>.", fill: ["c3"], hl: ["p-mid"] },
          { k: "Sum and circle", html: "Add the column → Σ(h − y) = <b>6</b>. The professor circles the headline number.", fill: ["sum"], mark: ["sum:c3"], hl: ["p-out"] },
          { k: "Redraw simpler", html: "When a figure is complex, REDRAW it into an equivalent simpler one and keep solving — watch the figure change. The result is unchanged: <b>Σ = 6</b>.", circuit: { fn: "sampleFlowSimple" }, hl: ["p-a1"] }
        ],
        answer: "Σ(h − y) = 6 — read straight off the circled cell of the table."
      }
    ],

    quiz: [
      {
        id: "q1",
        q: "What does the ▶ Play button on a worked example do?",
        options: [
          { t: "Reveals the steps one by one automatically, highlighting the figure", correct: true, why: "That's the step-reveal player — watch where each value comes from." },
          { t: "Skips to the final answer", why: "Reveal-all exists, but Play walks the steps." },
          { t: "Grades your answer", why: "Only the quiz grades you." },
          { t: "Opens the mock exam", why: "The mock exam lives on its own page." }
        ],
        explain: "Play = watch the solution build step by step, with the figure lighting up."
      },
      {
        id: "q2",
        q: "Where do flagged (☆) questions collect?",
        options: [
          { t: "On the home page, under 'Flagged for review'", correct: true, why: "One list across all lectures — your final sweep before the exam." },
          { t: "They are deleted", why: "Flags persist on this device." },
          { t: "In the quiz score", why: "Flags and scores are separate." },
          { t: "Nowhere — flags are decorative", why: "They drive the review list." }
        ],
        explain: "Flag anything shaky; clear the list the night before the exam."
      }
    ],

    flashcards: [
      { front: "The 5-step path of every lecture?", back: "Learn → Rules & Formulas → Worked Examples → Practice → Quiz" },
      { front: "What feeds the mastery %?", back: "40% sections read + 45% best quiz score + 15% flashcards known" }
    ],

    written: [
      {
        id: "wr1",
        prompt: "In your own words: what is the fastest way to use this site the night before the exam?",
        model: "Open the Revision page end-to-end, redo the flagged questions from the home page, replay the worked examples for the weakest lectures (▶ Play), then sit the timed mock exam and revise every topic the score report marks weak.",
        mark: "Any answer naming the revision, the flag list, and the timed mock earns full marks."
      }
    ]
  };
})();
