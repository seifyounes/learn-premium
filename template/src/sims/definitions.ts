// The Professor's definitions, pinned in the Course style sheet (CONTEXT.md): the settling band and
// the rise time's limits a step response is read by. An engine works to them, and so does the
// independent recompute, which says in its log which it used; the pinned-definitions gate holds
// both to the style sheet. Pure.
import { z } from "astro/zod";

const share = z.number().gt(0).lt(1);

export const definitions = z.strictObject({
  /** From the settling time on, the step response stays within ±band of its final value. */
  settlingTime: z.strictObject({ band: share }).optional(),
  /** The rise time runs from `from` to `to` of the final value (0.1 and 0.9 for 10–90 %). */
  riseTime: z
    .strictObject({ from: z.number().min(0).lt(1), to: z.number().gt(0).max(1) })
    .refine((r) => r.from < r.to, "a rise starts below where it ends: from is under to")
    .optional(),
});
export type PinnedDefinitions = z.output<typeof definitions>;
export type DefinitionName = keyof PinnedDefinitions;
/** Every definition pinned: what an engine is handed. */
export type AllPinned = { [N in DefinitionName]-?: NonNullable<PinnedDefinitions[N]> };

/** How a definition reads in a finding. */
export const DEFINITION_NAMES: Record<DefinitionName, string> = {
  settlingTime: "settling-time",
  riseTime: "rise-time",
};

/** Every definition a kind works to, from the style sheet: or the first it doesn't pin. */
export function pinnedFor<N extends DefinitionName>(
  names: readonly N[],
  pinned: PinnedDefinitions | undefined,
): { definitions: Pick<AllPinned, N> } | { missing: N } {
  for (const name of names) if (pinned?.[name] === undefined) return { missing: name };
  return { definitions: pinned as Pick<AllPinned, N> };
}

/** A definition written with its fields in one order, so two writings of it compare equal. */
const canonical = (value: object) => JSON.stringify(Object.fromEntries(Object.entries(value).sort()));

/**
 * Where a recompute log's definitions part from the pinned ones, one problem each: a definition the
 * kind works to that the log doesn't name, or names otherwise than the style sheet pins it.
 */
export function definitionProblems(
  names: readonly DefinitionName[],
  logged: PinnedDefinitions | undefined,
  pinned: PinnedDefinitions,
): string[] {
  return names.flatMap((name) => {
    const want = pinned[name];
    const got = logged?.[name];
    if (want === undefined) return [];
    const say = DEFINITION_NAMES[name];
    if (got === undefined) return [`the recompute log doesn't say which ${say} definition it worked to`];
    return canonical(got) === canonical(want)
      ? []
      : [
          `the recompute worked to the ${say} definition ${JSON.stringify(got)}, but the Course style sheet pins ${JSON.stringify(want)}`,
        ];
  });
}
