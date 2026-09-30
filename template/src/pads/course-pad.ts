// The pad a Course's course.yaml names, resolved outside the content layer: for the build log and
// the pad gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { course } from "../content/contract.ts";
import { resolvePad, type ResolvedPad } from "./pad.ts";

/** Throws when course.yaml can't be read or its pad breaks the content contract. */
export function coursePad(contentDir: string): ResolvedPad {
  const data: unknown = parse(readFileSync(join(contentDir, "course.yaml"), "utf8"));
  const pad = course.shape.pad.safeParse((data as { pad?: unknown } | null)?.pad);
  if (!pad.success) throw new Error(`course.yaml: pad: ${pad.error.issues[0]?.message ?? "invalid"}`);
  return resolvePad(pad.data);
}
