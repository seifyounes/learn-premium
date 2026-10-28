// The YouTube video cards of a Module's Watch page. A hunter subagent proposes candidates; a card
// ships only at a 9/10 match to the Professor's method, and only after the main agent has checked it
// itself: YouTube's oEmbed answers 200 (so it plays in place), the length and title are YouTube's
// own, every moment's quote is heard in the transcript within MOMENT_WINDOW_S of its timestamp, and
// the video isn't on the do-not-use list. `ready` holds the Module's cards to that check; after a
// production deploy `hideDead` takes the cards the live gates found dead off the page and lists them
// for the Owner, and the do-not-use list keeps them from coming back.
//
// All of it sits in the Private folder (never the repo): `waves/NN/youtube/` for a Module's hunts,
// transcripts and verified.json, and `youtube/do-not-use.json` for the whole Course. A transcript is
// evidence-shaped, so the pre-commit gate blocks one that slips into a commit.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { arr, fail, isoTime, nonEmpty, obj, type Infer } from "../ledger/schema.ts";
import { readJsonFile, waveFolder } from "./reading.ts";

export const HUNT = "learn-premium youtube hunt v1";
export const VERIFIED = "learn-premium video check v1";
export const DO_NOT_USE = "learn-premium do-not-use v1";

/** The oEmbed statuses that say a video can't play in a card (the template's live gate reads the same four as dead). */
const DEAD_STATUSES = new Set([400, 401, 403, 404]);

/** A card ships only at this match, out of 10, to the Professor's method. */
export const MIN_MATCH = 9;
/** A moment's quote must be heard this many seconds either side of its timestamp. */
export const MOMENT_WINDOW_S = 20;
/** A quote of fewer words proves nothing about where it was said. */
const MIN_QUOTE_WORDS = 4;

/** What the template's `videos probe` says about one video. */
export interface ProbeAnswer {
  id: string;
  oembed: { status: number; title?: string; author?: string } | { error: string };
  lengthSeconds: number | null;
}

/** A card as `media.yaml` writes it, as the template lists it. */
export interface ListedCard {
  module: string;
  at: string;
  id: string;
  title: string;
  channel: string;
  duration: string;
  match: number;
  why: string;
  moments: { at: string; label: string }[];
}

/**
 * The Course project's own template layer, as the video checks use it. A seam: faked in tests. A
 * string is why the template couldn't answer.
 */
export interface VideoTemplate {
  /** The cards the Module's `media.yaml` carries, in the checkout at `dir`. */
  cards(dir: string, folder: string): ListedCard[] | string;
  /** What YouTube answers for each id: the only call that touches the network. */
  probe(project: string, ids: string[]): ProbeAnswer[] | string;
  /** Hides the cards a live Gate report found dead; the cards hidden. */
  hide(project: string, report: string): { module: string; id: string; title: string }[] | string;
}

const clock: (v: unknown, p: string) => string = (v, p) =>
  typeof v === "string" && /^(?:\d+:[0-5]\d|\d{1,2}):[0-5]\d$/.test(v)
    ? v
    : fail(p, "a time written m:ss or h:mm:ss", v);
const mark: (v: unknown, p: string) => number = (v, p) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10 ? (v as number) : fail(p, "a match from 0 to 10", v);
const moduleNumber: (v: unknown, p: string) => string = (v, p) =>
  typeof v === "string" && /^\d{2}$/.test(v) ? v : fail(p, "a two-digit Module number", v);
const youtubeId: (v: unknown, p: string) => string = (v, p) =>
  typeof v === "string" && /^[\w-]{11}$/.test(v) ? v : fail(p, "a YouTube video id (11 letters, digits, - or _)", v);

