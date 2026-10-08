"""The independent recompute for the Fixture Course's flanged hub: its volume as a sum of the
drawing's primitives, worked from the (synthetic) sheet drawing alone, never reading the build123d
script, its GLB or its part record. The part gates compare it with the volume the B-rep measures.

The hub is a flange disc, a hub cylinder standing on it, less a bore through both and four bolt
holes through the flange: no two of them overlap, so their volumes add and subtract exactly.

Run from the repo root (standard library only):

    python fixture-course/tools/recompute-flanged-hub.py
"""

import json
from math import pi
from pathlib import Path

LOG = Path(__file__).resolve().parents[1] / "build-records" / "recompute" / "07-flanged-hub" / "parts" / "hub.json"

# The drawing, by the part's dimension ids (mm); the bolt holes' count is a note on the drawing. The
# pitch circle places the holes and leaves the volume as it is, since none of them overlaps another.
DIMENSIONS = {"flange-d": 80, "flange-t": 10, "hub-d": 40, "height": 30, "bore-d": 20, "hole-d": 8, "pcd": 60}
HOLES = 4


def cylinder(diameter: float, length: float) -> float:
    return pi * diameter**2 / 4 * length


def main() -> None:
    d = DIMENSIONS
    flange = cylinder(d["flange-d"], d["flange-t"])
    hub = cylinder(d["hub-d"], d["height"] - d["flange-t"])
    bore = cylinder(d["bore-d"], d["height"])
    holes = HOLES * cylinder(d["hole-d"], d["flange-t"])
    log = {
        "recompute": "learn-premium recompute log v1",
        "by": "fixture-course/tools/recompute-flanged-hub.py: the drawing's primitives summed by hand (flange + hub - bore - holes)",
        "inputs": {**DIMENSIONS, "holes": HOLES},
        "values": {"volume": flange + hub - bore - holes},
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_bytes((json.dumps(log, indent=2) + "\n").encode("utf-8"))
    print(f"volume {log['values']['volume']:.3f} mm³ -> {LOG}")


if __name__ == "__main__":
    main()
