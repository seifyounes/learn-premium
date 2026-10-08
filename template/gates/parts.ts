// The 3D part checks, per job: every machine part's GLB against the B-rep's record and the
// drawing. The record (`npm run parts`, build123d in the machine venv) holds what the exact solid
// measures; this gate measures the GLB itself (`src/parts/mesh.ts`), so a GLB that isn't the solid,
// a script edited after its build, a dimension the part doesn't have or a volume the drawing's own
// primitives don't sum to all block. A scaled or assumed dimension the Owner hasn't confirmed is a
// Checkpoint item, linking to the viewer with that dimension highlighted.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { part as partSchema } from "../src/content/contract.ts";
import { moduleOf } from "../src/content/layout.ts";
import { readStructured } from "../src/content/loaders.ts";
import {
  boundingBox,
  dot,
  measureAlong,
  meshVolume,
  openEdges,
  readPartMesh,
  signedVolume,
  sub,
  type Point3,
} from "../src/parts/mesh.ts";
import {
  dimensionAnchor,
  partGlbEntry,
  partPage,
  partRecomputeLog,
  partRecord,
  partRecomputeEntry,
  partRecordEntry,
  type PartRecord,
} from "../src/parts/record.ts";
import { courseCopy, courseFiles, type CourseFile } from "./course-files.ts";
import type { Finding, Gate, GateInput } from "./runner.ts";
import { nameOf, problems } from "./sims.ts";

/** GLB against B-rep: every tagged dimension and the bounding box (the ticket's 0.01 mm). */
export const MESH_TOLERANCE_MM = 0.01;
/** An independent volume against the B-rep's, and the mesh's against it. */
export const VOLUME_TOLERANCE = 0.005;
/** On the exact solid an end lies on its surface but for float noise. */
const SOLID_GAP_MM = 1e-4;
/** A dimension meets the solid's surface square: its line along the surface normal. */
const SOLID_SQUARE = 0.9999;
/** On the mesh a facet near a curved surface leans by up to half the tessellation angle. */
const MESH_SQUARE = 0.98;

const REBUILD = "re-run npm run parts";
const mm = (n: number) => `${Number(n.toFixed(3))} mm`;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** A script's hash as the build takes it: its line endings as LF. */
const scriptHash = (path: string) => sha256(Buffer.from(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), "utf8"));
const unit = (v: Point3): Point3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const sameEnds = (a: { from: number[]; to: number[]; value: number }, b: typeof a) =>
  a.value === b.value && a.from.join() === b.from.join() && a.to.join() === b.to.join();

interface PartSite {
  file: CourseFile;
  module: string;
  name: string;
}

function partsInScope(input: GateInput) {
  const files = courseFiles(input);
  return {
    parts: files
      .filter((f) => f.collection === "parts")
      .map((file) => ({ file, module: moduleOf(file.entry) ?? "", name: nameOf(file.entry) })),
    modules: files.filter((f) => f.collection === "modules").length,
  };
}

