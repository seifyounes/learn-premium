# PROTOTYPE: live STL/SCL listings with build oracles (ticket #37)

Throwaway. Wayfinder ticket #37, *How does a Study site run the Professor's STL/SCL listings, and
what checks them?* It lets the Owner see the listings running on a Module page before he decides
where the interpreter lives: in the versioned Site template, or written per Course.

**Open `dist/stl-scl-live.html`** (double-click, no server). It is one self-contained file.

## Decisions honoured (Owner, 2026-09-29)

1. **STL.** Our interpreter (`stl.mjs`) runs in the page with a trace for every statement:
   ACCU 1/2, AR 1, the whole status word and every memory write. At build, **awlsim** runs the same
   listing and must agree **bit for bit**.
2. **SCL.** Our interpreter (`scl.mjs`) runs in the page. At build, the **blind** second
   interpreter (`blind/scl-blind.mjs`, written without seeing `scl.mjs`, never edited here) runs the
   same scans. The Siemens SCL manual referees any disagreement.
3. **One shared S7 core.** `s7core.mjs` sits under both engines. It holds:
   - byte-addressed, big-endian areas (I, Q, M, PI, PQ, DBn);
   - INT/DINT wrap with OV/OS;
   - float32 REAL (`Math.fround`);
   - FC105/FC106 from Siemens' formula, including the clamp and RET_VAL `W#16#0008`.
4. **Students tune inputs and step.** They never edit the code.
5. **Professor vs Siemens.** The engine always behaves like a real S7. On a ruled line, the trace
   shows the Professor's result as the **exam answer** (double red frame) and a **red-pen note**
   saying what a real S7 does. There are two rulings, both labelled **demo**
   (`listings/rulings.mjs`):
   - FC105 out of range: the Professor scales past HI_LIM; a real S7 clamps and returns RET_VAL 8.
   - INT overflow: the Professor says the PLC stops; a real S7 wraps and sets OV/OS.
6. **Open question, shown for the Owner: how REAL values are displayed.** A switch at the top
   picks between:
   - `57.3`: the shortest round-trip, like a watch table (the default);
   - `57.29999924`: ten digits of the stored float32.

   The SCL `fill_pct` shows why this matters: one pallet out of six gives `16.666668` (float32 dust).

**Pad: Blue-grey.** DESIGN.md maps control to Blue-grey, and automation is a control discipline.
Graphite-grey (logic circuits) was the alternative.

## Run

```
node check.mjs    # the Gate: writes gate-report.json, prints the table, exit 1 on any FAIL
node build.mjs    # inlines modules, listings and gate-report.json into dist/stl-scl-live.html
node qa.mjs       # real-browser pass: screenshots in shots/, console errors, sideways scroll, 12px floor
```

`check.mjs` needs Python 3 and an awlsim source checkout. Get one with
`git clone https://github.com/mbuesch/awlsim` and set `AWLSIM_DIR`. The default is the scratch clone
this prototype used. awlsim is GPL-2.0-or-later and is not vendored here.

If awlsim or the blind file is missing, that check is **NOT RUN**, which counts as FAIL.

## The listings (written for this prototype, no Professor text)

**`listings/tank.awl` (STL): a horizontal cylindrical tank.**
- PIW 256, plus a +200 INT zero offset (`+I`, so OV can latch).
- FC105 scales the level to metres.
- The circular-segment area uses `ACOS`, `SQR`, `SQRT` and `ABS`; the volume in litres is a REAL.
- A register-indirect `LOOP` (`LAR1`, `L MD [AR1,P#0.0]`, `+AR1`) counts the HMI set-points passed.
- `<>I` and `>=I` set latched alarms with `S`; `I 0.0` resets them with `R`; an `O` chain drives the
  common lamp.
- The last network is an **exam trap**: `A I 0.2`, then a compare. The compare writes RLO outright
  (manual §2.2), so the pump bit is discarded. That line is also what lets the gate catch the
  "compare ANDs into RLO" mutant.

**`listings/warehouse.scl` (SCL): a warehouse state machine FB.**
- `TYPE "Slot"`, and `DATA_BLOCK "Rack"` holding `ARRAY[1..2, 1..3] OF "Slot"`.
- `CASE` over IDLE / SEARCH / MOVE / STORE / ERROR.
- Nested `FOR` loops with `EXIT` find the first free slot.
- Rising-edge detection on the request, a MOVE watchdog, and `fill_pct` as a REAL.

## What the gate compared, and what it caught

