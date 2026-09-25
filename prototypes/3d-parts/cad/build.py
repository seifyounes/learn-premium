"""PROTOTYPE (ticket #19): build three drawings as exact B-rep solids, export GLB, run checks.

Run from prototypes/3d-parts:  .venv/Scripts/python cad/build.py
Writes viewer/models/*.glb and viewer/checks.json.

Every number is tagged: "stated" (printed on the source), "derived" (arithmetic on stated
numbers), "scaled" (measured off the drawing at its own scale), or "assumed" (not in the source).
"""
import json
import sys
import struct
import time
from math import acos, asin, atan2, cos, pi, sin, sqrt, tan
from pathlib import Path

import numpy as np
from build123d import (Align, Box, Cone, Cylinder, Pos, Rot, SlotCenterToCenter, Circle, Unit,
                       export_gltf, extrude)

from involute import spur_gear

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "viewer" / "models"
MODELS.mkdir(parents=True, exist_ok=True)
MIN = (Align.CENTER, Align.CENTER, Align.MIN)
DEFLECTION = 0.01  # mm, tessellation chord tolerance for the GLB
checks = {}
sys.stdout.reconfigure(encoding="utf-8")


def export(shape, name):
  path = MODELS / f"{name}.glb"
  export_gltf(shape, str(path), unit=Unit.MM, binary=True, linear_deflection=DEFLECTION,
              angular_deflection=0.1)
  return path


def glb_bbox_mm(path):
  """Read POSITION min/max straight from the GLB's JSON chunk (glTF units are metres)."""
  data = path.read_bytes()
  n = struct.unpack_from("<I", data, 12)[0]
  gltf = json.loads(data[20:20 + n])
  lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
  for mesh in gltf["meshes"]:
    for prim in mesh["primitives"]:
      acc = gltf["accessors"][prim["attributes"]["POSITION"]]
      lo = np.minimum(lo, acc["min"])
      hi = np.maximum(hi, acc["max"])
  tris = sum(gltf["accessors"][p["indices"]]["count"] // 3
             for m in gltf["meshes"] for p in m["primitives"])
  return (hi - lo) * 1000, tris, len(data)


def row(name, source, tag, expected, measured, tol, conflict=False):
  """conflict=True: the source's own numbers disagree, so a miss is reported, not failed."""
  ok = abs(expected - measured) <= tol
  status = "PASS" if ok else ("CONFLICT" if conflict else "FAIL")
  return dict(name=name, source=source, tag=tag, expected=round(expected, 4),
              measured=round(measured, 4), tol=tol, ok=bool(ok), status=status)


# ---------------------------------------------------------------- 1. Tee fitting (exam 4.1)
def tee_solid(cone_deg):
  body = Box(50, 35, 35, align=MIN)                                   # stated 50, 35, 35
  boss = Pos(0, 0, 35) * Cylinder(12, 15, align=MIN)                  # stated Ø24, derived 50-35
  part = body + boss
  axis_z = 17.5                                                       # scaled 17.3 -> mid-height
  part -= Pos(0, 0, axis_z) * Rot(0, 90, 0) * Cylinder(8, 52)         # stated Ø16 through
  for x in (-20, 20):                                                 # derived (50-30)/2 = 10 deep
    part -= Pos(x, 0, axis_z) * Rot(0, 90, 0) * Cylinder(12, 10.001)  # stated Ø24
  cone_h = 8 / tan(cone_deg / 2 * pi / 180)
  top_of_hole = axis_z + 8
  tip = top_of_hole - cone_h
  part -= Pos(0, 0, top_of_hole) * Cylinder(8, 50 - top_of_hole + 1, align=MIN)  # stated Ø16
  part -= Pos(0, 0, tip) * Cone(0, 8, cone_h, align=MIN)              # scaled 90° drill point
  return part, tip


def inside_tee(x, y, z, cone_deg=90.0):
  """Independent point-membership test written from the drawing, not from the CAD code."""
  in_body = (abs(x) <= 25) & (abs(y) <= 17.5) & (z >= 0) & (z <= 35)
  in_boss = (x * x + y * y <= 144) & (z >= 35) & (z <= 50)
  r_h = np.sqrt(y * y + (z - 17.5) ** 2)
  hole = (r_h <= 8) | ((r_h <= 12) & (np.abs(x) >= 15))
  r_v = np.sqrt(x * x + y * y)
  k = tan(cone_deg / 2 * pi / 180)
  vbore = ((r_v <= 8) & (z >= 25.5)) | ((z >= 25.5 - 8 / k) & (z <= 25.5)
                                        & (r_v <= (z - (25.5 - 8 / k)) * k))
  return (in_body | in_boss) & ~hole & ~vbore


t0 = time.time()
tee, tip_z = tee_solid(90)
bb = tee.bounding_box().size
path = export(tee, "tee")
glb_size, tris, nbytes = glb_bbox_mm(path)
h = 0.25  # mm grid for the independent volume integral
gx, gy, gz = np.meshgrid(np.arange(-25 + h / 2, 25, h), np.arange(-17.5 + h / 2, 17.5, h),
                         np.arange(h / 2, 50, h), indexing="ij")
