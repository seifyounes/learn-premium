# Running the Professor's STL and SCL listings live

Research for [Can an agent run the Professor's STL/SCL listings live, and what checks the interpreter?](https://github.com/seifyounes/learn-premium/issues/36)
(map [#1](https://github.com/seifyounes/learn-premium/issues/1)). Written 2026-09-29.
**Findings only. The Owner decides.**

**Question.** The Second pilot (Industrial Automation-1, EEP 356) wants the Professor's Siemens S7
STL and SCL listings from Lectures 9–10 to run live on the Study site. An Agent-built sim ships only
if its model can be recomputed independently at build; otherwise the figure gets a step-through.
This note covers three things:

1. Is there an open, embeddable engine for SCL and for STL, and how faithful is it to S7?
2. What could act as the build-time oracle for the Gate?
3. What subset do the L9–L10 listings use, and what would a minimal interpreter cost?

**Method.**

- **Materials.** Only the nine L9–L10 decks were extracted, to a temp folder outside the repo, then
  deleted. Slide text was read from the slide XML and code images were read by eye.
- **Engines.** Checked in source, licence files and Siemens manuals:
  - awlsim was run headless, both in CPython and in Pyodide under Node.
  - Two throwaway interpreters were written in scratch (not committed) to size the work.
- **Confidentiality.** Nothing below reproduces a listing. Constructs and mnemonics are named, and
  what a listing does is paraphrased.
- Anything not checked is marked **(unverified)**.

---

## 1. Key findings

1. **STL has one faithful open engine: [awlsim](https://github.com/mbuesch/awlsim)**
   (GPL-2.0-or-later, pure Python, S7-300/400 STL).
   - **It runs headless.** `awlsim-test` returns exit 30 on a failed `__ASSERT==` and exit 0 on
     success.
   - **It also runs unmodified inside Pyodide in Node** (about 3 s cold start, 35 ms per later run).
   - **Its semantics match the Siemens STL manual** on INT wrap with OV/OS, `ITD`/`DTR`,
     `RND` ties-to-even, `TRUNC`, float32 REAL and compare RLO.
   - **Gaps:**
     - no SCL front end;
     - no TI-S7 library, so no FC105/FC106;
     - S5 timers run on the wall clock.
2. **No open engine is faithful to Siemens SCL.**
   - Every Structured Text engine found speaks IEC or CODESYS dialect.
   - Most get Siemens details wrong: float64 instead of float32 REAL, truncating instead of
     rounding `REAL_TO_INT`, or no 16-bit INT wrap.
   - The closest in dialect, TIA-SIM, has no licence.
3. **PLCSIM is ground truth but not a build gate.**
   - It is Windows-only and licensed.
   - Its API has no compile or download call, so a program still needs STEP 7 or TIA Portal to
     get in.
   - PLCSIM Advanced simulates S7-1500 only. The Professor's S7-300 listings need S7-PLCSIM V5.4,
     which has a GUI plus a COM interface and still needs STEP 7 V5.x to download.
4. **The L9–L10 subset is small.**
   - **STL:** about 30 mnemonics (load/transfer, INT/DINT/REAL math, `ITD`/`DTR`, REAL functions,
     compares, bit logic, one jump kind, one register-indirect loop) and **no timers**.
   - **SCL:** FC/FB, arrays up to 3-D, STRUCT/UDT, IF/CASE/FOR/WHILE/REPEAT/EXIT, `SQRT`/`SQR`/`EXP`,
     one conversion.
   - FC105 appears only as a LAD box call.
5. **A minimal interpreter is cheap. The spikes:**
   - an STL interpreter of **124 lines** that covers every STL mnemonic in the listings;
   - an SCL interpreter of **266 lines** that parsed and ran the Professor's warehouse and
     neural-network blocks **unchanged**.
6. **The oracle already earned its keep in the spike.**
   - awlsim matched the spike **bit for bit** on a horizontal-cylinder volume program.
   - It also **caught a real bug**: the spike combined a compare with the open logic string, while
     the Siemens manual and awlsim set RLO to the compare result outright.
   - A blind second implementation plus a faithful reference finds exactly this kind of error.
7. **Some of the Professor's stated results disagree with Siemens' own definitions.** A Gate should
   send each of these to a Checkpoint, not settle it silently:
   - one FC105 example value;
   - "no SQR in STL";
   - "FC105 scales past HI_LIM";
   - "INT overflow crashes the PLC".

   Section 4 gives the detail.

---

## 2. Existing engines

### STL (Instruction List plus the S7 accumulator and status-word model)

| Engine | Licence | Runs in | S7 faithfulness | Maintenance |
|---|---|---|---|---|
| **[awlsim](https://github.com/mbuesch/awlsim)** | GPL-2.0-or-later ([README](https://github.com/mbuesch/awlsim/blob/master/README.md)); GitHub reports "NOASSERTION" | CPython CLI (`awlsim-test`); **Pyodide in Node, verified**, so the browser is plausible (about 10 MB+ runtime) | **High.** 2- or 4-accumulator CPUs, full status word, full jump set incl. `LOOP`/`JL`, AR1/AR2, `CALL`/`BE`, and all five S5 timers with S5TIME. Also INT/DINT/REAL math, `ITD`/`DTR`/`RND`/`RND+`/`RND-`/`TRUNC`, `SQR`/`SQRT`/`EXP`/`LN`/trig. Stated gaps in [COMPATIBILITY.md](https://github.com/mbuesch/awlsim/blob/master/COMPATIBILITY.md): no MC7, some SFC/SFB missing, UC/CC with parameters, undefined behaviour not emulated. **No FC105/FC106.** Timers read the real monotonic clock (no virtual clock) | 74★, pushed 2026-06-18; last tag 0.77.1 (2024-04) |
| [plc-academy `stl.js`](https://github.com/Prizm-Technical-Services/plc-academy/blob/main/js/core/stl.js) | MIT | Browser JS | **Low.** ACCU1/2 but no status word, no INT wrap, no OV/OS, no `ITD`/`DTR`/REAL, only SD/SF timers in ms | 0★, one push 2026-08 |
| [mat2-sps-simulator](https://github.com/pmquang87/mat2-sps-simulator) | **No licence** | Browser TS | S7-300 AWL for a university course: timers, counters, jumps, **no REAL math** | 0★, 2026-07 |

Nothing else of substance turned up (GitHub searches for AWL/STL simulators). npm has no STL runtime.

**Siemens reference for semantics:** [STL for S7-300 and S7-400, 04/2017](https://cache.industry.siemens.com/dl/files/814/109751814/att_933093/v1/STEP_7_-_Statement_List_for_S7-300_and_S7-400.pdf).

- `ITD` sign-extends and `DTR` converts to IEEE 32-bit, rounding if needed.
- `RND` rounds halves to even.
- `+I` keeps the 16-bit result and sets OV/OS.
- A compare writes RLO, sets /FC = 1 and OR = 0 (§2.2, p.40).

### SCL (≈ IEC 61131-3 Structured Text, Siemens dialect)

| Engine | Licence | Runs in | Siemens-SCL faithfulness | Maintenance |
|---|---|---|---|---|
| [STruC++](https://github.com/Autonomy-Logic/STruCpp) | GPL-3.0 + runtime exception | Compiler in TypeScript (Node/browser), but **running needs g++** (`--test`); no WASM | IEC ed.3 + CODESYS. REAL = C++ `float`, INT = `int16_t` (good). `REAL_TO_INT` uses `std::round`, which rounds ties away from zero (Siemens rounds). No `#`/quoted-name/`VAR_STATIC` syntax. Its IL front end is **IEC IL**, not S7 STL | 78★, pushed 2026-09-28 |
| [matiec](https://github.com/beremiz/matiec) | GPL-3.0 | Native ST/IL → C translator + C compiler | IEC 2nd-edition draft; no Siemens syntax | 106★, pushed 2026-09-22 (OpenPLC forks archived) |
| [RuSTy](https://github.com/PLC-lang/rusty) | LGPL-3.0 | Native (Rust + LLVM); wasm32 target undocumented (unverified) | IEC; no IL/STL | 363★, v1.0.5 (2026-09) |
| [rk](https://github.com/adclz/rk) | AGPL-3.0 (generated modules exempt) | Native CLI that **emits .wasm** for browser/Node | IEC; integers wrap silently; libm EXP/LN | 0★, created 2026-09-14 |
| [cdilga/ladder-logic-editor](https://github.com/cdilga/ladder-logic-editor) | MIT | TypeScript interpreter, browser + Node | Good coverage (FUNCTION_BLOCK, STRUCT, multi-dim ARRAY, all loops, EXP/LN/SQRT, IEC timers). But **REAL is a JS double**, `REAL_TO_INT` **truncates** (its own tests), and there is **no INT wrap** | 17★, pushed 2026-04-10 |
| [plc-academy `scl.js`](https://github.com/Prizm-Technical-Services/plc-academy) | MIT | Browser JS | Accepts `#x` and `"x"`; **no ARRAY, STRUCT, FUNCTION, EXP**; untyped doubles | 0★ |
| [TIA-SIM](https://github.com/kasi09/TIA-SIM) | **No licence** | Python tree-walker | Closest dialect (REGION, `#`, FB/FC/DB, UDT, TON, Openness XML import); float32 memory; ties-to-even rounding. Pyodide untested | 1★, 2026-02 |
| esstee, st2cc, iec-checker, 4diac FORTE, Beremiz, CODESYS | GPL / LGPL / EPL / proprietary | Native or analyser only | Not SCL; not usable as an embeddable runtime | – |

**Siemens reference:** [S7-SCL V5.3 for S7-300/400](https://cache.industry.siemens.com/dl/files/793/5581793/att_66783/v1/SCL_e.pdf).

- `REAL_TO_INT` rounds (p.14-4).
- `ROUND` goes to even; `TRUNC` truncates (p.14-6).
- `SQR`, `SQRT` and `EXP` are in §14.2.

**FC105 SCALE** is a TI-S7 library block, not in the system-functions manual. Siemens' application
example [23330722](https://cache.industry.siemens.com/dl/files/722/23330722/att_114700/v1/scaling_and_unscaling_analog_values.pdf)
gives:

- `OUT = ((IN − K1)/(K2 − K1)) × (HI_LIM − LO_LIM) + LO_LIM`, with K1 = 0 or −27648 and
  K2 = 27648.
- **IN outside K1..K2 clamps OUT** to the nearer limit and returns RET_VAL `W#16#0008`.

Every engine would need FC105/FC106 written as a built-in; that is about 15 lines.

---

## 3. What the L9–L10 listings actually use

Nine decks: five in Lecture 9, four in Lecture 10.

- About 90 slides carry code, but many are progressive builds of one listing. That leaves roughly
  12 distinct STL fragments and 8 SCL blocks.
- The SCL guide deck and most of the tank-volume STL are images.
- The digit-entry and tank-input parts use **LAD** up/down counters, which fall under the ladder
  engine from [#23](https://github.com/seifyounes/learn-premium/issues/23), not an STL interpreter.

### STL

| Group | Mnemonics seen |
|---|---|
| Load/transfer | `L`, `T`: M bits/words/dwords, `I`, `Q`, `PIW`, `#` locals, INT, REAL and exponent constants |
| INT/DINT math | `+I`, `-I`, `*I`, `*D` |
| REAL math | `+R`, `-R`, `*R`, `/R`, `ABS`, `SQR`, `SQRT`, `LN`, `ACOS` (SIN/EXP only named in passing) |
| Conversion | `ITD`, `DTR` only. **No `RND`, `TRUNC`, `RND+`/`RND-`** |
| Compare | `>I`, `>R`, `<R`, `>=R`, `<=R` |
| Bit logic | `A`, `AN`, `O`, `=`, `S` (latched error flags) |
| Jumps | `JCN`, labels, `NOP 0` (`JU` named in text only) |
| Indirect | `LAR1 P##array`, `L W [AR1,P#0.0]`, `+AR1 P#2.0`, `LOOP` (one array-sum listing) |
| Library | FC105 called as a **LAD** box (IN, HI_LIM, LO_LIM, BIPOLAR, RET_VAL, OUT); FC106 named only |

**Not used in L9–L10:**

- S5 or IEC timers, and STL counters (timers are Lecture 6);
- `CALL`, `OPN DB`, nesting `A(`…`)`, status-word reads.

**The memory model must be byte-addressed**, not a symbol table:

- The listings use absolute addresses (`MW10`, `MD104`, `PIW300`).
- One variant reuses `MW50` inside `MD50`.
- The array loop steps a byte pointer.

### SCL

- **Blocks:** `FUNCTION name : INT` (returns by assigning the name), `FUNCTION_BLOCK` with instance
  statics, `TYPE … STRUCT` (a UDT), and a `DATA_BLOCK` holding a 3-D `ARRAY` of that UDT.
- **Sections:** `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT` (an array sorted in place), `VAR_TEMP`,
  `VAR`, `VAR_STATIC`, `CONST`.
- **Types:**
  - BOOL, BYTE, INT, DINT, REAL, WORD and TIME;
  - `ARRAY` in 1, 2 and 3 dimensions, and arrays of STRUCT;
  - initialisers, including a nested-bracket form for a 2-D REAL array (whether STEP 7 accepts that
    form is unverified);
  - a `TON` declared but never called.
- **Statements:** `:=`, `IF/ELSIF/ELSE`, `CASE` with values, ranges and `ELSE`,
  `FOR … BY -1`, `WHILE`, `REPEAT … UNTIL`, and `EXIT` out of three nested `FOR`s.
- **Functions:** `SQRT`, `SQR`, `EXP` (a sigmoid), `INT_TO_REAL` and one user FC.
- **Syntax:** `#` prefix, quoted block names, `TITLE =`.
- **The two showcase programs are small:**
  - **Warehouse:** a 4-state machine over repeated scans. Its slot search hits a hard-coded mock
    slot, not the DB.
  - **Neural network:** a 5-3-1 feed-forward net with fixed weights.

### Spikes (scratch only, not committed)

- **STL: 124 lines of JS.** It models:
  - a 2-accumulator S7-300 with byte-addressed big-endian areas;
  - float32 REAL via `Math.fround`;
  - 16-bit INT wrap with OV/OS;
  - RLO and /FC, jumps, `LOOP` and AR1 indirect access.

  Eight of my own test programs passed. They use the listings' instruction kinds, not the listings
  themselves.
- **SCL: 266 lines of JS**: lexer, recursive-descent parser and tree-walker, with INT/DINT wrap and
  float32 REAL. It parsed and ran the Professor's warehouse and neural-network FBs unchanged.
  - The net's float32 output matched a float64 recompute to 3e-8.
  - The warehouse FB takes three scans to report its slot, which a page can show scan by scan.
- **awlsim cross-check.** My horizontal-cylinder volume program gave the **identical 32-bit
  pattern** in the spike and in awlsim. A compare placed after an open `A` diverged: the spike
  ANDed it in, while awlsim and the manual overwrite RLO.
- **float32 shows through.** Digits 5, 7, 3 entered as 10X + Y + 0.1Z give 57.29999923…, not
  57.3. A float64 recompute needs a tolerance, and a page that shows raw values shows float32
  digits.

### Rough cost of a minimal interpreter (production TypeScript, both Node and browser)

| Piece | LOC (est.) | Agent-hours (est.) | Reasoning |
|---|---|---|---|
| STL core for the L9–L10 subset + FC105/FC106 built-ins | 500–800 | 4–8 | The spike is 124 dense lines. Production adds types, line-numbered errors, and a per-statement trace (ACCU1/2, RLO, /FC, OV/OS, CC, AR1) for the step-through view: roughly 4–6×. |
| + S5 timers with a virtual clock, `CALL` with parameters (for later lectures) | +250–400 | +3–6 | Not needed for L9–L10 |
| SCL core for the L10 subset | 900–1,400 | 8–16 | The spike is 266 lines. Production adds Siemens type rules (implicit-conversion errors), FB instances across scans, the trace, and error positions |
| Oracle harness (awlsim at build, assertion generation from the model's `expect`) | 150–300 | 3–6 | awlsim already exits 30 or 0 on `__ASSERT==`; the gate writes those lines |
| Tests + negative controls (broken listings the gate must catch) | 400–700 | 4–8 | One per mnemonic group and per SCL construct; the spike's compare bug is a ready negative control |

**Total for L9–L10:** about 2,000–3,200 LOC and **20–40 agent-hours**. The spikes took about 1.5
agent-hours for both, which suggests the core semantics are not the hard part. The Siemens edge
cases and the per-statement trace are.

---

## 4. Candidate oracles for the Gate

| Oracle | STL | SCL | Gaps |
|---|---|---|---|
| **(a) Second interpreter written blind** | Works; the spike shows it finds real divergences. But two blind implementations can share a misreading of the manual | **The only faithful-dialect option.** Needs a tie-break when the two disagree | Disagreements need a referee: the Siemens manual, and awlsim for STL; otherwise a Checkpoint |
| **(b) Open engine run at build** | **awlsim**, faithful, headless, exit-code gate (CLI or Pyodide) | **STruC++ `--test`** after a small dialect rewrite (`#`, quoted names, `VAR_STATIC`); REAL is float32. Needs g++ in the build; its rounding differs from Siemens, though no L10 SCL listing uses `REAL_TO_INT`. Compiling the L10 listings is **unverified** | awlsim: no SCL, no FC105, wall-clock timers. STruC++: dialect gap, native toolchain |
| **(c) The Professor's stated results** | A handful: SQRT/LN/ACOS single values, ITD/DTR of one number, one scaling example, one FC105 pitfall | The warehouse mock slot. **No stated outputs** for the neural net or the sort | Too sparse to be the oracle. **Some disagree with Siemens** (below), so they are Checkpoint input, not truth |
| **(d) PLCSIM / PLCSIM Advanced** | S7-300 needs **S7-PLCSIM V5.4** ([readme](https://cache.industry.siemens.com/dl/files/845/109748845/att_962483/v1/S7-PLCSIM_v548_Readme_enUS.pdf)): Windows 7–10, GUI, S7ProSim COM, and download needs STEP 7 V5.x | **PLCSIM Advanced** ([function manual 11/2022](https://cache.industry.siemens.com/dl/files/110/109813110/att_1119149/v1/s7-plcsim_advanced_function_manual_en-US_en-US.pdf)) is S7-1500 only, Windows only, 21-day trial, then licence. Its [API](https://cache.industry.siemens.com/dl/files/197/109826197/att_1161231/v1/s7-plcsim_advanced_function_manual_API_en-US.pdf) has power-on, run-to-sync-point and memory-card archive restore, but **no compile or download**. That needs TIA Portal + Openness | Not a build gate: Windows, licences, TIA/STEP 7 install. Classic STL on S7-1500 runs with differences ([FAQ 67655405](https://cache.industry.siemens.com/dl/files/405/67655405/att_859209/v1/67655405_STEP7_Migration_von_AWL-Programmen_nach_S7-1500_en.pdf)). The Materials include a SIMATIC Manager install guide, so an Owner-run manual check is conceivable |

**Where the Professor's statements differ from Siemens' definitions** (paraphrased):

- **FC105 pitfall value.** An FC105 example gives a wrong value for a unipolar signal scaled as
  bipolar. The slide's own formula gives **+50.0**, not the stated figure.
- **Out-of-range IN.** A best-practice slide says IN beyond range scales past HI_LIM. Siemens' FC105
  **clamps** to the limit and returns `W#16#0008`. A hand-written board note on the FC105 slides
  shows the RET_VAL word as 8, so the Professor may cover this in lecture.
- **SQR.** The 10-2 deck says STL has no SQR instruction, yet the same deck's listing uses `SQR`,
  and the Siemens manual lists it.
- **INT overflow.** The SCL guide says INT overflow crashes the PLC. On S7 it wraps and sets OV/OS
  (in SCL, the OK flag).
- **Negative inputs.** Its squaring FC guards only the upper bound, so −200 wraps to −25536. The sort
  example sends negative values to `SQRT`, which gives an invalid REAL on S7 and NaN in JS.

---

## 5. Options

These are options, not decisions.

| Area | Options |
|---|---|
| **STL on the page** | (a) Agent-built TS interpreter with a per-statement trace (accumulators, RLO, status bits); awlsim as the build oracle. (b) awlsim itself in the page via Pyodide (faithful for free; heavy, ~3 s cold, GPL-2+). (c) Step-through only, with values precomputed at build by awlsim |
| **SCL on the page** | (a) Agent-built TS interpreter, plus a second one written blind as the oracle, with the Siemens manual as referee. (b) The same, plus STruC++ at build as a third voice after a dialect rewrite. (c) Step-through only for SCL (values from a build-time run). (d) Start from cdilga's MIT interpreter and fix float32, rounding and INT wrap |
| **FC105/FC106** | Built-in written from the Siemens formula, including the clamp and RET_VAL 8 |
| **Disagreements with the Professor** | Gate raises a Checkpoint for each case in section 4, and the Owner decides how the page presents it |
| **PLCSIM** | Not a build gate in any option; possibly a one-off Owner-run check on Windows if STEP 7 V5.x is installed for the Course |

## 6. Not verified

- Whether STruC++ compiles the L10 SCL listings after a dialect rewrite, and whether a wasm32 RuSTy
  build works.
- Whether STEP 7 accepts the nested-bracket 2-D array initialiser and `VAR_STATIC` as written.
- Whether awlsim's timers can be driven by a virtual clock (by patching its monotonic clock).
- The Openness licence needed for a headless TIA download; PLCSIM V18 licensing.
- FC106 rounding mode. The Standard Functions Part 2 manual was found only on third-party mirrors.
- Snap7's licence (it is a communication library, not a simulator).
