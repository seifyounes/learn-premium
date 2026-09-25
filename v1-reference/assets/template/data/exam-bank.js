/* exam-bank.js — the GENERAL timed mock (window.EXAM_BANK).
   Minimal valid sample so the exam engine runs out of the box.
   During the exam-suite phase: replace with a full bank weighted to
   the high-yield modules, and add pattern-matched banks (MOCK_FINAL,
   FINAL_SIM…) as separate files wired via SITE.exam.variants. */
window.EXAM_BANK = {
  title: "Sample Mock Exam",
  blurb: "A tiny sample bank proving the exam engine works — replace with the real weighted mock.",
  durationMin: 30,
  sections: [
    {
      title: "Section A — Theory MCQ",
      type: "mcq",
      questions: [
        {
          id: "a1", module: "1",
          q: "During the mock exam, what happens when the clock reaches 0:00?",
          options: [
            { t: "The exam auto-submits and solutions are revealed", correct: true, why: "Exactly like the real thing — budget your time." },
            { t: "The clock restarts", why: "It ends the attempt." },
            { t: "Nothing", why: "The countdown is enforced." },
            { t: "The site closes", why: "Only the attempt ends." }
          ],
          explain: "The exam auto-submits at 0:00 — practice pacing, not just solving."
        },
        {
          id: "a2", module: "1",
          q: "Where does the score report send you after submitting?",
          options: [
            { t: "To the lectures you scored weakest on", correct: true, why: "Each weak module gets a direct revise link." },
            { t: "Back to the home page automatically", why: "You choose where to go." },
            { t: "To a printable certificate", why: "No certificates — just mastery." },
            { t: "Nowhere", why: "The report links weak topics." }
          ],
          explain: "The report lists every module under 60% with a revise link."
        }
      ]
    },
    {
      title: "Section B — Written problem",
      type: "written",
      questions: [
        {
          id: "b1", module: "1", marks: 10,
          prompt: "Describe the professor's simplify-and-redraw method as demonstrated in the sample worked example.",
          circuit: { fn: "sampleFlow" },
          model: "Start from the full figure, identify what can be combined, REDRAW the equivalent simpler figure, then solve on the simple one. The sample walkthrough morphs the 3-stage flow into a 2-stage equivalent at step 3.",
          mark: "Naming the redraw step and solving on the simplified figure earns the marks."
        }
      ]
    }
  ]
};
