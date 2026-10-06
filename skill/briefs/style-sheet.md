# Brief: the Course style sheet (Module 1's wave only)

Module 1's wave writes `content/style-sheet.yaml` before any other Module is written. Every later
writer, the recompute and the notation lint follow it. Write it from Module 1's settled reading
(`<Private folder>/waves/01/reading.json`) and its rendered pages. It describes the Professor's
conventions in our own words. Never paste the Professor's text into it: it is committed with the
Course project.

The shape is the template's contract (`template/src/content/style-sheet.ts`). The Fixture Course's
`style-sheet.yaml` is a worked example.

- `writtenFrom`: Module 1's folder name (`01-<slug>`).
- `voice`: how the Professor explains (register, order of working, what gets stressed), in two or
  three sentences.
- `tableForms`: the artefacts the Professor solves on: table layouts, column order, total rows.
- `definitions`: every definition the Professor pins down (a settling time to 2 %, a cost with a ½).
  The recompute uses these.
- `idealisedModels`: what the Professor idealises (ideal diodes, neglected losses).
- `notation`, the **machine-readable part**: one entry per symbol: `write` (the TeX exactly as the
  Professor writes it), `means`, and `not`, the variants a writer might use by habit and must not (for
  example `\theta_j` written `w_j`). Only list a variant the Course never uses for that symbol: the
  lint blocks every one, in every formula of every Module.
- `units`: each unit as the Professor writes it, with the spellings `not` to use, in text or math.

Run the notation lint (the `notation` gate, at the job point) on Module 1 before recording the
`style-sheet` job.
