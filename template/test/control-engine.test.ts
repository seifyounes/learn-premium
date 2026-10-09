import { describe, expect, it } from "vitest";
import {
  closedLoop,
  frequency,
  locus,
  margins,
  quantities,
  stepAt,
  stepInfo,
  type Definitions,
  type Model,
} from "../src/sims/control/engine.ts";

// The Fixture Course's loop: K in front of G(s) = 1/(s(s + 2)), unity negative feedback. Under it
// the closed loop is s² + 2s + K, so ωn = √K and ζ = 1/√K, and the textbook's second-order forms
// give every number checked here: at K = 4, ζ = 0.5, ωn = 2, poles −1 ± j√3,
// y(t) = 1 − e^(−t)(cos √3t + sin √3t / √3), %OS = 100 e^(−πζ/√(1 − ζ²)), Tp = π/(ωn√(1 − ζ²)),
// and the gain crossover from 4 = ω√(ω² + 4), ω² = −2 + √20, PM = 90° − atan(ω/2).
const model: Model = {
  plant: { gain: 1, zeros: [], poles: [0, -2] },
};
const pinned: Definitions = { settlingTime: { band: 0.02 }, riseTime: { from: 0.1, to: 0.9 } };
const y4 = (t: number) => 1 - Math.exp(-t) * (Math.cos(Math.sqrt(3) * t) + Math.sin(Math.sqrt(3) * t) / Math.sqrt(3));

