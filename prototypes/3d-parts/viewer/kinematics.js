// PROTOTYPE: live kinematics the page solves every frame (no baked animation).
// Shared by index.html and check_kinematics.mjs, so the page runs exactly the code that is checked.

export const LINKS = { a: 10, b: 50, c: 30, d: 40, e: 20 }; // crank, coupler, rocker, ground, ext.

// Four-bar by circle intersection. Ground pivots O2 = (0,0), O4 = (d,0).
// branch = -1 puts the coupler-rocker joint below the ground line, as in the drawing.
export function fourbar(t2, L = LINKS, branch = -1) {
  const A = [L.a * Math.cos(t2), L.a * Math.sin(t2)];
  const dx = L.d - A[0], dy = -A[1];
  const D = Math.hypot(dx, dy);
  const along = (L.b * L.b - L.c * L.c + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L.b * L.b - along * along));
  const B = [A[0] + (along * dx - branch * h * dy) / D, A[1] + (along * dy + branch * h * dx) / D];
  const t3 = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const t4 = Math.atan2(B[1], B[0] - L.d);          // O4 -> B
  const tip = [L.d - L.e * Math.cos(t4), -L.e * Math.sin(t4)]; // extension, past the pivot
  const mu = Math.acos(Math.max(-1, Math.min(1, (L.b * L.b + L.c * L.c - D * D) / (2 * L.b * L.c))));
  return { A, B, tip, t3, t4, mu };
}

// Gear pair: driven angle from driver angle (external mesh reverses direction).
export function gearPair(t1, z1, z2, phase) {
  return phase - t1 * z1 / z2;
}
