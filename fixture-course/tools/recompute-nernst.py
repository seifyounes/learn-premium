"""The independent recompute for the Fixture Course's Nernst sim (the copper concentration cell of
Module 13): the cell worked from each half-cell's own potential, written apart from the Site
template's engine and never reading it. It writes the recompute log the `nernst` gate compares the
engine, the sheet and the slider grid with.

The method. Each half-cell is a metal dipped in a solution of its own ion, and its reduction
potential in that solution is its own Nernst equation,

    E_red,i = E0_i + (R T / z_i F) ln c_i.

The cell's potential is the second electrode's less the first's, E = E_red,second - E_red,first;
the electrode with the lower reduction potential gives up its electrons, so it is the anode (none
at all when the two are equal to within 1e-12 V). The cell reaction moves n = lcm(z1, z2) electrons:
the first metal dissolves, n/z1 atoms of it, and n/z2 ions of the second are plated out, so

    Q = c1^(n/z1) / c2^(n/z2),      deltaG = -n F E,      K = exp(n F E0cell / R T),

with E0cell = E0_second - E0_first. R and F are CODATA 2018's, written out below.

It reads the sim (`modules/13-cell-potential/sims/cell.json`), copies its model and start values
into the log as the inputs it worked from, and walks the sim's tuned inputs in the order c1, c2, T
(whatever order the file lists them in) at nine points each, minimum to maximum, c1 slowest: 729
states, each with its E and its anode.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-nernst.py
"""

import json
import math
from pathlib import Path

COURSE = Path(__file__).resolve().parents[1]
SIM = COURSE / "modules" / "13-cell-potential" / "sims" / "cell.json"
LOG = COURSE / "build-records" / "recompute" / "13-cell-potential" / "cell.json"

# CODATA 2018.
R = 8.314462618  # J/(mol K)
F = 96485.33212  # C/mol
POINTS = 9
# Under this many volts the two electrodes are at one potential: no current, no anode.
NO_CURRENT = 1e-12


def reduction_potential(half: dict, c: float, T: float) -> float:
    """The half-cell's own Nernst potential, in volts."""
    return half["e0"] + (R * T / (half["charge"] * F)) * math.log(c)


def work(model: dict, c1: float, c2: float, T: float) -> dict:
    first, second = model["first"], model["second"]
    z1, z2 = first["charge"], second["charge"]
    n = math.lcm(z1, z2)
    e_first = reduction_potential(first, c1, T)
    e_second = reduction_potential(second, c2, T)
    E = e_second - e_first
    # The cell reaction: n/z1 atoms of the first metal dissolve into ions, n/z2 ions of the second
    # are plated; the reaction quotient is products over reactants.
    Q = (c1 ** (n // z1)) / (c2 ** (n // z2))
    E0cell = second["e0"] - first["e0"]
    if abs(e_first - e_second) < NO_CURRENT:
        anode = None
    else:
        anode = "first" if e_first < e_second else "second"
    return {
        "E0cell": E0cell,
        "n": n,
        "Q": Q,
        "E": E,
        "deltaG": -n * F * E / 1000,  # kJ/mol
        "K": math.exp(n * F * E0cell / (R * T)),
        "anode": anode,
    }


def grid(tune: dict) -> list[dict]:
    """Every combination of nine points on each tuned input, c1 slowest then c2 then T."""
    states: list[dict] = [{}]
    for name in ("c1", "c2", "T"):
        rng = tune[name]
        points = [rng["min"] + k * (rng["max"] - rng["min"]) / (POINTS - 1) for k in range(POINTS)]
        states = [{**state, name: value} for state in states for value in points]
    return states


def main() -> None:
    sim = json.loads(SIM.read_text(encoding="utf-8"))
    model, start, tune = sim["model"], sim["start"], sim["tune"]
    at_start = work(model, start["c1"], start["c2"], start["T"])
    sweep = []
    for state in grid(tune):
        cell = work(model, state["c1"], state["c2"], state["T"])
        sweep.append(
            {
                "inputs": {name: round(value, 12) for name, value in state.items()},
                "E": round(cell["E"], 12),
                "anode": cell["anode"],
            }
        )
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-nernst.py: each half-cell's own Nernst potential, apart from the engine",
        "inputs": {"model": model, "start": start},
        "values": {name: at_start[name] for name in ("E0cell", "n", "Q", "E", "deltaG", "K")},
        "sweep": sweep,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}: {len(sweep)} states")
    print({name: at_start[name] for name in ("Q", "E", "deltaG")})


if __name__ == "__main__":
    main()
