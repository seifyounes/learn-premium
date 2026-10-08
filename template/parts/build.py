"""Builds a Course's machine parts: each exact solid as build123d makes it, exported to GLB, and
measured on the solid itself for the part gates.

For every part in the Course (`modules/<NN-slug>/parts/<name>.json`, naming its build123d script
`source` beside it), this runs the script, which must leave the solid in `part`, then writes:

- `modules/<NN-slug>/parts/<name>.glb`: the solid tessellated to within LINEAR_DEFLECTION, the file
  the page's viewer loads (glTF: metres, +Y up);
- `build-records/parts/<NN-slug>/<name>.json`: the part record. What the B-rep measures (is it a
  valid solid, its volume and bounding box, and for each tagged dimension where its two ends meet
  the solid's surface and the surface's normal there), bound to the script and the GLB by their
  SHA-256, so a script edited after its build, or a GLB from another build, is stale.

The part gates check the GLB against the record in Node: Template CI has no build123d, so the
record is the B-rep's word, committed beside the Course's other build records.

Run with the machine venv's Python (it has build123d), from the template:

    npm run parts                 # every part in CONTENT_DIR (the Fixture Course by default)
    npm run parts -- --module 07-flanged-hub
"""

import argparse
import hashlib
import json
import runpy
import sys
from pathlib import Path

from build123d import Shape, Unit, Vector, export_gltf
from build123d import __version__ as BUILD123D_VERSION
from OCP.BRepMesh import BRepMesh_IncrementalMesh

RECORD = "learn-premium part record v1"
# The GLB's chord error, in millimetres, absolute (build123d's own export takes it relative to each
# edge's size). Half the gates' 0.01 mm: a dimension measured on the mesh may lose it at both ends.
LINEAR_DEFLECTION = 0.004
# Loose on purpose, so the linear deflection decides the mesh, never the angle.
ANGULAR_DEFLECTION = 0.5


def sha256_text(path: Path) -> str:
    """A text file's SHA-256 with its line endings as LF, so a checkout's CRLF changes nothing."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def sha256_bytes(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def surface_at(solid: Shape, point: list[float]) -> tuple[float, list[float]]:
    """How far `point` is from the solid's surface, and the surface's unit normal nearest it."""
    p = Vector(*point)
    face = min(solid.faces(), key=lambda f: f.distance_to(p))
    normal = face.normal_at(p).normalized()
    return face.distance_to(p), [normal.X, normal.Y, normal.Z]


def build_part(content: Path, module: str, descriptor: Path) -> str:
    name = descriptor.stem
    spec = json.loads(descriptor.read_text(encoding="utf-8"))
    script = descriptor.parent / spec["source"]
    solid = runpy.run_path(str(script), run_name="__part__").get("part")
    if not isinstance(solid, Shape):
        raise SystemExit(f"{script}: the script must leave its solid in `part`")

    glb = descriptor.with_suffix(".glb")
    BRepMesh_IncrementalMesh(solid.wrapped, LINEAR_DEFLECTION, False, ANGULAR_DEFLECTION, True)
    # The triangulation above is finer than this asks for, so the export keeps it.
    if not export_gltf(solid, str(glb), unit=Unit.MM, binary=True,
                       linear_deflection=LINEAR_DEFLECTION, angular_deflection=ANGULAR_DEFLECTION):
        raise SystemExit(f"{glb}: the GLB export failed")

    box = solid.bounding_box(optimal=True)
    dimensions = []
    for d in spec["dimensions"]:
        ends = [surface_at(solid, d["from"]), surface_at(solid, d["to"])]
        dimensions.append({
            "id": d["id"],
            "from": d["from"],
            "to": d["to"],
            "value": d["value"],
            "gaps": [gap for gap, _ in ends],
            "normals": [normal for _, normal in ends],
        })
    record = {
        "record": RECORD,
        "by": f"build123d {BUILD123D_VERSION}",
        "script": sha256_text(script),
        "glb": sha256_bytes(glb),
        "deflection": {"linear": LINEAR_DEFLECTION, "angular": ANGULAR_DEFLECTION},
        "valid": bool(solid.is_valid),
        "volume": solid.volume,
        "bbox": {"min": [box.min.X, box.min.Y, box.min.Z], "max": [box.max.X, box.max.Y, box.max.Z]},
        "dimensions": dimensions,
    }
    out = content / "build-records" / "parts" / module / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes((json.dumps(record, indent=2) + "\n").encode("utf-8"))
    return f"{module}/{name}: {glb.stat().st_size} B GLB, volume {solid.volume:.3f} mm³"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--content", required=True, type=Path, help="the Course's content folder")
    parser.add_argument("--module", help="build only this Module's parts (its folder name)")
    args = parser.parse_args()
    content = args.content.resolve()
    built = 0
    for descriptor in sorted(content.glob("modules/*/parts/*.json")):
        module = descriptor.parent.parent.name
        if args.module and module != args.module:
            continue
        print(build_part(content, module, descriptor))
        built += 1
    print(f"built {built} part(s) with build123d {BUILD123D_VERSION}")


if __name__ == "__main__":
    main()
