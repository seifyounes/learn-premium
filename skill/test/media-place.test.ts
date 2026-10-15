// Placing checked media: `stage` puts a checked re-encode in a media branch's worktree and its slot in
// media.yaml, `ready` is the merge gate of that branch, and `placed` closes the item once the branch has
// merged. Synthetic Fixture Course projects (git, template gates faked); no media is ever generated.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mergeMediaYaml } from "../scripts/media/place.ts";
import { fakeKit } from "./fake-media-kit.ts";
import { must } from "./fake-notebooklm.ts";
import { materialsOf } from "./fixture-courses.ts";
import { jsonInput, ledger, media, tempDir, writeFiles } from "./helpers.ts";
import {
  fakeVerifier,
  gitIn,
  ingestFixture,
  itemOf,
  MEDIA_YAML,
  mediaCourse,
  mediaWith,
  YOUTUBE_BLOCK,
  type MediaCourse,
} from "./media-course.ts";

// Git-heavy: each test makes a repo, a worktree and several commits.
vi.setConfig({ testTimeout: 60_000 });

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const AUDIO = "module-01-audio";
const MODULE_DIR = "content/modules/01-m01";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const flags = (c: MediaCourse, id: string, tree: string) => [
  ...["--project", c.project, "--tree", tree, "--item", id, "--private", c.privateFolder],
];

const stage = (c: MediaCourse, id: string, tree: string) =>
  mediaWith({ verifier: fakeVerifier() }, "stage", ...flags(c, id, tree));
const ready = (c: MediaCourse, tree: string, deps = { verifier: fakeVerifier() }) =>
  mediaWith(deps, "ready", "--project", c.project, "--tree", tree, "--module", "01");

/** `git worktree add -b media/01-m01-<n>` from main: the branch a media pass places one Module's media on. */
function mediaTree(c: MediaCourse, n: number): string {
  const tree = join(tempDir("media-tree"), `media-01-m01-${n}`);
  gitIn(c.project, "worktree", "add", "-q", "-b", `media/01-m01-${n}`, tree, "main");
  return tree;
}

const encode = (c: MediaCourse, id: string) =>
  must(
    mediaWith(
      { kit: fakeKit() },
      "encode",
      "--state",
      c.state,
      "--project",
      c.project,
      "--item",
      id,
      "--private",
      c.privateFolder,
    ),
  );

/** The item downloaded, passed on as checked (the fact check is media-check.test.ts's) and re-encoded. */
function approved(c: MediaCourse, id: string, attempt: number) {
  const master = ingestFixture(c, id, attempt);
  must(media("checked", "--state", c.state, "--project", c.project, "--item", id));
  encode(c, id);
  return master;
}

/** The check file the fact-check subagent wrote for an item's current attempt: all `stage` reads from it is the alt text. */
function checkWithAlt(c: MediaCourse, id: string, master: string, alt: string | null) {
  const attempt = itemOf(c, id).regenerations + 1;
  writeFiles(c.privateFolder, {
    [`media/checks/${id}-${attempt}.json`]: JSON.stringify({
      check: "learn-premium media check v1",
      item: id,
      attempt,
      masterHash: createHash("sha256").update(readFileSync(master)).digest("hex"),
      alt,
      readings: [{ at: "infographic", text: "R = L/(kA)" }],
      claims: [],
    }),
  });
}

function commit(tree: string, message: string) {
  gitIn(tree, "add", "-A");
  gitIn(tree, "commit", "-q", "-m", message);
}

const objects = (project: string) =>
  new Set(
    gitIn(project, "cat-file", "--batch-all-objects", "--batch-check")
      .split(/\r?\n/)
      .map((line) => line.split(" ")[0]),
  );

const blobId = (project: string, file: string) => gitIn(project, "hash-object", file).trim();

