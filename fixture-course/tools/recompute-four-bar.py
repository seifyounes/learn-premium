"""The independent recompute for the Fixture Course's crank-rocker four-bar (Module 11): the problem
as the (synthetic) Materials state it, worked from Freudenstein's equation in half-angle form, written
apart from the Site template's engine (which intersects two circles) and never reading it or the sim
file. It writes the recompute log the kinematics gate compares the engine and the sheet with: the
sheet's values at the example's crank angle, and one driver turn at 1° (every moving link's angle and
every pin off the ground), which the gate holds the viewer's motion to at 360 steps.

With the ground O2O4 = d, crank O2A = a, coupler AB = b and rocker O4B = c, all measured from the
ground line O2 → O4, the loop a·e^{jθ2} + b·e^{jθ3} = d + c·e^{jθ4} gives, for the rocker,

    K1 cos θ4 − K2 cos θ2 + K3 = cos(θ2 − θ4),   K1 = d/a, K2 = d/c, K3 = (a² − b² + c² + d²)/(2ac),

which with t = tan(θ4 / 2) is A t² + B t + C = 0, and for the coupler, with u = tan(θ3 / 2),

    K1 cos θ3 + K4 cos θ2 + K5 = cos(θ2 − θ3),   K4 = d/b, K5 = (c² − d² − a² − b²)/(2ab),

D u² + E u + F = 0. Each has two roots; of the four pairs only two close the loop (the open and the
crossed assembly), and the open one is the pair whose B lies to the left of the line from A to O4.
P, the coupler point, is `along` AB from A and `off` to its left. The transmission angle is the acute
angle between the coupler and rocker lines, acos |cos(θ3 − θ4)|.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-four-bar.py
"""

import json
import math
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "11-mechanisms"
    / "linkage.json"
)

# The problem, as the synthetic Materials give it: lengths in mm, angles in degrees.
GROUND, CRANK, COUPLER, ROCKER = 100, 40, 120, 80
ALONG, OFF = 60, 30
THETA2 = 60
ASSEMBLY = "open"

MODEL = {
    "type": "four-bar",
    "ground": GROUND,
    "crank": CRANK,
    "coupler": COUPLER,
    "rocker": ROCKER,
    "assembly": ASSEMBLY,
    "couplerPoint": {"along": ALONG, "off": OFF},
}


def half_angle_roots(a: float, b: float, c: float) -> list[float]:
    """The angles (radians) whose half-angle tangent t satisfies a t² + b t + c = 0."""
    if abs(a) < 1e-12:
        return [2 * math.atan(-c / b)]
    discriminant = b * b - 4 * a * c
    if discriminant < 0:
        raise ValueError("the linkage cannot close at this crank angle")
    root = math.sqrt(discriminant)
    return [2 * math.atan((-b + sign * root) / (2 * a)) for sign in (1, -1)]


def solve(theta2_deg: float) -> tuple[float, float]:
    """θ3 and θ4 in radians, the open assembly's: the pair that closes the loop with B left of A → O4."""
    a, b, c, d = CRANK, COUPLER, ROCKER, GROUND
    t2 = math.radians(theta2_deg)
    k1, k2, k3 = d / a, d / c, (a * a - b * b + c * c + d * d) / (2 * a * c)
    k4, k5 = d / b, (c * c - d * d - a * a - b * b) / (2 * a * b)
    rockers = half_angle_roots(
        math.cos(t2) - k1 - k2 * math.cos(t2) + k3,
        -2 * math.sin(t2),
        k1 - (k2 + 1) * math.cos(t2) + k3,
    )
    couplers = half_angle_roots(
        math.cos(t2) - k1 + k4 * math.cos(t2) + k5,
        -2 * math.sin(t2),
        k1 + (k4 - 1) * math.cos(t2) + k5,
    )
    ax, ay = a * math.cos(t2), a * math.sin(t2)
    closing = []
    for t3 in couplers:
        for t4 in rockers:
            bx, by = ax + b * math.cos(t3), ay + b * math.sin(t3)
            miss = math.hypot(bx - (d + c * math.cos(t4)), by - c * math.sin(t4))
            if miss < 1e-9:
                closing.append((t3, t4, bx, by))
    assert len(closing) == 2, f"{len(closing)} assemblies close at θ2 = {theta2_deg}°, expected two"
    side = 1 if ASSEMBLY == "open" else -1
    for t3, t4, bx, by in closing:
        # Cross product of (O4 − A) and (B − A): positive when B is left of the line from A to O4.
        cross = (d - ax) * (by - ay) - (0 - ay) * (bx - ax)
        if cross * side > 0:
            return t3, t4
    raise AssertionError("neither closing pair has B on the assembly's side")


def pins(theta2_deg: float) -> dict:
    """Everything one crank angle gives: the angles in degrees [0, 360), and the pins A, B, P."""
    t3, t4 = solve(theta2_deg)
    t2 = math.radians(theta2_deg)
    ax, ay = CRANK * math.cos(t2), CRANK * math.sin(t2)
    bx, by = ax + COUPLER * math.cos(t3), ay + COUPLER * math.sin(t3)
    # Loop closure, from the rocker's side too: the check every step must pass.
    closure = math.hypot(bx - (GROUND + ROCKER * math.cos(t4)), by - ROCKER * math.sin(t4))
    assert closure < 1e-9, f"the loop is open by {closure} at θ2 = {theta2_deg}°"
    px = ax + ALONG * math.cos(t3) - OFF * math.sin(t3)
    py = ay + ALONG * math.sin(t3) + OFF * math.cos(t3)
    return {
        "theta2": theta2_deg % 360,
        "theta3": math.degrees(t3) % 360,
        "theta4": math.degrees(t4) % 360,
        "A": [ax, ay],
        "B": [bx, by],
        "P": [px, py],
    }


def transmission(theta3: float, theta4: float) -> float:
    return math.degrees(math.acos(abs(math.cos(math.radians(theta3 - theta4)))))


def main() -> None:
    at = pins(THETA2)
    values = {
        "theta3": at["theta3"],
        "theta4": at["theta4"],
        "mu": transmission(at["theta3"], at["theta4"]),
        "Bx": at["B"][0],
        "By": at["B"][1],
        "Px": at["P"][0],
        "Py": at["P"][1],
    }
    turn = [pins(k) for k in range(360)]
    r9 = lambda x: round(x, 9)  # noqa: E731 - a one-line rounding helper
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-four-bar.py: Freudenstein's equation in half-angle form, both roots of each, the loop closure asserted at every step, apart from the engine",
        "inputs": {"model": MODEL, "start": {"theta": THETA2}},
        "values": values,
        "trace": {
            "theta": [k for k in range(360)],
            "angles": {
                "crank": [r9(p["theta2"]) for p in turn],
                "coupler": [r9(p["theta3"]) for p in turn],
                "rocker": [r9(p["theta4"]) for p in turn],
            },
            "points": {
                key: [[r9(p[key][0]), r9(p[key][1])] for p in turn] for key in ("A", "B", "P")
            },
        },
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")
    for name, value in values.items():
        print(f"  {name} = {value:.6f}")


if __name__ == "__main__":
    main()
