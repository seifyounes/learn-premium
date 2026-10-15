// The YouTube video cards' live gate and CLI: no network anywhere, every probe is a fake. The
// synthetic id `abcdefghijk` is planted in a copy of the Fixture Course; the committed Fixture has
// no card.
import { describe, expect, it } from "vitest";
import { GATES } from "../gates/index.ts";
import { runControls, runGates, type GateInput } from "../gates/runner.ts";
import { liveVideos, livenessOf, youtubeProbe, type OembedAnswer, type VideoProbe } from "../gates/videos.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MODULE = "01-thermal-resistance";
const CARD = `youtube:
  - { id: abcdefghijk, title: A planted card, channel: A channel, duration: '9:30', match: 9, why: Planted. }
`;

/** A copy of the Fixture Course with the planted card appended to Module 01's media.yaml. */
const coursePlanted = (): GateInput => ({
  contentDir: fixtureWith(`modules/${MODULE}/media.yaml`, (source) => `${source}${CARD}`),
});

/** A probe that answers every id the same way, and remembers what it was asked. */
function fakeProbe(answer: OembedAnswer, length: number | null = 570) {
  const asked: string[] = [];
  const probe: VideoProbe = {
    async oembed(id) {
      asked.push(id);
      return answer;
    },
    async lengthSeconds() {
      return length;
    },
  };
  return { probe, asked };
}

const runLive = (input: GateInput) => runGates({ point: "live", commit: COMMIT, input, gates: [liveVideos] });

describe("the live-videos gate", () => {
  it("live-videos raises a dead card as a Checkpoint item", async () => {
    const { probe } = fakeProbe({ status: 404 });
    const report = await runLive({ ...coursePlanted(), videoProbe: probe });
    expect(report.green).toBe(true);
    expect(report.gates[0]?.status).toBe("checkpoint");
    expect(report.checkpointItems).toHaveLength(1);
    const item = report.checkpointItems[0];
    expect(item?.message).toMatch(/^abcdefghijk is dead: /);
    expect(item?.at).toBe(`modules/${MODULE}/media.yaml`);
  });

  it("raises an embedding-off card (401) the same way", async () => {
    const { probe } = fakeProbe({ status: 401 });
    const report = await runLive({ ...coursePlanted(), videoProbe: probe });
    expect(report.checkpointItems[0]?.message).toMatch(
      /^abcdefghijk is dead: .*401 \(private, or embedding turned off\)/,
    );
  });

  it("passes the committed Fixture Course, which has no card, without a probe", async () => {
    const report = await runLive({ contentDir: FIXTURE_COURSE });
    expect(report.gates[0]?.status).toBe("pass");
    expect(report.gates[0]?.coverage).toEqual({ modules: 10, cards: 0, probed: 0 });
  });

  it("never asks YouTube without a live URL or a probe, whatever the Course holds", async () => {
    const report = await runLive(coursePlanted());
    expect(report.gates[0]?.status).toBe("pass");
    expect(report.gates[0]?.coverage).toEqual({ modules: 10, cards: 1, probed: 0 });
  });

  it("passes a card whose video answers 200, and counts it as probed", async () => {
    const { probe, asked } = fakeProbe({ status: 200, title: "T", author: "A" });
    const report = await runLive({ ...coursePlanted(), videoProbe: probe });
    expect(report.gates[0]?.status).toBe("pass");
    expect(report.gates[0]?.coverage).toEqual({ modules: 10, cards: 1, probed: 1 });
    expect(asked).toEqual(["abcdefghijk"]);
  });

  it("tells the Owner it couldn't check a card, and leaves the card", async () => {
    const { probe } = fakeProbe({ status: 429 });
    const report = await runLive({ ...coursePlanted(), videoProbe: probe });
    expect(report.gates[0]?.status).toBe("checkpoint");
    expect(report.checkpointItems[0]?.message).toMatch(/^couldn't check abcdefghijk: .*; the card stays$/);
  });

  it("catches both negative controls as Checkpoint items and passes its positive fixture", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE }, gates: [liveVideos] });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.gates[0]?.controls.map((c) => [c.expected, c.caught])).toEqual([
      ["checkpoint", true],
      ["checkpoint", true],
    ]);
  });

  it("runs at the live point only, after the other live gates", () => {
    expect(liveVideos.points).toEqual(["live"]);
    expect(GATES.at(-1)).toBe(liveVideos);
  });
});

describe("livenessOf", () => {
  it.each([
    [{ status: 200 }, "live"],
    [{ status: 400 }, "dead"],
    [{ status: 401 }, "dead"],
    [{ status: 403 }, "dead"],
    [{ status: 404 }, "dead"],
    [{ status: 429 }, "unknown"],
    [{ status: 503 }, "unknown"],
    [{ error: "offline" }, "unknown"],
  ] as [OembedAnswer, string][])("reads %j as %s", (answer, state) => {
    expect(livenessOf(answer).state).toBe(state);
  });
});

describe("youtubeProbe", () => {
  const respond =
    (body: string, status = 200) =>
    async () =>
      new Response(body, { status });

  it("asks oEmbed for the watch URL and reads the title and author on a 200", async () => {
    const urls: string[] = [];
    const probe = youtubeProbe(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ title: "A video", author_name: "A channel" }), { status: 200 });
    });
    expect(await probe.oembed("abcdefghijk")).toEqual({ status: 200, title: "A video", author: "A channel" });
    expect(urls).toEqual([
      "https://www.youtube.com/oembed?format=json&url=" +
        encodeURIComponent("https://www.youtube.com/watch?v=abcdefghijk"),
    ]);
  });

  it("gives the bare status on a non-200", async () => {
    expect(await youtubeProbe(respond("", 404)).oembed("abcdefghijk")).toEqual({ status: 404 });
  });

  it("gives the error when the fetch throws", async () => {
    const probe = youtubeProbe(async () => {
      throw new Error("offline");
    });
    expect(await probe.oembed("abcdefghijk")).toEqual({ error: "offline" });
    expect(await probe.lengthSeconds("abcdefghijk")).toBeNull();
  });

  it("reads the length from the watch page, else null", async () => {
    expect(await youtubeProbe(respond('x "lengthSeconds":"725" y')).lengthSeconds("abcdefghijk")).toBe(725);
    expect(await youtubeProbe(respond("no length here")).lengthSeconds("abcdefghijk")).toBeNull();
  });
});