/** Everything one part breaks, and what was checked. */
function checkPart({ contentDir }: GateInput, { file, module, name }: PartSite) {
  const findings: Finding[] = [];
  const counted = { dimensions: 0, meshes: 0, volumes: 0 };
  const block = (message: string) => findings.push({ outcome: "block", at: file.entry, message });
  const result = () => ({ findings, counted });

  const parsed = partSchema.safeParse(readStructured(readFileSync(file.path, "utf8"), file.entry, () => {}));
  if (!parsed.success) {
    block(`can't check the part: the content contract reports ${problems(parsed.error)}`);
    return result();
  }
  const p = parsed.data;
  const script = join(contentDir, "modules", module, "parts", p.source);
  const glbEntry = partGlbEntry(module, name);
  const recordEntry = partRecordEntry(module, name);
  const logEntry = partRecomputeEntry(module, name);
  if (!existsSync(script)) {
    block(`names parts/${p.source}, which isn't in its folder`);
    return result();
  }
  // The viewer sits below the Worked example it names: one the Module lacks would hide it from the
  // Module page, and a Checkpoint item would link to nothing.
  const worked = p.worked;
  if (
    worked !== undefined &&
    !["json", "yaml", "yml"].some((ext) =>
      existsSync(join(contentDir, "modules", module, "worked", `${worked}.${ext}`)),
    )
  ) {
    block(`the part names Worked example ${worked}, which Module ${module} doesn't have`);
    return result();
  }
  for (const [entry, what] of [
    [recordEntry, "part record"],
    [glbEntry, "GLB"],
  ] as const) {
    if (!existsSync(join(contentDir, entry))) {
      block(`no ${what} at ${entry}: build the part with npm run parts`);
      return result();
    }
  }
  let record: PartRecord;
  try {
    const read = partRecord.safeParse(JSON.parse(readFileSync(join(contentDir, recordEntry), "utf8")));
    if (!read.success) {
      block(`the part record ${recordEntry} isn't one: ${problems(read.error)}`);
      return result();
    }
    record = read.data;
  } catch (error) {
    block(`can't read the part record ${recordEntry}: ${(error as Error).message}`);
    return result();
  }

  // Bound to what it was built from: anything changed since is stale, and nothing below can be trusted.
  const glbBytes = readFileSync(join(contentDir, glbEntry));
  if (scriptHash(script) !== record.script) {
    block(`${p.source} changed after the part was built, so its GLB and record are stale: ${REBUILD}`);
    return result();
  }
  if (sha256(glbBytes) !== record.glb) {
    block(`${glbEntry} isn't the GLB the part's build wrote: ${REBUILD}`);
    return result();
  }
  const changed = [
    ...p.dimensions.filter((d) => !record.dimensions.some((r) => r.id === d.id && sameEnds(r, d))).map((d) => d.id),
    ...record.dimensions.filter((r) => !p.dimensions.some((d) => d.id === r.id)).map((r) => r.id),
  ];
  if (changed.length > 0) {
    block(
      `the dimensions changed after the part was built (${changed.join(", ")}), so its record is stale: ${REBUILD}`,
    );
    return result();
  }
  if (!record.valid) block("OpenCascade calls the solid invalid, so nothing measured on it can be trusted");

  let mesh;
  try {
    mesh = readPartMesh(glbBytes);
    counted.meshes += 1;
  } catch (error) {
    block(`can't read ${glbEntry}: ${(error as Error).message}`);
    return result();
  }

  // The bounding box, axis by axis.
  const box = boundingBox(mesh);
  const off: string[] = [];
  let worst = 0;
  for (const [end, glb, solid] of [
    ["min", box.min, record.bbox.min],
    ["max", box.max, record.bbox.max],
  ] as const) {
    ["x", "y", "z"].forEach((axis, i) => {
      const gap = Math.abs((glb[i] ?? NaN) - (solid[i] ?? NaN));
      if (!(gap <= MESH_TOLERANCE_MM)) {
        off.push(`${axis} ${end}`);
        worst = Math.max(worst, gap);
      }
    });
  }
  if (off.length > 0) {
    const order = ["x min", "x max", "y min", "y max", "z min", "z max"];
    off.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    block(
      `the GLB's bounding box is ${mm(worst)} off the solid's on ${off.join(", ")} (more than ${MESH_TOLERANCE_MM} mm): ${REBUILD}`,
    );
  }

  // Every tagged dimension, on the solid and on the mesh.
  for (const d of p.dimensions) {
    counted.dimensions += 1;
    const named = `${d.label} (${d.id})`;
    const r = record.dimensions.find((x) => x.id === d.id);
    const dir = unit(sub(d.to, d.from));
    const ENDS = ["from", "to"] as const;
    ENDS.forEach((end, i) => {
      const gap = r?.gaps[i] ?? Infinity;
      if (!(gap <= SOLID_GAP_MM))
        block(
          `${named}: on the solid, its ${end} end is ${mm(gap)} off the surface: a dimension runs between two points on the part`,
        );
      else if (Math.abs(dot(r?.normals[i] ?? [0, 0, 0], dir)) < SOLID_SQUARE)
        block(
          `${named}: on the solid, its line doesn't meet the surface square at its ${end} end: a dimension runs between two faces it meets square, or across a diameter`,
        );
    });
    const measured = measureAlong(mesh, d.from, d.to);
    const onMesh = measured.ends.every((e) => e.gap <= MESH_TOLERANCE_MM);
    ENDS.forEach((end, i) => {
      const e = measured.ends[i];
      if (!e) return;
      if (!(e.gap <= MESH_TOLERANCE_MM))
        block(
          `${named}: on the GLB, its ${end} end is ${mm(e.gap)} off the surface: a dimension runs between two points on the part`,
        );
      else if (Math.abs(dot(e.normal, dir)) < MESH_SQUARE)
        block(`${named}: on the GLB, its line doesn't meet the surface square at its ${end} end`);
    });
    if (onMesh && !(Math.abs(measured.length - d.value) <= MESH_TOLERANCE_MM))
      block(
        `${named}: the GLB measures ${mm(measured.length)} where the solid measures ${mm(d.value)} (more than ${MESH_TOLERANCE_MM} mm apart): ${REBUILD}`,
      );
    // Only the Owner can say a reading off the drawing, or a value the drawing lacks, is right.
    if ((d.tag === "scaled" || d.tag === "assumed") && !d.confirmed)
      findings.push({
        outcome: "checkpoint",
        at: `${partPage(module, p.worked)}#${dimensionAnchor(module, name, d.id)}`,
        message: `${named} = ${d.value} mm is ${d.tag === "scaled" ? "scaled off the drawing" : "assumed: the drawing doesn't give it"}, not stated: confirm it, or give the stated value`,
      });
  }

  // A closed surface first: an open one encloses no volume, whatever its triangles sum to.
  const open = openEdges(mesh);
  if (open > 0)
    block(
      `the GLB's surface is open (${open} edge(s) don't join two triangles facing the same way), so it isn't a closed solid: ${REBUILD}`,
    );
  // Outward: glTF draws only front faces, so a surface wound inside out is culled from outside.
  if (signedVolume(mesh) < 0)
    block(`the GLB's surface faces inward, so the viewer would cull the part's outside: ${REBUILD}`);
  const apart = (a: number, b: number) => Math.abs(a - b) / b;
  const meshV = meshVolume(mesh);
  if (apart(meshV, record.volume) > VOLUME_TOLERANCE)
    block(
      `the GLB encloses ${meshV.toFixed(2)} mm³ but the solid ${record.volume.toFixed(2)} mm³ (more than ${VOLUME_TOLERANCE * 100} % apart): the mesh isn't closed, or isn't this solid; ${REBUILD}`,
    );

  // The volume, against the independent recompute's sum of the drawing's primitives.
  const logPath = join(contentDir, logEntry);
  if (!existsSync(logPath)) {
    block(`no recompute log at ${logEntry}: a part ships only once an independent recompute checks its volume`);
    return result();
  }
  let log;
  try {
    log = partRecomputeLog.safeParse(JSON.parse(readFileSync(logPath, "utf8")));
  } catch (error) {
    block(`can't read the recompute log ${logEntry}: ${(error as Error).message}`);
    return result();
  }
  if (!log.success) {
    block(`the recompute log ${logEntry} isn't one: ${problems(log.error)}`);
    return result();
  }
  counted.volumes += 1;
  // It works from the whole drawing: every dimension the part tags, as read there.
  const unread = p.dimensions.filter((d) => !(d.id in log.data.inputs)).map((d) => d.id);
  if (unread.length > 0)
    block(
      `the independent recompute ${logEntry} doesn't say what it took for ${unread.join(", ")}: it logs every dimension of the drawing it works from`,
    );
  for (const d of p.dimensions.filter((x) => x.id in log.data.inputs)) {
    const took = log.data.inputs[d.id] ?? NaN;
    if (Math.abs(took - d.value) > 1e-9)
      block(
        `the independent recompute took ${d.id} = ${took} mm, but the part's dimension is ${d.value} mm: it must work from the same drawing`,
      );
  }
  const summed = log.data.values.volume;
  if (apart(summed, record.volume) > VOLUME_TOLERANCE)
    block(
      `the solid's volume is ${record.volume.toFixed(2)} mm³ but the independent recompute sums the drawing to ${summed.toFixed(2)} mm³ (${(apart(summed, record.volume) * 100).toFixed(2)} % apart, more than ${VOLUME_TOLERANCE * 100} %); fix whichever is wrong`,
    );
  return result();
}

