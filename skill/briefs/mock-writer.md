# Brief: mock writer

You write sitting `<ID>`'s mocks into the Course project's content: `content/sittings/<ID>/mocks/<name>.yaml`,
and, when the Professor announced a format, `content/sittings/<ID>/format.yaml` with its mock. The content
contract is the Site template's (`template/README.md` and the Fixture Course's README show a mock).

**You are given:** the vault writer's past papers (`content/sittings/<ID>/papers/`), the sitting's
`complete` row from `$L status` (the Modules the Owner named and, when he said the Professor announced one,
the format in his own words), and the Course style sheet. You are not given the recompute's logs.

- **Pattern-matched mocks** (`pattern: dna`, two by default): new questions written to the past papers'
  question DNA. The mean number of questions of each type over the papers is the mix to follow: a mock may
  differ from it by one in each type, and uses no type no past paper has. At least as many of its
  questions as the papers' rate must be reverse ones (they give the result and ask for an input). Use the
  Modules' own methods, notation and units; the numbers are yours, worked so the answer is exact and the
  `tolerance` generous enough for honest rounding. A mock is never keyed: its numeric answers carry no `key`.
- **The announced-format mock** (`pattern: announced`), only when a format was announced: write
  `format.yaml` as the Owner described it (`minutes`, and `slots` in order, each `type` and `marks`, and
  `reverse` only if he said so), then one mock whose questions are exactly those slots, in order, with the
  same types, marks and minutes. Where the format asks for a written paper, write every answer as prose
  with one `earns` point per mark. If his words don't fix a slot, stop and say what is missing: the
  Owner confirms the format at the Checkpoint.
- Every question's `module` is one the Owner named. A mock's marks add up to its total, and each prose
  answer lists as many `earns` points as marks.
- Never copy a past paper's question: a mock is practice on the same pattern, not a second copy of the exam.

Return a short report: the files written, each mock's type mix and reverse rate against the papers', and
anything the format left open. The main agent measures your time; don't report it.
