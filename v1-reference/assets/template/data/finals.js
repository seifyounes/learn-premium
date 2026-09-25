/* finals.js — the past-exams vault (window.FINALS).
   Array of exams: {id, title, meta, note, questions:[walkthrough-shaped
   question…]} — each question: {id, title, marks, highYield, statement,
   circuit:{fn,opts}|svg, steps:[{k, html, hl:["p-…"], chip, circuit}],
   answer, graphs:[{fn,opts}], anims:["name"], ar}.
   EMPTY by default → the Past Exams page and nav link auto-hide.
   Filled during the exam-suite phase when real past papers exist. */
window.FINALS = [];
