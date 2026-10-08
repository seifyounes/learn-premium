"""The independent recompute for the Fixture Course's control sim, with python-control as the
oracle: the loop as the (synthetic) Materials draw it, K in front of G(s) = 1/(s(s + 2)) under unity
negative feedback, closed and stepped by python-control, written apart from the Site template's
engine and never reading it or the sim file. The settling band and the rise time's limits are read
from the Course style sheet, the Professor's pinned definitions, and the log says which it used.

python-control reads each characteristic off a sampled response (`step_info`), so each one it
finds is then pinned down between its two samples by bisection on python-control's own exact
response (`step_response` over a single interval is the matrix exponential), the peak on the sign
of the impulse response, the response's slope. It writes the recompute log the sim-numbers gate
compares the engine and the sheet with. python-control runs here, at build, never in the page.

Run from the repo root, with the machine venv's python-control (0.10.2, pinned in skill/uv.lock):

    uv run --no-project --with control==0.10.2 --with pyyaml python fixture-course/tools/recompute-control.py
"""

import json
from pathlib import Path

import control as ct
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / "build-records" / "recompute" / "08-root-locus" / "loop.json"
STYLE_SHEET = ROOT / "style-sheet.yaml"

# The loop, as the synthetic Materials draw it: R(s) into the summing junction, the error through
# the gain K and the plant G(s) = 1/(s(s + 2)), and Y(s) fed back to the junction's minus input.
PLANT = {"gain": 1, "zeros": [], "poles": [0, -2]}
LOOP = {"input": "R", "sum": "E", "gain": "K", "plant": "G", "output": "Y"}
PARTS = [
    {"id": "R", "kind": "port", "label": "R(s)"},
    {"id": "E", "kind": "sum"},
    {"id": "K", "kind": "block", "label": "K"},
    {"id": "G", "kind": "block", "label": "G(s)"},
    {"id": "Y", "kind": "port", "label": "Y(s)"},
]
NETS = [
    {"id": "r", "pins": ["R.t", "E.in1"]},
    {"id": "e", "pins": ["E.out", "K.in"]},
    {"id": "u", "pins": ["K.out", "G.in"]},
    {"id": "y", "pins": ["G.out", "Y.t", "E.in2"]},
]
K = 4


def bisect(f, lo: float, hi: float) -> float:
    """The sign change of f between lo and hi, to the last float."""
    below = f(lo) < 0
    for _ in range(200):
        mid = (lo + hi) / 2
        if (f(mid) < 0) == below:
            lo = mid
        else:
            hi = mid
        if hi - lo <= 1e-15 * max(1.0, hi):
            break
    return (lo + hi) / 2


def main() -> None:
    definitions = yaml.safe_load(STYLE_SHEET.read_text(encoding="utf-8"))["pinned"]
    band = definitions["settlingTime"]["band"]
    rise = (definitions["riseTime"]["from"], definitions["riseTime"]["to"])

    plant = ct.zpk(PLANT["zeros"], PLANT["poles"], PLANT["gain"])
    opened = K * plant
    closed = ct.feedback(opened, 1)

    def y(t: float) -> float:
        return float(ct.step_response(closed, timepts=[0.0, t]).outputs[-1]) if t > 0 else 0.0

    def slope(t: float) -> float:
        return float(ct.impulse_response(closed, timepts=[0.0, t]).outputs[-1])

    values: dict[str, float] = {}
    poles = sorted(closed.poles(), key=lambda p: (-p.imag, -p.real))
    for i, p in enumerate(poles):
        values[f"pole[{i}].re"] = float(p.real)
        values[f"pole[{i}].im"] = float(p.imag)
    wn, zeta, _ = ct.damp(closed, doprint=False)
    values["wn"] = float(wn[0])
    values["zeta"] = float(zeta[0])

    T = np.linspace(0, 20, 200_001)
    info = ct.step_info(closed, timepts=T, SettlingTimeThreshold=band, RiseTimeLimits=rise)
    final = float(ct.dcgain(closed))
    values["final"] = final

    def index(t: float) -> int:
        return int(np.searchsorted(T, t))

    # Rise: python-control's first sample past each limit, then the crossing between samples.
    response = ct.step_response(closed, timepts=T).outputs
    lower = int(np.nonzero(response - rise[0] * final >= 0)[0][0])
    upper = int(np.nonzero(response - rise[1] * final >= 0)[0][0])
    t_lower = bisect(lambda t: y(t) - rise[0] * final, T[lower - 1], T[lower])
    t_upper = bisect(lambda t: y(t) - rise[1] * final, T[upper - 1], T[upper])
    assert abs((t_upper - t_lower) - info["RiseTime"]) < 2e-4
    values["Tr"] = float(t_upper - t_lower)

    # Settling: the first sample inside the band for good, then where the response last left it.
    settled = index(info["SettlingTime"])
    values["Ts"] = float(bisect(lambda t: abs(y(t) / final - 1) - band, T[settled - 1], T[settled]))

    # Peak: python-control's highest sample, then where the slope turns.
    peak = index(info["PeakTime"])
    tp = float(bisect(lambda t: -slope(t), T[peak - 1], T[peak + 1]))
    values["Tp"] = tp
    values["peak"] = y(tp)
    values["overshoot"] = 100 * (values["peak"] - final) / final
    assert abs(values["overshoot"] - info["Overshoot"]) < 1e-3

    gm, pm, _, wcp = ct.margin(opened)
    values["wc"] = float(wcp)
    values["PM"] = float(pm)
    assert np.isinf(gm), "this plant's phase never reaches -180 degrees"

    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-control.py: python-control 0.10.2 (feedback, step_info, damp, margin), each step characteristic pinned down between its samples, apart from the engine",
        "inputs": {
            "model": {"plant": PLANT, "loop": LOOP, "parts": PARTS, "nets": NETS},
            "start": {"K": K},
        },
        "definitions": {
            "settlingTime": {"band": band},
            "riseTime": {"from": rise[0], "to": rise[1]},
        },
        "values": values,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_bytes((json.dumps(log, indent=2) + "\n").encode("utf-8"))
    print(f"wrote {LOG}")
    for name, value in values.items():
        print(f"  {name} = {value!r}")


if __name__ == "__main__":
    main()
