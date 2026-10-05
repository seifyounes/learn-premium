"""The independent recompute for the Fixture Course's tangent sim: the problem as the (synthetic)
Materials state it, worked by direct evaluation in exact fractions, written apart from the Site
template's engine and never reading it or the sim file. The polynomial is evaluated term by term
as written, and its derivative comes from the power rule applied by hand. It writes the recompute
log the sim-numbers gate compares the engine and the sheet with.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-tangent.py
"""

import json
from fractions import Fraction
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "05-derivatives"
    / "tangent.json"
)

# The problem, as the synthetic Materials give it: f(x) = x³ − 3x² + 2x + 1 at x = 2, runs from h = 1.
A = Fraction(2)
H = Fraction(1)
RUNS = 3


def f(x: Fraction) -> Fraction:
    """f(x) = x³ − 3x² + 2x + 1, term by term."""
    return x**3 - 3 * x**2 + 2 * x + 1


def f_prime(x: Fraction) -> Fraction:
    """The power rule on each term: f′(x) = 3x² − 6x + 2."""
    return 3 * x**2 - 6 * x + 2


def main() -> None:
    values: dict[str, float] = {}
    base = f(A)
    slope = f_prime(A)
    values["f(a)"] = float(base)
    values["slope"] = float(slope)
    values["intercept"] = float(base - slope * A)
    for k in range(RUNS):
        run = H / 10**k
        rise = f(A + run) - base
        values[f"h[{k}]"] = float(run)
        values[f"f(a+h)[{k}]"] = float(f(A + run))
        values[f"secant[{k}]"] = float(rise / run)
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-tangent.py: direct evaluation in exact fractions, apart from the engine",
        "inputs": {
            "model": {"coefficients": [1, 2, -3, 1]},
            "start": {"a": int(A), "h": int(H)},
        },
        "values": values,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
