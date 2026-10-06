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
