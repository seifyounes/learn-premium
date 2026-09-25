# Full adder: authoring notes

Source: `fixtures/full-adder.png` only (the answer key was not read).

## (a) Reading of the figure

| Gate | Type | Inputs | Output net |
|---|---|---|---|
| G1 | XOR (2-in) | A, B | `P` (G1 out) |
| G2 | AND (2-in) | A, B | `G` (G2 out) |
| G3 | XOR (2-in) | P, Cin | S |
| G4 | AND (2-in) | P, Cin | `T` (G4 out) |
| G5 | OR (2-in) | T, G | Cout |

Wiring as drawn:

- A: dot just after the label; one branch into G1's top input, one branch down the left rail
  into G2's top input.
- B: dot just after the label; one branch into G1's bottom input, one branch down the second
  rail into G2's bottom input. The A rail crosses the B line with no dot, so no connection.
- G1 output runs right to a dot. One branch goes into G3's top input; the other goes down into
  G4's top input.
- Cin runs along the top and then down a vertical. It crosses G1's output line with **no dot**
  (no connection), then hits a **dot** that feeds G3's bottom input, and carries on down into
  G4's bottom input. It also crosses the G1 to G4 branch with no dot.
- G4 output goes to G5's top input. G2 output runs right along the bottom (with a small jog)
  into G5's bottom input.
- G3 output is S. G5 output is Cout.

## (b) Boolean expressions

- P = A XOR B
- S = P XOR Cin = A XOR B XOR Cin
- Cout = (P AND Cin) OR (A AND B) = (A XOR B)·Cin + A·B (equivalently the majority A·B + A·Cin + B·Cin)

## (c) Expected truth table

| A | B | Cin | S | Cout |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 1 | 0 |
| 0 | 1 | 0 | 1 | 0 |
| 0 | 1 | 1 | 0 | 1 |
| 1 | 0 | 0 | 1 | 0 |
| 1 | 0 | 1 | 0 | 1 |
| 1 | 1 | 0 | 0 | 1 |
| 1 | 1 | 1 | 1 | 1 |

Self-checks run: `digitaljs.json` through DigitalJS `HeadlessCircuit`, and `circuitjs.txt`
through a script that joins coincident endpoints and evaluates the gates. Both matched this table
on all 8 rows. The CircuitJS file has not yet been loaded in a real CircuitJS instance.

## (d) Ambiguities in the drawing

- **G2's output wire runs along G4's bottom edge.** It touches or overlaps G4's body outline,
  and the "G4" label sits on top of it. I read it as passing under G4 to G5 with no connection,
  because a gate body is not a junction and there is no dot. This is the least certain spot.
- **Small jog in the G2 output line** just before G5 (about x=700). I read it as a cosmetic step
  with no connection.
- **Cin crosses G1's output** just before G3, with no dot. I read that as no connection; the dot
  a little lower is where Cin actually meets G3.
- Gate labels G4 and G5 sit below and overlap their bodies, so matching a label to its gate relies
  on how close they are. The pairing is unambiguous here.

## File-format choices

- **DigitalJS.** Device ids equal the net names (`A`, `B`, `Cin`, `S`, `Cout`), because
  `Circuit.setInput(name)` looks the cell up by id (`_graph.getCell(name)`). `net` and `label`
  carry the same name. Inputs are `Button` (port `out`), outputs are `Lamp` (port `in`), and gate
  inputs are `in1`/`in2`. There is no `position`, so the circuit auto-lays-out.
- **CircuitJS.** Gates are full size (flag 0), 128 px long, with input posts at y±16 and output at
  `x2 y2`. Every junction dot is a shared wire endpoint, and every no-dot crossing is laid out so
  that no endpoint falls on the other wire. Logic inputs use the label flag (4) to show A/B/Cin.
  Labeled nodes (`207`) named A, B, Cin, S and Cout sit on each I/O net, so
  `getNodeVoltage("S")` works.