/** Writes JSON back as the build does. */
const writeJson = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

interface PlantSite {
  contentDir: string;
  descriptor: string;
  record: string;
  glb: string;
  log: string;
  script: string;
}

/** A scratch copy of the Course with `plant` run on the first part in scope. Throws when there is none. */
function plantInPart(good: GateInput, scratch: string, plant: (site: PlantSite) => void): GateInput {
  const copy = courseCopy(good, scratch);
  const [first] = partsInScope(copy).parts;
  if (!first) throw new Error(`no machine part in ${good.contentDir} to plant a negative control in`);
  const { contentDir } = copy;
  const descriptor = first.file.path;
  const spec = readJson<{ source: string }>(descriptor);
  plant({
    contentDir,
    descriptor,
    record: join(contentDir, partRecordEntry(first.module, first.name)),
    glb: join(contentDir, partGlbEntry(first.module, first.name)),
    log: join(contentDir, partRecomputeEntry(first.module, first.name)),
    script: join(contentDir, "modules", first.module, "parts", spec.source),
  });
  return copy;
}

/** Edits a GLB in place and rebinds the part's record to it, so only its geometry can give it away. */
function editGlb(site: PlantSite, edit: (bytes: Buffer, layout: GlbLayout) => void) {
  const bytes = readFileSync(site.glb);
  edit(bytes, glbLayout(bytes));
  writeFileSync(site.glb, bytes);
  const record = readJson<Record<string, unknown>>(site.record);
  writeJson(site.record, { ...record, glb: sha256(bytes) });
}

