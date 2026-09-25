// PROTOTYPE: cross-check the viewer's four-bar solver against Python's Freudenstein reference.
// Run from prototypes/3d-parts:  node cad/check_kinematics.mjs   (after cad/build.py)
import { readFileSync, writeFileSync } from "node:fs";
import { fourbar, LINKS } from "../viewer/kinematics.js";

const path = new URL("../viewer/checks.json", import.meta.url);
const checks = JSON.parse(readFileSync(path, "utf8"));
const fb = checks.fourbar;
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));

let err = [0, 0], closure = 0, swing = [Infinity, -Infinity];
for (const [deg, t4p, t4m] of fb.freudenstein) {
  const s = fourbar((deg * Math.PI) / 180);
  err[0] = Math.max(err[0], Math.abs(wrap(s.t4 - t4p)));
  err[1] = Math.max(err[1], Math.abs(wrap(s.t4 - t4m)));
  closure = Math.max(
    closure,
    Math.abs(Math.hypot(s.B[0] - s.A[0], s.B[1] - s.A[1]) - LINKS.b),
    Math.abs(Math.hypot(s.B[0] - LINKS.d, s.B[1]) - LINKS.c),
  );
}
for (let i = 0; i < 3600; i++) {
  const t4 = fourbar((i / 10) * (Math.PI / 180)).t4;
  const deg = ((t4 * 180) / Math.PI + 360) % 360;
  swing = [Math.min(swing[0], deg), Math.max(swing[1], deg)];
}
const branch = err[0] < err[1] ? 0 : 1;
const maxErrDeg = (err[branch] * 180) / Math.PI;
const row = (name, expected, measured, tol) => ({
  name, source: "recompute", tag: "derived", expected, measured: +measured.toFixed(6), tol,
  ok: Math.abs(expected - measured) <= tol,
  status: Math.abs(expected - measured) <= tol ? "PASS" : "FAIL",
});
fb.rows = fb.rows.filter((r) => r.source !== "recompute").concat([
  row("Rocker angle: viewer vs Freudenstein, max error (deg)", 0, maxErrDeg, 1e-6),
  row("Loop closure: link-length drift, max (mm)", 0, closure, 1e-9),
]);
fb.rocker_swing_deg = [+swing[0].toFixed(2), +swing[1].toFixed(2)];
fb.branch = branch === 0 ? "+sqrt" : "-sqrt";
writeFileSync(path, JSON.stringify(checks, null, 1));
for (const r of fb.rows) console.log(`[${r.status}] ${r.name}: ${r.measured}`);
console.log("rocker swing (deg):", fb.rocker_swing_deg, "Freudenstein branch:", fb.branch);
