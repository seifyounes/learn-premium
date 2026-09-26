# The machine every FSM candidate shows

PROTOTYPE (throwaway). A **Moore "101" sequence detector, overlapping**. One input X, one output Z,
clocked on the rising edge. Written once here; every candidate loads this machine. The answer key
the checks read is `expected.json` (the same numbers as below, typed by hand, not generated).

## States

| State | Meaning | Z |
|---|---|---|
| S0 | reset, nothing useful seen | 0 |
| S1 | seen `1` | 0 |
| S2 | seen `10` | 0 |
| S3 | seen `101` (detected) | 1 |

Overlap: from S3 an input `0` goes to S2 (the last `1` plus this `0` is `10`), and a `1` goes to S1.

## State table

| Present state | Next, X = 0 | Next, X = 1 | Z |
|---|---|---|---|
| S0 | S0 | S1 | 0 |
| S1 | S2 | S1 | 0 |
| S2 | S0 | S3 | 0 |
| S3 | S2 | S1 | 1 |

## Binary state assignment

Two D flip-flops, Q1 Q0: S0 = 00, S1 = 01, S2 = 10, S3 = 11.

## Encoded transition table and D excitation

A D flip-flop's excitation is D = Q⁺ (0→0 needs D=0, 0→1 needs 1, 1→0 needs 0, 1→1 needs 1).

| Q1 | Q0 | X | Q1⁺ | Q0⁺ | D1 | D0 | Z |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| 0 | 1 | 0 | 1 | 0 | 1 | 0 | 0 |
| 0 | 1 | 1 | 0 | 1 | 0 | 1 | 0 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 1 | 1 | 1 | 1 | 1 | 0 |
| 1 | 1 | 0 | 1 | 0 | 1 | 0 | 1 |
| 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 |

## Excitation equations (minimal sum of products)

- D1 = Q0·X' + Q1·Q0'·X   (minterms 2, 5, 6 of Q1 Q0 X)
- D0 = X                  (minterms 1, 3, 5, 7)
- Z  = Q1·Q0              (Moore: depends on the state only)

## Test sequence

Start in S0 (reset). X = 1 0 1 0 1 1 0 1, one value per clock period, sampled on the rising edge
at the end of that period.

| Clock period | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | after 8th edge |
|---|---|---|---|---|---|---|---|---|---|
| Present state | S0 | S1 | S2 | S3 | S2 | S3 | S1 | S2 | S3 |
| X | 1 | 0 | 1 | 0 | 1 | 1 | 0 | 1 | |
| Z (during the period) | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 1 |

Z after each clock edge 1…8: **0 0 1 0 1 0 0 1**. Three detections, ending at inputs 3, 5 and 8;
the one at input 5 reuses the `1` of input 3 (overlap).

**Moore one-clock lag.** Z rises only after the edge that samples the final `1`, and stays high for
that whole next period. The `1` present in period 3 shows up as Z = 1 in period 4. A Mealy detector
would raise Z during period 3 itself.
