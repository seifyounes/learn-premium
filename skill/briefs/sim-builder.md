# Brief: sim builder

You build one tool of Module `<NN>`: the file `wave.ts assign` named for you (`<name>`, built as
`<tool>`), in `content/modules/<NN>-<slug>/` (`sims/`, `python/` or `parts/`). The content contract is the
Site template's (`template/README.md` and the Fixture Course's README show a file of every kind). You
never write JSX, only the structured file.

**You are given:** the settled reading (`<Private folder>/waves/<NN>/reading.json`), the render or crop of
your figure, the Course style sheet (`content/style-sheet.yaml`), your entry of the tool assignment (its
Worked example, Discipline, interaction and tool), and the contract for your tool's kind.

- Read the model off the Professor's figure: the quantities it names, the values it prints, the ranges a
  student would tune. Copy every printed number exactly as the settled reading gives it, even one you
  think is wrong. The recompute and the Owner settle that, never you.
- For a schematic sim (a circuit, a ladder, a pneumatic circuit, a control loop), write the Layout hints only (the cell of each
  part, its turn, its label side), never a coordinate. The Figure reading is a Blind reader's, not yours:
  don't redo it. A part count or net count that disagrees with it is a finding, not something to fix.
  For a state diagram (an FSM, a GRAFCET), the cell of each state or step, the side of each self-loop, and an
  edge's bow only where the figure bends it; its counts are its states (parts) and edges (nets).
- Tag every number: `stated`, `derived`, `scaled` or `assumed`. A constant the figure doesn't print is
  `assumed`, and goes in your assumptions.
- A region you can't read is not a guess: list it as unreadable. The main agent settles it on its crop.
- Never read the recompute's logs (`content/build-records/recompute/`) or its working.

**Self-check before you hand back:** `npm run gates -- run --point job --module <NN>-<slug> --content ../content`
from `template/`. It must pass. Fix what it finds; don't change a gate or the template.

**Hand back** by writing `<Private folder>/waves/<NN>/builders/<name>.json`:

```json
{ "handback": "learn-premium sim builder v1", "module": "<NN>", "name": "<name>", "tool": "<what you built>",
  "figure": { "file": "…", "page": 4, "box": [0, 0, 1, 1], "label": "…" },
  "files": ["content/modules/<NN>-<slug>/sims/<name>.json"],
  "counts": { "parts": 0, "nets": 0 },
  "assumptions": [{ "value": "…", "why": "…" }],
  "unreadables": [{ "where": "…", "what": "…" }],
  "selfCheck": { "ran": ["…"], "passed": true, "notes": null } }
```

`files` are the files you wrote, relative to the Course project, inside the Module's folder or
`content/build-records/`, and they include `<name>`'s own file. Put no time in it, not even in a note: the
main agent measures your time. Then return one line saying it is written.
