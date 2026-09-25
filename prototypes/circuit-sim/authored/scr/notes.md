# SCR half-wave controlled rectifier (R load): authoring notes

Source: lecture slide "2. Single-phase Half-wave Controlled Rectifier, a) Resistive Load" (circuit
at top right) and Example 5: 120 V rms, 60 Hz, R = 10 Ω, α = 60°.

## (a) Reading of the figure

One series loop, no other branches.

| Component | From node | To node | Notes |
| --- | --- | --- | --- |
| AC source `vs` | `vs` (+, top) | `0` (−, bottom) | Sinusoid, + at top per the figure's polarity marks |
| Thyristor T (SCR) | `vs` (anode, left) | `vo` (cathode, right) | Arrow points left to right, same as `io`; gate drawn at the cathode end. `vT` is anode minus cathode (+ on left) |
| Resistor `R` | `vo` (+, top) | `0` (−, bottom) | Output `vo` is taken across R |
| Gate drive (not drawn) | gate | cathode `vo` | Added to fire the SCR at α; the slide only says the pulse is delayed by α from the start of the + half-cycle |

Current `io` = thyristor current `iT` = load current, flowing vs → T → R → back to the source.

File node names: ngspice uses `vs`, `vo`, `0` (+ internal `a1`, `a2`, `gp`, `cr`, `ctl`, `pout`).
CircuitJS: source at x = 176 (+ at y = 176), SCR anode (240,176) to cathode (304,176) with the gate
post at (304,144), R from (400,176) to (400,336), ground at (176,336).

## (b) Assumptions

- **Source:** vs = Vm sin(ωt), Vm = 120√2 = 169.71 V, zero phase, so the + half-cycle starts at t = 0.
- **Firing:** α = 60° after each + zero crossing, i.e. t = α/(360·f) = 2.778 ms, repeating every
  16.667 ms.
- **ngspice thyristor:** no XSPICE and no built-in SCR, so it is a hysteretic switch (`SW`, VT 0.5 V,
  VH 0.1 V, Ron 1 mΩ, Roff 1 GΩ) in series with a diode and a 0 V ammeter. The switch control is
  `u(v(gate) − 2.5) + u(iT − 10 mA)` through a 1 µs RC. That makes it a real latch: it turns on
  only when gated (and the diode only conducts when vT > 0), stays on after the 0.5 ms gate pulse ends
  while iT is above the 10 mA holding current, and turns off when iT falls to about 0 at ωt = π.
  Why a latch instead of a long gate pulse: it copies the slide's turn-on/turn-off rule, and it
  stays correct if the load later becomes R-L (conduction past π), where a fixed-width pulse would
  give the wrong answer. The RC breaks the algebraic loop (iT → control → switch → iT). The
  hysteresis makes the latch state unambiguous.
- **ngspice forward drop:** near-ideal diode (IS 1 nA, N 0.1, RS 1 mΩ), about 0.06 V at 15 A, so
  the results should match the ideal textbook values to within about 0.1%. A commented line in the
  file swaps in a realistic ~1 V model.
- **ngspice gate reference:** the gate pulse is a control signal referenced to ground. This is
  valid because it only drives the behavioural switch. A real gate drive is referenced to the
  cathode, as it is in the CircuitJS file.
- **CircuitJS SCR:** the built-in element (dump type 177) with the defaults: trigger current 10 mA,
  holding current 8.2 mA, gate resistance 50 Ω. Its internal diode uses the default diode model, so
  expect a forward drop of about 0.7–0.9 V at 10–15 A (plus 0.0105 Ω on-resistance). CircuitJS
  results should therefore sit slightly below the ideal values, as in the table below.
- **CircuitJS gate pulse:** a floating pulse source from the cathode (−) to the gate (+), 5 V,
  60 Hz, 10% duty (36°). Phase is 5π/3 rad (= −60°) so the pulse rises at ωt = 60° and stays high to
  96°. That is 100 mA of gate current through 50 Ω, well above the 10 mA trigger. A phase of −π/3
  was avoided because Java `%` keeps the sign, which would make the pulse high over 0 ≤ ωt < 60°.
- **Grid:** the `$` flags leave "small grid" off, so gridSize = 16. The SCR is 64 px long, which puts
  its gate post exactly at (x2, y − 32) = (304,144). The wire from the gate source ends there.
- **Scopes:** `vo` across R (with the average and RMS readouts on) and `vs` across the source.

## (c) Expected values (own analysis)

Vm = 169.706 V, α = π/3, R = 10 Ω, ideal device.

- Vo,av = Vm/(2π)·(1 + cos α) = 27.009 × 1.5 = **40.51 V**
- Io,av = Vo,av/R = **4.05 A**
- Vo,rms = (Vm/2)·√(1 − α/π + sin 2α/(2π)) = 84.853 × √0.80450 = **76.11 V**
- Io,rms = **7.61 A** (this is also the source rms current)
- P = Vo,rms²/R = **579.2 W**
- pf = P/(Vs,rms·Is,rms) = 579.2/(120 × 7.611) = **0.634** (= Vo,rms/Vs,rms for an R load)

In the ngspice `.meas` window (50–100 ms, exactly 3 cycles), results should agree to about 3
significant figures. The first cycle is already steady state, because an R load has no memory.

### Effect of a real forward drop Vf

With conduction from α to about π, vo = vs − Vf, so ΔVo,av ≈ −Vf·(π − α)/(2π) = −Vf/3. I checked
this numerically:

| Vf | Vo,av | Io,av | Vo,rms | Io,rms | P (load) | pf seen by source |
| --- | --- | --- | --- | --- | --- | --- |
| 0 (ideal) | 40.51 V | 4.051 A | 76.11 V | 7.611 A | 579.2 W | 0.634 |
| 0.7 V | 40.28 V | 4.028 A | 75.74 V | 7.574 A | 573.6 W | 0.634 |
| 1.0 V | 40.18 V | 4.018 A | 75.58 V | 7.558 A | 571.2 W | 0.634 |

A 1 V drop lowers the averages by about 0.8% and load power by about 1.4%. The source still delivers
the thyristor loss (Vf·Io,av ≈ 4 W), so the source power factor stays about 0.634. The load-only
ratio P_R/(Vs·Is) falls slightly, to about 0.630 at 1 V. Conduction also starts at α and ends just
before π, at π − asin(Vf/Vm), about 0.3° early.
