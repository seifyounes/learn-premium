# Brief: Blind reader

You are one of two Blind readers for Module `<NN>` of `<Course>`. You transcribe the Module's
Materials on your own. Another reader does the same, and neither of you ever sees the other's output.
Your numbers are compared with theirs, so write what the page shows and never guess.

**You are given:** the Materials files for this Module (paths relative to the Materials folder),
the Materials folder, the Private folder, and the one file you write:
`<Private folder>/waves/<NN>/reading-<a|b>.json`. Write nothing anywhere else, and don't open the
other reader's file.

1. Read every file through the Materials reader (`scripts/reader/README.md`: `materials_reader.py read`).
   Look at each rendered page and slide image it writes. Never use a PDF's text layer. A deck's
   notes and narration transcripts count as Materials too.
2. Make one item for everything the Module's content will rely on: each number in a worked
   solution, sheet or table (with its unit), each formula and definition, each table cell, each
   figure label, and every handwritten pen annotation. Give each item:
   - `key`: the file, the page and what it is, the way the other reader would name it too
     (`L01.pdf#p3/eq-2`, `Sheet 1.pdf#p1/q3-answer`, `L02.pptx#s7/table-r2c3`);
   - `file`, `page` (the slide number for a deck), and `box`, where it sits as fractions of the render
     (`[x0, y0, x1, y1]`, top-left origin);
   - `quantity`: what a number or formula is (`learning rate`, `cost after step 1`), named the same
     way wherever it appears;
   - `kind`: `number`, `formula` (TeX), `text`, `annotation` or `figure`;
   - `value`: exactly as written: digits as printed, trailing zeros kept, TeX for formulas.
3. If you can't read something for sure (a smudged digit, an ambiguous pen stroke), set `value` to
   null. Don't infer it from the surrounding working.
4. Write the file in the shape `scripts/wave/README.md` gives, then return a short report: files read,
   item counts by kind, the items you set to null, and anything odd (a page that didn't render).
   Report no values.

**A sitting's past papers.** For a Sitting wave you read the sitting's past-paper files instead, and
write `<Private folder>/sittings/<ID>/reading-<a|b>.json` in the same shape with `"sitting": "<ID>"` in
place of `"module"`. Key each paper by the short name the Owner gave it (`2025`): every question as the
paper numbers it, `<name>/q<n>/text` (the question exactly as printed, formulas as TeX, `kind: text`),
`<name>/q<n>/marks` (its marks, a digit string) and, only where the Professor printed one beside the
question or on a key sheet, `<name>/q<n>/key` (the key as printed, trailing zeros kept); then
`<name>/total` (the printed total marks) and `<name>/minutes` (the printed time). List the questions in the
order the paper prints them. A key the paper doesn't print has no item: never work one out.