const huntSchema = obj({
  hunt: (v, p) => (v === HUNT ? HUNT : fail(p, JSON.stringify(HUNT), v)),
  module: moduleNumber,
  topic: nonEmpty,
  candidates: arr(
    obj({
      id: youtubeId,
      title: nonEmpty,
      channel: nonEmpty,
      duration: clock,
      match: mark,
      why: nonEmpty,
      /** What in the video is the Professor's method, and where. */
      evidence: nonEmpty,
      moments: arr(obj({ at: clock, label: nonEmpty, quote: nonEmpty })),
    }),
  ),
});
type Candidate = Infer<typeof huntSchema>["candidates"][number];

const cardSchema = obj({
  id: youtubeId,
  title: nonEmpty,
  channel: nonEmpty,
  duration: clock,
  match: mark,
  why: nonEmpty,
  moments: arr(obj({ at: clock, label: nonEmpty })),
});

const verifiedSchema = obj({
  verified: (v, p) => (v === VERIFIED ? VERIFIED : fail(p, JSON.stringify(VERIFIED), v)),
  module: moduleNumber,
  at: isoTime,
  cards: arr(cardSchema),
  rejected: arr(obj({ id: nonEmpty, reasons: arr(nonEmpty) })),
  dropped: arr(obj({ id: nonEmpty, at: nonEmpty, why: nonEmpty })),
});
type Verified = Infer<typeof verifiedSchema>;

const doNotUseSchema = obj({
  list: (v, p) => (v === DO_NOT_USE ? DO_NOT_USE : fail(p, JSON.stringify(DO_NOT_USE), v)),
  videos: arr(obj({ id: youtubeId, reason: nonEmpty, at: isoTime })),
});
type DoNotUse = Infer<typeof doNotUseSchema>;

export const videosFolder = (privateFolder: string, module: string) =>
  join(waveFolder(privateFolder, module), "youtube");
const doNotUsePath = (privateFolder: string) => join(privateFolder, "youtube", "do-not-use.json");

/** The Course-wide do-not-use list; empty when nothing was ever listed. */
function readDoNotUse(privateFolder: string): DoNotUse {
  const path = doNotUsePath(privateFolder);
  if (!existsSync(path)) return { list: DO_NOT_USE, videos: [] };
  return readJsonFile(path, doNotUseSchema, "do-not-use.json");
}

/** Lists `id`, unless it is listed already. The list only ever grows. */
function listNever(privateFolder: string, id: string, reason: string): void {
  // Checked before anything is written: the shared list must never hold an entry its schema rejects.
  youtubeId(id, "id");
  nonEmpty(reason, "reason");
  const list = readDoNotUse(privateFolder);
  if (list.videos.some((v) => v.id === id)) return;
  list.videos.push({ id, reason, at: new Date().toISOString() });
  mkdirSync(join(privateFolder, "youtube"), { recursive: true });
  writeFileSync(doNotUsePath(privateFolder), `${JSON.stringify(list, null, 2)}\n`);
}

/** Records a video the main agent ruled off the Professor's method: it is never a card, here or in a later wave. */
export function neverUse(privateFolder: string, id: string, reason: string) {
  youtubeId(id, "--id");
  nonEmpty(reason, "--reason");
  listNever(privateFolder, id, reason);
  return { id, reason, listed: readDoNotUse(privateFolder).videos.length };
}

/** `m:ss` or `h:mm:ss` → seconds. */
const secondsOf = (at: string) => at.split(":").reduce((total, part) => total * 60 + Number(part), 0);

