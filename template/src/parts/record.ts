// What `npm run parts` (parts/build.py, in the machine venv) leaves for each machine part, and
// where: the B-rep's own measurements, bound to the script and GLB they came from. The part gates
// read it; Template CI has no build123d to measure the solid again.
import { z } from "astro/zod";

export const PART_RECORD = "learn-premium part record v1";

const point3 = z.tuple([z.number(), z.number(), z.number()]);

export const partRecord = z.strictObject({
  record: z.literal(PART_RECORD),
  /** The kernel that built it, with its version. */
  by: z.string().min(1),
  /** SHA-256 of the build123d script, its line endings as LF. */
  script: z.string().regex(/^[0-9a-f]{64}$/),
  /** SHA-256 of the GLB the build wrote. */
  glb: z.string().regex(/^[0-9a-f]{64}$/),
  /** The GLB's tessellation: chord error in mm (absolute) and angle in radians. */
  deflection: z.strictObject({ linear: z.number().positive(), angular: z.number().positive() }),
  /** Whether OpenCascade calls the solid valid. */
  valid: z.boolean(),
  /** In mm³. */
  volume: z.number().positive(),
  bbox: z.strictObject({ min: point3, max: point3 }),
  /** Each tagged dimension as built: its ends, and on the solid how far each is from the surface and the normal there. */
  dimensions: z.array(
    z.strictObject({
      id: z.string(),
      from: point3,
      to: point3,
      value: z.number(),
      gaps: z.tuple([z.number(), z.number()]),
      normals: z.tuple([point3, point3]),
    }),
  ),
});
export type PartRecord = z.output<typeof partRecord>;

/** The independent recompute's log for a part: the drawing's readings it worked from, and the volume it summed. */
export const partRecomputeLog = z.strictObject({
  recompute: z.literal("learn-premium recompute log v1"),
  by: z.string().min(1),
  /** Every reading it took from the drawing (mm), by the part's dimension id where it is one. */
  inputs: z.record(z.string(), z.number()),
  values: z.strictObject({ volume: z.number().positive() }),
});

/**
 * Where the independent recompute logs a part, apart from the sims' logs (a sim and a part may share a
 * name): `build-records/recompute/<module>/parts/<name>.json`.
 */
export const partRecomputeEntry = (module: string, name: string) =>
  `build-records/recompute/${module}/parts/${name}.json`;
/** Where a part's record sits in the Course's build records. */
export const partRecordEntry = (module: string, name: string) => `build-records/parts/${module}/${name}.json`;
/** A part's GLB, beside its descriptor. */
export const partGlbEntry = (module: string, name: string) => `modules/${module}/parts/${name}.glb`;
/** Where the page publishes it. */
export const partGlbUrl = (module: string, name: string) => `/${module}/parts/${name}.glb`;

/** The id of a part's dimension on the page: a Checkpoint item links to it, and the viewer highlights it. */
export const dimensionAnchor = (module: string, name: string, id: string) => `dim-${module}-${name}-${id}`;
/** The page a part is on: its Worked example's Module page, or the Lab when it sits in none. */
export const partPage = (module: string, worked: string | undefined) =>
  worked === undefined ? "/lab/" : `/${module}/`;