describe("a rejected output never reaches git history", () => {
  test("attempt 1 is rejected, attempt 2 is staged, merged and placed: only attempt 2's re-encode is in the history", () => {
    const c = mediaCourse({ git: true });
    const master1 = ingestFixture(c, AUDIO, 1);
    must(media("checked", "--state", c.state, "--project", c.project, "--item", AUDIO));
    const web1 = join(c.privateFolder, encode(c, AUDIO).file as string);
    must(media("fail", "--state", c.state, "--project", c.project, "--item", AUDIO, "--reason", "a late finding"));
    const master2 = approved(c, AUDIO, 2);
    const web2 = join(c.privateFolder, itemOf(c, AUDIO).encoded?.file ?? "");

    const tree = mediaTree(c, 1);
    const staged = must(stage(c, AUDIO, tree));
    commit(tree, "feat: place Module 01's audio");
    const problems = ready(c, tree);
    gitIn(c.project, "merge", "--ff-only", "-q", "media/01-m01-1");
    const placed = media("placed", "--state", c.state, "--project", c.project, "--item", AUDIO, "--file", staged.file);

    expect(staged).toMatchObject({ file: `${MODULE_DIR}/media/deep-dive.mp3`, slot: "audio", module: "01" });
    expect(problems.out.problems).toEqual([]);
    expect(placed.code, JSON.stringify(placed.out)).toBe(0);
    expect(itemOf(c, AUDIO)).toMatchObject({ state: "placed", file: staged.file });
    const history = objects(c.project);
    expect(history.has(blobId(c.project, master1))).toBe(false);
    expect(history.has(blobId(c.project, master2))).toBe(false);
    expect(history.has(blobId(c.project, web1))).toBe(false);
    expect(history.has(blobId(c.project, web2))).toBe(true);
    const names = gitIn(c.project, "log", "--all", "--name-only", "--format=");
    expect(names).not.toMatch(/media-inbox/);
    expect(readFileSync(join(c.project, staged.file)).equals(readFileSync(web2))).toBe(true);
  });

  test("a media branch carrying a file that is no checked item's re-encode is refused by ready", () => {
    // Negative control: attempt 1's rejected master slipped onto the branch where the re-encode belongs.
    const c = mediaCourse({ git: true });
    const master1 = ingestFixture(c, AUDIO, 1);
    must(media("fail", "--state", c.state, "--project", c.project, "--item", AUDIO, "--reason", "wrong"));
    approved(c, AUDIO, 2);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    writeFileSync(join(tree, MODULE_DIR, "media", "deep-dive.mp3"), readFileSync(master1));
    commit(tree, "feat: place Module 01's audio");

    const { code, out } = ready(c, tree);

    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/media\/deep-dive\.mp3 isn't a checked item's re-encode/);
  });
});