/** Seconds → the card's duration, `m:ss`, or `h:mm:ss` from an hour. */
function clockOf(total: number): string {
  const s = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${s}`;
}

/** Lowercase, punctuation to spaces, spaces collapsed: what a quote is looked for in. */
const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

interface Cue {
  at: number;
  text: string;
}

/**
 * A transcript as saved from YouTube's transcript panel: a line `m:ss text`, or a `m:ss` line with its
 * text on the lines after it.
 */
function cuesOf(transcript: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const start = /^\s*((?:\d+:)?\d{1,2}:[0-5]\d)(?:\s+(.*))?$/.exec(line);
    if (start !== null) cues.push({ at: secondsOf(start[1] as string), text: start[2] ?? "" });
    else if (cues.length > 0 && line.trim() !== "") (cues.at(-1) as Cue).text += ` ${line.trim()}`;
  }
  return cues;
}

/** Whether the quote is heard within MOMENT_WINDOW_S of `at`: in the cues that start there, joined. */
function heardNear(cues: Cue[], at: number, quote: string): boolean {
  const near = cues.filter((c) => Math.abs(c.at - at) <= MOMENT_WINDOW_S).map((c) => c.text);
  return normalised(near.join(" ")).includes(normalised(quote));
}

const wordsIn = (quote: string) => normalised(quote).split(" ").filter(Boolean).length;

/** Every candidate the Module's hunts proposed, once each (the first hunt to name an id wins). */
function candidatesOf(privateFolder: string, module: string): Candidate[] {
  const folder = videosFolder(privateFolder, module);
  const files = existsSync(folder)
    ? readdirSync(folder)
        .filter((f) => /^hunt-.+\.json$/.test(f))
        .sort()
    : [];
  if (files.length === 0)
    throw new LedgerError(
      "invalid",
      `no hunt-<topic>.json in ${folder}: the YouTube hunters write one each (briefs/youtube-hunter.md)`,
    );
  const seen = new Map<string, Candidate>();
  for (const file of files) {
    const hunt = readJsonFile(join(folder, file), huntSchema, file);
    if (hunt.module !== module)
      throw new LedgerError("invalid", `${file} hunts for Module ${hunt.module}, not ${module}`);
    hunt.candidates.forEach((c, i) => {
      for (const m of c.moments)
        if (wordsIn(m.quote) < MIN_QUOTE_WORDS)
          throw new LedgerError(
            "invalid",
            `${file}: candidates[${i}] (${c.id}) cites "${m.quote}" at ${m.at}: a quote is at least ${MIN_QUOTE_WORDS} words heard there`,
          );
      if (!seen.has(c.id)) seen.set(c.id, c);
    });
  }
  return [...seen.values()];
}

/**
 * Re-verifies the Module's hunted candidates the way a card must be to ship, and writes
 * `verified.json`: the cards (paste-ready for `media.yaml`), each rejection with its reasons, and each
 * moment dropped because its quote isn't heard there. A candidate whose transcript hasn't been saved
 * yet, or that YouTube couldn't be asked about, is `waiting` (exit 1): save it and run verify again.
 */
export function verifyVideos(project: string, privateFolder: string, module: string, videos: VideoTemplate) {
  const candidates = candidatesOf(privateFolder, module);
  const list = readDoNotUse(privateFolder);
  const rejected: Verified["rejected"] = [];
  const reject = (id: string, ...reasons: string[]) => rejected.push({ id, reasons });
  const survivors: Candidate[] = [];
  for (const c of candidates) {
    if (c.match < MIN_MATCH)
      reject(c.id, `match ${c.match} is below ${MIN_MATCH}: below ${MIN_MATCH} there is no card`);
    else {
      const listed = list.videos.find((v) => v.id === c.id);
      if (listed !== undefined) reject(c.id, `it is on the do-not-use list: ${listed.reason}`);
      else survivors.push(c);
    }
  }

  const probes =
    survivors.length === 0
      ? []
      : videos.probe(
          project,
          survivors.map((c) => c.id),
        );
  if (typeof probes === "string") throw new LedgerError("refused", `the template can't ask YouTube: ${probes}`);
  const cards: Verified["cards"] = [];
  const dropped: Verified["dropped"] = [];
  const waiting: { id: string; why: string }[] = [];
  const transcripts = join(videosFolder(privateFolder, module), "transcripts");
  for (const c of survivors) {
    const probe = probes.find((p) => p.id === c.id);
    if (probe === undefined) {
      waiting.push({ id: c.id, why: "the template gave no answer for it" });
      continue;
    }
    if ("error" in probe.oembed) {
      waiting.push({ id: c.id, why: `YouTube couldn't be asked: ${probe.oembed.error}` });
      continue;
    }
    // Only a status that says the video can't play in a card is a rejection; a throttle or an outage
    // (429, 5xx…) is no verdict, so the candidate waits for a retry rather than being dropped.
    if (!DEAD_STATUSES.has(probe.oembed.status) && probe.oembed.status !== 200) {
      waiting.push({ id: c.id, why: `YouTube answered ${probe.oembed.status}, which says nothing about the video` });
      continue;
    }
    if (probe.oembed.status !== 200) {
      reject(
        c.id,
        `oEmbed answered ${probe.oembed.status}: the video can't play in a card (private, removed or embedding off)`,
      );
      continue;
    }
    const { title, author } = probe.oembed;
    if (title === undefined || author === undefined) {
      reject(c.id, "oEmbed gave no title or channel");
      continue;
    }
    if (probe.lengthSeconds === null) {
      reject(c.id, "YouTube's watch page gave no length, so its duration can't be checked");
      continue;
    }
    const file = join(transcripts, `${c.id}.txt`);
    if (!existsSync(file)) {
      waiting.push({ id: c.id, why: `save its transcript at ${file} from the video's transcript panel` });
      continue;
    }
    const cues = cuesOf(readFileSync(file, "utf8"));
    const moments: Verified["cards"][number]["moments"] = [];
    for (const m of c.moments) {
      if (secondsOf(m.at) > probe.lengthSeconds)
        dropped.push({
          id: c.id,
          at: m.at,
          why: `${m.at} is past the end of the video (${clockOf(probe.lengthSeconds)})`,
        });
      else if (!heardNear(cues, secondsOf(m.at), m.quote))
        dropped.push({
          id: c.id,
          at: m.at,
          why: `"${m.quote}" isn't heard within ${MOMENT_WINDOW_S} s of ${m.at} in its transcript`,
        });
      else moments.push({ at: m.at, label: m.label });
    }
    cards.push({
      id: c.id,
      title,
      channel: author,
      duration: clockOf(probe.lengthSeconds),
      match: c.match,
      why: c.why,
      moments,
    });
  }

  const verified: Verified = { verified: VERIFIED, module, at: new Date().toISOString(), cards, rejected, dropped };
  writeFileSync(join(videosFolder(privateFolder, module), "verified.json"), `${JSON.stringify(verified, null, 2)}\n`);
  const next =
    waiting.length > 0
      ? `${waiting.map((w) => `${w.id}: ${w.why}`).join("; ")}; then run verify again`
      : cards.length === 0
        ? "no candidate shipped: the Module gets no YouTube card"
        : "copy verified.json's cards into the Module's media.yaml youtube block, in the Professor's teaching order";
  return { code: waiting.length > 0 ? 1 : 0, cards, rejected, dropped, waiting: waiting.map((w) => w.id), next };
}

