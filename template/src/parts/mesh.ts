// A part's GLB as triangles in the frame its drawing is dimensioned in: millimetres, +Z up, as
// build123d models it (glTF itself is metres, +Y up). The part gates measure the mesh here, apart
// from the B-rep's own record, so a GLB that isn't the solid shows. Pure; no three.js.

/** Every triangle of the part, three corners of x, y, z each, in millimetres. */
export interface PartMesh {
  positions: Float64Array;
}

export type Point3 = readonly [number, number, number];

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const TRIANGLES = 4;
const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/** Reads a binary glTF's triangles into the drawing's frame. Throws on anything else. */
export function readPartMesh(bytes: Uint8Array): PartMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2)
    throw new Error("not a GLB (binary glTF 2.0) file");
  let gltf: Gltf | undefined;
  let bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (type === JSON_CHUNK) gltf = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    else if (type === BIN_CHUNK) bin = chunk;
    at += 8 + length;
  }
  if (!gltf || !bin) throw new Error("not a GLB: it lacks its JSON or its binary chunk");
  const data = bin;
  const doc = gltf;

  const accessor = (index: number, components: number): number[] => {
    const a = doc.accessors?.[index];
    const bv = a?.bufferView === undefined ? undefined : doc.bufferViews?.[a.bufferView];
    const size = a && COMPONENT_BYTES[a.componentType];
    if (!a || !bv || !size) throw new Error(`the GLB's accessor ${index} can't be read`);
    const stride = bv.byteStride ?? size * components;
    const base = data.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const dv = new DataView(data.buffer, base, bv.byteLength - (a.byteOffset ?? 0));
    const out: number[] = [];
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < components; c++) {
        const offset = i * stride + c * size;
        out.push(
          a.componentType === 5126
            ? dv.getFloat32(offset, true)
            : a.componentType === 5125
              ? dv.getUint32(offset, true)
              : a.componentType === 5123
                ? dv.getUint16(offset, true)
                : dv.getUint8(offset),
        );
      }
    }
    return out;
  };

  const triangles: number[] = [];
  const visit = (index: number, parent: Matrix) => {
    const node = doc.nodes?.[index];
    if (!node) throw new Error(`the GLB names a node ${index} it doesn't have`);
    const world = multiply(parent, localMatrix(node));
    for (const primitive of node.mesh === undefined ? [] : (doc.meshes?.[node.mesh]?.primitives ?? [])) {
      if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) throw new Error("the GLB has a primitive that isn't triangles");
      const position = primitive.attributes.POSITION;
      if (position === undefined) continue;
      const xyz = accessor(position, 3);
      const order =
        primitive.indices === undefined
          ? Array.from({ length: xyz.length / 3 }, (_, i) => i)
          : accessor(primitive.indices, 1);
      for (const i of order) {
        const [x, y, z] = apply(world, [xyz[3 * i] ?? NaN, xyz[3 * i + 1] ?? NaN, xyz[3 * i + 2] ?? NaN]);
        // glTF (metres, +Y up) back to the drawing's frame (millimetres, +Z up).
        triangles.push(x * 1000, -z * 1000, y * 1000);
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const roots = doc.scenes?.[doc.scene ?? 0]?.nodes ?? [];
  for (const root of roots) visit(root, IDENTITY);
  if (triangles.length === 0) throw new Error("the GLB holds no triangles");
  return { positions: Float64Array.from(triangles) };
}

/** Column-major 4×4, as glTF writes it. */
type Matrix = readonly number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function localMatrix(node: GltfNode): Matrix {
  if (node.matrix) return node.matrix;
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [x = 0, y = 0, z = 0, w = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out.push(sum);
    }
  return out;
}

const apply = (m: Matrix, [x, y, z]: Point3): Point3 => [
  (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
  (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
  (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
];

export interface Box3 {
  min: Point3;
  max: Point3;
}

export function boundingBox({ positions }: PartMesh): Box3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let c = 0; c < 3; c++) {
      const v = positions[i + c] ?? NaN;
      min[c] = Math.min(min[c] ?? v, v);
      max[c] = Math.max(max[c] ?? v, v);
    }
  return { min: min as unknown as Point3, max: max as unknown as Point3 };
}

/**
 * The volume the triangles enclose, in mm³ (the divergence theorem over the closed surface): positive
 * when they face outward, as glTF's front faces must, negative when the surface is inside out.
 */
export function signedVolume({ positions: p }: PartMesh): number {
  let six = 0;
  for (let i = 0; i + 8 < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(p.subarray(i, i + 9));
    six +=
      (ax ?? 0) * ((by ?? 0) * (cz ?? 0) - (bz ?? 0) * (cy ?? 0)) -
      (ay ?? 0) * ((bx ?? 0) * (cz ?? 0) - (bz ?? 0) * (cx ?? 0)) +
      (az ?? 0) * ((bx ?? 0) * (cy ?? 0) - (by ?? 0) * (cx ?? 0));
  }
  return six / 6;
}

/** The volume the triangles enclose, in mm³, whichever way they face. */
export const meshVolume = (mesh: PartMesh) => Math.abs(signedVolume(mesh));

/**
 * The edges of the surface that don't join exactly two triangles facing the same way: none on a
 * closed, consistently wound solid's mesh, where each edge is walked once in each direction. A
 * triangle turned inside out is culled by the viewer and leaves a hole, though every edge still
 * joins two triangles. Each face of a solid is exported apart, its own vertices, so corners are
 * matched by position (to a thousandth of a millimetre); a triangle collapsed to a line or a point
 * counts for nothing.
 */
export function openEdges({ positions: p }: PartMesh): number {
  const key = (i: number) =>
    `${Math.round((p[i] ?? NaN) * 1000)},${Math.round((p[i + 1] ?? NaN) * 1000)},${Math.round((p[i + 2] ?? NaN) * 1000)}`;
  /** Each edge, by its two ends in a fixed order, and how often it is walked each way. */
  const edges = new Map<string, { forward: number; back: number }>();
  for (let i = 0; i + 8 < p.length; i += 9) {
    const [a, b, c] = [key(i), key(i + 3), key(i + 6)];
    if (a === b || b === c || a === c) continue;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const forward = u < v;
      const edge = forward ? `${u}|${v}` : `${v}|${u}`;
      const seen = edges.get(edge) ?? { forward: 0, back: 0 };
      if (forward) seen.forward += 1;
      else seen.back += 1;
      edges.set(edge, seen);
    }
  }
  let open = 0;
  for (const { forward, back } of edges.values()) if (forward !== 1 || back !== 1) open += 1;
  return open;
}

export interface SurfaceEnd {
  /** Where the dimension's line meets the surface, nearest the end. */
  at: Point3;
  /** How far that is from the end, along the line, in mm (Infinity if the line meets no surface). */
  gap: number;
  /** The unit normal of the triangle met there. */
  normal: Point3;
}

export interface Measured {
  /** The distance between the two surface points, in mm. */
  length: number;
  ends: [SurfaceEnd, SurfaceEnd];
}

/**
 * A dimension measured on the mesh: its line, through `from` and `to`, meets the surface at many
 * points; the one nearest each end is where the mesh puts that end.
 */
export function measureAlong({ positions: p }: PartMesh, from: Point3, to: Point3): Measured {
  const dir = sub(to, from);
  const span = Math.hypot(...dir);
  if (span === 0) throw new Error("a dimension's two ends are the same point");
  const d: Point3 = [dir[0] / span, dir[1] / span, dir[2] / span];
  const hits: { t: number; normal: Point3 }[] = [];
  for (let i = 0; i + 8 < p.length; i += 9) {
    const a: Point3 = [p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0];
    const e1 = sub([p[i + 3] ?? 0, p[i + 4] ?? 0, p[i + 5] ?? 0], a);
    const e2 = sub([p[i + 6] ?? 0, p[i + 7] ?? 0, p[i + 8] ?? 0], a);
    // Möller–Trumbore against the whole line, edges included.
    const h = cross(d, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(from, a);
    const u = dot(s, h) / det;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = cross(s, e1);
    const v = dot(d, q) / det;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const n = cross(e1, e2);
    const len = Math.hypot(...n);
    hits.push({ t: dot(e2, q) / det, normal: [n[0] / len, n[1] / len, n[2] / len] });
  }
  const nearest = (t: number): SurfaceEnd => {
    let best: { t: number; normal: Point3 } | undefined;
    for (const hit of hits) if (!best || Math.abs(hit.t - t) < Math.abs(best.t - t)) best = hit;
    if (!best) return { at: from, gap: Infinity, normal: [0, 0, 0] };
    return {
      at: [from[0] + d[0] * best.t, from[1] + d[1] * best.t, from[2] + d[2] * best.t],
      gap: Math.abs(best.t - t),
      normal: best.normal,
    };
  };
  const ends: [SurfaceEnd, SurfaceEnd] = [nearest(0), nearest(span)];
  return { length: Math.hypot(...sub(ends[1].at, ends[0].at)), ends };
}

export const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
