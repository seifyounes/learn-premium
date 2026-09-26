---
name: learn-premium Study site
description: The engineering computation pad. Every Study site is the sheet the student will write in the exam.
colors:
  desk: "#CFDCC2"
  sheet: "#E6EFDC"
  grid-fine: "#CADBBB"
  grid-major: "#B9CEA7"
  print: "#2E5A38"
  muted: "#4F5B4B"
  graphite: "#262B25"
  pencil: "#3D433C"
  red-pen: "#C0341D"
typography:
  display:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 75"
  headline:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.1
    fontVariation: "'wdth' 75"
  title:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.2
    fontVariation: "'wdth' 80"
  sheet-title:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: 1.2
    fontVariation: "'wdth' 87"
  body:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 80"
  label-action:
    fontFamily: "Archivo, 'Arial Narrow', sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 80"
  quantity:
    fontFamily: "'Atkinson Hyperlegible Mono', ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum' 1"
  quantity-large:
    fontFamily: "'Atkinson Hyperlegible Mono', ui-monospace, monospace"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "'tnum' 1"
rounded:
  none: "0px"
  sheet: "2px"
spacing:
  grid-minor: "20px"
  grid-major: "100px"
  cell: "7px 12px 9px"
  sheet: "28px 40px 22px"
  sheet-phone: "16px 16px 20px"
  margin-column: "216px"
components:
  button-print:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.print}"
    typography: "{typography.label-action}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "42px"
  button-print-hover:
    backgroundColor: "color-mix(in srgb, #2E5A38 10%, #E6EFDC)"
    textColor: "{colors.print}"
  button-print-next:
    backgroundColor: "{colors.print}"
    textColor: "{colors.sheet}"
    typography: "{typography.label-action}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "42px"
  button-print-next-hover:
    backgroundColor: "color-mix(in srgb, #2E5A38 82%, black)"
    textColor: "{colors.sheet}"
  title-block-cell:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.pencil}"
    rounded: "{rounded.none}"
    padding: "{spacing.cell}"
  step-box:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.pencil}"
    typography: "{typography.quantity}"
    rounded: "{rounded.none}"
    size: "24px"
  step-box-current:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.none}"
    size: "24px"
  answer-box:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.none}"
    padding: "7px 14px 9px"
---

# Design System: learn-premium Study site

## Overview

**Creative North Star: "The Computation Pad"**

Every Study site, for every Course and every discipline, is one engineering computation pad: pale paper with a 5 mm grid printed faintly through it, a ruled title block in the pad's printing colour, and the Professor's solving artefact ruled in pencil and filled in the order the Professor writes it. The Course home is the pad's contents sheet; a worked example is one solved sheet. What is on screen is what the student will write in the exam, so the interface is paper fidelity, not a dashboard.

The system is one house identity. A Course changes only its **palette** (the colour of the pad); layout grammar, typefaces, components, red-pen marking, motion and the worked-example invariants are fixed. Light only: the student has real paper beside the laptop under a desk lamp, and there is no dark mode. Density is that of a filled engineering sheet: tight printed cells, quantities in tabular mono, prose kept off the dense grid and held to 68–78ch.

Confirmed rejections: the dark SaaS course dashboard of cards, progress rings and indigo; and its predictable opposite, the cream-paper editorial serif notebook. The generic default Claude look is out by standing constraint.

Motion is the pen on the sheet: ruled lines draw along the writing direction, values land in hand order (column by column, top to bottom), and red-pen marks draw after the values they judge. It is transform, opacity and stroke-drawing only, and collapses to instant under reduced motion.

**Reference implementation (throwaway, stack undecided):** `prototypes/visual-identity/b/style.css` and `prototypes/visual-identity/b/app.js`, mounted by `prototypes/visual-identity/shared/boot.js`, on the local-only branch `prototype/visual-identity` (never pushed: it carries Pilot course content). Known defect there: at 320px the plot's labels scale to about 10–11px, below the 12px floor; a v2 build must size plot labels in screen pixels. Any v2 stack reimplements the tokens, roles and rules below; it does not port the prototype code.

**Key Characteristics:**