/** HEAD's Module `media.yaml`, or null when it has none. */
function committedMedia(dir: string, folder: string): string | null {
  const show = spawnSync("git", ["-C", dir, "show", `HEAD:${CONTENT_DIR}/modules/${folder}/media.yaml`], {
    encoding: "utf8",
  });
  return show.status === 0 ? show.stdout : null;
}

/**
 * Why the Module's YouTube cards don't let the wave merge: a card that isn't in `verified.json`, one
 * whose title, channel, duration or match differs from the verified one (its `why` and moment labels
 * may be reworded), a moment the check didn't keep, or a video on the do-not-use list. `dir` is the
 * wave's checkout; nothing is read when its committed `media.yaml` names no YouTube card.
 */
export function videoReadyProblems(
  dir: string,
  privateFolder: string,
  module: string,
  folder: string,
  videos: VideoTemplate,
): string[] {
  const media = committedMedia(dir, folder);
  if (media === null || !media.includes("youtube")) return [];
  const cards = videos.cards(dir, folder);
  if (typeof cards === "string") return [`the Module's video cards can't be read: ${cards}`];
  if (cards.length === 0) return [];

  let verified: Verified | null = null;
  const file = join(videosFolder(privateFolder, module), "verified.json");
  try {
    if (existsSync(file)) verified = readJsonFile(file, verifiedSchema, "verified.json");
  } catch (error) {
    if (error instanceof LedgerError) return [`video cards: ${error.message}`];
    throw error;
  }
  const never = new Map(readDoNotUse(privateFolder).videos.map((v) => [v.id, v.reason]));
  const problems: string[] = [];
  for (const card of cards) {
    const said = verified?.cards.find((c) => c.id === card.id);
    if (said === undefined)
      problems.push(
        `video card ${card.id} isn't in verified.json: run \`wave.ts videos verify\` and copy only the cards it passes`,
      );
    else {
      for (const k of ["title", "channel", "duration", "match"] as const)
        if (card[k] !== said[k])
          problems.push(`video card ${card.id}'s ${k} differs from verified.json: copy it as verify wrote it`);
      for (const m of card.moments)
        if (!said.moments.some((v) => v.at === m.at))
          problems.push(
            `video card ${card.id} cites ${m.at}, a moment verify didn't keep (its quote isn't heard there): drop it`,
          );
    }
    const listed = never.get(card.id);
    if (listed !== undefined) problems.push(`video card ${card.id} is on the do-not-use list (${listed}): remove it`);
  }
  return problems;
}

