"""The independent recompute for the Fixture Course's plane-wall sim: the problem as the (synthetic)
Materials state it, worked from the exact solution, the Fourier series, written apart from the
Site template's engine (a Crank–Nicolson march) and never reading it or the sim file. It writes
the recompute log the sim-numbers gate compares the engine and the sheet with: the two agree at
the sheet's printed precision, not to the last float, since the engine marches a grid.

For a wall at T_i whose faces are held at T_s from t = 0,

    T(x, t) = T_s + (T_i − T_s) Σ_{n odd} (4 / nπ) sin(nπx / L) exp(−(nπ / L)² α t).

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-plane-wall.py
"""

import json
import math
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "01-thermal-resistance"
    / "plate.json"
)

# The problem, as the synthetic Materials give it: lengths in mm, α in mm²/s, time in s.
L = 40
T_INITIAL = 200
T_SURFACE = 20
ALPHA = 12
TIME = 30

PROBES = [("T(0)", 0), ("T(L/4)", 1 / 4), ("T(L/2)", 1 / 2), ("T(3L/4)", 3 / 4), ("T(L)", 1)]


def temperature(x: float, t: float) -> float:
    """The Fourier series, summed until its terms are below a millionth of a degree."""
    total = 0.0
    n = 1
    while True:
        decay = math.exp(-((n * math.pi / L) ** 2) * ALPHA * t)
        term = 4 / (n * math.pi) * math.sin(n * math.pi * x / L) * decay
        total += term
        if (T_INITIAL - T_SURFACE) * 4 / (n * math.pi) * decay < 1e-6:
            break
        n += 2
    return T_SURFACE + (T_INITIAL - T_SURFACE) * total


def main() -> None:
    values: dict[str, float] = {name: temperature(share * L, TIME) for name, share in PROBES}
    values["Fo"] = ALPHA * TIME / L**2
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-plane-wall.py: the Fourier series, apart from the engine",
        "inputs": {
            "model": {"thickness": L, "initial": T_INITIAL, "surface": T_SURFACE},
            "start": {"time": TIME, "diffusivity": ALPHA},
        },
        "values": values,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
