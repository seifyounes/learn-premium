/* site.js — the ONE file holding every subject-specific string/flag.
   Loaded FIRST (before the engines) so util.js can read the namespace.
   Fill this at scaffold time from the intake interview; engines and
   data files stay generic. */
window.SITE = {
  /* localStorage namespace — set per project so two crash-course sites
     on the same origin never collide (e.g. "ml_v1_", "thermo_v1_") */
  ns: "cc_v1_",

  /* branding: topbar logo letter + the two-tone site name.
     h1 renders `first <gradient>rest</gradient>` */
  brand: { logo: "C", first: "Crash", rest: " Course" },

  course: "Sample Course",                 // full course name (hero eyebrow, tab titles)
  titleSuffix: " — Crash Course",          // appended to every document.title
  eyebrow: "",                             // hero eyebrow; empty → "<course> · Exam Revision"

  /* Credit line under the h1 — small, light, muted (.byline in styles.css).
     KEEP IT. It is the owner's shout-out and belongs on every site this skill
     builds; do not drop it when filling site.js from the intake interview.
     Only change it if the site is being handed over as someone else's work. */
  byline: "by Seif Younes",

  tagline: "Concise summaries, worked solutions, drills and a timed mock exam — everything you need, offline.",

  /* professor-method fidelity: when the site reproduces the professor's
     exact solving style, describe it here — shown as a callout above the
     worked examples. null → no callout. */
  professor: null,                          // e.g. "Dr. …" (used in copy you write in data files)
  methodNote: null,                         // e.g. "Every walkthrough follows Dr. X's exact method…"
  methodNoteLbl: "Solved the professor's way",

  /* Professor credit + disclaimer, printed under the tagline. When the professor is
     named on the site, credit them respectfully AND say the site is a student-built
     study aid, not reviewed or endorsed by them. null → hidden. Example:
     "Built from the lectures and boards of Dr. X, with respect and thanks. A
      student-built study aid — not reviewed or endorsed by Dr. X." */
  credit: null,

  footer: "Built with the Crash Course study-site template. Verify nothing is left unrevised. Good luck. ⚡",

  /* Arabic explanatory notes (.ar-note blocks + topbar toggle).
     true → toggle appears, notes render; false → no toggle, notes hidden. */
  arabic: false,

  /* home page */
  weightNote: "",                           // note under the lecture groups (e.g. "N1–N3 are low-weight") — empty → hidden
  planTitle: "Your study plan",
  plan: [],                                 // [{day, theme, tasks:[{id,t,href}]}] — empty → plan section hidden

  /* EXAM PARTS — needed once a course spans more than one exam (a sat midterm
     plus the final it is NOT in the scope of). Each part becomes its own
     collapsible group of lecture cards; a module joins one via its own
     `part: "<key>"`. Leave EMPTY for a single-exam course — the home page then
     renders one ungrouped "All lectures" list, exactly as before.
       { key, title, ic, open:bool, archived:bool, note, empty }
     `archived:true` desaturates the group, keeps the primary CTA away from it,
     and scopes the progress stats to the live part. A module whose `part`
     matches no declared key is never hidden — it falls into the first group. */
  parts: [],

  /* Scope banner printed at the top of a route whose content belongs to a sat
     exam — keys are route names ("revision" | "rules" | "exam"). Without it an
     archived revision page reads exactly like a live one. */
  pageBanners: {},

  /* nav labels (all optional — sensible defaults used when empty) */
  labels: { revision: "Revision", finals: "Past Exams", rules: "Master Rules", exam: "Mock Exam" },

  /* mock-exam page: which banks exist and how to present them.
     Each variant: { key:"FINAL_SIM", label:"⭐ The Final (announced format)", primary:true }
     — a button renders only when window[key] exists. The general
     window.EXAM_BANK is always offered when present. */
  exam: {
    statLabel: "Mock exam",                 // home-page tile label ("Mock final" …)
    variants: [],
    blurb: "",                              // intro paragraph on the chooser; empty → generic
    tip: "",                                // small note under the buttons (e.g. link to worked solutions)
    generalLabel: "📚 General mock (MCQ + problems)"
  },

  /* past-exams vault page heading (used when window.FINALS has entries). The vault
     also serves a circulating pre-exam problem set — relabel badge/title/nav then. */
  finals: { badge: "★ Real past exams", title: "Past Exams — solved step by step", sub: "The real past papers, reproduced faithfully and worked step-by-step. Press ▶ on any question to watch it solve." },

  /* master-rules page strings (empty → engine defaults). When the exam is announced
     as PROBLEMS ONLY, cut the sheet to the rules the worked examples use and retitle
     it here ("Master Rules — the formulas the problems use"). */
  rules: { eyebrow: "", title: "", sub: "", lead: "" },

  /* video-rail header above a lecture summary (module.videos[]) */
  videos: { label: "🎬 Watch it explained", note: "audited against the professor's solving method · opens YouTube (needs internet)" }
};
