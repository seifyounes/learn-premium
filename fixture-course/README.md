# Fixture Course

A small synthetic Course that the Site template builds on every change. It is written from
textbook physics, with no Professor's material, so it can live in this repo. Every value in it is
worked out here, not copied from any Course's Materials.

Layout (content contract v0):

- `course.yaml`: the course config (name, pad, Credit line).
- `modules/<NN>-<slug>/module.yaml`: one Module; the folder name is its route.
- `modules/<NN>-<slug>/summary/<n>.md`: one Summary beat each, plain Markdown.
- `modules/<NN>-<slug>/worked/<n>.json`: one Worked example each.
- `modules/<NN>-<slug>/practice/<n>.yaml`: one Practice item each.

Math is written between `$…$` (inline) or `$$…$$` (display) in any prose field, and `\ce{…}`
renders chemistry. In JSON every backslash is doubled; in YAML use single quotes or a block scalar.
