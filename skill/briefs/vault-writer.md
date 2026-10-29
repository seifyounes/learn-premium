# Brief: vault writer

You write sitting `<ID>`'s past papers into the Course project's content, verbatim from the settled
reading: `content/sittings/<ID>/papers/<name>.yaml`, one file per past paper. The content contract is the
Site template's (`template/README.md` and the Fixture Course's README show a paper). You never write
JSX or MDX, only the structured files.

**You are given:** the settled reading (`<Private folder>/sittings/<ID>/reading.json`), the rendered
pages it points at, the paper names the Owner gave (`$L status`, the sitting's `complete` row), the
Course style sheet (`content/style-sheet.yaml`) and the Owner's answers to any Checkpoint items already
ruled (`ledger.ts checkpoint --key …`).

- A paper is the Professor's, so copy it exactly: each question's text as the settled reading gives it
  (math between `$…$`, in the style sheet's notation and units), the questions in the paper's own order,
  each question's marks, and the paper's printed total and minutes. Never reword, reorder, merge, drop or
  add a question: the sitting gate and `ready` hold every one to the settled reading.
- Question `n` is its place in the file. Give each its `module` (the Module folder it examines, one the
  Owner named), its `type` (the Course's own kind of question, kebab-case: `calculation`, `explain`; the
  same words for the same kind everywhere, since the mocks follow them) and `reverse: true` when it gives
  the result and asks for an input.
- The answer: `numeric` (`value`, `unit`, `tolerance` tight enough that the key's printed digits pass, and
  `key`, the Professor's printed key exactly as printed, on a past paper) or `prose` (a `model` answer and
  one `earns` point per mark, as many as the question has marks). Where the Professor printed no key for
  any numeric answer, don't make one up: the paper says `key: solved` and the solver supplies the answers.
  Where he printed keys for some numeric answers and not others, the paper stays `key: professor`: carry
  each printed key, leave `key` off the rest, and the solver supplies those answers (the Owner confirms them).
  Never read the recompute's logs (`content/build-records/recompute/`).
- A value the Owner ruled on the Professor's key ships as he ruled: a Slip ships the corrected value
  with `provenance.slips` (`value`, `sheet`), a Divergence ships the Professor's with
  `provenance.divergences` (`value`, `note`). Never rule one yourself.
- A value the readers couldn't read (`null` in the settled reading), or a total or time the paper doesn't
  print, waits for the Owner's answer; don't guess it.

Return a short report: the files written, each paper's questions, marks and kind of key, anything you
couldn't place. The main agent measures your time; don't report it.
