"""PROTOTYPE: exact involute spur gear in build123d (bd_warehouse 0.3.0 is broken on build123d 0.13).

Full-depth gear: addendum = m, dedendum = 1.25 m by default; tooth arc thickness s at the pitch
circle (default pi m / 2, i.e. zero backlash).
Tooth centreline on +X. Angles in radians unless noted.
"""
from math import acos, cos, pi, sin, tan

from build123d import CenterArc, Circle, Face, Line, Spline, Wire, extrude


def inv(a):
  return tan(a) - a


def half_angle(rho, rb, r, s, alpha):
  """Half the angular tooth thickness at radius rho (rho >= rb); s = arc thickness at pitch r."""
  return s / (2 * r) + inv(alpha) - inv(acos(rb / rho))


def pol(r, t):
  return (r * cos(t), r * sin(t))


def gear_profile(m, z, alpha_deg=20.0, s=None, dedendum=1.25, n=24):
  alpha = alpha_deg * pi / 180
  r = m * z / 2
  rb = r * cos(alpha)
  ra = r + m
  rf = r - dedendum * m
  s = pi * m / 2 if s is None else s
  r0 = max(rb, rf)  # involute starts at the base circle; below it the flank is radial
  edges = []
  pitch = 2 * pi / z
  for k in range(z):
    c = k * pitch
    up = [pol(r0 + (ra - r0) * i / n, c - half_angle(r0 + (ra - r0) * i / n, rb, r, s, alpha))
          for i in range(n + 1)]
    down = [pol(p_r, c + half_angle(p_r, rb, r, s, alpha))
            for p_r in [ra - (ra - r0) * i / n for i in range(n + 1)]]
    h0 = half_angle(r0, rb, r, s, alpha)
    if rf < r0:
      edges.append(Line(pol(rf, c - h0), pol(r0, c - h0)))
    edges.append(Spline(*up))
    ha = half_angle(ra, rb, r, s, alpha)
    edges.append(CenterArc((0, 0), ra, (c - ha) * 180 / pi, 2 * ha * 180 / pi))
    edges.append(Spline(*down))
    if rf < r0:
      edges.append(Line(pol(r0, c + h0), pol(rf, c + h0)))
    # root arc to the next tooth
    edges.append(CenterArc((0, 0), rf, (c + h0) * 180 / pi, (pitch - 2 * h0) * 180 / pi))
  return Wire(edges), dict(r=r, rb=rb, ra=ra, rf=rf, s=s)


def spur_gear(m, z, width, bore, alpha_deg=20.0, **kw):
  wire, radii = gear_profile(m, z, alpha_deg, **kw)
  face = Face(wire) - Circle(bore / 2)
  return extrude(face, width), radii
