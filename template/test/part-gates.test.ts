// The 3D part checks on the Fixture Course's flanged hub: the GLB against the B-rep's record (every
// tagged dimension and the bounding box within 0.01 mm), the volume against an independent sum of
// the drawing's primitives (within 0.5 %), and every scaled or assumed dimension the Owner hasn't
// confirmed raised as a Checkpoint item that links to the viewer with that dimension highlighted.
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partChecks } from "../gates/parts.ts";
import { runControls } from "../gates/runner.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "07-flanged-hub";
const DESCRIPTOR = `modules/${MODULE}/parts/hub.json`;
const RECORD = `build-records/parts/${MODULE}/hub.json`;
const LOG = `build-records/recompute/${MODULE}/parts/hub.json`;
const GLB = `modules/${MODULE}/parts/hub.glb`;
const check = (contentDir: string) => partChecks.run({ contentDir, module: MODULE });

type Json = Record<string, unknown> & { dimensions: Record<string, unknown>[] };
const editJson = (file: string, edit: (data: Json) => void, from = FIXTURE_COURSE) =>
  fixtureWith(
    file,
    (source) => {
      const data = JSON.parse(source) as Json;
      edit(data);
      return JSON.stringify(data, null, 2);
    },
    from,
  );

/**
 * A copy of the Course whose GLB has every vertex scaled about the origin by `factor`, its record
 * rebound to the edited file, so only the geometry can give it away.
 */
function scaledGlb(factor: number): string {
  // Copied as bytes: fixtureWith edits text.
  const course = fixtureWith(RECORD, (s) => s);
  const bytes = readFileSync(join(FIXTURE_COURSE, GLB));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  };
  const bin = 20 + jsonLength + 8;
  for (const primitive of gltf.meshes[0]?.primitives ?? []) {
    const a = gltf.accessors[primitive.attributes.POSITION];
    const view = a && gltf.bufferViews[a.bufferView];
    if (!a || !view) throw new Error("no positions");
    const base = bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count * 3; i++) {
      const at = base + Math.floor(i / 3) * (view.byteStride ?? 12) + (i % 3) * 4;
      bytes.writeFloatLE(bytes.readFloatLE(at) * factor, at);
    }
  }
  writeFileSync(join(course, GLB), bytes);
  return editJson(
    RECORD,
    (r) => {
      r.glb = createHash("sha256").update(bytes).digest("hex");
    },
    course,
  );
}

