"""The independent recompute for the Fixture Course's Worked example W01.1 (heat loss through a
composite wall): the problem as the (synthetic) Materials state it, worked in exact fractions,
written apart from the Worked example's sheet and never reading it. Each layer's resistance is
R = L / (k A), in series they add, the heat rate is the whole drop over the total, and each layer
drops Q R. It writes the recompute log the worked-numbers gate compares the sheet with, by cell.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-composite-wall.py
"""

import json
from fractions import Fraction
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "01-thermal-resistance"
    / "worked-1.json"
)

# The problem, as the synthetic Materials give it: three layers in series, A = 1 m², T1 = 20 °C, T4 = −5 °C.
AREA = Fraction(1)
T_INSIDE = Fraction(20)
T_OUTSIDE = Fraction(-5)
# Layer: (L in m, k in W/(m·K)), in the order heat crosses them; the sheet's rows 1–3.
LAYERS = [
    (Fraction("0.02"), Fraction("0.5")),
    (Fraction("0.20"), Fraction("0.8")),
    (Fraction("0.05"), Fraction("0.04")),
]


def main() -> None:
    resistances = [length / (k * AREA) for length, k in LAYERS]
    total = sum(resistances, Fraction(0))
    heat_rate = (T_INSIDE - T_OUTSIDE) / total
    drops = [heat_rate * r for r in resistances]
    cells: dict[str, float] = {}
    # Column D is R, column E is the temperature drop; row 4 is the total.
    for row, (r, drop) in enumerate(zip(resistances, drops), start=1):
        cells[f"D{row}"] = float(r)
        cells[f"E{row}"] = float(drop)
    cells["D4"] = float(total)
    cells["E4"] = float(sum(drops, Fraction(0)))
    log = {
        "recompute": "learn-premium worked recompute v1",
        "by": "fixture-course/tools/recompute-composite-wall.py: R = L/(kA) in series, exact fractions, apart from the sheet",
        "cells": cells,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