/** The branch checked out in the project, or null. */
function branchOf(project: string): string | null {
  const child = spawnSync("git", ["-C", project, "symbolic-ref", "--short", "-q", "HEAD"], { encoding: "utf8" });
  return child.status === 0 ? child.stdout.trim() : null;
}

/**
 * After a production deploy: takes the cards the live gates found dead off their Modules' pages,
 * lists each on the do-not-use list so no later wave brings it back, and returns the Owner's report.
 * Refused unless the project is on `main`: a hide is a commit to the deployed branch.
 */
export function hideDead(project: string, privateFolder: string, reportPath: string, videos: VideoTemplate) {
  const branch = branchOf(project);
  if (branch !== "main")
    throw new LedgerError(
      "refused",
      `${project} is on ${branch ?? "no branch"}, not main: a dead card is hidden on the deployed branch, after its deploy`,
    );
  if (!existsSync(reportPath)) throw new LedgerError("invalid", `no live Gate report at ${reportPath}`);
  const hidden = videos.hide(project, reportPath);
  if (typeof hidden === "string") throw new LedgerError("refused", `the template can't hide the cards: ${hidden}`);
  const messages = reportMessages(reportPath);
  const lines = hidden.map((h) => {
    const reason = messages.get(h.id) ?? "the live gates found it dead";
    listNever(privateFolder, h.id, reason);
    return `- \`${h.id}\` "${h.title}" (Module ${h.module}): ${reason}`;
  });
  const markdown =
    hidden.length === 0
      ? "**Dead video cards**: none to hide."
      : [
          `**Dead video cards hidden**: ${hidden.length}. Each is off its Module's Watch page and on the do-not-use list; no new hunt runs unless you ask for one.`,
          "",
          ...lines,
        ].join("\n");
  return { hidden, markdown };
}

/** The live-videos items of a live Gate report, by video id: why each card was raised. */
function reportMessages(reportPath: string): Map<string, string> {
  const messages = new Map<string, string>();
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      checkpointItems?: { gate?: string; message?: string }[];
    };
    for (const item of report.checkpointItems ?? []) {
      const id = item.gate === "live-videos" ? /^([\w-]{11}) is dead: /.exec(item.message ?? "")?.[1] : undefined;
      if (id !== undefined) messages.set(id, item.message as string);
    }
  } catch {
    // The template already read this report to hide the cards; a reason is all that is lost.
  }
  return messages;
}