describe("ready judges every commit being merged, and each file against its own item", () => {
  test("a rejected master committed and then replaced still rides the merge, so ready refuses it", () => {
    // Negative control: the final tree is clean, but a fast-forward publishes every commit's blobs.
    const c = mediaCourse({ git: true });
    const master1 = ingestFixture(c, AUDIO, 1);
    must(media("fail", "--state", c.state, "--project", c.project, "--item", AUDIO, "--reason", "wrong"));
    approved(c, AUDIO, 2);
    const tree = mediaTree(c, 1);
    mkdirSync(join(tree, MODULE_DIR, "media"), { recursive: true });
    writeFileSync(join(tree, MODULE_DIR, "media", "deep-dive.mp3"), readFileSync(master1));
    commit(tree, "feat: the first deep dive");
    must(stage(c, AUDIO, tree));
    commit(tree, "feat: the right deep dive");

    const { code, out } = ready(c, tree);

    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/media\/deep-dive\.mp3 isn't a checked item's re-encode/);
  });

  test("a branch with a merge commit is refused: it is rebased onto main, never merged", () => {
    // A merge commit's own diff is empty, so the history gate would never see what came in with it.
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    commit(tree, "feat: place Module 01's audio");
    gitIn(tree, "checkout", "-q", "-b", "side", "HEAD~1");
    writeFiles(tree, { [`${MODULE_DIR}/summary/1.md`]: "from a side branch\n" });
    commit(tree, "feat: a side edit");
    gitIn(tree, "checkout", "-q", "media/01-m01-1");
    gitIn(tree, "merge", "-q", "--no-ff", "-m", "chore: merge the side branch", "side");

    const { out } = ready(c, tree);

    expect(out.problems.join("\n")).toMatch(/merge commit/);
  });

  test("another Module's checked audio can't be committed as this Module's", () => {
    const c = mediaCourse({ git: true, alsoLive: ["02"] });
    approved(c, AUDIO, 1);
    approved(c, "module-02-audio", 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    const other = readFileSync(join(c.privateFolder, itemOf(c, "module-02-audio").encoded?.file ?? ""));
    writeFileSync(join(tree, MODULE_DIR, "media", "deep-dive.mp3"), other);
    commit(tree, "feat: Module 02's audio as Module 01's");

    const { out } = ready(c, tree);

    expect(out.problems.join("\n")).toMatch(/media\/deep-dive\.mp3 isn't a checked item's re-encode/);
  });

  test("a checked file under the wrong name for its kind is refused", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    writeFileSync(
      join(tree, MODULE_DIR, "media", "explainer.mp4"),
      readFileSync(join(tree, MODULE_DIR, "media", "deep-dive.mp3")),
    );
    commit(tree, "feat: the audio's bytes in the video's slot");

    const { out } = ready(c, tree);

    expect(out.problems.join("\n")).toMatch(/media\/explainer\.mp4 isn't a checked item's re-encode/);
  });

  test("the worktree's Materials inventory must hold every hash the live ledger has", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    commit(tree, "feat: place Module 01's audio");
    writeFiles(materialsOf(c.project), { "L03b.pdf": "a new board photo scan" });
    const added = { id: "03", slug: "m03", title: "Module 03", materials: ["L03b.pdf"] };
    must(
      ledger(
        "map",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--input",
        jsonInput({ modules: [added], unmapped: [] }),
      ),
    );

    const stale = ready(c, tree).out.problems.join("\n");
    gitIn(c.project, "add", "build-ledger.json", "build-records");
    gitIn(c.project, "commit", "-q", "-m", "chore: record the new Material");
    gitIn(tree, "rebase", "-q", "main");
    const fresh = ready(c, tree);

    expect(stale).toMatch(/predates Materials the live ledger has \(L03b\.pdf\)/);
    expect(fresh.out.problems).toEqual([]);
  });
});

/** An item that passed the real judge (no number in what the fake kit heard): evidence, a check file, `check`. */
function passedJudge(c: MediaCourse, id: string, attempt: number) {
  const master = ingestFixture(c, id, attempt);
  const evidence = must(mediaWith({ kit: fakeKit(), verifier: fakeVerifier() }, "evidence", ...pass(c, id)));
  writeFiles(c.privateFolder, {
    [`media/checks/${id}-${attempt}.json`]: JSON.stringify({
      check: "learn-premium media check v1",
      item: id,
      attempt,
      masterHash: createHash("sha256").update(readFileSync(master)).digest("hex"),
      alt: null,
      readings: [],
      claims: [],
    }),
  });
  expect(evidence.check).toBeDefined();
  must(mediaWith({ verifier: fakeVerifier() }, "check", ...pass(c, id)));
  encode(c, id);
}

const pass = (c: MediaCourse, id: string) => ["--project", c.project, "--item", id, "--private", c.privateFolder];