describe("the 3D part checks", () => {
  it("pass the flanged hub: its GLB, its B-rep and the drawing's own sum agree", async () => {
    const result = await check(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ modules: 1, parts: 1, dimensions: 7, meshes: 1, volumes: 1 });
  });

  it("block a GLB that is 0.05 mm off the solid, though its build recorded it", async () => {
    const messages = (await check(scaledGlb(1.00125))).findings.map((f) => `${f.outcome}: ${f.message}`);
    expect(messages).toContain(
      "block: the GLB's bounding box is 0.05 mm off the solid's on x min, x max, y min, y max, z max (more than 0.01 mm): re-run npm run parts",
    );
    expect(messages).toContainEqual(
      // Not quite 0.05 where the line meets a facet between two of the rim's vertices.
      expect.stringMatching(
        /^block: Flange diameter \(flange-d\): on the GLB, its from end is 0\.0[45]\d* mm off the surface/,
      ),
    );
  });

  it("block a dimension the GLB measures 0.014 mm long, each end inside the tolerance", async () => {
    // Scaled by 1.0002: the rim 0.008 mm out, so the box and each end pass and only the length can tell.
    expect((await check(scaledGlb(1.0002))).findings.map((f) => f.message)).toEqual([
      "Flange diameter (flange-d): the GLB measures 80.014 mm where the solid measures 80 mm (more than 0.01 mm apart): re-run npm run parts",
      "Bolt-hole pitch circle (pcd): the GLB measures 60.012 mm where the solid measures 60 mm (more than 0.01 mm apart): re-run npm run parts",
    ]);
  });

  it("raise a scaled dimension the Owner hasn't confirmed, linking to the viewer with it highlighted", async () => {
    const course = editJson(DESCRIPTOR, (p) => {
      delete p.dimensions[3]?.confirmed;
    });
    const editedRecord = course; // the record measures ends, not confirmations
    expect((await check(editedRecord)).findings).toEqual([
      {
        outcome: "checkpoint",
        at: `/${MODULE}/#dim-${MODULE}-hub-height`,
        message:
          "Overall height (height) = 30 mm is scaled off the drawing, not stated: confirm it, or give the stated value",
      },
    ]);
  });

  it("block a pitch circle whose holes aren't where the drawing puts them", async () => {
    // As a build would record it if the script set the holes 1 mm further out than the drawing's 60.
    const move = (d: Record<string, unknown>) =>
      d.id === "pcd" ? { ...d, from: [-31, 0, 5], to: [31, 0, 5], value: 62 } : d;
    const described = editJson(DESCRIPTOR, (p) => {
      p.dimensions = p.dimensions.map(move);
    });
    const recorded = editJson(
      RECORD,
      (r) => {
        r.dimensions = r.dimensions.map((d) => (d.id === "pcd" ? { ...move(d), gaps: [1, 1] } : d));
      },
      described,
    );
    const messages = (await check(recorded)).findings.map((f) => f.message);
    expect(messages).toContain(
      "Bolt-hole pitch circle (pcd): on the solid, its from end is 1 mm off the axis of a round feature: a centres dimension runs between two axes",
    );
    expect(messages).toContain(
      "Bolt-hole pitch circle (pcd): on the GLB, its from end is 1 mm off the middle of a round feature: a centres dimension runs between two axes",
    );
  });

  it("block a part in a folder with no module.yaml", async () => {
    const course = fixtureWith(DESCRIPTOR, (s) => s);
    rmSync(join(course, `modules/${MODULE}/module.yaml`));
    expect((await check(course)).findings.map((f) => f.message)).toEqual([
      `sits in modules/${MODULE}/, which has no module.yaml, so no page would show it`,
    ]);
  });

  it("block a part that names a Worked example its Module doesn't have", async () => {
    const course = editJson(DESCRIPTOR, (p) => {
      p.worked = "9";
    });
    expect((await check(course)).findings).toEqual([
      {
        outcome: "block",
        at: DESCRIPTOR,
        message: `the part names Worked example 9, which Module ${MODULE} doesn't have`,
      },
    ]);
  });

  it("block a script edited after its build", async () => {
    const course = fixtureWith(`modules/${MODULE}/parts/hub.py`, (s) => s.replace("HOLE_D = 8", "HOLE_D = 9"));
    expect((await check(course)).findings).toEqual([
      {
        outcome: "block",
        at: DESCRIPTOR,
        message: "hub.py changed after the part was built, so its GLB and record are stale: re-run npm run parts",
      },
    ]);
  });

  it("block a dimension moved after the part was built", async () => {
    const course = editJson(DESCRIPTOR, (p) => {
      p.dimensions[0] = { ...p.dimensions[0], from: [-40, 0, 6], to: [40, 0, 6] };
    });
    expect((await check(course)).findings.map((f) => f.message)).toEqual([
      "the dimensions changed after the part was built (flange-d), so its record is stale: re-run npm run parts",
    ]);
  });

  it("block a dimension whose end isn't on the part", async () => {
    // Moved in the descriptor and in the record alike, as a build would have written it.
    const move = (d: Record<string, unknown>) => ({ ...d, from: [-45, 0, 5], to: [40, 0, 5], value: 85 });
    const described = editJson(DESCRIPTOR, (p) => {
      p.dimensions[0] = move(p.dimensions[0] ?? {});
    });
    const recorded = editJson(
      RECORD,
      (r) => {
        r.dimensions[0] = { ...move(r.dimensions[0] ?? {}), gaps: [5, 0] };
      },
      described,
    );
    expect((await check(recorded)).findings.map((f) => f.message)).toEqual([
      "Flange diameter (flange-d): on the solid, its from end is 5 mm off the surface: a dimension runs between two points on the part",
      "Flange diameter (flange-d): on the GLB, its from end is 5.002 mm off the surface: a dimension runs between two points on the part",
      "the independent recompute took flange-d = 80 mm, but the part's dimension is 85 mm: it must work from the same drawing",
    ]);
  });

  it("block a volume the drawing's primitives don't sum to", async () => {
    const course = editJson(LOG, (log) => {
      const values = log.values as { volume: number };
      values.volume *= 1.01;
    });
    expect((await check(course)).findings).toEqual([
      {
        outcome: "block",
        at: DESCRIPTOR,
        message:
          "the solid's volume is 63962.83 mm³ but the independent recompute sums the drawing to 64602.45 mm³ (1.00 % apart, more than 0.5 %); fix whichever is wrong",
      },
    ]);
  });

  it("block a recompute worked from another reading of a dimension", async () => {
    const course = editJson(LOG, (log) => {
      (log.inputs as Record<string, number>)["hole-d"] = 9;
    });
    expect((await check(course)).findings.map((f) => f.message)).toContain(
      "the independent recompute took hole-d = 9 mm, but the part's dimension is 8 mm: it must work from the same drawing",
    );
  });

  it("block a recompute that doesn't log every dimension it works from", async () => {
    const course = editJson(LOG, (log) => {
      delete (log.inputs as Record<string, number>)["bore-d"];
    });
    expect((await check(course)).findings.map((f) => f.message)).toEqual([
      `the independent recompute ${LOG} doesn't say what it took for bore-d: it logs every dimension of the drawing it works from`,
    ]);
  });

  it("block a part with no record, GLB or recompute", async () => {
    for (const [file, message] of [
      [RECORD, `no part record at ${RECORD}: build the part with npm run parts`],
      [GLB, `no GLB at ${GLB}: build the part with npm run parts`],
      [LOG, `no recompute log at ${LOG}: a part ships only once an independent recompute checks its volume`],
    ] as const) {
      const course = fixtureWith(DESCRIPTOR, (s) => s);
      rmSync(join(course, file));
      expect((await check(course)).findings).toEqual([{ outcome: "block", at: DESCRIPTOR, message }]);
    }
  });

  it("catch every negative control and pass the Course as it is", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE }, gates: [partChecks] });
    expect(result.gates[0]?.controls.filter((c) => !c.caught)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
