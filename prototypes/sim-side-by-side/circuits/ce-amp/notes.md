# CE amplifier, circuit (i): authoring notes

Source: `fixtures/materials/ce-amp-fig.png`, circuit (i) (top-left, +20 V, beta = 50).

## (a) Reading of the figure

| Part | Value | Node A | Node B | Notes |
|---|---|---|---|---|
| VCC | +20 V | vcc | 0 | supply terminal at the top |
| RB | 430 kΩ | vcc | b | fixed bias, top of RB on the supply rail |
| RC | 2 kΩ | vcc | c | |
| C1 (input) | 10 µF | vi | b | series from the vi terminal to the base |
| C2 (output) | 10 µF | c | vo | vo is an open terminal |
| Q1 | NPN, beta = 50 | c / b / e | | arrow on the emitter points out: NPN |
| RE | 1 kΩ | e | 0 | |
| CE (bypass) | 40 µF | e | 0 | in parallel with RE |
| vi source | small sine | vi | 0 | not drawn; the figure only labels the vi terminal |

## (b) Assumptions

- vi is an ideal source (no source resistance) and vo is unloaded (no RL drawn). Both
  simulators add RPROBE = 10 MΩ from vo to ground, only to give that node a DC path and a scope
  target. It lowers the gain by 0.02%.
- Test signal: 2 mV peak, 10 kHz (not 5 mV / 1 kHz). 2 mV keeps vbe well below Vt, so the
  output stays small-signal. 10 kHz is mid-band: the bypass pole is about
  1 / (2π · 40 µF · 12.5 Ω) ≈ 320 Hz, so at 1 kHz the 40 µF is not a short (Xc ≈ 4 Ω next to
  r'e ≈ 12 Ω) and |Av| would read about 147, not about 155.
- SPICE model: `NPN(IS=3.5e-15 BF=50)`. At 27 °C (Vt = 25.865 mV) this gives
  VBE = Vt · ln(2.006 mA / 3.5e-15) = 0.700 V at the expected IC. Early effect is off (VAF
  unset), BR = 1, and there are no junction capacitances, so there is no high-frequency roll-off.
- CircuitJS uses a custom model line `32 ce-npn ...` with the same IS = 3.5e-15 (its own Vt
  is also 0.025865). Beta 50 is set on the transistor line. Without the model line, CircuitJS's
  `default` model (IS = 1e-13) would give VBE ≈ 0.614 V.
- Initial conditions. ngspice: no `uic`, so `.tran` starts from the `.op` solution with every
  capacitor already charged, and no settling run is needed. CircuitJS: each capacitor line
  carries its expected DC voltage as both the state and the reset value (C1 = −2.746 V
  vi→b, C2 = 15.99 V c→vo, CE = 2.046 V e→0). Options flag 128 (DC analysis on reset) is also
  set.
- CircuitJS layout: all coordinates are multiples of 16, and every junction is a shared
  endpoint. Base post (256,208), collector (304,192) and emitter (304,224) follow from
  `TransistorElm.setPoints` for `t 256 208 304 208`. Scope 1 is on element 19 (the vi source)
  and scope 2 is on element 14 (RPROBE, which reads vo).
- Numbers are written without `+` because the CircuitJS tokenizer splits on `+`.

## (c) Expected values

### Hand analysis (course conventions: VBE = 0.7 V, VT = 25 mV, r'e = 25 mV / IE, ro = ∞)

- IBQ = (20 − 0.7) / (430k + 51 · 1k) = 19.3 / 481k = **40.1 µA**
- ICQ = β · IB = **2.006 mA**; IE = 51 · IB = 2.046 mA
- VE = 2.046 V, VB = 2.746 V, VC = 20 − 2k · 2.006 mA = 15.99 V
- VCEQ = VC − VE = **13.94 V** (the textbook shortcut IC ≈ IE, VCE ≈ 20 − IC(RC + RE) gives
  13.98 V)
- r'e = 25 mV / 2.046 mA = **12.22 Ω**
- Av = −RC / r'e = −2000 / 12.22 = **−163.7** (vo is unloaded, and CE is an ideal bypass at
  mid-band)
- Zi = RB ‖ βr'e = 430k ‖ 610.8 Ω = **610 Ω** (if the course uses (β+1)r'e: 622 Ω)
- Zo = RC = **2 kΩ** (ro = ∞)

### What SPICE should show (ngspice and CircuitJS alike)

- Q-point: essentially the hand values, because IS was chosen so that VBE ≈ 0.700 V. Expect
  IB ≈ 40.1 µA, IC ≈ 2.006 mA and VCE ≈ 13.94 V, with differences in the third digit.
  VBE is not constant, but it is pinned near 0.70 V at this current.
- Small-signal: SPICE uses gm = IC / Vt with Vt = 25.865 mV (not 25 mV) and IC (not IE).
  gm = 77.57 mS, so mid-band Av = −gm · RC ≈ **−155.1**. That is about 5% below the course's
  −163.7: 3.4% from Vt and 2% from IC versus IE.
- rπ = β / gm = 644.6 Ω, so Zi ≈ 430k ‖ 644.6 ≈ **644 Ω** (the course gives 610 Ω).
- Zo = 2 kΩ exactly, because the Early effect is off.
- `.meas` targets: av_tran ≈ 155 (vopp ≈ 0.62 V for vipp = 4 mV). av_mid (AC at 10 kHz)
  ≈ 155.0. av_1k ≈ 146.7 (partial bypass). The output is inverted relative to vi.
- If an exact match to the course numbers is ever wanted, run ngspice at `.options temp=16.96
  tnom=16.96` (Vt = 25.0 mV). The remaining 2% gap then comes from IC versus IE.
