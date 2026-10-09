// The fix loop: a blocked job gets two fix rounds. When the second fix round is blocked too, the job
// falls back (a sim to a step-through animation, a tool to the next tool in its Discipline's Toolkit,
// a media item dropped) or, for a job with no fallback, becomes a Checkpoint item. Either way a
// Module never merges red and never stalls on one job.
import { LedgerError } from "./file.ts";
import type { Job, JobResult } from "./model.ts";

/** Fix rounds a blocked job gets before it falls back or goes to the Checkpoint. */
export const FIX_ROUNDS = 2;

/** Job names by what they make, so their fallback is known: `sim-<name>`, `tool-<name>`, `media-<kind>`. */
const FALLBACKS: { prefix: string; fallback: string }[] = [
  { prefix: "sim-", fallback: "a step-through animation of the Professor's figure in place of the sim" },
  { prefix: "tool-", fallback: "the next tool in the Discipline's Toolkit" },
  { prefix: "media-", fallback: "drop the media item: the Module goes live without it" },
];

/** What a job falls back to once its fix rounds are spent, or null when only the Owner can settle it. */
export function fallbackOf(job: string): string | null {
  return FALLBACKS.find((f) => job.startsWith(f.prefix))?.fallback ?? null;
}

export interface FixRounds {
  /** Fix rounds already spent on the current run of blocks. */
  used: number;
  left: number;
}

/**
 * How many times in a row the job is blocked at the end of its history (`rows` oldest first, every
 * row of the job in its wave, superseded or not). A pass, a fallback or an escalation to the
 * Checkpoint ends a run of blocks, so a later block starts with fresh fix rounds.
 */
function blocksInARow(rows: Pick<Job, "result">[]): number {
  let n = 0;
  for (const row of [...rows].reverse()) {
    if (row.result !== "blocked") break;
    n += 1;
  }
  return n;
}

/** The first block isn't a fix round; each block after it spends one. */
const spent = (blocks: number) => Math.max(0, blocks - 1);

/** Refuses a result the fix loop doesn't allow after `history` (the job's rows in its wave, oldest first). */
export function checkResult(job: string, result: JobResult, detail: string | null, history: Pick<Job, "result">[]) {
  if (result === "fell-back") {
    if (fallbackOf(job) === null)
      throw new LedgerError(
        "invalid",
        `${job} has no fallback (only sim-, tool- and media- jobs do): record --result checkpoint with what it needs from the Owner`,
      );
    if (detail === null) throw new LedgerError("invalid", `a fallback needs --detail saying what ${job} fell back to`);
  }
  if ((result === "blocked" || result === "passed") && spent(blocksInARow(history)) >= FIX_ROUNDS)
    throw new LedgerError(
      "refused",
      `${job}'s two fix rounds are spent: record --result fell-back (${fallbackOf(job) ?? "it has none"}) or --result checkpoint`,
    );
}

/** What `record job` reports for a blocked job: its fix rounds, and once they're spent, what comes next. */
export function afterBlock(job: string, history: Pick<Job, "result">[]) {
  const used = spent(blocksInARow(history));
  const fixRounds: FixRounds = { used, left: FIX_ROUNDS - used };
  if (used < FIX_ROUNDS)
    return { fixRounds, next: `the job that made the problem fixes it (fix round ${used + 1} of ${FIX_ROUNDS})` };
  const fallback = fallbackOf(job);
  return {
    fixRounds,
    exhausted: true,
    next:
      fallback === null
        ? `${job} has no fallback: record --result checkpoint with what it needs, and it joins the Module's batched Checkpoint`
        : `fall back to ${fallback}, then record --result fell-back --detail "<what it fell back to>"; or record --result checkpoint`,
  };
}
