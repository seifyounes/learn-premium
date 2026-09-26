# PLC program shown by every candidate: two-conveyor start sequence

Same program in all four candidates. Machine-readable copy with the answer key:
`program.json` (read by `check-pad-native-ladder.mjs`).

## I/O

| Tag | Address | Kind | Wiring / meaning |
|---|---|---|---|
| START | %I0.0 | input | START push button, **normally open**. Bit = 1 while pressed. |
| STOP | %I0.1 | input | STOP push button, **normally closed** (fail-safe). Bit = 1 while *not* pressed, 0 while pressed. |
| M1 | %Q0.0 | output | Conveyor 1 motor contactor |
| M2 | %Q0.1 | output | Conveyor 2 motor contactor |
| T1 | – | TON | On-delay timer, PT = T#5s (IEC 61131-3 semantics) |

## Ladder (IEC 61131-3 LD)

```
     START        STOP                          M1
|----| |----+-----| |---------------------------( )----|   Rung 1: seal-in
|           |                                          |
|     M1    |                                          |
|----| |----+                                          |
|                                                      |
|     M1         +-------+                      M2     |
|----| |---------|IN  TON|Q---------------------( )----|   Rung 2: timed start of M2
|                |  T1   |                             |
|        T#5s ---|PT   ET|--- (elapsed time)           |
|                +-------+                             |
```

Because STOP is wired NC, the rung uses a normally open contact on its input bit: the
bit is 1 at rest and drops to 0 when STOP is pressed (a broken wire also stops the line).

## Structured Text equivalent

```
M1 := (START OR M1) AND STOP;   (* STOP bit is 1 at rest: NC button *)
T1(IN := M1, PT := T#5s);
M2 := T1.Q;
```

## IEC TON semantics used

- IN false: Q = FALSE, ET = 0.
- IN rises: ET starts at 0 and counts up with elapsed time, capped at PT.
- Q = TRUE once ET = PT, and stays TRUE while IN stays TRUE.
- IN falls: Q = FALSE and ET = 0 in the same scan (non-retentive).

## Expected timeline (answer key)

Times are from the first START press. Scan = 10 ms; each check is read after the scan at that time.

| t | Action | START bit | STOP bit | M1 | T1.ET | T1.Q | M2 |
|---|---|---|---|---|---|---|---|
| 0.00 s | press START | 1 | 1 | **1** at once | 0.00 s | 0 | 0 |
| 1.00 s | release START | 0 | 1 | 1 (seal-in) | 1.00 s | 0 | 0 |
| 4.99 s | – | 0 | 1 | 1 | 4.99 s | 0 | 0 |
| 5.00 s | – | 0 | 1 | 1 | 5.00 s | **1** | **1** |
| 7.00 s | – | 0 | 1 | 1 | 5.00 s (capped) | 1 | 1 |
| 8.00 s | press STOP | 0 | 0 | **0** | **0.00 s** (reset) | 0 | **0** (same scan) |
| 8.50 s | release STOP | 0 | 1 | 0 (stays off) | 0.00 s | 0 | 0 |
| 9.00 s | press START and STOP together | 1 | 0 | 0 (STOP wins) | 0.00 s | 0 | 0 |
| 9.50 s | release both | 0 | 1 | 0 | 0.00 s | 0 | 0 |
| 10.00 s | press START again | 1 | 1 | 1 | 0.00 s | 0 | 0 |
| 10.20 s | release START | 0 | 1 | 1 | 0.20 s | 0 | 0 |
| 14.99 s | – | 0 | 1 | 1 | 4.99 s | 0 | 0 |
| 15.00 s | – | 0 | 1 | 1 | 5.00 s | 1 | 1 (timer really restarted from 0) |
