"""The independent recompute for the Fixture Course's spur gear pair (Module 11): the problem as the
(synthetic) Materials state it, worked from the textbook path-of-contact and base-pitch formulas, apart
from the Site template's engine and never reading it or the sim file. It writes the recompute log the
kinematics gate compares the engine and the sheet with: the sheet's values, and one driver turn at 1°
(each gear's angle, the driver's handle H on its pitch circle and the driven gear's tooth tip T), which
the gate holds the viewer's motion to at 360 steps.

For standard full-depth involute spur gears (addendum m, dedendum 1.25 m) of N1 and N2 teeth at the
pressure angle φ, the pitch diameters are d = mN, the base diameters d_b = d cos φ, the tip radii
r_a = d/2 + m, and the centre distance a = (d1 + d2)/2. The line of action meets the two tip circles
along a path of contact Z = √(r_a1² − r_b1²) + √(r_a2² − r_b2²) − a sin φ, and the contact ratio is
that path over the base pitch p_b = π m cos φ. The pitch circles roll without slipping, r1 Δθ1 = r2 Δθ2,
the two turning opposite ways. The driver's tooth 0 points at the driven gear at θ1 = 0, so the driven
gear's tooth 0 sits half its pitch off the line of centres: φ2 = 180° + 180°/N2 − (N1/N2) θ1.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-gear-pair.py
"""

import json
import math
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "11-mechanisms"
    / "gears.json"
)

# The problem, as the synthetic Materials give it: lengths in mm, angles in degrees.
MODULE = 2
N1, N2 = 18, 36
PHI = 20
FACE_WIDTH = 12
THETA1 = 0

MODEL = {
    "type": "gear-pair",
    "module": MODULE,
    "teeth": [N1, N2],
    "pressureAngle": PHI,
    "faceWidth": FACE_WIDTH,
}


def sheet_values() -> dict:
    phi = math.radians(PHI)
    d1, d2 = MODULE * N1, MODULE * N2
    a = (d1 + d2) / 2
    rb1, rb2 = d1 / 2 * math.cos(phi), d2 / 2 * math.cos(phi)
    ra1, ra2 = d1 / 2 + MODULE, d2 / 2 + MODULE
    path = math.sqrt(ra1**2 - rb1**2) + math.sqrt(ra2**2 - rb2**2) - a * math.sin(phi)
    base_pitch = math.pi * MODULE * math.cos(phi)
    return {
        "d1": d1,
        "d2": d2,
        "a": a,
        "ratio": N2 / N1,
        "db1": 2 * rb1,
        "db2": 2 * rb2,
        "contactRatio": path / base_pitch,
    }


def at(theta1: float) -> dict:
    """The driven gear's angle by rolling, the handle H, and the tooth tip T, at one driver angle."""
    r1, r2 = MODULE * N1 / 2, MODULE * N2 / 2
    a = r1 + r2
    ra2 = r2 + MODULE
    driven = (180 + 180 / N2 - r1 / r2 * theta1) % 360
    return {
        "driver": theta1 % 360,
        "driven": driven,
        "H": [r1 * math.cos(math.radians(theta1)), r1 * math.sin(math.radians(theta1))],
        "T": [a + ra2 * math.cos(math.radians(driven)), ra2 * math.sin(math.radians(driven))],
    }


def main() -> None:
    values = sheet_values()
    turn = [at(k) for k in range(360)]
    r9 = lambda x: round(x, 9)  # noqa: E731 - a one-line rounding helper
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-gear-pair.py: the path-of-contact and base-pitch formulas, the driven gear by rolling of the pitch circles, apart from the engine",
        "inputs": {"model": MODEL, "start": {"theta": THETA1}},
        "values": values,
        "trace": {
            "theta": [k for k in range(360)],
            "angles": {
                "driver": [r9(p["driver"]) for p in turn],
                "driven": [r9(p["driven"]) for p in turn],
            },
            "points": {key: [[r9(p[key][0]), r9(p[key][1])] for p in turn] for key in ("H", "T")},
        },
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")
    for name, value in values.items():
        print(f"  {name} = {value:.6f}")


if __name__ == "__main__":
    main()