- One identity for every Study site; only the palette is themeable per Course.
- Paper with a two-weight printed grid (fine every 20px, major every 100px).
- Three hands of type: printed condensed labels, hyperlegible prose, mono quantities.
- Red pen is a meaning, not a colour: it marks, it never fills.
- Square, ruled forms; the only shadow is the sheet lying on the desk.
- Light only.

## Colors

A low-chroma pad of one hue family (paper, desk, grid, printing), fixed graphite and pencil inks for the student's hand, and one red pen. The frontmatter values are the reference palette (ML, green pad); the full starting catalogue of seven pads is below and in the sidecar (`coursePalettes.catalogue`).

### The Course palette slot (themeable)

A Course supplies a value for each of these slots. The roles never move; only the values change.

- **Desk** (`desk`): the surface behind the sheet. Slightly darker and more saturated than the sheet (sheet-to-desk contrast about 1.2:1).
- **Computation Paper** (`sheet`): the page itself, every cell fill, the knock-out behind SVG labels, the text colour on the Next button.
- **Faint Grid** (`grid-fine`) and **Major Grid** (`grid-major`): the printed 5 mm grid. Must stay faint: about 1.2–1.5:1 against the sheet, never competing with text.
- **Pad Printing** (`print`): everything the pad was printed with. Title-block rules, field labels, printed buttons, group headings, the contents margin line, focus rings, text selection, the Next button fill, form accent colour. In ML a deep forest green; in circuits a deep engineering blue.
- **Faded Annotation** (`muted`): secondary prose (module summaries, group notes, not-yet-current steps, legends).
- **Sheet Shadow Tint** (sidecar, an RGB triplet): the hue of the shadow the sheet casts on the desk, matched to the pad.

### Fixed inks (not themeable)

