// Course overrides: a template-layer file shadowed for one Course from its overrides area, tied to
// the gate gap it works around. The Site template's build loads `overrides/<path>` in place of
// `template/<path>` (template/src/overrides/plugin.ts); the integrity check holds every file in the
// overrides area to a recorded override, and every other template edit to the pinned hashes.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OVERRIDES_DIR } from "../intake/scaffold.ts";
import { hashTree } from "./hash.ts";
import { current, type Ledger } from "./model.ts";

/**
 * What an override can shadow: site code and styles the build loads under `src/`. The gates,
 * deploy scripts, config and dependencies verify the Course, so a Course never swaps them.
 * The same rule as the template's build plugin (template/src/overrides/plugin.ts).
 */
export const OVERRIDABLE = /^src\/(?:[^/]+\/)*[^/]+\.(?:astro|ts|tsx|js|jsx|mjs|css|json)$/;

/** The overrides area's own placeholder, not an override. */
const PLACEHOLDER = ".gitkeep";

/** Why `path` can't be a Course override in this project, or null when it can. */
export function overrideProblem(project: string, ledger: Ledger, path: string): string | null {
  if (!(path in ledger.template.files)) return `${path} isn't a template-layer file`;
  if (!OVERRIDABLE.test(path))
    return `${path} can't be overridden: an override shadows site code or styles under src/ (.astro, .ts, .tsx, .js, .jsx, .mjs, .css, .json), never a gate, a script or the config`;
  if (!existsSync(join(project, OVERRIDES_DIR, path)))
    return `there's no ${OVERRIDES_DIR}/${path}: write the override there first`;
  return null;
}

/** The overrides area against the ledger: files no current override records, and recorded overrides with no file. */
export function overridesAgainstLedger(project: string, ledger: Ledger) {
  const onDisk = Object.keys(hashTree(join(project, OVERRIDES_DIR))).filter((path) => path !== PLACEHOLDER);
  const recorded = current(ledger.template.overrides).map((row) => row.path);
  return {
    unrecordedOverrides: onDisk.filter((path) => !recorded.includes(path)),
    missingOverrides: recorded.filter((path) => !onDisk.includes(path)),
  };
}
