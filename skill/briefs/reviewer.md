# Brief: Fresh reviewer

You review Module `<NN>` of `<Course>` after its gates are green on the Vercel preview. You never
saw it being written, and you are launched fresh for every review: no earlier reviewer's findings,
no writer's notes. The gates already checked numbers, notation, layout and tags. You hunt what they
can't see: places where the Study site says something the Professor didn't mean, or shows a figure
or table that isn't the one on the Professor's page.

**You are given:** the commit `<sha>` whose preview you review; the screenshots and their list,
`<Private folder>/waves/<NN>/review/shots/` (phone and laptop, every section open, one shot per tab
view); the Module's content folder `content/modules/<NN>-<slug>/`; the Course style sheet; the
Module's Materials files and the Private folder; and the one file you write:
`<Private folder>/waves/<NN>/review/review.json`. Write nothing anywhere else.

1. **The eyes loop.** Render the Materials pages the Module draws on through the Materials reader
   (`scripts/reader/README.md`; never a PDF's text layer) and look at them beside the screenshots.
   For every figure, table, sheet and plot on the page: is it the Professor's (same parts, same
   arrangement, same labels, same table shape and order, data drawn as the source drew it)? Is
   anything cut off, overlapping, unreadable at phone width, or missing on one device?
2. **The adversarial read.** Read every Summary beat, Worked example step, rule and Practice item
   against the Materials, trying to prove each one wrong. Look hardest at what a number check can't
   catch:
   - a reversed direction, sign, inequality or comparison ("largest" for "smallest", "increases"
     for "decreases", hot and cold swapped);
   - a condition dropped or changed (series for parallel, steady for transient, "only if" for "if");
   - a definition, symbol or term that isn't the Professor's, or two terms swapped;
   - a rule credited to the wrong case, or a step the Professor's method doesn't take, or takes in
     another order;
   - a claim the Materials don't make at all, stated as theirs.
3. For each thing you find, add one finding:
   - `kind`: `meaning` (the read) or `visual` (the eyes loop);
   - `content`: the content file it sits in, relative to `content/` (`modules/01-x/summary/2.md`),
     or null for a visual finding with no one file;
   - `screenshot`: the shot it shows in (`waves/<NN>/review/shots/phone.png`, relative to the Private
     folder), or null; a visual finding needs one;
   - `materials`: `{file, page, box}`, where the Professor says otherwise (`box` as fractions of the
     render, or null); a meaning finding needs one;
   - `site`: what the site says or shows; `source`: what the Materials say or show; `why`: why
     they differ in meaning, in a sentence.
   A difference in wording that keeps the meaning is not a finding. Don't report what a gate
   already checks (a number at its printed precision, a notation variant).
4. Write `{"review": "learn-premium review v1", "module": "<NN>", "commit": "<sha>", "findings":
   [...]}` (an empty list when you found nothing), then return a short report: pages compared,
   screenshots looked at, and the count of findings by kind. Quote nothing from the Materials in it.

The main agent re-verifies every finding itself before it blocks, so be exact about where: a
finding it can't find on the crop or the screenshot is rejected.
