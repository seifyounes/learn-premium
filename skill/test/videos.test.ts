// The YouTube video cards' skill side (`wave.ts videos …`) through the command interface, on a
// synthetic Course project and Private folder. The template's `videos probe` is faked: no test asks
// YouTube anything, and every id here is synthetic.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import type { ProbeAnswer, VideoTemplate } from "../scripts/wave/videos.ts";
import { templateVideos } from "../scripts/wave/wave.ts";
import { fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { tempDir, writeFiles, type Result } from "./helpers.ts";

// Each hide commits to a repo: the 30 s the other git-heavy suites have.
vi.setConfig({ testTimeout: 30_000 });

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function wave(args: string[], deps: Partial<WaveDeps> = {}): Result {
  const { code, stdout } = runWave(args, deps);
  return { code, out: JSON.parse(stdout) };
}

function newCourse() {
  const project = fixtureCourse("Machine Learning", { planned: ["01", "02"] });
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  return { project, privateFolder };
}

const A = "abcdefghijk";
const B = "bcdefghijkl";
const QUOTE = "add the resistances in series";

const candidate = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Claimed title of ${id}`,
  channel: "Claimed channel",
  duration: "1:00",
  match: 9,
  why: "Adds layer resistances in a table, as the sheet does.",
  evidence: "At 3:15 it builds the same resistance table as Lecture 2.",
  moments: [{ at: "3:15", label: "The series rule", quote: QUOTE }],
  ...over,
});

function hunt(privateFolder: string, candidates: unknown[], topic = "series resistances", module = "01") {
  writeFiles(privateFolder, {
    [`waves/${module}/youtube/hunt-${topic.replace(/\W+/g, "-")}.json`]: JSON.stringify({
      hunt: "learn-premium youtube hunt v1",
      module,
      topic,
      candidates,
    }),
  });
}

const transcript = (privateFolder: string, id: string, text: string) =>
  writeFiles(privateFolder, { [`waves/01/youtube/transcripts/${id}.txt`]: text });

/** The template's `videos probe`, faked: every id answers 200 with its own title, 725 s long, unless `answers` says otherwise. */
function fakeVideos(answers: Record<string, Partial<ProbeAnswer>> = {}) {
  const asked: string[][] = [];
  const hidden: { module: string; id: string; title: string }[] = [];
  const videos: VideoTemplate = {
    cards: () => [],
    probe: (_project, ids) => {
      asked.push(ids);
      return ids.map((id) => ({
        id,
        oembed: { status: 200, title: `YouTube title of ${id}`, author: "YouTube channel" },
        lengthSeconds: 725,
        ...answers[id],
      }));
    },
    hide: () => hidden,
  };
  return { videos, asked, hidden };
}

const verify = (project: string, videos: VideoTemplate, module = "01") =>
  wave(["videos", "verify", "--project", project, "--module", module], { videos });

const verifiedOf = (privateFolder: string) =>
  JSON.parse(readFileSync(join(privateFolder, "waves/01/youtube/verified.json"), "utf8"));

describe("videos verify", () => {
  test("verify never passes a candidate below 9, and never probes it", () => {
    const { project, privateFolder } = newCourse();
    hunt(privateFolder, [candidate(A, { match: 8 }), candidate(B, { match: 9 })]);
    transcript(privateFolder, B, `3:15 so we ${QUOTE} and that is the whole rule`);
    const { videos, asked } = fakeVideos();

    const { code, out } = verify(project, videos);

    expect(code).toBe(0);
    expect(out.cards.map((c: { id: string }) => c.id)).toEqual([B]);
    expect(out.rejected).toEqual([{ id: A, reasons: [expect.stringMatching(/match 8 is below 9/)] }]);
    expect(asked).toEqual([[B]]);
    expect(verifiedOf(privateFolder).cards.map((c: { id: string }) => c.id)).toEqual([B]);
  });
});

/** One candidate that passes everything but what a test breaks, with a transcript that hears the quote at 3:15. */
function oneCard(over: Record<string, unknown> = {}, text = `3:15 so we ${QUOTE} and that is the whole rule`) {
  const course = newCourse();
  hunt(course.privateFolder, [candidate(A, over)]);
  transcript(course.privateFolder, A, text);
  return course;
}

describe("videos verify, hunts older than the Module's Materials", () => {
  const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

  test("a hunt written before the Module's Materials last changed is refused: exit 2, nothing probed", () => {
    const { project, privateFolder } = oneCard();
    utimesSync(join(privateFolder, "waves/01/youtube/hunt-series-resistances.json"), LONG_AGO, LONG_AGO);
    const { videos, asked } = fakeVideos();

    const { code, out } = verify(project, videos);

    expect(code).toBe(2);
    expect(out.error).toMatch(/hunt-series-resistances\.json .*older than Module 01's Materials/);
    expect(asked).toEqual([]);
    expect(existsSync(join(privateFolder, "waves/01/youtube/verified.json"))).toBe(false);
  });

  test("a hunt written after the Materials is still read (negative control)", () => {
    const { project } = oneCard();
    const fresh = fakeVideos();

    expect(verify(project, fresh.videos).code).toBe(0);
    expect(fresh.asked).toEqual([[A]]);
  });
});

describe("videos verify, one candidate at a time", () => {
  test("a candidate on the do-not-use list is rejected, and so is one `never` rules off the method", () => {
    const { project, privateFolder } = oneCard();
    const { videos, asked } = fakeVideos();
    const never = wave(
      ["videos", "never", "--project", project, "--id", A, "--reason", "teaches R = kL, not the sheet's"],
      {
        videos,
      },
    );
    expect(never.code).toBe(0);

    const { code, out } = verify(project, videos);

    expect(code).toBe(0);
    expect(out.cards).toEqual([]);
    expect(out.rejected).toEqual([{ id: A, reasons: [expect.stringMatching(/do-not-use list: teaches R = kL/)] }]);
    expect(asked).toEqual([]);
    expect(existsSync(join(privateFolder, "youtube/do-not-use.json"))).toBe(true);
  });

  test("`never` takes only a YouTube video id", () => {
    const { project } = newCourse();
    const { code, out } = wave(["videos", "never", "--project", project, "--id", "short", "--reason", "no"]);
    expect(code).toBe(2);
    expect(out.error).toMatch(/--id/);
  });

  test("parallel waves ruling videos off at once each keep their entry on the shared list", async () => {
    const { project, privateFolder } = newCourse();
    const entry = fileURLToPath(new URL("../scripts/wave.ts", import.meta.url));
    const together = new URL("./start-together.ts", import.meta.url).href;
    const startAt = Date.now() + 1500;
    const ids = ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3", "aaaaaaaaaa4", "aaaaaaaaaa5", "aaaaaaaaaa6"];
    const codes = await Promise.all(
      ids.map(
        (id) =>
          new Promise<number | null>((resolve) =>
            spawn(
              process.execPath,
              ["--import", together, entry, ...["videos", "never", "--project", project, "--id", id, "--reason", "r"]],
              { stdio: "ignore", env: { ...process.env, START_AT: String(startAt) } },
            ).on("close", resolve),
          ),
      ),
    );
    expect(codes).toEqual(ids.map(() => 0));
    const list = JSON.parse(readFileSync(join(privateFolder, "youtube/do-not-use.json"), "utf8"));
    expect(list.videos.map((v: { id: string }) => v.id).sort()).toEqual(ids);
  });

  test.each(["", "   "])("`never` refuses the empty reason %j and leaves the do-not-use list intact", (reason) => {
    const { project, privateFolder } = newCourse();
    const refused = wave(["videos", "never", "--project", project, "--id", A, "--reason", reason]);
    expect(refused.code).toBe(2);
    expect(existsSync(join(privateFolder, "youtube/do-not-use.json"))).toBe(false);
    // A later, valid ruling still lands: nothing invalid was written before it.
    const later = wave(["videos", "never", "--project", project, "--id", B, "--reason", "wrong method"]);
    expect(later.code).toBe(0);
    expect(later.out.listed).toBe(1);
  });

  test.each([
    [401, /oEmbed answered 401/],
    [404, /oEmbed answered 404/],
  ])("oEmbed answering %i rejects the candidate: it can't play in a card", (status, reason) => {
    const { project } = oneCard();
    const { videos } = fakeVideos({ [A]: { oembed: { status } } });

    const { code, out } = verify(project, videos);

    expect(code).toBe(0);
    expect(out.cards).toEqual([]);
    expect(out.rejected).toEqual([{ id: A, reasons: [expect.stringMatching(reason)] }]);
  });

  test("a video with no length on its watch page is rejected", () => {
    const { project } = oneCard();
    const { out } = verify(project, fakeVideos({ [A]: { lengthSeconds: null } }).videos);
    expect(out.cards).toEqual([]);
    expect(out.rejected[0].reasons[0]).toMatch(/no length/);
  });

  test("the card's title, channel and duration are YouTube's own, never the hunter's claim", () => {
    const { project } = oneCard();
    const { out } = verify(project, fakeVideos().videos);
    expect(out.cards).toEqual([
      {
        id: A,
        title: `YouTube title of ${A}`,
        channel: "YouTube channel",
        duration: "12:05",
        match: 9,
        why: "Adds layer resistances in a table, as the sheet does.",
        moments: [{ at: "3:15", label: "The series rule" }],
      },
    ]);
  });

  test.each([
    [725, "12:05"],
    [3725, "1:02:05"],
    [59, "0:59"],
  ])("a %i s video is written %s", (lengthSeconds, written) => {
    const { project } = oneCard({ moments: [] });
    const { out } = verify(project, fakeVideos({ [A]: { lengthSeconds } }).videos);
    expect(out.cards[0].duration).toBe(written);
  });

  test.each([429, 500, 503])(
    "oEmbed answering %i is a throttle or an outage: the candidate waits, it isn't rejected",
    (status) => {
      const { project } = oneCard();
      const { code, out } = verify(project, fakeVideos({ [A]: { oembed: { status } } }).videos);
      expect(code).toBe(1);
      expect(out.waiting).toEqual([A]);
      expect(out.rejected).toEqual([]);
      expect(out.cards).toEqual([]);
      expect(out.next).toMatch(new RegExp(`${A}: YouTube answered ${status}`));
    },
  );

  test.each([400, 403])("oEmbed answering %i rejects the candidate like 401 and 404", (status) => {
    const { project } = oneCard();
    const { code, out } = verify(project, fakeVideos({ [A]: { oembed: { status } } }).videos);
    expect(code).toBe(0);
    expect(out.rejected).toEqual([{ id: A, reasons: [expect.stringMatching(`oEmbed answered ${status}`)] }]);
  });

  test("a watch page that couldn't be read leaves the candidate waiting: it isn't a page with no length", () => {
    const { project } = oneCard();
    const { code, out } = verify(project, fakeVideos({ [A]: { lengthSeconds: { error: "timed out" } } }).videos);
    expect(code).toBe(1);
    expect(out.waiting).toEqual([A]);
    expect(out.rejected).toEqual([]);
    expect(out.next).toMatch(/watch page couldn't be read: timed out/);
  });

  test("a dollar sign in YouTube's title or channel is written escaped, so the content's prose reads it literally", () => {
    const { project } = oneCard();
    const { out } = verify(
      project,
      fakeVideos({ [A]: { oembed: { status: 200, title: "Economics of a $5 price", author: "Cost $ Channel" } } })
        .videos,
    );
    expect(out.cards[0].title).toBe("Economics of a \\$5 price");
    expect(out.cards[0].channel).toBe("Cost \\$ Channel");
  });

  test("a YouTube that can't be asked leaves the candidate waiting, not rejected", () => {
    const { project } = oneCard();
    const { code, out } = verify(project, fakeVideos({ [A]: { oembed: { error: "offline" } } }).videos);
    expect(code).toBe(1);
    expect(out.waiting).toEqual([A]);
    expect(out.rejected).toEqual([]);
    expect(out.next).toMatch(/offline/);
  });
});

describe("videos verify, the moments against the transcript", () => {
  test("a moment ships when its quote is heard in a cue within 20 s, and not otherwise", () => {
    const { project } = oneCard(
      {
        moments: [
          { at: "3:15", label: "Kept", quote: QUOTE },
          { at: "3:15", label: "Absent", quote: "the quote nobody said" },
          { at: "1:00", label: "Far away", quote: QUOTE },
        ],
      },
      `3:15 so we ${QUOTE} and that is the whole rule\n3:40 next layer`,
    );

    const { code, out } = verify(project, fakeVideos().videos);

    expect(code).toBe(0);
    expect(out.cards[0].moments).toEqual([{ at: "3:15", label: "Kept" }]);
    expect(out.dropped).toEqual([
      { id: A, at: "3:15", why: expect.stringMatching(/"the quote nobody said" isn't heard within 20 s of 3:15/) },
      { id: A, at: "1:00", why: expect.stringMatching(/isn't heard within 20 s of 1:00/) },
    ]);
  });

  test("a quote heard only 90 s away is dropped", () => {
    const { project } = oneCard({}, `4:45 so we ${QUOTE} and that is the whole rule\n3:15 nothing relevant here`);
    const { out } = verify(project, fakeVideos().videos);
    expect(out.cards[0].moments).toEqual([]);
    expect(out.dropped).toHaveLength(1);
  });

  test.each([
    ["20 s after", "3:35", true],
    ["21 s after", "3:36", false],
    ["20 s before", "2:55", true],
    ["21 s before", "2:54", false],
  ])("the window's edge: a cue %s the moment", (_edge, at, kept) => {
    const { project } = oneCard({}, `${at} so we ${QUOTE} and that is the whole rule`);
    const { out } = verify(project, fakeVideos().videos);
    expect(out.cards[0].moments).toHaveLength(kept ? 1 : 0);
  });

  test("reads a time line followed by its text lines, CRLF endings, and a quote split across two cues", () => {
    const { project } = oneCard(
      {},
      ["3:12", "so now we add the", "3:15", "resistances in series, right?", "3:19", "and that is the rule"].join(
        "\r\n",
      ),
    );
    const { out } = verify(project, fakeVideos().videos);
    expect(out.cards[0].moments).toEqual([{ at: "3:15", label: "The series rule" }]);
  });

  test("ignores case and punctuation in the quote and the transcript", () => {
    const { project } = oneCard({}, "3:15 So we ADD the resistances, in series!");
    const { out } = verify(project, fakeVideos().videos);
    expect(out.cards[0].moments).toHaveLength(1);
  });

  test("a moment past the end of the video is dropped", () => {
    const { project } = oneCard({}, `3:15 so we ${QUOTE} and that is the whole rule`);
    const { out } = verify(project, fakeVideos({ [A]: { lengthSeconds: 120 } }).videos);
    expect(out.cards[0].moments).toEqual([]);
    expect(out.dropped[0].why).toMatch(/past the end of the video \(2:00\)/);
  });

  test("a card whose moments all drop still ships, without moments", () => {
    const { project } = oneCard({}, "3:15 nothing of the sort");
    const { code, out } = verify(project, fakeVideos().videos);
    expect(code).toBe(0);
    expect(out.cards.map((c: { id: string }) => c.id)).toEqual([A]);
    expect(out.cards[0].moments).toEqual([]);
  });

  test("a candidate with no saved transcript is waiting: exit 1, and next says to save it", () => {
    const { project, privateFolder } = newCourse();
    hunt(privateFolder, [candidate(A), candidate(B)]);
    transcript(privateFolder, B, `3:15 so we ${QUOTE} now`);

    const { code, out } = verify(project, fakeVideos().videos);

    expect(code).toBe(1);
    expect(out.waiting).toEqual([A]);
    expect(out.cards.map((c: { id: string }) => c.id)).toEqual([B]);
    expect(out.next).toMatch(new RegExp(`${A}: save its transcript at .*${A}\\.txt`));
  });

  test("a quote of fewer than 4 words is malformed: exit 2", () => {
    const { project } = oneCard({ moments: [{ at: "3:15", label: "Short", quote: "add them up" }] });
    const { code, out } = verify(project, fakeVideos().videos);
    expect(code).toBe(2);
    expect(out.error).toMatch(/at least 4 words/);
  });

  test("no hunt file, or one that doesn't read, is exit 2", () => {
    const { project, privateFolder } = newCourse();
    expect(verify(project, fakeVideos().videos).code).toBe(2);
    writeFiles(privateFolder, {
      "waves/01/youtube/hunt-x.json": JSON.stringify({ hunt: "learn-premium youtube hunt v1" }),
    });
    expect(verify(project, fakeVideos().videos).code).toBe(2);
  });
});

describe("the template's probe, called through its command line", () => {
  // A stub gate runner that parses argv with the real runner's strict options and echoes one probe per id.
  const STUB = [
    'import { parseArgs } from "node:util";',
    "const { values } = parseArgs({",
    "  args: process.argv.slice(2),",
    "  allowPositionals: true,",
    '  options: { ids: { type: "string" }, content: { type: "string" } },',
    "});",
    'const ids = (values.ids ?? "").split(",");',
    "const probes = ids.map((id) => ({ id, oembed: { status: 200, title: id, author: id }, lengthSeconds: 60 }));",
    "console.log(JSON.stringify({ probes }));",
    "",
  ].join("\n");

  test.each(["-bcdefghijk", "abcdefghijk"])("an id of %s reaches the template as asked", (id) => {
    const project = tempDir("probe-project");
    writeFiles(project, { "template/gates/cli.ts": STUB });

    const answered = templateVideos.probe(project, [id]);

    expect(typeof answered).not.toBe("string");
    expect((answered as ProbeAnswer[])[0]?.id).toBe(id);
  });
});

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

describe("videos hide", () => {
  const REPORT = JSON.stringify({
    checkpointItems: [
      {
        gate: "live-videos",
        message: `${A} is dead: YouTube's oEmbed answers 404 (removed); the card is hidden after this deploy`,
        at: "modules/01-m01/media.yaml",
      },
    ],
  });

  function onBranch(branch: string) {
    const course = newCourse();
    git(course.project, "init", "-q");
    git(course.project, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
    writeFiles(course.project, { "live-report.json": REPORT });
    return course;
  }
  const hide = (project: string, videos: VideoTemplate) =>
    wave(["videos", "hide", "--project", project, "--report", join(project, "live-report.json")], { videos });

  test("hide is refused off main, and hides nothing", () => {
    const { project } = onBranch("module/01-m01");
    const { videos } = fakeVideos();
    const hidden = vi.spyOn(videos, "hide");

    const { code, out } = hide(project, videos);

    expect(code).toBe(3);
    expect(out.error).toMatch(/not main/);
    expect(hidden).not.toHaveBeenCalled();
  });

  test("on main it records the dead card on the do-not-use list and reports it, and a later verify rejects it", () => {
    const { project, privateFolder } = onBranch("main");
    const { videos, hidden } = fakeVideos();
    hidden.push({ module: "01-m01", id: A, title: "A planted card" });

    const { code, out } = hide(project, videos);

    expect(code).toBe(0);
    expect(out.hidden).toEqual([{ module: "01-m01", id: A, title: "A planted card" }]);
    expect(out.markdown).toContain(A);
    expect(out.markdown).toContain("A planted card");
    expect(out.markdown).toMatch(/oEmbed answers 404 \(removed\)/);
    const list = JSON.parse(readFileSync(join(privateFolder, "youtube/do-not-use.json"), "utf8"));
    expect(list.videos).toEqual([{ id: A, reason: expect.stringContaining("is dead"), at: expect.any(String) }]);

    // The list only grows: hiding it again adds nothing, and a hunt that finds it again is rejected.
    hide(project, videos);
    expect(JSON.parse(readFileSync(join(privateFolder, "youtube/do-not-use.json"), "utf8")).videos).toHaveLength(1);
    hunt(privateFolder, [candidate(A)]);
    transcript(privateFolder, A, `3:15 so we ${QUOTE}`);
    expect(verify(project, fakeVideos().videos).out.rejected).toEqual([
      { id: A, reasons: [expect.stringMatching(/do-not-use/)] },
    ]);
  });

  test("with nothing dead it says so", () => {
    const { project } = onBranch("main");
    const { out } = hide(project, fakeVideos().videos);
    expect(out.hidden).toEqual([]);
    expect(out.markdown).toMatch(/none to hide/);
  });

  test("a report that isn't there is exit 2", () => {
    const { project } = onBranch("main");
    const { code } = wave(["videos", "hide", "--project", project, "--report", join(project, "nope.json")], {
      videos: fakeVideos().videos,
    });
    expect(code).toBe(2);
  });
});