| Check | Result | Compared |
|---|---|---|
| stl.mjs vs awlsim, bit for bit | PASS | 43 cases (20 raw levels incl. out of range × unipolar/bipolar, pump on/off, 3 multi-scan sequences), 56 scans, 6,088 statements. After every scan: MB 0–127, QB 0–15, ACCU 1/2, AR 1 and the status word. After every statement: ACCU 1/2, AR 1 and the status word. 32,304 patterns in all |
| scl.mjs vs blind | PASS | 5 scan sequences (happy path, held/repeated requests, full rack → ERROR → reset → ERROR, watchdog, stray reset), 91 scans, 2,002 values. REAL compared bit for bit |
| scl.mjs vs a hand-written state walk | PASS | the state after every scan in 3 sequences |
| rulings anchored | PASS | 2 rulings, both demo |
| **Negative control:** STL compare ANDs into RLO | caught | QB 4 differs (the exam-trap network) |
| **Negative control:** `+I` without 16-bit wrap or OV | caught | ACCU 1 differs after line 11 |
| **Negative control:** SCL REAL kept in float64 | caught | `fill_pct` 16#41855555 vs 16#41855556 |
| **Negative control:** SCL `EXIT` ignored | caught | index `Rack.slot[3,4]` out of range |

`gate-report.json` is tied to a SHA-256 over the checked sources (`sourcesSha`) as well as the git
base.

### What development found (all resolved; the manual or awlsim referee noted)

- **Block end.** The end of OB 1 sets STA = 1 and clears OS, OR and /FC (manual 10.2). My engine
  missed it at first. The manual backs awlsim; fixed.
- **Registers at OB 1 start.** awlsim clears ACCU 1/2, AR 1 and the status word each time OB 1
  starts. The manual is silent. The engine follows awlsim; this is unverified against a real CPU.
- **After a library CALL**, ACCU 1/2, RLO, CC 0/1, OV and BR hold whatever FC105 left there, and
  Siemens does not publish FC105's internals.
  - The trace shows these as "left by FC105" or `?` until the program overwrites them.
  - The gate masks them: 112 accumulator values plus those bits.
  - The awlsim side runs *our* STL FC105 (`oracle/fc105.awl`), written separately from the JS
    built-in. Two implementations of Siemens' formula agree; neither is Siemens' binary.
- **`*I`.** The spike kept a 16-bit result. The manual (7.5) stores a **32-bit** product in ACCU 1.
  Fixed in `stl.mjs`, but the tank listing does not use `*I`, so no gate covers it yet (a gate gap).
- **SCL float64 mutant.** A first version of this control went **uncaught**: assigning to a REAL
  re-rounds to float32, which hid the float64 intermediate.
  - The listing now computes `stored / 6.0 * 100.0` (two roundings).
  - The mutant also drops the operand rounding.
  - The lesson: a negative control has to exercise the defect it claims to detect.
- **SCL vs blind.** They agreed on the first run, with zero disagreements, so there is nothing to
  referee and no open item.

## What is faked or simplified

- **Rulings.** Both are demos. No real Owner ruling exists yet.
- **FC105.** The page's FC105 is our JS built-in. Real FC105 leftovers (accumulators, RLO, BR/ENO)
  are unknown, so they are shown as undefined.
- **Inputs.** The page reads its inputs when a scan starts. A real `L PIW` reads the module
  directly mid-scan.
- **VAR_TEMP.** It is zeroed every scan. On a real S7 its contents are undefined.
- **Placeholders.** The course and module names in the title block are placeholders.
- **Layout.**
  - At 1280×800, a ruling pushes the register table below the fold.
  - On phones, the sticky Step bar covers the bottom lines of the listing box, and the trace sits
    below the listing.
  - The listing box scrolls sideways for long comments.
- **Design detector.** It flags two things, both kept on purpose:
  - the pad's printed grid, which is the identity;
  - 13–14px mono quantities, which sit inside DESIGN.md's 13–17px quantity range.

## Lines of code

| Module | LOC |
|---|---|
| `s7core.mjs` (shared core, FC105/106, float display) | 134 |
| `stl.mjs` (STL interpreter + trace) | 226 |
| `scl.mjs` (SCL lexer, parser, tree-walker + trace) | 398 |
| `listings/rulings.mjs` | 35 |
| `check.mjs` (gate) | 247 |
| `oracle/awlsim_run.py` + `oracle/fc105.awl` | 65 + 69 |
| `app.mjs` (page shell) | 470 |
| `build.mjs` | 40 |
| `index.html` + `page.css` (+ `pad.css`, copied) | 76 + 248 |
| `blind/scl-blind.mjs` (blind oracle, not ours) | 884 |