v_grid = inside_tee(gx, gy, gz).sum() * h ** 3
tee118, _ = tee_solid(118)
checks["tee"] = dict(
  title="Tee fitting (exam sheet, question 4.1)",
  build_s=round(time.time() - t0, 1), glb_bytes=nbytes, triangles=tris,
  valid=tee.is_valid,
  rows=[
    row("Overall length X", "front section", "stated", 50, bb.X, 1e-6),
    row("Overall depth Y", "plan", "stated", 35, bb.Y, 1e-6),
    row("Overall height Z", "side", "stated", 50, bb.Z, 1e-6),
    row("GLB length X (mesh, metres to mm)", "tessellated", "stated", 50, glb_size[0], DEFLECTION),
    row("GLB height Z (mesh)", "tessellated", "stated", 50, glb_size[2], DEFLECTION),
    row("Volume: B-rep vs independent grid integral (mm³)", "recompute", "derived",
        v_grid, tee.volume, 0.01 * v_grid),
    row("Drill-point tip on bore axis (z)", "front section", "scaled", 17.5, tip_z, 1e-6),
  ],
  notes=[
    "Stated on the sheet: 50, 35, 35, 50, 30, Ø24, Ø16.",
    "Derived: counterbore depth 10 = (50 − 30) / 2; boss height 15 = 50 − 35.",
    "Scaled off the drawing (11.94 px/mm): bore axis 17.3 → 17.5 (mid-height); drill point "
    "drawn at ~90°, not the 118° drafting standard; a 118° point would change the volume by "
    f"{tee118.volume - tee.volume:+.1f} mm³ — the kind of reading a Professor must confirm.",
    "The sheet is an exam that asks students to add dimensions, so it is under-dimensioned on "
    "purpose — the realistic case for lecture figures.",
  ],
)


# ---------------------------------------------------------------- 2. Spur gear pair (NASA TM)
m = 25.4 / 8                    # stated: 3.18 mm module (8 diametral pitch)
z = 28                          # stated
alpha = 20.0                    # stated
face = 6.35                     # stated
cd = 88.9                       # stated
r = m * z / 2
chordal = 4.85                  # stated chordal tooth thickness
s_arc = 2 * r * asin(chordal / (2 * r))
t0 = time.time()
gear, radii = spur_gear(m, z, face, 20.0, alpha, s=s_arc)            # bore Ø20 assumed
gpath = export(gear, "gear28")
g_glb, g_tris, g_bytes = glb_bbox_mm(gpath)

# measure tooth arc thickness at the pitch circle with a boolean: gear ∩ thin shell
eps = 0.001
shell = (Pos(0, 0, 1) * Cylinder(r + eps, 1)) - (Pos(0, 0, 1) * Cylinder(r - eps, 1.2))
pieces = (gear & shell).solids()
arc_measured = np.mean([p.volume for p in pieces]) / (2 * eps * 1)
chord_measured = 2 * r * sin(arc_measured / (2 * r))

# meshing: overlap volume at many angles, and backlash from the solid-to-solid distance
pitch_deg = 360 / z
overlaps, gaps = [], []
for k in range(8):
  t1 = k * pitch_deg / 8
  a_ = Rot(0, 0, t1) * gear
  b_ = Pos(cd, 0, 0) * Rot(0, 0, 180 + pitch_deg / 2 - t1) * gear      # ratio 28/28
  inter = a_ & b_
  overlaps.append(inter.volume if inter else 0.0)
  gaps.append(a_.distance_to(b_))
