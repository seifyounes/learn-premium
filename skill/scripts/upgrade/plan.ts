// What an Upgrade wave to a newer Template release would do, before anything is changed: the
// releases in between, the gate gaps they close (from each release's notes, the annotated tag's
// message), the Course overrides they retire, and whether the Owner's 7-day exam freeze holds the
// offer back. Read-only.
import { spawnSync } from "node:child_process";
import { LedgerError } from "../ledger/file.ts";
import { current, type Intake } from "../ledger/model.ts";
import { requireLedger } from "../ledger/ledger.ts";
import { GATE_GAPS_HEADING, NotesError, parseNotes } from "../release/notes.ts";

/** A Template release tag: `vMAJOR.MINOR.PATCH`, nothing else (the release flow's own rule). */
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** No Upgrade wave is offered within this many days before an Exam sitting, up to and including the day. */
export const FREEZE_DAYS = 7;

/** The Owner's local calendar date, `YYYY-MM-DD`: the day Egypt is on, not UTC's. */
export function localToday(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

function versionOf(tag: string): [number, number, number] | null {
  const match = RELEASE_TAG.exec(tag);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is the older release. Both must be release tags. */
function compare(a: string, b: string): number {
  const [x, y] = [versionOf(a), versionOf(b)];
  if (x === null || y === null) throw new Error(`${x === null ? a : b} is not a release tag`);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function git(source: string, args: string[]): string {
  const child = spawnSync("git", ["-C", source, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0)
    throw new LedgerError("invalid", `git ${args.join(" ")} failed in ${source}: ${child.stderr.trim()}`);
  return child.stdout;
}

/** The release tags newer than `from` and up to `to` in the release repo, oldest first. */
export function releasesAfter(source: string, from: string, to: string): string[] {
  return git(source, ["tag", "--list"])
    .split(/\r?\n/)
    .filter((tag) => versionOf(tag) !== null && compare(tag, from) > 0 && compare(tag, to) <= 0)
    .sort(compare);
}

export interface ReleaseNotes {
  tag: string;
  gateGaps: { number: number; title: string }[];
}

/** The gate gaps a release's notes say it closes: the notes are the annotated tag's message. */
export function notesOf(source: string, tag: string): ReleaseNotes {
  const [type, ...message] = git(source, ["for-each-ref", `refs/tags/${tag}`, "--format=%(objecttype)%00%(contents)"])
    .replace(/\r?\n$/, "")
    .split("\0");
  if (type !== "tag")
    throw new LedgerError(
      "invalid",
      `${tag} isn't an annotated tag: a Template release is an annotated tag whose message is its release notes`,
    );
  const notes = message.join("\0");
  try {
    parseNotes(notes);
  } catch (error) {
    if (error instanceof NotesError) throw new LedgerError("invalid", `${tag}: ${error.message}`);
    throw error;
  }
  return { tag, gateGaps: gateGapsIn(notes) };
}

/** The `- #N title` lines of the notes' gate gaps section. */
function gateGapsIn(notes: string): ReleaseNotes["gateGaps"] {
  const lines = notes.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === GATE_GAPS_HEADING);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).flatMap((line) => {
    const match = /^- #(\d+)\b\s*(.*?)\s*$/.exec(line);
    return match ? [{ number: Number(match[1]), title: match[2] ?? "" }] : [];
  });
}

const day = (date: string): number => {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** The sitting the freeze holds on `today`: the first (by date) within the 7 days up to and including it. */
export function freezeOf(
  sittings: Intake["sittings"],
  today: string,
): { id: string; name: string; date: string } | null {
  const frozen = sittings
    .flatMap(({ id, name, date }) => (date === null ? [] : [{ id, name, date }]))
    .filter(({ date }) => day(date) - day(today) >= 0 && day(date) - day(today) <= FREEZE_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));
  return frozen[0] ?? null;
}

export interface UpgradePlan {
  from: string;
  to: string;
  /** The releases in between, oldest first, `to` last. */
  releases: string[];
  gateGapsClosed: { number: number; title: string }[];
  /** The Course's overrides whose gate gap one of those releases closes. */
  overridesRetired: { path: string; gateGap: number }[];
  /** The gate gaps this Course filed that those releases close. */
  closesOwnGaps: number[];
  freeze: { id: string; name: string; date: string } | null;
  /** In the freeze, and nothing the Course filed is closed: no offer is made. */
  held: boolean;
  /** An earlier Upgrade wave to this release that ended red, so the Owner is told. */
  lastFailed: { id: string; gateGap: string | null } | null;
}

/** Why a held plan makes no offer, for the Owner. */
export function heldReason(plan: UpgradePlan): string {
  const sitting = plan.freeze === null ? "an Exam sitting" : `the ${plan.freeze.name} sitting on ${plan.freeze.date}`;
  return `held: ${sitting} is within ${FREEZE_DAYS} days, and ${plan.to} closes no gate gap this Course filed`;
}

/**
 * The plan for upgrading the Course project from its pinned release to `to`, read from the release
 * repo at `source`. `plan` is null, with the `reason`, when `to` isn't a release newer than the pinned one.
 */
export function planUpgrade(
  project: string,
  source: string,
  to: string,
  today: string,
): { plan: UpgradePlan | null; reason: string | null } {
  const ledger = requireLedger(project);
  const from = ledger.template.release;
  if (versionOf(to) === null) return { plan: null, reason: `${to} is not a release tag (vX.Y.Z)` };
  if (versionOf(from) === null) return { plan: null, reason: `the pinned release ${from} is not a release tag` };
  if (compare(to, from) <= 0) return { plan: null, reason: `${to} is not newer than the pinned release ${from}` };
  const releases = releasesAfter(source, from, to);
  if (!releases.includes(to)) throw new LedgerError("invalid", `the release repo ${source} has no tag ${to}`);

  const closed = new Map<number, string>();
  for (const tag of releases) for (const gap of notesOf(source, tag).gateGaps) closed.set(gap.number, gap.title);
  const filed = current(ledger.gateGaps).flatMap((gap) => (gap.issue === null ? [] : [gap.issue]));
  const closesOwnGaps = [...new Set(filed.filter((issue) => closed.has(issue)))].sort((a, b) => a - b);
  const freeze = freezeOf(ledger.intake.sittings, today);
  const failed = current(ledger.upgrades)
    .filter((u) => u.to === to && u.state === "failed")
    .at(-1);
  return {
    plan: {
      from,
      to,
      releases,
      gateGapsClosed: [...closed].sort(([a], [b]) => a - b).map(([number, title]) => ({ number, title })),
      overridesRetired: current(ledger.template.overrides)
        .filter((row) => closed.has(row.gateGap))
        .map(({ path, gateGap }) => ({ path, gateGap })),
      closesOwnGaps,
      freeze,
      held: freeze !== null && closesOwnGaps.length === 0,
      lastFailed: failed === undefined ? null : { id: failed.id, gateGap: failed.gateGap },
    },
    reason: null,
  };
}
