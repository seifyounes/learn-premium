# Buck converter (lecture Example 2): authoring notes

Source: `fixtures/materials/buck-fig.png` (slide "4. Buck Converter") and the Example 2 statement:
Vs = 50 V, D = 0.4, L = 400 µH, C = 100 µF, f = 20 kHz, R = 20 Ω.

## (a) Reading of the figure

Named nodes: `vs` (source + / switch input), `sw` (switch output, diode cathode, inductor input),
`vo` (output), `0` (bottom return rail). The figure draws no ground symbol; the bottom rail is
taken as the reference.

| Part | Figure label | Connects | Notes |
| --- | --- | --- | --- |
| DC source | Vs | `vs` (+) to `0` (−) | + at the top, per the polarity marks |
| Switch | S | `vs` to `sw` | Ideal switch. The timing inset shows on for DT, off until T, starting "on" |
| Diode | D | anode `0`, cathode `sw` | Triangle points up to the bar, so the cathode is at the top |
| Inductor | L | `sw` to `vo` | iL flows to the right; VL is drawn as + on the right (vo side) |
| Capacitor | C | `vo` to `0` | iC shown flowing down |
| Resistor | R | `vo` to `0` | io flows right into R; Vo is measured across R, + at top |

Not in the figure, added for the simulators: `gate` node and gate source VG (`gate` to `0`) that
drives S.

## (b) Assumptions

- **Switch.** ngspice: voltage-controlled `S` element, Ron = 1 mΩ, Roff = 100 MΩ, Vt = 2.5 V, no
  hysteresis. CircuitJS: analog switch (type 159), r_on = 0.01 Ω, r_off = 1e8 Ω, threshold 2.5 V.
  The switch closes whenever the gate is at 5 V, so the gate is ground-referenced even though S is
  high-side. That is a simulation idealisation; a real high-side switch needs a floating or
  bootstrapped driver.
- **Why an analog switch in CircuitJS** and not a MOSFET or a square source on the diode node: the
  figure shows a plain two-terminal switch S in series with Vs. The analog switch keeps Vs, S and D
  as separate parts, so the student can see the diode take over during the off-time. A square
  source on `sw` would remove both S and D. An NMOS would need a floating gate drive above 50 V and
  adds a body diode and a threshold that are not in the figure.
- **Gate drive.** 0/5 V square, 20 kHz, duty 0.4, high at t = 0 (so the first interval is "on").
  ngspice: `PULSE(0 5 0 10n 10n 19.99u 50u)`, on for 20 µs out of 50 µs. CircuitJS: square wave,
  bias 2.5 V, amplitude 2.5 V, duty 0.4.
- **Diode.** Both files use the same junction: Is = 1.714e-7 A, N = 2 (CircuitJS's built-in
  "default" model, copied into the ngspice `.model`). No series resistance, junction capacitance or
  reverse recovery. About 0.73 V at 0.2 A and 0.83 V at 1.7 A.
- **Passives.** Ideal: no inductor DCR, no capacitor ESR, no core saturation. All start at zero
  (no initial current or voltage).
- **Timing.** ngspice `.tran 0.2u 40m 0 0.2u`. CircuitJS time step 0.1 µs (500 steps per period),
  fixed step. The switch edges land on step boundaries, so each edge can be up to one step late.
- **Start-up.** L and C are lightly damped (ζ = (1/2R)·√(L/C) = 0.05, f0 = 1/(2π√(LC)) ≈ 796 Hz).
  Expect a large overshoot, up to about 1.8× the final Vo, that settles with τ = 2RC = 4 ms. Read
  steady-state values after about 25 ms, e.g. over 38–40 ms.
- **CircuitJS scopes.** Scope 1: voltage on R (= Vo) with average shown. Scope 2: current in L
  (= iL) with max, min and average shown. Both at speed 4 (about 5 periods across a typical scope
  width). Labeled nodes `vs`, `sw`, `vo` are added only as markers; they attach at wire ends that
  already exist.

## (c) Expected steady-state values

### Ideal textbook analysis (ideal switch and diode, CCM)

| Quantity | Formula | Value |
| --- | --- | --- |
| Vo (average) | D·Vs | **20 V** |
| IL (average) = Io | Vo / R | **1.0 A** |
| ΔiL (p-p) | (Vs − Vo)·D / (L·f) | 30·0.4 / (400e-6·20e3) = **1.5 A** |
| Imax | IL + ΔiL/2 | **1.75 A** |
| Imin | IL − ΔiL/2 | **0.25 A** (> 0, so CCM holds) |
| Lmin for CCM | (1 − D)·R / (2f) | 300 µH (L = 400 µH is above it) |
| ΔVo (p-p) | Vo·(1 − D) / (8·L·C·f²) = ΔiL / (8·C·f) | **93.75 mV** (ΔVo/Vo = 0.47 %) |

### With the simulated diode drop

During the off-time sw sits at −VD instead of 0, so Vo ≈ D·Vs − (1 − D)·VD. Averaging the diode
equation over the off-time current ramp (0.21 A to 1.74 A) gives VD ≈ 0.80 V. The switch drop
(1 mΩ × about 1 A) is negligible.

| Quantity | Expected in simulation |
| --- | --- |
| Vo (average) | ≈ 20 − 0.6·0.80 ≈ **19.5 V** (about 0.48 V below ideal) |
| IL (average) | ≈ **0.976 A** |
| ΔiL (p-p) | (50 − 19.52)·20 µs / 400 µH ≈ **1.52 A** (slightly larger, because Vs − Vo is larger) |
| Imax / Imin | ≈ **1.74 A / 0.21 A** |
| ΔVo (p-p) | ≈ 1.52 / (8·100e-6·20e3) ≈ **95 mV** |

Rule of thumb: every 1 V of diode drop lowers Vo by (1 − D) = 0.6 V. The ripple values barely move.
A Schottky diode (about 0.4 V) would give Vo ≈ 19.76 V. If the simulated Vo is within about
±0.1 V of 19.5 V and the iL peaks are within about ±0.05 A of the values above, the circuit
matches the figure.