describe("what was checked is what is placed", () => {
  test("a Module rebuilt between the check and the staging must be checked again", () => {
    // Negative control: the check bound itself to the Module's content as it was.
    const c = mediaCourse({ git: true });
    passedJudge(c, AUDIO, 1);
    writeFiles(c.project, { [`${MODULE_DIR}/summary/1.md`]: "a rebuilt summary beat\n" });
    const tree = mediaTree(c, 1);

    const { code, out } = stage(c, AUDIO, tree);

    expect(code).toBe(3);
    expect(out.error).toMatch(/content changed since .*fact check/);
  });

  test("a Module left alone stages the item that passed", () => {
    const c = mediaCourse({ git: true });
    passedJudge(c, AUDIO, 1);
    const tree = mediaTree(c, 1);

    expect(stage(c, AUDIO, tree).code).toBe(0);
  });

  test("media.yaml's other blocks must still be main's: a youtube card can't be dropped from a media branch", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    const yaml = join(tree, MODULE_DIR, "media.yaml");
    writeFileSync(yaml, readFileSync(yaml, "utf8").replace(YOUTUBE_BLOCK, ""));
    commit(tree, "feat: place the audio and drop a card");

    const { out } = ready(c, tree);

    expect(out.problems.join("\n")).toMatch(/media\.yaml changes blocks other than the media slots \(youtube\)/);
  });
});

describe("stage and ready hold a branch to media only", () => {
  test("an item that isn't checked can't be staged", () => {
    const c = mediaCourse({ git: true });
    const tree = mediaTree(c, 1);

    const { code, out } = stage(c, AUDIO, tree);

    expect(code).toBe(3);
    expect(out.error).toMatch(/queued/);
    expect(existsSync(join(tree, MODULE_DIR, "media"))).toBe(false);
  });

  test("a branch that also edits the Module's text is refused by ready", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    writeFiles(tree, { [`${MODULE_DIR}/summary/1.md`]: "edited from a media branch\n" });
    commit(tree, "feat: place media and edit a summary");

    const { out } = ready(c, tree);

    expect(out.problems.join("\n")).toMatch(/a media branch places media only: .*summary\/1\.md/);
  });

  test("a branch that isn't a media branch can't be staged", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = join(tempDir("media-tree"), "other");
    gitIn(c.project, "worktree", "add", "-q", "-b", "module/01-m01-9", tree, "main");

    const { code, out } = stage(c, AUDIO, tree);

    expect(code).toBe(3);
    expect(out.error).toMatch(/media\//);
  });

  test("a re-encode that no longer matches what was recorded can't be staged", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    writeFileSync(join(c.privateFolder, itemOf(c, AUDIO).encoded?.file ?? ""), "changed on disk");
    const tree = mediaTree(c, 1);

    const { code, out } = stage(c, AUDIO, tree);

    expect(code).toBe(3);
    expect(out.error).toMatch(/re-encode/);
  });
});

describe("placed media never blocks a Module", () => {
  const startWave = (c: MediaCourse, target: string, branch: string) =>
    must(
      ledger(
        "wave",
        "start",
        "--project",
        c.project,
        "--holder",
        "session-a",
        "--kind",
        "module",
        "--target",
        target,
        "--branch",
        branch,
      ),
    );

  test("a Module being rebuilt keeps its media waiting: stage and ready refuse until it is live again", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    commit(tree, "feat: place Module 01's audio");
    startWave(c, "01", "module/01-m01-2");

    const staged = stage(c, AUDIO, tree);
    const { code, out } = ready(c, tree);

    expect(staged.code).toBe(3);
    expect(staged.out.error).toMatch(/Module 01 is being rebuilt \(wave module-01-2\)/);
    expect(code).toBe(1);
    expect(out.problems.join("\n")).toMatch(/Module 01 is being rebuilt \(wave module-01-2\)/);
  });

  test("ready waits for any running wave, so a media merge never makes a wave rebase and re-gate", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const tree = mediaTree(c, 1);
    must(stage(c, AUDIO, tree));
    commit(tree, "feat: place Module 01's audio");
    const { wave } = startWave(c, "02", "module/02-m02");

    const waiting = ready(c, tree).out.problems.join("\n");
    must(ledger("wave", "end", "--project", c.project, "--holder", "session-a", "--wave", wave, "--result", "failed"));
    const clear = ready(c, tree);

    expect(waiting).toMatch(/wave module-02-1 is running/);
    expect(clear.out.problems).toEqual([]);
  });

  test("an item dropped for good leaves its Module live and plans no wave for it", () => {
    const c = mediaCourse({ git: true });
    for (const id of ["module-01-video", AUDIO, "module-01-infographic"]) {
      ingestFixture(c, id, 1);
      must(media("fail", "--state", c.state, "--project", c.project, "--item", id, "--reason", "r", "--final"));
    }

    const status = must(ledger("status", "--project", c.project));
    const next = must(ledger("next", "--project", c.project));

    expect(status.modules.find((m: { id: string }) => m.id === "01").state).toBe("live");
    expect(JSON.stringify(next)).not.toMatch(/"module":"01"|"target":"01"/);
    expect(itemOf(c, AUDIO).state).toBe("dropped");
  });
});

