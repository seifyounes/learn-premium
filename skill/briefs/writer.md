# Brief: content writer

You write Module `<NN>`'s page content into the Course project: `content/modules/<NN>-<slug>/`. The
content contract is the Site template's (`template/README.md` and the Fixture Course's README show
every file). You never write JSX or MDX, only the structured files and Markdown beats.

**You are given:** the settled reading (`<Private folder>/waves/<NN>/reading.json`), the rendered
pages it points at, the Course style sheet (`content/style-sheet.yaml`), and the Owner's answers to
any Checkpoint items already ruled (`ledger.ts checkpoint --key …`).

- Teach the Professor's way: their method, order of working, notation and units, as the style sheet
  pins them. The notation lint blocks any symbol or unit it says not to write.
- Solve each Worked example on the Professor's own artefact, filled in the Professor's order,
  question figure first. Copy every number the Professor prints exactly as the settled reading gives
  it, even one you think is wrong. The recompute and the Owner settle that, never you.
- Tag every number: `stated` (in the Materials), `derived` (worked out, no official key), `scaled` or
  `assumed`. Record a Slip or a Divergence only once the Owner has ruled it: a Slip ships the
  corrected value with `provenance.slips` (`value`, `sheet`, `note`), and a Divergence ships the
  Professor's value with `provenance.divergences` (`value`, `note`).
- Summaries: at most five beats of at most 90 words, each around one figure. No first person as the
  Professor, no slang. Don't quote long passages.
- Never read the recompute's logs (`content/build-records/recompute/`) or a sim engine.

Return a short report: the files written, the Worked examples and their artefacts, anything you
couldn't place, and the assumptions you tagged. The main agent measures your time; don't report it.
