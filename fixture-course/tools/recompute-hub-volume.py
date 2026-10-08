"""The independent recompute for the Fixture Course's Worked example W07.1 (the flanged hub's
volume): the part as the (synthetic) Materials dimension it, split into the same primitives and
worked from V = pi/4 d^2 l, apart from the sheet and the part's model. It writes the recompute log
the worked-numbers gate compares the sheet with, by cell.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-hub-volume.py
"""

import json
import math
from pathlib import Path

LOG = (
    Path(__file__).resolve().parents[1]
    / "build-records"
    / "recompute"
    / "07-flanged-hub"
    / "worked-1.json"
)

# The part, as the synthetic Materials give it (mm): row → (diameter, length, count, sign).
PRIMITIVES = {
    1: (80, 10, 1, +1),  # the flange
    2: (40, 20, 1, +1),  # the hub standing on it
    3: (20, 30, 1, -1),  # the bore, through both
    4: (8, 10, 4, -1),  # four bolt holes, through the flange
}


def main() -> None:
    cells: dict[str, float] = {}
    for row, (d, length, count, sign) in PRIMITIVES.items():
        cells[f"D{row}"] = sign * count * math.pi / 4 * d**2 * length
    cells["D5"] = sum(cells.values())
    log = {
        "recompute": "learn-premium worked recompute v1",
        "by": "fixture-course/tools/recompute-hub-volume.py: V = pi/4 d^2 l per primitive, apart from the sheet and the model",
        "cells": cells,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