describe("the infographic slot", () => {
  test("stages the checked file with the check's alt text, keeping the youtube card as it was", () => {
    const c = mediaCourse({ git: true });
    const master = approved(c, "module-01-infographic", 1);
    checkWithAlt(c, "module-01-infographic", master, 'Thermal resistance: R = L/(kA), "layers add"');
    const tree = mediaTree(c, 1);

    const staged = must(stage(c, "module-01-infographic", tree));

    expect(staged).toMatchObject({ file: `${MODULE_DIR}/media/infographic.png`, slot: "infographic" });
    const yaml = readFileSync(join(tree, MODULE_DIR, "media.yaml"), "utf8");
    expect(yaml).toBe(
      `# Synthetic media slots for the media tests.\ninfographic:\n  file: infographic.png\n  alt: "Thermal resistance: R = L/(kA), \\"layers add\\""\n${YOUTUBE_BLOCK}`,
    );
    const web = join(c.privateFolder, itemOf(c, "module-01-infographic").encoded?.file ?? "");
    expect(readFileSync(join(tree, staged.file)).equals(readFileSync(web))).toBe(true);
  });
});

describe("placed", () => {
  test("a re-encoded item is placed only from a file on main that is the recorded re-encode", () => {
    // Negative control: an item with an encode isn't placed by a path that isn't in the history, or isn't the re-encode.
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    writeFiles(c.project, { [`${MODULE_DIR}/media/deep-dive.mp3`]: "not the re-encode" });
    const place = (file: string) =>
      media("placed", "--state", c.state, "--project", c.project, "--item", AUDIO, "--file", file);

    const wrong = place(`${MODULE_DIR}/media/deep-dive.mp3`);

    expect(wrong.code).toBe(2);
    expect(itemOf(c, AUDIO).state).toBe("checked");
  });

  test("the right bytes that aren't committed on main yet, or sit on another branch, aren't placed", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const web = readFileSync(join(c.privateFolder, itemOf(c, AUDIO).encoded?.file ?? ""));
    const file = `${MODULE_DIR}/media/deep-dive.mp3`;
    mkdirSync(join(c.project, MODULE_DIR, "media"), { recursive: true });
    writeFileSync(join(c.project, file), web);
    const place = () => media("placed", "--state", c.state, "--project", c.project, "--item", AUDIO, "--file", file);

    const untracked = place();
    gitIn(c.project, "add", "-A");
    gitIn(c.project, "commit", "-q", "-m", "feat: the media, on a side branch");
    gitIn(c.project, "checkout", "-q", "-b", "side");
    const elsewhere = place();

    expect([untracked.code, elsewhere.code]).toEqual([2, 2]);
    expect(untracked.out.error).toMatch(/committed on main/);
    expect(elsewhere.out.error).toMatch(/isn't on main/);
    expect(itemOf(c, AUDIO).state).toBe("checked");
  });

  test("the re-encode copied over a path whose committed bytes are older isn't placed: main would publish the old file", () => {
    const c = mediaCourse({ git: true });
    approved(c, AUDIO, 1);
    const file = `${MODULE_DIR}/media/deep-dive.mp3`;
    mkdirSync(join(c.project, MODULE_DIR, "media"), { recursive: true });
    writeFileSync(join(c.project, file), "an older deep dive");
    gitIn(c.project, "add", "-A");
    gitIn(c.project, "commit", "-q", "-m", "feat: an older deep dive");
    writeFileSync(join(c.project, file), readFileSync(join(c.privateFolder, itemOf(c, AUDIO).encoded?.file ?? "")));

    const { code, out } = media("placed", "--state", c.state, "--project", c.project, "--item", AUDIO, "--file", file);

    expect(code).toBe(2);
    expect(out.error).toMatch(/committed on main/);
    expect(itemOf(c, AUDIO).state).toBe("checked");
  });

  test("a checked item with no re-encode is placed only by hand, with --unencoded", () => {
    // Negative control: after `check` and before `encode` an item has no re-encode, and `placed` mustn't skip it.
    const c = mediaCourse();
    ingestFixture(c, AUDIO, 1);
    must(media("checked", "--state", c.state, "--project", c.project, "--item", AUDIO));
    writeFiles(c.project, { "deep-dive.mp3": "placed by hand" });
    const place = (...more: string[]) =>
      media("placed", "--state", c.state, "--project", c.project, "--item", AUDIO, "--file", "deep-dive.mp3", ...more);

    const refused = place();
    const byHand = place("--unencoded");

    expect(refused.code).toBe(3);
    expect(refused.out.error).toMatch(/encode/);
    expect(byHand.code).toBe(0);
    expect(itemOf(c, AUDIO).state).toBe("placed");
  });
});