interface GlbLayout {
  /** Byte offset of each primitive's positions (float32 VEC3) and indices, with their counts. */
  primitives: {
    positions: number;
    stride: number;
    count: number;
    indices?: { at: number; size: number; count: number };
  }[];
}

function glbLayout(bytes: Buffer): GlbLayout {
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  };
  const bin = 20 + jsonLength + 8;
  const at = (index: number) => {
    const a = gltf.accessors[index];
    const view = a && gltf.bufferViews[a.bufferView];
    if (!a || !view) throw new Error(`the GLB's accessor ${index} can't be found`);
    return { a, view, offset: bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) };
  };
  return {
    primitives: gltf.meshes.flatMap((m) =>
      m.primitives.map((p) => {
        const pos = at(p.attributes.POSITION);
        const idx = p.indices === undefined ? undefined : at(p.indices);
        return {
          positions: pos.offset,
          stride: pos.view.byteStride ?? 12,
          count: pos.a.count,
          ...(idx && {
            indices: {
              at: idx.offset,
              size: idx.a.componentType === 5125 ? 4 : idx.a.componentType === 5123 ? 2 : 1,
              count: idx.a.count,
            },
          }),
        };
      }),
    ),
  };
}

type RecordDimension = PartRecord["dimensions"][number];
/** Edits the first dimension in the descriptor and the record alike, as a build would have written it. */
function editFirstDimension(
  site: PlantSite,
  edit: (d: Record<string, unknown>) => Record<string, unknown>,
  recordOnly: Partial<RecordDimension>,
) {
  const spec = readJson<{ dimensions: Record<string, unknown>[] }>(site.descriptor);
  const record = readJson<{ dimensions: Record<string, unknown>[] }>(site.record);
  const [d] = spec.dimensions;
  const [r] = record.dimensions;
  if (!d || !r) throw new Error("the part has no dimension to plant a defect in");
  spec.dimensions[0] = edit(d);
  record.dimensions[0] = { ...edit(r), ...recordOnly };
  writeJson(site.descriptor, spec);
  writeJson(site.record, record);
}

