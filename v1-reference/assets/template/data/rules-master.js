/* rules-master.js — the one-page master rules sheet (window.RULES_MASTER).
   Groups: [{title, icon, intro, rules:[{name, formula, note}]}]
   Minimal sample; the rules-master phase replaces it with every rule
   the exam can test, organized by topic. Empty array → the Master
   Rules page and its nav link auto-hide. */
window.RULES_MASTER = [
  {
    title: "Using this site",
    icon: "🧭",
    intro: "Sample group — replace with the subject's real rule groups.",
    rules: [
      { name: "Steps in order", formula: "Learn -> Rules -> Worked -> Practice -> Quiz", note: "The 5-step path per lecture." },
      { name: "Mock under the clock", formula: "timed mock ⇒ weak-topic report", note: "Always finish a study cycle with the timed mock." },
      { name: "Mastery blend", formula: "{40·seen + 45·quiz + 15·cards}/{100}", note: "Every division in a rule is a STACKED fraction — write it {numerator}/{denominator}. A bare a/b in a formula fails the table checker." }
    ]
  }
];