- **Graphite** (`graphite`): primary text, headings, the student's firm writing, done ticks, the current-step fill, figure points and centroids.
- **Pencil** (`pencil`): filled values in the table, table rules, ruled boxes, axes and ticks. Lighter than graphite: pencil is the working, graphite the committed.
- **Red Pen** (`red-pen`, #C0341D): the accent role, the same red on every Course (ticket #20). Pads are chosen to suit the red, never the other way round.

### How a Course gets its pad (ticket #20)

- **Catalogue first.** A catalogue of cool-hued pads (the starting seven are below), each checked against the requirements below and mapped to a default discipline, approved once by the Owner. No red, orange or brown pads: they fight the red pen.
- **Confirmed at intake.** The agent suggests the discipline's pad; the Owner confirms or swaps it. A discipline with no mapped pad gets the pad of the nearest listed discipline (control → Blue-grey, fluids and thermodynamics → Teal, statics and strength of materials → Steel), and Graphite-grey when nothing is close.
- **Off-catalogue on request.** The Owner may name any other colour; the agent builds a pad from it. A good one joins the catalogue only with the Owner's approval.
- **One config value.** The pad is a single setting in the Course config; changing it rebuilds the whole site.
- **Tools and media.** Framed tools (simulators, 3D viewers, embedded sims) take the pad's frame (sheet, grid, print, graphite) but keep colours that carry meaning, reds included (e.g. CircuitJS voltage colours, CPK oxygen in 3D); the red pen is never drawn inside a framed tool. Figures drawn onto the sheet follow the Red Hue Rule. NotebookLM's Custom style is given the Course pad.
- **No colour-blind simulation gate.** Red marks always carry a shape (ring, double frame, stroke), so no meaning depends on colour alone; the ML green pad stays even though red and green print converge under deuteranopia (1.7:1 by lightness only).

### The starting pad catalogue (ticket #21)

Approved by the Owner on 2026-09-26. Every pad passes every requirement below; the tightest pair on each is the red pen on the sheet (last column). The pads share one geometry in OKLCH (sheet L ≈ 93.6, desk ≈ 86.8, fine grid ≈ 86.9, major grid ≈ 81.4, print ≈ 36–42), so only hue and chroma differ.

| Pad | Default discipline | desk | sheet | grid-fine | grid-major | print | muted | shadow tint | red on sheet |
|---|---|---|---|---|---|---|---|---|---|
| Green (`green`) | Machine learning | `#CFDCC2` | `#E6EFDC` | `#CADBBB` | `#B9CEA7` | `#2E5A38` | `#4F5B4B` | `30 45 28` | 4.73 |
| Blue-grey (`bluegrey`) | Electric circuits | `#C8D5DE` | `#E1E9EF` | `#C9D6E0` | `#B3C4D1` | `#1F4B73` | `#4A5763` | `26 40 55` | 4.56 |
| Teal (`teal`) | Heat transfer | `#BDDBD8` | `#DAEFED` | `#BBDCD9` | `#A2CCC8` | `#035455` | `#455A5A` | `22 52 50` | 4.68 |
| Slate-violet (`violet`) | Mathematics | `#D3D1E2` | `#EAE8F4` | `#D4D1E4` | `#C2BFD6` | `#493F6F` | `#555364` | `46 44 58` | 4.63 |
| Steel (`steel`) | Machinery | `#C8D6DA` | `#E2ECEE` | `#C8D7DB` | `#B3C6CB` | `#32484F` | `#4C575C` | `34 49 52` | 4.66 |
| Graphite-grey (`graphite`) | Logic circuits | `#D2D3D6` | `#E9EAEC` | `#D3D4D7` | `#C1C2C6` | `#3A3B43` | `#54555A` | `43 45 56` | 4.65 |
| Indigo ink (`indigo`) | Engineering chemistry | `#CCD3E5` | `#E5EAF6` | `#CCD4E8` | `#B8C2DA` | `#2D3E7E` | `#4E5566` | `40 45 61` | 4.65 |

- **Steel** is the least distinct pad: its paper sits close to Blue-grey and Graphite-grey, and it is told apart mainly by its darker grey-blue print.
- **Graphite-grey** has an almost grey print (OKLCH chroma 0.014), so it meets the red-pen hue rule by being achromatic: red is the only colour on that pad.
- **Indigo ink** was chosen over Aubergine (too near the red, 70° away) and Malachite (too near Teal) for Engineering chemistry.

### Contrast requirements for any Course palette

The build checks every pad, catalogue or custom, against these, measured WCAG 2.x. A failing pair does not block the build: the build adjusts the pad colour in that pair (never the red pen, graphite or pencil) until it passes, and the build report lists every value it changed.

- `graphite`, `pencil`, `print`, `muted` and `red-pen` each at least 4.5:1 on `sheet` (reference: red-pen is the tightest, 4.73:1 ML, 4.56:1 circuits).
- Those same text roles at least 3:1 on `grid-major`, the worst pixel a glyph can sit on.
- `sheet` on `print` at least 4.5:1 (the Next button and selection).
- `grid-fine` and `grid-major` no more than about 1.5:1 on `sheet`.
- `sheet` lighter than `desk`.
- `red-pen` distinguishable from `print` by hue, not only lightness: red must still read as the correcting pen on that pad. Measured as an OKLCH hue gap of at least 60° from the red (hue 32°), or a near-grey print (chroma under 0.035).

### Named Rules

**The Red Pen Rule.** Red is the pen of whoever marks the sheet: circled results and the answer box, corrections and warnings, the high-yield ring on a contents line, the "you stopped here" margin note and its arrow, and marks drawn onto the table. It is always a stroke or text, never a fill, a button, a tint or a background.

**The Printed Ink Rule.** `print` is what came printed on the pad; graphite and pencil are what the student wrote. Content (values, answers, prose) is never set in `print`, and chrome (field labels, title-block rules, printed buttons) is never set in graphite.

**The Palette Slot Rule.** A Course changes slot values, never roles, never the count of colours. No Course adds a second accent, a gradient, or a dark variant.

**The Red Hue Rule.** Nothing drawn onto the sheet except the red pen sits within 60° of its OKLCH hue (32°). Framed tools keep their own meaning reds inside their frame; sheet figures, structures and plots do not. The build fails on a violation (ticket #25).

## Typography

**Display / Label Font:** Archivo, variable width, used condensed (with Arial Narrow, sans-serif)
**Body Font:** Atkinson Hyperlegible Next (with system-ui, sans-serif)
**Quantity Font:** Atkinson Hyperlegible Mono (with ui-monospace, monospace), tabular numerals

**Character:** Archivo at 75–87% width is the pad's printing: compact, engineered, clearly not handwriting. Atkinson Hyperlegible carries anything read at length, chosen for late-night legibility, and its mono twin sets every number so columns align like a hand-kept table.

### Hierarchy

- **Display** (Archivo 700, 42px, 0.95, 75% width): the Course name in the home title block only. 34px under 760px.
- **Headline** (Archivo 700, 25px, 1.1, 75% width, `print`): contents group headings.
- **Title** (Archivo 700, 21px, 1.2, 80% width, graphite): the current step's heading; the table caption uses the same voice at 20px.
- **Sheet title** (Archivo 650, 19px, 1.2, 87% width): the worked example's title inside its title block; 16–17px on phones.
- **Body** (Atkinson Next 400, 17px, 1.5): step notes (1.55), method notes, figure captions; max 68ch. Answers at 600 weight.
- **Body small** (Atkinson Next 400, 15px, 1.45): module summaries, legends, warnings (15.5px); max 70ch.
- **Label** (Archivo 600, 12px, 0.08em, uppercase, 80% width, `print`): the printed field name inside a title-block cell or a ruled box (COURSE, EXAM, STEP, GIVEN, ANSWER).
- **Action label** (Archivo 700, 15px, 0.08em, uppercase, 80% width): printed buttons, the back cell, phone tabs and the Given toggle (14px).
- **Quantity** (Atkinson Mono 400–500, 13–17px, tabular): table values (16px, 15px on phones, never under 14px), step numbers, counts, given data, plot tick labels.
- **Quantity large** (Atkinson Mono 500, 26px): the counts in the home title block; 19–21px in the worked title block.

### Named Rules

**The Three Hands Rule.** Printed form in condensed Archivo, prose in Atkinson Next, every quantity in Atkinson Mono with tabular numerals. A number in prose type, or a sentence in mono, is a bug.

**The Field Label Rule.** An uppercase tracked label only names a field, and it sits inside the ruled cell or box whose content it names. It is never a free-floating kicker above a heading.

**The Paper Math Rule.** Math renders as paper math (KaTeX-class): stacked fractions with a long bar, never raw `_` or `^`. Inline math sits at about 1.08em of the body size in graphite.

**The 12px Floor Rule.** Nothing renders under 12px on a phone; table values stay at 14px or above.

## Layout

The page is a **desk** with one **sheet** on it (max 1200px wide, centred, 24px desk margin). The sheet's grid is 20px fine and 100px major, offset -1px so rules land on pixel edges; figures are plotted on the same grid. Under 760px (home) and 900px (worked) the sheet goes full-bleed: no desk margin, no shadow, no radius.

**Title block.** Every page opens with a title block: a grid of cells separated by 1px `print` rules inside a 2px `print` border. Home: course cell (2.6fr) plus five count cells, the course cell spanning the full width on phones. Worked: back cell, topic, title (2.9fr), example code, step counter; on phones back / example / step on one row and the title below it, topic hidden.

**Home, the contents sheet.** A method-and-key notes block (2.3fr / 1fr, stacked on phones), then groups of modules as ruled lines. Each line is a grid: a **margin column** (216px, 184px under 1000px) where the red-pen resume note lives, a 44px sheet-number box, the module text, and four 72px count columns. A 1px `print` margin line runs down the contents at the margin column's edge. Under 760px the margin column collapses and counts wrap beneath the title with visible units.

**Worked, the solved sheet.** Title block, then a pencil-ruled box holding the statement and the given data, then three columns: steps margin (172px) | solving table with the step note below | figure (376px, sticky). At 900–1100px the columns tighten to 150px / 320px. Under 900px the margin becomes a step strip (numbered boxes flanked by Prev/Next), the Given box becomes a collapsible, and table and figure share one artefact region behind a Table | Plot toggle.

### Named Rules

**The Artefact Stays Rule.** While stepping, the solving artefact never scrolls away. At 1280×800 the table, figure, step text and Next are all visible with no scroll; at 390×844 the table (or plot), step text and Next are visible.

**The Nothing Covers the Figure Rule.** Labels, chips and notes sit beside or below a figure, never on it. A too-wide table scrolls inside its own box; the page never scrolls sideways at 320px.

**The Logical Direction Rule.** All spacing, borders and positions use logical properties (inline/block start/end); direction-bearing drawings (arrows, back chevrons) mirror in RTL, rules draw from the inline start, and arrow keys follow the document direction.

## Elevation & Depth

Flat inside the sheet. Depth exists at exactly one level: the sheet lying on the desk, shown by a three-layer shadow tinted with the pad's shadow hue (full values in the sidecar). Inside the sheet, hierarchy comes from ruling weight (2px title-block border, 1.5px printed boxes, 1.2px pencil boxes, 1px table rules) and from a faint `print` tint (8%) on hover.

### Shadow Vocabulary

- **Sheet on desk** (`box-shadow: 0 1px 1px rgb(shadow / 0.10), 0 5px 12px -3px rgb(shadow / 0.18), 0 26px 46px -22px rgb(shadow / 0.45)`): the sheet only, and only where the desk is visible.

### Named Rules

**The One Sheet Rule.** Only the sheet casts a shadow. Nothing inside the sheet lifts, floats or glows; a box is drawn with a rule, not raised with a shadow.

## Shapes

Square and ruled. Every box, cell, button, step box and answer frame has square corners (0px); the sheet itself has a barely-there 2px corner. Form language comes from line weights: `print` rules for printed structure, pencil rules for the student's working, red strokes for marks. The answer is a double red frame (1.5px border plus a 1.5px outline 3px outside), the way a result is boxed twice by hand. Hand-drawn marks (rings, arrows, ticks, correction strokes) are SVG paths with round caps and joins, 1.8–2.2px wide.

**The Ruled Corner Rule.** No rounded corners, pills or chips anywhere on the sheet.

## Components

### Printed Buttons

Printed onto the pad, not floating over it.

- **Shape:** square (0px), 1.5px `print` border, 42px min height (38px in the step-note controls, 40px square-ish on the phone strip).
- **Default:** `sheet` fill, `print` text in the action label voice.
- **Next:** `print` fill with `sheet` text; the one filled control on the sheet.
- **Hover / Focus:** default gains a 10% `print` tint; Next darkens (82% print with black). Focus is a 2px `print` outline, 2px offset. 150ms ease-out colour transitions.
- **Disabled:** 40% opacity, no hover.
- **Icons:** drawn stroke arrows (2px, round caps) in `currentColor`, mirrored in RTL.

### Title Block

- **Structure:** cells in a grid on a `print` ground so the 1px gaps read as ruled lines; 2px outer border.
- **Cell:** `sheet` fill, a field label at the top, the value at the bottom (pencil prose value 22px or mono quantity).
- **Back cell:** a title-block cell that is a link, printed arrow plus BACK label, tinted on hover.
- **Honesty cell:** where a page must declare something (a synthetic sample Course), a full-width cell hatched with 11% `print` diagonal lines carries the statement in printed type.

### Contents Line (home)

- A ruled grid row: 44px square sheet-number box (1.5px `print` border, condensed number), module title (Atkinson 600, 18px) and summary (muted), mono counts in right columns.
- A 1px pencil rule at 50% opacity underlines each line; the group head carries a 2px `print` rule.
- The whole line is one link target; hover tints the row 8% `print` and underlines the title. Focus outlines the row.
- **High yield:** a red-pen ring drawn around the sheet-number box.

### Red-Pen Margin Note

The resume pointer: "You stopped here: W10.1, step 4 of 8" in red, the location line in mono and underlined, with a hand-drawn arrow pointing at the line (sideways on desktop, curving down on phones). It lives in the margin column, never in the body of the sheet.

### Solving Table (signature)

- Mono, tabular, fixed layout, 29px rows, 1px pencil rules; header cells carry a printed label and a mono unit/value line.
- Rules can be inked as SVG so they draw themselves on first render; pre-filled columns sit in graphite, filled values in pencil.
- **Motion:** new values land in hand order (column by column, top to bottom), each fading in from 2px above over 260ms, staggered 24–34ms; red-pen marks then draw (520ms, in-out sine). Going back renders the state instantly. Any step renders directly from its state; interrupted motion completes rather than freezes.

### Steps Margin and Step Strip

- **Step box:** 24px square, 1.2px pencil border, mono number. Current: graphite fill, `sheet` number, bold. Done: a graphite tick drawn over the box's corner (300ms draw on advance).
- **Desktop:** a margin list of step boxes with their short titles, divided from the table by a 1px `print` margin line.
- **Phone:** a strip of step boxes (up to 32px wide, 34px tall) between icon-only Prev and Next buttons.
- **Keyboard:** left/right arrows step, following document direction; a step counter sits in the title block.

### Step Note, Correction, Answer

- **Note:** numbered square (26px, 1.5px graphite border) beside the step title, body text with paper math.
- **Correction:** red text with a drawn red correction mark and a bold "Correction." lead.
- **Answer:** the double red frame with an ANSWER field label and the answer in Atkinson 600, 17px.

### Figure

Plotted on the sheet's own grid with the same `grid-fine` / `grid-major` lines; pencil axes, mono tick labels, graphite points (filled for one class, open for the other), labels knocked out with a 4px `sheet` stroke so they never sit on a grid line. Sticky beside the table on desktop. Motion (centroids travelling, focus strokes drawing) is 500–950ms and skipped under reduced motion.

### Chemistry Figures (ticket #25)

- **2D structures:** graphite skeletal drawings with element letters, as a Professor writes them; no atom colours on the sheet (CPK H, S and Cl are 1.1–1.3:1 on a pad sheet, and CPK oxygen sits 3° from the red pen).
- **2D emphasis:** a pencil bracket with a pencil label names a group; when a worked step points at atoms, the red pen rings them, as it rings a result in the table. No fills or halos.
- **3D viewer:** standard Jmol CPK element colours on a transparent background (the sheet shows through), graphite/pencil labels and axes. An element key (dot + symbol, only the elements present) sits below the viewer, and tapping or hovering an atom shows its symbol. The red pen is never drawn inside the viewer.
- **Plots with several series** (species curves, isotherms, Pourbaix regions): graphite and pencil line styles and marker shapes, each series labelled at its line, regions named inside them; no categorical colours. Past about four series, split into small plots on a shared axis or let the student toggle series (hidden ones dim to pencil). This applies to chemistry only; other disciplines' multi-series colours are still open.
- **Build gate:** fail on any sheet-figure colour within 60° of the red pen's hue, on non-graphite atoms in a 2D structure SVG, and on a 3D palette that is not standard CPK.

### Phone Tabs and Given Toggle

- **Given toggle:** a collapsible summary row in the action label voice with a chevron that rotates 180° when open.
- **Table | Plot tabs:** printed tabs on a 1.5px pencil baseline; selected tab takes the `sheet` fill and graphite text.

## Do's and Don'ts

### Do:

- **Do** treat every Study site as the same pad; change only the Course palette slot values.
- **Do** check every Course palette against the contrast requirements in Colors on every build, auto-fixing the pad (never the red) and reporting each change.
- **Do** set every quantity in Atkinson Hyperlegible Mono with tabular numerals, and every printed label in condensed Archivo inside its own ruled cell.
- **Do** keep the solving artefact on screen while stepping, with Prev / Next buttons, arrow keys and a step counter.
- **Do** mark state with a drawn mark (tick, ring, arrow, frame), not only a colour change.
- **Do** draw motion as the pen would: rules along the writing direction, values in hand order, red marks last; transform, opacity and stroke-drawing only; instant under reduced motion.
- **Do** use logical properties everywhere and mirror direction-bearing drawings in RTL.

### Don't:

- **Don't** ship a dark mode or a dark palette; the pad is light only.
- **Don't** use red as a fill, a button, a background tint or decoration; red is the pen.
- **Don't** build the dark SaaS dashboard of cards, progress rings and indigo, or the cream-paper editorial serif notebook.
- **Don't** round corners, add pills or chips, or lift anything inside the sheet with a shadow.
- **Don't** put uppercase tracked labels above headings as kickers; a label names the field it sits in.
- **Don't** cover a figure with labels, chips or notes, or shrink a wide figure below legibility; scroll it inside its box.
- **Don't** render any text under 12px on a phone, or table values under 14px.
- **Don't** render math as raw `_` / `^` markup.
