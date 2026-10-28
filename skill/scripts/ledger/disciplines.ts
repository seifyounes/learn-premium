// A Discipline added at intake, in the Build ledger. Pure: the five eligibility checks a ready-made
// tool is held to, and the rule that PhET and Falstad are only ever credited links.
import { normalise } from "../intake/pads.ts";
import type { ReadyMadeCandidate } from "./model.ts";

/** The checks a ready-made tool must all pass: the template's `tools` gate holds every sim to the same five. */
export const ELIGIBILITY_CHECKS = ["embeddable", "padFrame", "touch", "writable", "headless"] as const;
export type EligibilityCheck = (typeof ELIGIBILITY_CHECKS)[number];

/** Each check in the template gate's words. */
export const CHECK_LABELS: Record<EligibilityCheck, string> = {
  embeddable: "embeddable",
  padFrame: "takes the pad frame",
  touch: "touch-usable",
  writable: "writable from the Materials",
  headless: "checkable headlessly",
};

/** Whether a ready-made candidate passes all five checks, and the ones it fails (in the checks' order). */
export function eligibilityOf(candidate: Pick<ReadyMadeCandidate, "checks">): {
  eligible: boolean;
  failed: EligibilityCheck[];
} {
  const failed = ELIGIBILITY_CHECKS.filter((check) => !candidate.checks[check].pass);
  return { eligible: failed.length === 0, failed };
}

const LINK_ONLY_NAME = /\b(phet|falstad)\b/i;

/** The sentence every refusal of a PhET or Falstad tool ends with, so the Owner reads the same rule everywhere. */
export const LINKS_ONLY = "PhET and Falstad appear only as credited links in a new tab, never as a Worked or Lab tool";

/**
 * Whether a tool is PhET or Falstad, by its name or its source's host. Those two are licensed for
 * credited links only, so they are never a tool. A source that isn't a URL is just not link-only.
 */
export function isLinkOnly(name: string, source?: string): boolean {
  if (LINK_ONLY_NAME.test(name)) return true;
  if (source === undefined) return false;
  try {
    const host = new URL(source).hostname.toLowerCase();
    const within = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    return within("phet.colorado.edu") || within("falstad.com");
  } catch {
    return false;
  }
}

/** Whether two Discipline names are the same one: compared as `intake/pads.ts` compares names. */
export function sameDiscipline(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}
