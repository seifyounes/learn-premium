"""The independent recompute for the Fixture Course's Worked example W09.1 (weighing the blending
station's hopper): the problem as the (synthetic) Materials state it, worked by hand's arithmetic,
written apart from the sheet and the SCL listing and never reading either. The row the blender sim
maps (raw 6480, 4320, 6480) is that sim's to check against the blind interpreter; this log gives the
other two rows, the ones only the sheet works out.

Each load cell reads raw / 27648 of 500 kg; the hopper holds their sum; the batch is the recipe's
120 + 80 + 120 kg; bags are the hopper's weight over 25 kg, rounded to the nearest bag.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-blender.py
"""

import json
import math
from pathlib import Path

LOG = Path(__file__).resolve().parents[1] / "build-records" / "recompute" / "09-silo-blender" / "worked-1.json"

# The problem, as the synthetic Materials give it.
FULL_SCALE = 27648  # raw value of a full load cell
FULL_KG = 500.0  # kg at full scale
RECIPE_KG = 120.0 + 80.0 + 120.0
BAG_KG = 25.0
# The sheet's rows 1 and 3 (row 2 is the blender sim's).
RAW = {1: (3456, 2592, 4320), 3: (7344, 4536, 6912)}


def main() -> None:
    cells: dict[str, float] = {}
    for row, raws in RAW.items():
        total = sum(raw / FULL_SCALE * FULL_KG for raw in raws)
        bags = total / BAG_KG
        cells[f"D{row}"] = total
        cells[f"E{row}"] = total / RECIPE_KG * 100
        # To the nearest bag, a half up as the statement counts it (row 1's 7.5 is 8 either way).
        cells[f"F{row}"] = float(math.floor(bags + 0.5))
    log = {
        "recompute": "learn-premium worked recompute v1",
        "by": "fixture-course/tools/recompute-blender.py: load cells scaled and summed, apart from the sheet and the listing",
        "cells": cells,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {LOG}")


if __name__ == "__main__":
    main()
