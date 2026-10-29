// The YouTube video cards' live gate and CLI: no network anywhere, every probe is a fake. The
// synthetic id `abcdefghijk` is planted in a copy of the Fixture Course; the committed Fixture has
// no card.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { GATES } from "../gates/index.ts";
import { runControls, runGates, type GateInput, type GateReport } from "../gates/runner.ts";
import {
  deadInReport,
  hideCards,
  liveVideos,
  livenessOf,
  videoCards,
  youtubeProbe,
  type OembedAnswer,
  type VideoProbe,
} from "../gates/videos.ts";
import { media } from "../src/content/contract.ts";
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
    // Fourteen Modules: the mechanisms (Module 11) and the pneumatic cascade (Module 12) join the ten, then the copper cell (Module 13) and the state machines (Module 14).
    expect(report.gates[0]?.coverage).toEqual({ courses: 1, modules: 14, cards: 0, probed: 0 });
  });

  it("passes a newly scaffolded Course with no Module yet: nothing to check is not a gate that saw nothing", async () => {
    const contentDir = mkdtempSync(join(tmpdir(), "lp-empty-course-"));
    mkdirSync(join(contentDir, "modules"));
    writeFileSync(join(contentDir, "course.yaml"), "name: Empty\nsittings: []\n");
    const report = await runLive({ contentDir });
    rmSync(contentDir, { recursive: true, force: true });
    expect(report.gates[0]?.status).toBe("pass");
    expect(report.gates[0]?.coverage).toEqual({ courses: 1, modules: 0, cards: 0, probed: 0 });
  });

  it("never asks YouTube without a live URL or a probe, whatever the Course holds", async () => {
    const report = await runLive(coursePlanted());
    expect(report.gates[0]?.status).toBe("pass");
    // Fourteen Modules: the mechanisms (Module 11) and the pneumatic cascade (Module 12) join the ten, then the copper cell (Module 13) and the state machines (Module 14).
    expect(report.gates[0]?.coverage).toEqual({ courses: 1, modules: 14, cards: 1, probed: 0 });
  });

  it("passes a card whose video answers 200, and counts it as probed", async () => {
    const { probe, asked } = fakeProbe({ status: 200, title: "T", author: "A" });
    const report = await runLive({ ...coursePlanted(), videoProbe: probe });
    expect(report.gates[0]?.status).toBe("pass");
    // Fourteen Modules: the mechanisms (Module 11) and the pneumatic cascade (Module 12) join the ten, then the copper cell (Module 13) and the state machines (Module 14).
    expect(report.gates[0]?.coverage).toEqual({ courses: 1, modules: 14, cards: 1, probed: 1 });
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
    const ids = GATES.map((g) => g.id);
    expect(ids[ids.indexOf("live-private-paths") + 1]).toBe("live-videos");
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
    // A watch page that couldn't be read is not a page with no length: the first may be retried.
    expect(await probe.lengthSeconds("abcdefghijk")).toEqual({ error: "offline" });
  });

  it("gives the error, not null, when the watch page answers a throttle", async () => {
    expect(await youtubeProbe(respond("", 429)).lengthSeconds("abcdefghijk")).toEqual({
      error: "the watch page answered 429",
    });
  });

  it("reads the length from the watch page, else null", async () => {
    expect(await youtubeProbe(respond('x "lengthSeconds":"725" y')).lengthSeconds("abcdefghijk")).toBe(725);
    expect(await youtubeProbe(respond("no length here")).lengthSeconds("abcdefghijk")).toBeNull();
  });
});

const TEMPLATE_DIR = resolve(import.meta.dirname, "..");
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["gates/cli.ts", "videos", ...args], { cwd: TEMPLATE_DIR, encoding: "utf8" });

const AT = `modules/${MODULE}/media.yaml`;
const OTHER = `  - { id: zyxwvutsrqp, title: A live card, channel: Another, duration: '1:02:05', match: 10, why: Kept., moments: [{ at: '3:15', label: The series rule }] }
`;
const DEAD = "abcdefghijk is dead: YouTube's oEmbed answers 404 (removed); the card is hidden after this deploy";

/** A copy of the Fixture with two cards in Module 01: the planted one, then a live one. */
const courseWithTwo = (): string => fixtureWith(`modules/${MODULE}/media.yaml`, (source) => `${source}${CARD}${OTHER}`);

const mediaOf = (contentDir: string) => join(contentDir, AT);

/** A live-gate report that raises the given items, the way the gate does. */
const reportOf = (...items: { gate: string; message: string; at: string }[]) =>
  ({ checkpointItems: items.map((i) => ({ outcome: "checkpoint", ...i })) }) as unknown as GateReport;

