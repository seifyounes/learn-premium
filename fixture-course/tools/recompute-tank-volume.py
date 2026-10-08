"""The independent recompute for the Fixture Course's Worked example W06.1 (the tank's volume from
its level transmitter): the problem as the (synthetic) Materials state it, worked from the
geometry of a horizontal cylinder, written apart from the sheet and the STL listing and never
reading either. The row the tank sim maps (raw 13624) is that sim's to check against awlsim; this
log gives the other two rows, the ones only the sheet works out.

Each raw value gets the zero-point offset; the level is that over 27648 times the diameter; the
wetted area of a circle of radius r filled to h is r^2 acos(d/r) - d sqrt(2rh - h^2), d = r - h;
the volume is that area times the length, in litres.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-tank-volume.py
"""

import json
import math
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "06-tank-level"
    / "worked-1.json"
)

# The problem, as the synthetic Materials give it.
RADIUS = 1.0  # m
LENGTH = 4.0  # m
FULL_SCALE = 27648  # raw value of a full tank
OFFSET = 200  # zero-point offset
# The sheet's rows 1 and 3 (row 2, raw 13624, is the tank sim's).
RAW = {1: 6712, 3: 20536}


def main() -> None:
    cells: dict[str, float] = {}
    for row, raw in RAW.items():
        corrected = raw + OFFSET
        level = corrected / FULL_SCALE * 2 * RADIUS
        d = RADIUS - level
        area = RADIUS**2 * math.acos(d / RADIUS) - d * math.sqrt(2 * RADIUS * level - level**2)
        cells[f"B{row}"] = float(corrected)
        cells[f"C{row}"] = level
        cells[f"D{row}"] = area
        cells[f"E{row}"] = area * LENGTH * 1000
    log = {
        "recompute": "learn-premium worked recompute v1",
        "by": "fixture-course/tools/recompute-tank-volume.py: circular-segment area from the level, apart from the sheet and the listing",
        "cells": cells,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
