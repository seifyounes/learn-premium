"""The independent recompute for the Fixture Course's gradient-descent sim: the problem as the
(synthetic) Materials state it, worked in exact fractions, written apart from the Site template's
engine and never reading it or the sim file. It writes the recompute log the sim-numbers gate
compares the engine and the sheet with.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute_gradient_descent.py
"""

import json
import math
from fractions import Fraction
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "02-gradient-descent"
    / "descent.json"
)

# The problem, as the synthetic Materials give it.
POINTS = [(0, 1), (1, 3), (2, 4)]
THETA = (0, 0)
ALPHA = Fraction(1, 10)
STEPS = 2


def cost(theta0: Fraction, theta1: Fraction) -> Fraction:
    """J(θ) = 1/(2m) Σ (θ0 + θ1·x − y)²."""
    m = len(POINTS)
    return sum(((theta0 + theta1 * x - y) ** 2 for x, y in POINTS), Fraction(0)) / (2 * m)


def descend() -> list[tuple[Fraction, Fraction, Fraction]]:
    """θ := θ − α ∇J, both parameters from the same gradient; the start and every step after it."""
    m = len(POINTS)
    theta0, theta1 = Fraction(THETA[0]), Fraction(THETA[1])
    rows = [(theta0, theta1, cost(theta0, theta1))]
    for _ in range(STEPS):
        errors = [(theta0 + theta1 * x - y, x) for x, y in POINTS]
        d0 = sum((e for e, _ in errors), Fraction(0)) / m
        d1 = sum((e * x for e, x in errors), Fraction(0)) / m
        theta0, theta1 = theta0 - ALPHA * d0, theta1 - ALPHA * d1
        rows.append((theta0, theta1, cost(theta0, theta1)))
    return rows


def least_squares() -> tuple[Fraction, Fraction]:
    """The normal equations' solution: where descent ends when it converges."""
    m = len(POINTS)
    sx = sum(Fraction(x) for x, _ in POINTS)
    sy = sum(Fraction(y) for _, y in POINTS)
    sxx = sum(Fraction(x * x) for x, _ in POINTS)
    sxy = sum(Fraction(x * y) for x, y in POINTS)
    slope = (m * sxy - sx * sy) / (m * sxx - sx * sx)
    return (sy - slope * sx) / m, slope


def alpha_limit() -> float:
    """2 / λmax of the Hessian (1/m)·[[m, Σx], [Σx, Σx²]]: past it, descent diverges."""
    m = len(POINTS)
    a = Fraction(1)
    b = sum(Fraction(x) for x, _ in POINTS) / m
    c = sum(Fraction(x * x) for x, _ in POINTS) / m
    largest = (a + c) / 2 + math.sqrt(((a - c) / 2) ** 2 + b**2)
    return 2 / float(largest)


def main() -> None:
    values: dict[str, float] = {}
    for k, (theta0, theta1, j) in enumerate(descend()):
        values[f"theta0[{k}]"] = float(theta0)
        values[f"theta1[{k}]"] = float(theta1)
        values[f"J[{k}]"] = float(j)
    best0, best1 = least_squares()
    values["minimum.theta0"] = float(best0)
    values["minimum.theta1"] = float(best1)
    values["minimum.J"] = float(cost(best0, best1))
    values["alpha.limit"] = alpha_limit()
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute_gradient_descent.py: exact fractions, apart from the engine",
        "inputs": {
            "model": {"data": [list(p) for p in POINTS]},
            "start": {
                "theta0": THETA[0],
                "theta1": THETA[1],
                "alpha": float(ALPHA),
                "iterations": STEPS,
            },
        },
        "values": values,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