export const partChecks: Gate = {
  id: "part-checks",
  checks:
    "every machine part's GLB against its B-rep (each tagged dimension and the bounding box within 0.01 mm), its volume against an independent sum of the drawing's primitives (within 0.5 %); a scaled or assumed dimension is a Checkpoint item",
  points: ["job", "deploy"],
  async run(input) {
    const { parts, modules } = partsInScope(input);
    const coverage = { modules, parts: parts.length, dimensions: 0, meshes: 0, volumes: 0 };
    const findings: Finding[] = [];
    for (const site of parts) {
      const checked = checkPart(input, site);
      findings.push(...checked.findings);
      coverage.dimensions += checked.counted.dimensions;
      coverage.meshes += checked.counted.meshes;
      coverage.volumes += checked.counted.volumes;
    }
    return { coverage, findings };
  },
  controls: [
    {
      defect: "a GLB 0.05 mm off its solid, its record rebound to it",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editGlb(site, (bytes, { primitives }) => {
            for (const p of primitives)
              for (let i = 0; i < p.count; i++)
                for (let c = 0; c < 3; c++) {
                  const at = p.positions + i * p.stride + c * 4;
                  bytes.writeFloatLE(bytes.readFloatLE(at) * 1.00125, at);
                }
          }),
        ),
    },
    {
      defect: "a GLB missing one face of its solid, its record rebound to it",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editGlb(site, (bytes, { primitives }) => {
            // The face with the most triangles, collapsed to a point: its surface is gone.
            const face = [...primitives].sort((a, b) => (b.indices?.count ?? 0) - (a.indices?.count ?? 0))[0]?.indices;
            if (!face) throw new Error("the GLB's faces aren't indexed");
            for (let i = 0; i < face.count; i++) bytes.writeUIntLE(0, face.at + i * face.size, face.size);
          }),
        ),
    },
    {
      defect: "a GLB with one triangle of a flat face collapsed, which changes neither its volume nor its box",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editGlb(site, (bytes, { primitives }) => {
            const face = primitives.find((p) => p.indices && p.indices.count >= 3)?.indices;
            if (!face) throw new Error("the GLB's faces aren't indexed");
            // The face's first triangle, folded onto its first corner.
            const first = bytes.readUIntLE(face.at, face.size);
            for (let i = 1; i < 3; i++) bytes.writeUIntLE(first, face.at + i * face.size, face.size);
          }),
        ),
    },
    {
      defect: "a GLB with one triangle turned inside out, which the viewer culls to a hole",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editGlb(site, (bytes, { primitives }) => {
            const face = primitives.find((p) => p.indices && p.indices.count >= 3)?.indices;
            if (!face) throw new Error("the GLB's faces aren't indexed");
            // The face's first triangle with two corners swapped.
            const second = bytes.readUIntLE(face.at + face.size, face.size);
            const third = bytes.readUIntLE(face.at + 2 * face.size, face.size);
            bytes.writeUIntLE(third, face.at + face.size, face.size);
            bytes.writeUIntLE(second, face.at + 2 * face.size, face.size);
          }),
        ),
    },
    {
      defect: "a GLB turned inside out, every triangle wound backwards",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editGlb(site, (bytes, { primitives }) => {
            for (const { indices } of primitives) {
              if (!indices) throw new Error("the GLB's faces aren't indexed");
              for (let t = 0; t + 2 < indices.count; t += 3) {
                const at = (k: number) => indices.at + (t + k) * indices.size;
                const second = bytes.readUIntLE(at(1), indices.size);
                bytes.writeUIntLE(bytes.readUIntLE(at(2), indices.size), at(1), indices.size);
                bytes.writeUIntLE(second, at(2), indices.size);
              }
            }
          }),
        ),
    },
    {
      defect: "a script edited after its part was built",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          writeFileSync(site.script, `${readFileSync(site.script, "utf8")}\n# edited\n`),
        ),
    },
    {
      defect: "a dimension whose end isn't on the part",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editFirstDimension(
            site,
            (d) => {
              // Pushed 5 mm out past its from end, along its own line.
              const from = d.from as Point3;
              const dir = unit(sub(d.to as Point3, from));
              return { ...d, from: from.map((v, i) => v - 5 * (dir[i] ?? 0)), value: (d.value as number) + 5 };
            },
            { gaps: [5, 0] },
          ),
        ),
    },
    {
      defect: "a dimension between two points on the part that its line doesn't meet square",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          editFirstDimension(
            site,
            (d) => {
              // Its to end swung 3 mm sideways: still on the record's word on the surface, but slanting.
              const from = d.from as Point3;
              const to = d.to as Point3;
              const swung: Point3 = [to[0], to[1] + 3, to[2]];
              return { ...d, to: swung, value: Math.hypot(...sub(swung, from)) };
            },
            {},
          ),
        ),
    },
    {
      defect: "an invalid solid",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) =>
          writeJson(site.record, { ...readJson<object>(site.record), valid: false }),
        ),
    },
    {
      defect: "a volume 1 % off the independent sum of the drawing's primitives",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) => {
          const log = readJson<{ values: { volume: number } }>(site.log);
          writeJson(site.log, { ...log, values: { volume: log.values.volume * 1.01 } });
        }),
    },
    {
      defect: "an independent recompute that worked from another reading of a dimension",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) => {
          const log = readJson<{ inputs: Record<string, number> }>(site.log);
          const [id] = Object.keys(log.inputs);
          if (!id) throw new Error("the recompute log took no reading");
          writeJson(site.log, { ...log, inputs: { ...log.inputs, [id]: (log.inputs[id] ?? 0) + 1 } });
        }),
    },
    {
      defect: "a part with no recompute log",
      plant: (good, scratch) => plantInPart(good, scratch, (site) => rmSync(site.log)),
    },
    {
      defect: "a scaled dimension the Owner hasn't confirmed",
      expect: "checkpoint",
      plant: (good, scratch) =>
        plantInPart(good, scratch, (site) => {
          const spec = readJson<{ dimensions: { tag: string; confirmed?: boolean }[] }>(site.descriptor);
          const d = spec.dimensions.find((x) => x.tag === "scaled" || x.tag === "assumed") ?? spec.dimensions[0];
          if (!d) throw new Error("the part has no dimension");
          d.tag = "scaled";
          delete d.confirmed;
          writeJson(site.descriptor, spec);
        }),
    },
  ],
};