describe("mergeMediaYaml", () => {
  const VIDEO = "video:\n  file: explainer.mp4\n  duration: '0:04'\n";
  const AUDIO_SLOT = "audio:\n  file: deep-dive.mp3\n  duration: '0:04'\n";

  test("keeps the header and every other block byte for byte, in their order", () => {
    const existing = `# a header\n# another line\n\n${YOUTUBE_BLOCK}other:\n  - 1\n`;

    const merged = mergeMediaYaml(existing, { audio: AUDIO_SLOT });

    expect(merged).toBe(`# a header\n# another line\n\n${AUDIO_SLOT}${YOUTUBE_BLOCK}other:\n  - 1\n`);
  });

  test("replaces a slot's block: the old video's captions line is gone", () => {
    const old = "video:\n  file: old.mp4\n  duration: '1:00'\n  captions: old.vtt\n";

    const merged = mergeMediaYaml(`${old}${YOUTUBE_BLOCK}`, { video: VIDEO });

    expect(merged).toBe(`${VIDEO}${YOUTUBE_BLOCK}`);
    expect(merged).not.toMatch(/captions/);
  });

  test("orders the slots video, audio, infographic, whatever order they came in", () => {
    const info = "infographic:\n  file: infographic.png\n  alt: x\n";

    const merged = mergeMediaYaml(`${info}${AUDIO_SLOT}`, { video: VIDEO });

    expect(merged).toBe(`${VIDEO}${AUDIO_SLOT}${info}`);
  });

  test("a comment above a block stays with that block when the one before it is replaced", () => {
    const existing = `video:\n  file: old.mp4\n  duration: '1:00'\n# the cards\n${YOUTUBE_BLOCK}`;

    const merged = mergeMediaYaml(existing, { video: VIDEO });

    expect(merged).toBe(`${VIDEO}# the cards\n${YOUTUBE_BLOCK}`);
  });

  test("starts a file from nothing", () => {
    expect(mergeMediaYaml("", { audio: AUDIO_SLOT })).toBe(AUDIO_SLOT);
    expect(MEDIA_YAML).toContain("youtube:");
  });
});