describe("videos list", () => {
  it("videos list prints the planted card raw", () => {
    const contentDir = coursePlanted().contentDir;
    const run = cli("list", "--module", MODULE, "--content", contentDir);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      cards: [
        {
          module: MODULE,
          at: AT,
          id: "abcdefghijk",
          title: "A planted card",
          channel: "A channel",
          duration: "9:30",
          match: 9,
          why: "Planted.",
          moments: [],
        },
      ],
    });
  });

  it("lists nothing for the committed Fixture, and only the named Module's cards", () => {
    expect(videoCards({ contentDir: FIXTURE_COURSE })).toEqual([]);
    const contentDir = courseWithTwo();
    expect(videoCards({ contentDir, module: "02-convection" })).toEqual([]);
    expect(videoCards({ contentDir, module: MODULE }).map((c) => c.id)).toEqual(["abcdefghijk", "zyxwvutsrqp"]);
  });
});

describe("videos probe", () => {
  it("needs --ids, and exits 2 without it (it never spawns a real probe here)", () => {
    const run = cli("probe");
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--ids/);
  });

  it("is a usage error to name no subcommand or a wrong one", () => {
    expect(cli().status).toBe(2);
    expect(cli("nope").status).toBe(2);
  });
});

describe("deadInReport", () => {
  it("takes the dead cards of the live-videos gate, and ignores 'couldn't check' items and other gates", () => {
    const report = reportOf(
      { gate: "live-videos", at: AT, message: DEAD },
      { gate: "live-videos", at: AT, message: "couldn't check zyxwvutsrqp: oEmbed answered 429; the card stays" },
      { gate: "licences", at: AT, message: "abcdefghijk is dead: not ours" },
    );
    expect(deadInReport(report)).toEqual([{ at: AT, id: "abcdefghijk" }]);
  });
});

describe("videos hide", () => {
  it("videos hide removes only the dead card: the live card and the comment stay, and the file still parses", () => {
    const contentDir = courseWithTwo();
    const hidden = hideCards(contentDir, [{ at: AT, id: "abcdefghijk" }]);
    expect(hidden).toEqual([{ module: MODULE, id: "abcdefghijk", title: "A planted card" }]);
    const source = readFileSync(mediaOf(contentDir), "utf8");
    expect(source).toContain("# Synthetic media");
    const parsed = media.parse(parseDocument(source).toJS());
    expect(parsed.youtube.map((c) => c.id)).toEqual(["zyxwvutsrqp"]);
    expect(parsed.video?.file).toBe("explainer.mp4");
    expect(parsed.infographic?.file).toBe("infographic.png");
  });

  it("drops the youtube block when its last card goes, and the file still parses", () => {
    const contentDir = coursePlanted().contentDir;
    hideCards(contentDir, [{ at: AT, id: "abcdefghijk" }]);
    const source = readFileSync(mediaOf(contentDir), "utf8");
    expect(source).not.toContain("youtube");
    expect(media.parse(parseDocument(source).toJS()).youtube).toEqual([]);
  });

  it("hides nothing for an id the file doesn't hold, and leaves the file as it was", () => {
    const contentDir = courseWithTwo();
    const before = readFileSync(mediaOf(contentDir), "utf8");
    expect(hideCards(contentDir, [{ at: AT, id: "qqqqqqqqqqq" }])).toEqual([]);
    expect(readFileSync(mediaOf(contentDir), "utf8")).toBe(before);
  });

  it("the CLI hides what the report names and prints it as JSON", () => {
    const contentDir = courseWithTwo();
    const reportPath = join(contentDir, "live-report.json");
    writeFileSync(reportPath, JSON.stringify(reportOf({ gate: "live-videos", at: AT, message: DEAD })));
    const run = cli("hide", "--report", reportPath, "--content", contentDir);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      hidden: [{ module: MODULE, id: "abcdefghijk", title: "A planted card" }],
    });
    expect(videoCards({ contentDir }).map((c) => c.id)).toEqual(["zyxwvutsrqp"]);
  });

  it("touches only a Module's media.yaml, whatever path a report names", () => {
    const contentDir = courseWithTwo();
    const before = readFileSync(join(contentDir, "course.yaml"), "utf8");
    expect(hideCards(contentDir, [{ at: "course.yaml", id: "abcdefghijk" }])).toEqual([]);
    expect(hideCards(contentDir, [{ at: "modules/../course.yaml", id: "abcdefghijk" }])).toEqual([]);
    expect(readFileSync(join(contentDir, "course.yaml"), "utf8")).toBe(before);
  });

  it("refuses a path that climbs out of the content folder, a backslash form included", () => {
    const contentDir = courseWithTwo();
    const outside = join(contentDir, "..", `outside-${Date.now()}`);
    mkdirSync(join(outside), { recursive: true });
    const planted = join(outside, "media.yaml");
    writeFileSync(planted, `${CARD}${OTHER}`);
    const before = readFileSync(planted, "utf8");
    const name = outside.split(/[\\/]/).at(-1) ?? "";
    for (const at of [
      `modules/..\\..\\${name}/media.yaml`,
      `modules/../../${name}/media.yaml`,
      `modules/../media.yaml`,
    ])
      expect(hideCards(contentDir, [{ at, id: "abcdefghijk" }]), at).toEqual([]);
    const after = readFileSync(planted, "utf8");
    rmSync(outside, { recursive: true, force: true });
    expect(after).toBe(before);
  });

  it("the CLI needs --report", () => {
    expect(cli("hide").status).toBe(2);
  });
});
