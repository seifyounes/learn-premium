# Pneumatics circuit: A+ B+ B− A−, two-group cascade

PROTOTYPE (throwaway). The one circuit every pneumatics candidate shows, where the tool allows.

## Components

| Id | Part | Notes |
|---|---|---|
| 0Z | Air supply, 6 bar | |
| A (1A) | Double-acting cylinder | cap end ← 1V1 port 4, rod end ← 1V1 port 2 |
| B (2A) | Double-acting cylinder | cap end ← 2V1 port 4, rod end ← 2V1 port 2 |
| 1V1 | 5/2 double-pilot valve (memory) for A | pilot 14 → A+, pilot 12 → A− |
| 2V1 | 5/2 double-pilot valve (memory) for B | pilot 14 → B+, pilot 12 → B− |
| 0V1 | 5/2 double-pilot group-changeover valve | port 4 → line I, port 2 → line II; pilot 14 selects I, pilot 12 selects II |
| a0, a1 | 3/2 NC roller valves, spring return | made by A at its retracted / extended end |
| b0, b1 | 3/2 NC roller valves, spring return | made by B at its retracted / extended end |
| START | 3/2 NC push-button valve, spring return | in series after a0 |

## Why a cascade

Wired naively (a0·START → A+, a1 → B+, b1 → B−, b0 → A−) the sequence has two signal overlaps:

- **2V1** at step 3: a1 (A still out) holds pilot 14 while b1 asks for B−, so both pilots are live.
- **1V1** at step 1: b0 (B home) holds pilot 12 while START asks for A+.

Split the sequence where a letter repeats: **group I = A+ B+**, **group II = B− A−**. A 5/2 memory
valve (0V1) pressurises exactly one group line at a time, so a signal fed from the dead line can
never hold a pilot.

## Connections (by port)

| Line | Joins |
|---|---|
| P (supply) | 0Z → 1V1.1, 2V1.1, 0V1.1 |
| I | 0V1.4 → 1V1.14 (A+ directly), a1.1, b1.1 |
| II | 0V1.2 → 2V1.12 (B− directly), a0.1, b0.1 |
| a0 out | a0.2 → START.1 |
| START out | START.2 → 0V1.14 (select I) |
| a1 out | a1.2 → 2V1.14 (B+) |
| b1 out | b1.2 → 0V1.12 (select II) |
| b0 out | b0.2 → 1V1.12 (A−) |

Rest: 0V1 on II, 1V1 and 2V1 on 12, A and B retracted, a0 and b0 made. Line II holds 2V1.12 and
(through b0) 1V1.12, which keeps both cylinders home; a0 waits at START.

## Expected cycle (one START press)

| Step | Trigger | Group | Movement | After the step |
|---|---|---|---|---|
| 1 | START · a0 (line II) → 0V1.14 | II → I | A+ (line I → 1V1.14) | A out, a1 made |
| 2 | a1 (line I) → 2V1.14 | I | B+ | B out, b1 made |
| 3 | b1 (line I) → 0V1.12 | I → II | B− (line II → 2V1.12) | B home, b0 made |
| 4 | b0 (line II) → 1V1.12 | II | A− | A home, a0 made |
| 5 | (rest: waits for START) | II | | |

## Expected displacement-step diagram

Position at each step boundary (0 = retracted, 1 = extended):

| Step | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| A | 0 | 1 | 1 | 1 | 0 |
| B | 0 | 0 | 1 | 0 | 0 |

Read it as: A rises across step 1→2 and stays out until it falls across 4→5; B rises across
2→3 and falls straight back across 3→4.

No double-pilot valve may ever see both pilots pressurised at once. Holding START down repeats
the cycle; releasing it stops the machine at rest after step 4.