describe("the control engine", () => {
  it("closes the loop: its poles are the roots of s² + 2s + K", () => {
    const loop = closedLoop(model, 4);
    expect(loop.stable).toBe(true);
    expect(loop.poles).toHaveLength(2);
    expect(loop.poles[0]?.[0]).toBeCloseTo(-1, 12);
    expect(loop.poles[0]?.[1]).toBeCloseTo(Math.sqrt(3), 12);
    expect(loop.poles[1]?.[1]).toBeCloseTo(-Math.sqrt(3), 12);
    // K = 1 puts both poles on −1; K = 0.5 parts them on the real axis at −1 ± 1/√2.
    for (const p of closedLoop(model, 1).poles) expect(p[0]).toBeCloseTo(-1, 6);
    const real = closedLoop(model, 0.5).poles.map((p) => p[0]);
    expect(real[0]).toBeCloseTo(-1 + Math.SQRT1_2, 12);
    expect(real[1]).toBeCloseTo(-1 - Math.SQRT1_2, 12);
  });

  it("steps the closed loop exactly: y(t) is the second-order response", () => {
    for (const t of [0, 0.25, 1, 1.8138, 3, 6.5]) expect(stepAt(model, 4, t)).toBeCloseTo(y4(t), 12);
  });

  it("reads overshoot, peak, rise and settling off the response, by the pinned definitions", () => {
    const info = stepInfo(model, 4, pinned);
    if (!info) throw new Error("a stable loop has step characteristics");
    const zeta = 0.5;
    expect(info.final).toBeCloseTo(1, 12);
    expect(info.overshoot).toBeCloseTo(100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta ** 2)), 9);
    expect(info.Tp).toBeCloseTo(Math.PI / Math.sqrt(3), 9);
    expect(info.peak).toBeCloseTo(y4(Math.PI / Math.sqrt(3)), 12);
    // Rise: from where y first reaches 0.1 to where it first reaches 0.9.
    const [from, Tr] = [info.riseFrom ?? NaN, info.Tr ?? NaN];
    expect(y4(from)).toBeCloseTo(0.1, 9);
    expect(y4(from + Tr)).toBeCloseTo(0.9, 9);
    // Settling: y last leaves the ±2 % band at Ts, and stays inside it after.
    expect(Math.abs(y4(info.Ts) - 1)).toBeCloseTo(0.02, 9);
    for (let t = info.Ts + 0.001; t < 15; t += 0.001) expect(Math.abs(y4(t) - 1)).toBeLessThan(0.02);
    expect(Math.abs(y4(info.Ts - 0.01) - 1)).toBeGreaterThan(0.0195);
  });

  it("works to whatever band the Course style sheet pins: a 5 % band settles sooner", () => {
    const two = stepInfo(model, 4, pinned);
    const five = stepInfo(model, 4, { ...pinned, settlingTime: { band: 0.05 } });
    if (!two || !five) throw new Error("a stable loop has step characteristics");
    expect(Math.abs(y4(five.Ts) - 1)).toBeCloseTo(0.05, 9);
    expect(five.Ts).toBeLessThan(two.Ts);
  });

  it("gives no overshoot or peak time when the loop is critically damped or slower", () => {
    for (const K of [0.5, 1]) {
      const info = stepInfo(model, K, pinned);
      expect(info?.overshoot).toBe(0);
      expect(info?.Tp).toBeUndefined();
      expect(info?.Ts).toBeGreaterThan(0);
    }
  });

  it("gives the open loop's frequency response and its phase margin", () => {
    const w = 1;
    const at1 = frequency(model, 4, w);
    // L(j1) = 4 / (j(j + 2)) = 4 / (−1 + 2j): |L| = 4/√5, phase −90° − atan(1/2).
    expect(at1.magnitude).toBeCloseTo(4 / Math.sqrt(5), 12);
    expect(at1.phase).toBeCloseTo(-90 - (Math.atan(0.5) * 180) / Math.PI, 10);
    expect(at1.re).toBeCloseTo(-4 / 5, 12);
    expect(at1.im).toBeCloseTo(-8 / 5, 12);
    const wc = Math.sqrt(-2 + Math.sqrt(20));
    const m = margins(model, 4);
    expect(m.wc).toBeCloseTo(wc, 10);
    expect(m.PM).toBeCloseTo(90 - (Math.atan(wc / 2) * 180) / Math.PI, 9);
    // Its phase never reaches −180°: no gain margin to give.
    expect(m.GM).toBeUndefined();
  });

  it("traces the root locus: every point on it is a closed-loop pole for its K", () => {
    const branches = locus(model, [0, 0.5, 1, 4, 9]);
    expect(branches).toHaveLength(2);
    // K = 0 starts each branch on an open-loop pole.
    expect(branches.map((b) => b[0]?.[0]).sort()).toEqual([-2, 0]);
    for (const branch of branches) {
      expect(branch).toHaveLength(5);
      branch.forEach(([re, im], i) => {
        const K = [0, 0.5, 1, 4, 9][i] ?? 0;
        // s² + 2s + K = 0 at that point.
        const real = re * re - im * im + 2 * re + K;
        const imag = 2 * re * im + 2 * im;
        expect(Math.hypot(real, imag)).toBeLessThan(1e-6);
      });
    }
  });

  it("names every number the way sheets and recompute logs do", () => {
    const named = quantities(model, { K: 4 }, pinned);
    expect(named).toMatchObject({ zeta: expect.closeTo(0.5, 12), wn: expect.closeTo(2, 12), final: 1 });
    expect(named["pole[0].re"]).toBeCloseTo(-1, 12);
    expect(named["pole[0].im"]).toBeCloseTo(Math.sqrt(3), 12);
    expect(named["pole[1].im"]).toBeCloseTo(-Math.sqrt(3), 12);
    expect(Object.keys(named).sort()).toEqual(
      [
        "PM",
        "Tp",
        "Tr",
        "Ts",
        "final",
        "overshoot",
        "peak",
        "pole[0].im",
        "pole[0].re",
        "pole[1].im",
        "pole[1].re",
        "wc",
        "wn",
        "zeta",
      ].sort(),
    );
  });

  it("turns the phase by 180° for a negative gain, on the Bode plot as on the Nyquist plot", () => {
    // G(s) = −1/(s + 2) at ω = 1: L = −1/(2 + j) = (−2 + j)/5, at 180° − atan(1/2) below the axis turn.
    const negative: Model = { plant: { gain: -1, zeros: [], poles: [-2] } };
    const f = frequency(negative, 1, 1);
    expect(f.re).toBeCloseTo(-2 / 5, 12);
    expect(f.im).toBeCloseTo(1 / 5, 12);
    expect(Math.cos((f.phase * Math.PI) / 180) * f.magnitude).toBeCloseTo(f.re, 12);
    expect(Math.sin((f.phase * Math.PI) / 180) * f.magnitude).toBeCloseTo(f.im, 12);
  });

  it("finds the crossover however far the gain moves it: K/s crosses at ω = K with 90° of margin", () => {
    const integrator: Model = { plant: { gain: 1, zeros: [], poles: [0] } };
    for (const K of [0.0001, 1, 10000]) {
      const m = margins(integrator, K);
      expect(m.wc).toBeCloseTo(K, 6 - Math.log10(Math.max(1, K)));
      expect(m.PM).toBeCloseTo(90, 9);
    }
  });

  it("gives no rise time it can't read: a response that never reaches 100 % of its final value", () => {
    const first: Model = { plant: { gain: 1, zeros: [], poles: [-1] } };
    const info = stepInfo(first, 1, { ...pinned, riseTime: { from: 0.1, to: 1 } });
    expect(info?.Tr).toBeUndefined();
    expect(info?.Ts).toBeGreaterThan(0);
  });

  it("gives no step characteristics read against a final value of 0", () => {
    // G(s) = s/((s + 1)(s + 2)): the closed loop keeps the zero at the origin, so y(∞) = 0.
    const differentiating: Model = { plant: { gain: 1, zeros: [0], poles: [-1, -2] } };
    expect(closedLoop(differentiating, 1).stable).toBe(true);
    expect(stepInfo(differentiating, 1, pinned)).toBeUndefined();
    for (const v of Object.values(quantities(differentiating, { K: 1 }, pinned))) expect(Number.isFinite(v)).toBe(true);
  });

  it("keeps one pole per order, even where four of them meet: (s + 1)⁴", () => {
    // G(s) = 1/(s(s + 2)(s² + 2s + 2)) at K = 1: s⁴ + 4s³ + 6s² + 4s + 1 = (s + 1)⁴.
    const quartic: Model = { plant: { gain: 1, zeros: [], poles: [0, -2, [-1, 1]] } };
    const poles = closedLoop(quartic, 1).poles;
    expect(poles).toHaveLength(4);
    for (const [re, im] of poles) expect(Math.hypot(re + 1, im)).toBeLessThan(1e-3);
  });

  it("finds the peak of a lightly damped loop, however many swings the scan holds", () => {
    // G(s) = 1/(s(s + 0.002)) at K = 1: ζ = 0.001, ωn = 1, so Tp = π/√(1 − ζ²) and %OS ≈ 99.69.
    const light: Model = { plant: { gain: 1, zeros: [], poles: [0, -0.002] } };
    const info = stepInfo(light, 1, pinned);
    const zeta = 0.001;
    expect(info?.Tp).toBeCloseTo(Math.PI / Math.sqrt(1 - zeta ** 2), 6);
    expect(info?.overshoot).toBeCloseTo(100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta ** 2)), 6);
  });

  it("keeps a fast transient's peak however slow another pole makes the scan", () => {
    // A pole and zero cancelled at −10⁻⁶ leave the K = 4 loop of K/(s(s + 2)): 16.303 %, Tp = π/√3.
    const slow: Model = { plant: { gain: 1, zeros: [-1e-6], poles: [-1e-6, 0, -2] } };
    const info = stepInfo(slow, 4, pinned);
    expect(info?.overshoot).toBeCloseTo(16.303, 2);
    expect(info?.Tp).toBeCloseTo(Math.PI / Math.sqrt(3), 4);
  });

  it("finds a crossover below the plant's corners, rising or falling into it", () => {
    // 1/(s + 1) at K = 1.0000001 crosses at √(K² − 1) ≈ 4.472·10⁻⁴ rad/s.
    const lag: Model = { plant: { gain: 1, zeros: [], poles: [-1] } };
    expect(margins(lag, 1.0000001).wc).toBeCloseTo(Math.sqrt(1.0000001 ** 2 - 1), 6);
    // 10000s/(s + 1)² crosses 1 twice, near 10⁻⁴ rad/s on its way up and near 10⁴ on its way down:
    // the low one is found too, and the one reported is the limiting margin of the two.
    const lead: Model = { plant: { gain: 10000, zeros: [0], poles: [-1, -1] } };
    const m = margins(lead, 1);
    expect(frequency(lead, 1, m.wc ?? 0).magnitude).toBeCloseTo(1, 9);
  });

  it("reports the limiting phase margin of several crossovers, as python-control does", () => {
    // Codex's case: crossings with margins of about 0.490°, −0.296° and −177.985°; the limiting one is −0.296°.
    const multi: Model = { plant: { gain: 0.001, zeros: [-100], poles: [-0.001, -0.001, [-0.001, 1]] } };
    expect(margins(multi, 1).PM).toBeCloseTo(-0.296, 2);
  });

  it("cancels a pole a zero cancels before closing the loop: s/(s(s + 1)) is 1/(s + 1)", () => {
    const cancelled: Model = { plant: { gain: 1, zeros: [0], poles: [0, -1] } };
    const loop = closedLoop(cancelled, 1);
    expect(loop.poles).toHaveLength(1);
    expect(loop.stable).toBe(true);
    expect(stepInfo(cancelled, 1, pinned)?.final).toBeCloseTo(0.5, 12);
  });

  it("finds the crossovers of a narrow resonance that lifts the gain over 1 between grid points", () => {
    // Poles at −0.0001 ± j1 and −5, gain 0.0011: |L| tops 1 only within about ±0.0005 of ω = 1.
    const resonant: Model = { plant: { gain: 0.0011, zeros: [], poles: [[-0.0001, 1], -5] } };
    const m = margins(resonant, 1);
    expect(m.wc).toBeDefined();
    expect(Math.abs((m.wc ?? 0) - 1)).toBeLessThan(0.001);
    expect(frequency(resonant, 1, m.wc ?? 0).magnitude).toBeCloseTo(1, 9);
  });

  it("takes no phase crossover at a pole on the imaginary axis: 0.1/(s² + 1)", () => {
    const undamped: Model = { plant: { gain: 0.1, zeros: [], poles: [[0, 1]] } };
    const m = margins(undamped, 1);
    expect(m.wpc === undefined || Math.abs(m.wpc - 1) > 0.01).toBe(true);
    if (m.GM !== undefined) expect(Number.isFinite(m.GM) && Math.abs(m.GM) < 200).toBe(true);
  });

  it("counts poles on the imaginary axis unstable, through the root solver's rounding", () => {
    // K/(s(s + 2)(s + 3)) at K = 30: (s + 5)(s² + 6), a pair on the axis that never settles.
    const third: Model = { plant: { gain: 1, zeros: [], poles: [0, -2, -3] } };
    expect(closedLoop(third, 30).stable).toBe(false);
    expect(stepInfo(third, 30, pinned)).toBeUndefined();
  });

  it("settles after a swing that peaks just outside the band between two samples", () => {
    const K = 1.6449069485188585;
    const info = stepInfo(model, K, pinned);
    if (!info?.Tp || info.peak === undefined) throw new Error("this loop overshoots");
    // The peak is outside the 2 % band, so the response can't have settled before it.
    expect(Math.abs(info.peak / info.final - 1)).toBeGreaterThanOrEqual(0.02);
    expect(info.Ts).toBeGreaterThan(info.Tp);
    expect(Math.abs(stepAt(model, K, info.Ts) / info.final - 1)).toBeCloseTo(0.02, 9);
  });

  it("keeps a slow but strictly stable pole stable: 10⁻¹⁰/(s + 10⁻¹⁰)", () => {
    const slow: Model = { plant: { gain: 1e-10, zeros: [], poles: [-1e-10] } };
    expect(closedLoop(slow, 1).stable).toBe(true);
  });

  it("takes a phase crossover only where L(jω) crosses the negative real axis", () => {
    // Poles at 1 ± j and −5: L(j1) ≈ 0.0538 + j0.0692 is no crossover, though one factor's
    // angle would jump by 360° there.
    const unstable: Model = { plant: { gain: 1, zeros: [], poles: [[1, 1], -5] } };
    const m = margins(unstable, 1);
    if (m.wpc !== undefined) expect(frequency(unstable, 1, m.wpc).re).toBeLessThan(0);
    expect(m.wpc === undefined || Math.abs(m.wpc - 1) > 0.05).toBe(true);
    // Its Bode phase runs on without a jump.
    const phases = Array.from({ length: 200 }, (_, i) => frequency(unstable, 1, 0.5 + i * 0.005).phase);
    for (let i = 1; i < phases.length; i++) expect(Math.abs((phases[i] ?? 0) - (phases[i - 1] ?? 0))).toBeLessThan(5);
  });

  it("gives no settling time it can't see: a response slower than the scan", () => {
    // G(s) = 1/(s(s + 2·10⁻⁶)) at K = 1: ζ = 10⁻⁶, still swinging long past any scan.
    const endless: Model = { plant: { gain: 1, zeros: [], poles: [0, -0.000002] } };
    // Seen before any scan starts, so tuning to it never holds the page.
    const started = performance.now();
    expect(stepInfo(endless, 1, pinned)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("closes a third-order loop the same way, its step matching partial fractions", () => {
    // K/(s(s + 1)(s + 5)) at K = 6: the closed loop s³ + 6s² + 5s + 6.
    const third: Model = { plant: { gain: 1, zeros: [], poles: [0, -1, -5] } };
    const loop = closedLoop(third, 6);
    expect(loop.stable).toBe(true);
    // y(t) = 1 + Σ r e^(pt), r = 6 / (p · D'(p)), D'(s) = 3s² + 12s + 5.
    const y = (t: number) =>
      1 +
      loop.poles.reduce((sum, [a, b]) => {
        const dRe = 3 * (a * a - b * b) + 12 * a + 5;
        const dIm = 6 * a * b + 12 * b;
        const denRe = a * dRe - b * dIm;
        const denIm = a * dIm + b * dRe;
        const d = denRe ** 2 + denIm ** 2;
        const [rRe, rIm] = [(6 * denRe) / d, (-6 * denIm) / d];
        const e = Math.exp(a * t);
        return sum + e * (rRe * Math.cos(b * t) - rIm * Math.sin(b * t));
      }, 0);
    for (const t of [0.5, 2, 7]) expect(stepAt(third, 6, t)).toBeCloseTo(y(t), 10);
    // Past K = 30 the closed loop goes unstable (Routh): no step characteristics to give.
    expect(closedLoop(third, 31).stable).toBe(false);
    expect(stepInfo(third, 31, pinned)).toBeUndefined();
  });
});
