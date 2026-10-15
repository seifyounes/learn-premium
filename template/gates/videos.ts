// The YouTube video cards after a deploy. A card ships only at a 9/10 match, re-verified before it
// is merged (the skill's `wave videos verify`); this checks the live link afterwards. A card whose
// video was removed, or turned embedding off, is raised as a Checkpoint item and hidden after the
// deploy (`videos hide`): never a block, because a third party's deletion must not roll the Owner's
// production deploy back.
//
// The probe is the only place that touches YouTube, and it is injectable: tests, `controls` and a
// pre-merge run give no URL and no probe, so none of them reaches the network.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { courseCopy, courseFiles, slashes } from "./course-files.ts";
import type { Finding, Gate, GateInput, GateReport } from "./runner.ts";

/** What YouTube's oEmbed answered for a video: the status (title and author on a 200), or why it couldn't be asked. */
export type OembedAnswer = { status: number; title?: string; author?: string } | { error: string };

/** How the live gates ask YouTube about a card. */
export interface VideoProbe {
  oembed(id: string): Promise<OembedAnswer>;
  /** The video's length in seconds, from its watch page; null when the page doesn't say. */
  lengthSeconds(id: string): Promise<number | null>;
}

/** How long one YouTube request may take before it counts as unanswered. */
const REQUEST_MS = 20_000;

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** The real probe: YouTube's public oEmbed endpoint and the watch page. `fetchImpl` is for tests. */
export function youtubeProbe(fetchImpl: typeof fetch = fetch): VideoProbe {
  return {
    async oembed(id) {
      try {
        const response = await fetchImpl(
          `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`,
          { signal: AbortSignal.timeout(REQUEST_MS) },
        );
        if (response.status !== 200) return { status: response.status };
        const body = (await response.json()) as { title?: unknown; author_name?: unknown };
        return {
          status: 200,
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.author_name === "string" ? { author: body.author_name } : {}),
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    async lengthSeconds(id) {
      try {
        const response = await fetchImpl(watchUrl(id), { signal: AbortSignal.timeout(REQUEST_MS) });
        const seconds = /"lengthSeconds":"(\d+)"/.exec(await response.text())?.[1];
        return seconds === undefined ? null : Number(seconds);
      } catch {
        return null;
      }
    },
  };
}

export type Liveness = { state: "live" } | { state: "dead"; why: string } | { state: "unknown"; why: string };

const DEAD_STATUS: Record<number, string> = {
  400: "YouTube knows no such video",
  401: "private, or embedding turned off",
  403: "embedding refused",
  404: "removed",
};

/** Whether a card still plays: 200 live; 400, 401, 403 and 404 dead; anything else (a throttle, an outage) unknown. */
export function livenessOf(answer: OembedAnswer): Liveness {
  if ("error" in answer) return { state: "unknown", why: answer.error };
  if (answer.status === 200) return { state: "live" };
  const why = DEAD_STATUS[answer.status];
  if (why !== undefined) return { state: "dead", why };
  return { state: "unknown", why: `oEmbed answered ${answer.status}` };
}

/** A card as `media.yaml` writes it, every field raw. */
export interface ListedCard {
  module: string;
  /** The file it sits in, relative to the content folder: `modules/<module>/media.yaml`. */
  at: string;
  id: string;
  title: string;
  channel: string;
  duration: string;
  match: number;
  why: string;
  moments: { at: string; label: string }[];
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Every YouTube card in the Course's `media.yaml` files (one Module's when the input names it). */
export function videoCards(input: GateInput): ListedCard[] {
  const cards: ListedCard[] = [];
  for (const file of courseFiles(input)) {
    if (file.collection !== "media") continue;
    const youtube: unknown = (parseDocument(readFileSync(file.path, "utf8")).toJS() as { youtube?: unknown } | null)
      ?.youtube;
    if (!Array.isArray(youtube)) continue;
    for (const raw of youtube as Record<string, unknown>[]) {
      if (typeof raw !== "object" || raw === null || typeof raw["id"] !== "string") continue;
      const moments = Array.isArray(raw["moments"]) ? (raw["moments"] as Record<string, unknown>[]) : [];
      cards.push({
        module: file.entry.split("/")[1] ?? "",
        at: file.entry,
        id: raw["id"],
        title: text(raw["title"]),
        channel: text(raw["channel"]),
        duration: text(raw["duration"]),
        match: typeof raw["match"] === "number" ? raw["match"] : 0,
        why: text(raw["why"]),
        moments: moments.map((m) => ({ at: text(m["at"]), label: text(m["label"]) })),
      });
    }
  }
  return cards;
}

const MEDIA_FILE = /^modules\/[^/]+\/media\.yaml$/;
const DEAD_MESSAGE = /^([\w-]{11}) is dead: /;

/** The cards the live-videos gate found dead, from a live Gate report: where each sits and its id. */
export function deadInReport(report: GateReport): { at: string; id: string }[] {
  return report.checkpointItems.flatMap((item) => {
    const id = item.gate === liveVideos.id ? DEAD_MESSAGE.exec(item.message)?.[1] : undefined;
    return id === undefined || item.at === undefined ? [] : [{ at: item.at, id }];
  });
}

/**
 * Removes the dead cards from their `media.yaml`, touching nothing else in the file (comments, the
 * other blocks and the live cards stay). Returns each card it hid.
 */
export function hideCards(
  contentDir: string,
  dead: { at: string; id: string }[],
): { module: string; id: string; title: string }[] {
  const hidden: { module: string; id: string; title: string }[] = [];
  for (const at of new Set(dead.map((d) => d.at))) {
    // Only a Module's media.yaml: a report says where an item was raised, never a path to trust.
    if (!MEDIA_FILE.test(at)) continue;
    const path = join(contentDir, at);
    const doc = parseDocument(readFileSync(path, "utf8"));
    const cards = doc.get("youtube", true);
    if (!isSeq(cards)) continue;
    const ids = new Set(dead.filter((d) => d.at === at).map((d) => d.id));
    const before = hidden.length;
    cards.items = cards.items.filter((card) => {
      if (!isMap(card) || !ids.has(text(card.get("id")))) return true;
      hidden.push({
        module: slashes(at).split("/")[1] ?? "",
        id: text(card.get("id")),
        title: text(card.get("title")),
      });
      return false;
    });
    if (hidden.length === before) continue;
    if (cards.items.length === 0) doc.delete("youtube");
    writeFileSync(path, String(doc));
  }
  return hidden;
}

/** The probe a run uses: the one given, else YouTube's own when the run is against a live URL, else none. */
const probeOf = (input: GateInput) => input.videoProbe ?? (input.siteUrl !== undefined ? youtubeProbe() : undefined);

/** A copy of the Course with one planted card in its first `media.yaml`, for the negative controls. */
function planted(good: GateInput, scratch: string, videoProbe: VideoProbe): GateInput {
  const copy = courseCopy(good, scratch);
  const media = courseFiles(copy).find((f) => f.collection === "media");
  if (media === undefined) throw new Error("no media.yaml to plant a video card in");
  const doc = parseDocument(readFileSync(media.path, "utf8"));
  const card = {
    id: "abcdefghijk",
    title: "A planted card",
    channel: "A channel",
    duration: "9:30",
    match: 9,
    why: "Planted.",
  };
  const existing = doc.get("youtube", true);
  if (isSeq(existing)) existing.add(doc.createNode(card));
  else doc.set("youtube", doc.createNode([card]));
  writeFileSync(media.path, String(doc));
  return { ...copy, videoProbe };
}

const answers = (status: number): VideoProbe => ({
  oembed: async () => ({ status }),
  lengthSeconds: async () => null,
});

export const liveVideos: Gate = {
  id: "live-videos",
  checks:
    "every YouTube card in the Course still plays: a card whose video was removed or turned embedding off is raised to the Owner and hidden after the deploy",
  points: ["live"],
  async run(input) {
    const cards = videoCards(input);
    const probe = probeOf(input);
    const findings: Finding[] = [];
    let probed = 0;
    if (probe !== undefined) {
      for (const card of cards) {
        probed += 1;
        const answer = await probe.oembed(card.id);
        const liveness = livenessOf(answer);
        if (liveness.state === "dead") {
          const status = "status" in answer ? answer.status : 0;
          findings.push({
            outcome: "checkpoint",
            at: card.at,
            message: `${card.id} is dead: YouTube's oEmbed answers ${status} (${liveness.why}); the card is hidden after this deploy`,
          });
        } else if (liveness.state === "unknown") {
          findings.push({
            outcome: "checkpoint",
            at: card.at,
            message: `couldn't check ${card.id}: ${liveness.why}; the card stays`,
          });
        }
      }
    }
    const modules = courseFiles(input).filter((f) => f.collection === "modules").length;
    return { coverage: { modules, cards: cards.length, probed }, findings };
  },
  controls: [
    {
      defect: "a card whose video was removed (oEmbed 404)",
      expect: "checkpoint",
      plant: (good, scratch) => planted(good, scratch, answers(404)),
    },
    {
      defect: "a card whose video turned embedding off (oEmbed 401)",
      expect: "checkpoint",
      plant: (good, scratch) => planted(good, scratch, answers(401)),
    },
  ],
};
