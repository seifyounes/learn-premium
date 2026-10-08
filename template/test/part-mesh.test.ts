// A part's GLB read back the way the part gates read it: in the CAD frame the drawing is dimensioned
// in (millimetres, +Z up), measured on the mesh itself. The Fixture Course's flanged hub is the
// known part: its drawing gives every number expected here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundingBox, measureAlong, meshVolume, openEdges, readPartMesh, signedVolume } from "../src/parts/mesh";
import { FIXTURE_COURSE } from "./build-course";

const glb = readFileSync(join(FIXTURE_COURSE, "modules/07-flanged-hub/parts/hub.glb"));
const mesh = readPartMesh(glb);
/** π/4 (80²·10 + 40²·20 − 20²·30 − 4·8²·10), the drawing's primitives, in mm³. */
const DRAWN_VOLUME = 63962.826;

describe("a part's mesh", () => {
  it("reads in the drawing's frame: millimetres, z up", () => {
    const box = boundingBox(mesh);
    [-40, -40, 0].forEach((v, i) => expect(box.min[i]).toBeCloseTo(v, 2));
    [40, 40, 30].forEach((v, i) => expect(box.max[i]).toBeCloseTo(v, 2));
  });

  it("is closed: every edge joins two triangles, across the faces it was exported in", () => {
    expect(openEdges(mesh)).toBe(0);
    // One triangle folded onto a corner leaves its three edges open.
    const folded = Float64Array.from(mesh.positions);
    folded.copyWithin(3, 0, 3);
    folded.copyWithin(6, 0, 3);
    expect(openEdges({ positions: folded })).toBe(3);
    // One triangle turned inside out: every edge still joins two triangles, three of them facing apart.
    const turned = Float64Array.from(mesh.positions);
    turned.set(mesh.positions.subarray(6, 9), 3);
    turned.set(mesh.positions.subarray(3, 6), 6);
    expect(openEdges({ positions: turned })).toBe(3);
  });

  it("faces outward, as glTF's front faces must", () => {
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it("encloses the solid's volume", () => {
    expect(Math.abs(meshVolume(mesh) - DRAWN_VOLUME) / DRAWN_VOLUME).toBeLessThan(0.001);
  });

  it("measures a dimension where its line meets the surface, with the surface's normal there", () => {
    const flange = measureAlong(mesh, [-40, 0, 5], [40, 0, 5]);
    expect(flange.length).toBeCloseTo(80, 2);
    for (const end of flange.ends) {
      expect(end.gap).toBeLessThan(0.01);
      expect(Math.abs(end.normal[0])).toBeGreaterThan(0.99);
    }
    // The bore: the line runs through empty space between its walls.
    expect(measureAlong(mesh, [-10, 0, 15], [10, 0, 15]).length).toBeCloseTo(20, 2);
    expect(measureAlong(mesh, [15, 0, 0], [15, 0, 30]).length).toBeCloseTo(30, 2);
  });

  it("finds no surface where a dimension's end floats in the air", () => {
    const off = measureAlong(mesh, [-45, 0, 5], [40, 0, 5]);
    expect(off.ends[0].gap).toBeGreaterThan(4);
  });

  it("refuses a file that isn't a GLB", () => {
    expect(() => readPartMesh(Buffer.from("not a glb at all"))).toThrow(/GLB/);
  });
});