# wrong phase: shift the driven gear by a quarter pitch -> must collide
bad = (Rot(0, 0, 0) * gear) & (Pos(cd, 0, 0) * Rot(0, 0, 180 + pitch_deg / 4) * gear)
bad_overlap = bad.volume if bad else 0.0
rb, ra = radii["rb"], radii["ra"]
a_rad = alpha * pi / 180
contact_ratio = (2 * sqrt(ra ** 2 - rb ** 2) - cd * sin(a_rad)) / (pi * m * cos(a_rad))
normal_backlash = 2 * min(gaps)
s_015 = pi * m / 2 - 0.15 / cos(a_rad) / 2          # arc thickness giving 0.15 normal backlash
chord_for_015 = 2 * r * sin(s_015 / (2 * r))
checks["gears"] = dict(
  title="Spur gear pair (NASA TM-2010-216251, Table 1, design 1)",
  build_s=round(time.time() - t0, 1), glb_bytes=g_bytes, triangles=g_tris, valid=gear.is_valid,
  rows=[
    row("Outside diameter", "Table 1", "stated", 95.25, gear.bounding_box().size.X, 0.01),
    row("Outside diameter, GLB mesh", "tessellated", "stated", 95.25, g_glb[0], 0.02),
    row("Face width", "Table 1", "stated", 6.35, gear.bounding_box().size.Z, 1e-6),
    row("Chordal tooth thickness (boolean-measured)", "Table 1", "stated", 4.85,
        chord_measured, 0.01),
    row("Contact ratio (recomputed)", "Table 1", "stated", 1.64, contact_ratio, 0.01),
    row("Max tooth overlap over 8 angles (mm³)", "meshing", "derived", 0, max(overlaps), 1e-6),
    row("Normal backlash (2 × min solid gap)", "Table 1", "stated", 0.15, normal_backlash, 0.02,
        conflict=True),
    row("Wrong phase is caught: overlap (mm³) > 0", "control", "derived", 1,
        1.0 if bad_overlap > 1 else 0.0, 0),
  ],
  notes=[
    "Stated: 28 teeth, module 3.18 (8 DP), 20°, OD 95.25, face 6.35, centre distance 88.9, "
    "chordal thickness 4.85, backlash 0.15, contact ratio 1.64.",
    "Assumed: Ø20 bore (the table gives none).",
    f"The source is a table, not a drawing. Thinning teeth to the stated 4.85 chordal "
    f"thickness gives {normal_backlash:.3f} mm normal backlash, not the stated 0.15; a 0.15 "
    f"backlash would need a chordal thickness of {chord_for_015:.3f}. The table's own numbers do "
    "not reconcile under standard formulas, so the check reports a CONFLICT rather than hiding it.",
    f"bd_warehouse 0.3.0 (PyPI) fails on build123d 0.13 (\"Edges are disconnected\"); the "
    "involute is written from first principles in cad/involute.py.",
  ],
  overlaps=[round(o, 6) for o in overlaps], wrong_phase_overlap=round(bad_overlap, 1),
)


# ---------------------------------------------------------------- 3. Four-bar (Commons GIF)
L = dict(a=10, b=50, c=30, d=40, e=20)   # stated a..e; units unstated -> assumed mm
W, T, HOLE = 5.0, 2.0, 1.6               # assumed link width, thickness, pin hole


def link(length, holes, x0=0.0):
  body = extrude(Pos(x0 + length / 2, 0) * SlotCenterToCenter(length, W), T)
  for hx in holes:
    body -= Pos(hx, 0, 0) * Cylinder(HOLE / 2, 3 * T)
  return body


parts = dict(
  ground=link(L["d"], [0, L["d"]]),
  crank=link(L["a"], [0, L["a"]]),
  coupler=link(L["b"], [0, L["b"]]),
  rocker=link(L["c"] + L["e"], [-L["c"], 0], x0=-L["c"]),   # origin at the ground pivot
)
fb_sizes = {}
for name, solid in parts.items():
  p = export(solid, f"fourbar_{name}")
  fb_sizes[name] = p.stat().st_size

# kinematics reference: Freudenstein's equation (angle form), independent of the viewer's
# circle-intersection code; the Node check compares the two over a full crank turn
a, b, c, d = L["a"], L["b"], L["c"], L["d"]
K1, K2, K3 = d / a, d / c, (a * a - b * b + c * c + d * d) / (2 * a * c)
ref = []
for deg in range(0, 360, 5):
  t2 = deg * pi / 180
  A = cos(t2) - K1 - K2 * cos(t2) + K3
  B = -2 * sin(t2)
  C = K1 - (K2 + 1) * cos(t2) + K3
  disc = B * B - 4 * A * C
  # both assembly branches; the Node check reports which one the viewer follows
  ref.append([deg, 2 * atan2(-B + sqrt(disc), 2 * A), 2 * atan2(-B - sqrt(disc), 2 * A)])
s_, l_ = min(L["a"], L["b"], L["c"], L["d"]), max(L["a"], L["b"], L["c"], L["d"])
pq = sum([L["a"], L["b"], L["c"], L["d"]]) - s_ - l_
checks["fourbar"] = dict(
  title="Four-bar crank-rocker (Wikimedia Commons, MichaelFrey)",
  glb_bytes=sum(fb_sizes.values()), lengths=L,
  grashof=dict(s_plus_l=s_ + l_, p_plus_q=pq, crank_rocker=bool(s_ + l_ <= pq and s_ == L["a"])),
  freudenstein=ref,
  rows=[row("Grashof s + l ≤ p + q (crank turns fully)", "lengths", "derived", 1,
            1.0 if s_ + l_ <= pq else 0.0, 0)],
  notes=["Stated: a = 10, b = 50, c = 30, d = 40, e = 20 (rocker extension past its pivot).",
         "Assumed: units (mm), link width 5, thickness 2, pin Ø1.6 — none are in the figure.",
         "Motion is not baked: the page solves the linkage every frame from the crank angle."],
)

(ROOT / "viewer" / "checks.json").write_text(json.dumps(checks, indent=1))
for k, v in checks.items():
  for rw in v["rows"]:
    print(f"[{rw['status']}] {k:8} {rw['name']}: expected {rw['expected']}, "
          f"measured {rw['measured']}")
  print(k, {x: v.get(x) for x in ("build_s", "glb_bytes", "triangles", "valid")})
