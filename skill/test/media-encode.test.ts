// The web re-encode and its size policy through the `encode` command: a checked item's master becomes a web
// copy in the Private folder; one over GitHub's file limit is re-encoded harder once, else dropped. The kit is
// faked, the limit small, so no test makes a big file.
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GITHUB_FILE_LIMIT_BYTES } from "../scripts/media/model.ts";
import { fakeKit } from "./fake-media-kit.ts";
import { must } from "./fake-notebooklm.ts";
import { fakeVerifier, ingestFixture, itemOf, mediaCourse, mediaWith, type MediaCourse } from "./media-course.ts";
import { media, writeFiles } from "./helpers.ts";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const VIDEO = "module-01-video";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const flags = (c: MediaCourse, id: string) => ["--project", c.project, "--item", id, "--private", c.privateFolder];

/** An item downloaded and passed on to `checked` (the fact check itself is media-check.test.ts's). */
function checked(id = VIDEO) {
  const c = mediaCourse();
  const master = ingestFixture(c, id, 1);
  must(media("checked", "--state", c.state, "--project", c.project, "--item", id));
  return { c, master };
}

const encode = (c: MediaCourse, kit = fakeKit(), id = VIDEO, limitBytes = GITHUB_FILE_LIMIT_BYTES) =>
  mediaWith({ kit, verifier: fakeVerifier(), limitBytes }, "encode", "--state", c.state, ...flags(c, id));

describe("the size policy", () => {
  test("a file over the limit is re-encoded harder once and kept, with both sizes reported", () => {
    const { c, master } = checked();
    const kit = fakeKit({ sizes: { [VIDEO]: [150, 90] } });

    const { code, out } = encode(c, kit, VIDEO, 100);

    expect(code, JSON.stringify(out)).toBe(0);
    expect(kit.calls.map((call) => call.call)).toEqual(["encode", "encode-harder"]);
    expect(out).toMatchObject({
      bytes: 90,
      masterBytes: statSync(master).size,
      harder: true,
      tries: [
        { profile: "standard", bytes: 150 },
        { profile: "harder", bytes: 90 },
      ],
    });
    expect(itemOf(c, VIDEO).encoded).toMatchObject({ attempt: 1, bytes: 90, harder: true, duration: 4 });
    const page = readFileSync(join(c.project, "build-records", "media.md"), "utf8");
    expect(page).toContain(`90 bytes (master ${statSync(master).size} bytes), harder`);
  });

  test("a file still over after the harder re-encode is dropped, with both sizes in the reason", () => {
    const { c } = checked();

    const { code, out } = encode(c, fakeKit({ sizes: { [VIDEO]: [150, 120] } }), VIDEO, 100);

    expect(code).toBe(1);
    expect(out).toMatchObject({ state: "dropped" });
    expect(itemOf(c, VIDEO).failures.at(-1)?.reason).toBe(
      "still 120 bytes after the harder re-encode (limit 100 bytes, first try 150 bytes)",
    );
    expect(itemOf(c, VIDEO).encoded).toBeNull();
  });

  test("a file under the limit is encoded once, with no harder try", () => {
    // Negative control: harder runs only when the standard encode is over the limit.
    const { c } = checked();
    const kit = fakeKit({ sizes: { [VIDEO]: [90] } });

    const { code, out } = encode(c, kit, VIDEO, 100);

    expect(code).toBe(0);
    expect(kit.calls.map((call) => call.call)).toEqual(["encode"]);
    expect(out).toMatchObject({ bytes: 90, harder: false, tries: [{ profile: "standard", bytes: 90 }] });
  });

  test("the limit is GitHub's 100 MiB unless a test lowers it", () => {
    expect(GITHUB_FILE_LIMIT_BYTES).toBe(104_857_600);
  });
});

describe("the encode of an item", () => {
  test("keeps a web copy beside the master in the Private folder, hashed, and never in the Course project", () => {
    const { c } = checked("module-01-audio");

    const { out } = encode(c, fakeKit(), "module-01-audio");

    const { encoded } = itemOf(c, "module-01-audio");
    expect(encoded?.file).toBe("media/web/module-01-audio-1.mp3");
    expect(readFileSync(join(c.privateFolder, "media", "web", "module-01-audio-1.mp3")).length).toBe(out["bytes"]);
    expect(encoded?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an item that isn't checked is refused and nothing is encoded", () => {
    // Negative control: a downloaded item has not passed the fact check.
    const c = mediaCourse();
    ingestFixture(c, VIDEO, 1);
    const kit = fakeKit();

    const { code, out } = encode(c, kit);

    expect(code).toBe(3);
    expect(out["error"]).toMatch(/downloaded/);
    expect(kit.calls).toEqual([]);
  });

  test("a master replaced after its fact check is refused: only the checked bytes are encoded", () => {
    // Negative control: the check file binds the check to the master's hash.
    const { c, master } = checked();
    const attempt = 1;
    writeFiles(c.privateFolder, {
      [`media/checks/${VIDEO}-${attempt}.json`]: JSON.stringify({
        check: "learn-premium media check v1",
        item: VIDEO,
        attempt,
        masterHash: createHash("sha256").update(readFileSync(master)).digest("hex"),
        alt: null,
        readings: [],
        claims: [],
      }),
    });
    const kit = fakeKit();
    expect(encode(c, kit).code).toBe(0);
    writeFileSync(master, "replaced after the check");

    const { code, out } = encode(c, kit);

    expect(code).toBe(3);
    expect(out["error"]).toMatch(/another master/);
    expect(kit.calls.map((call) => call.call)).toEqual(["encode"]);
  });

  test("a kit that fails leaves the item as it was", () => {
    const { c } = checked();
    const kit = { ...fakeKit(), encode: () => ({ ok: false as const, error: "no libx264" }) };

    const { code, out } = encode(c, kit);

    expect(code).toBe(2);
    expect(out["error"]).toMatch(/no libx264/);
    expect(itemOf(c, VIDEO)).toMatchObject({ state: "checked", encoded: null });
  });

  test("a failed regeneration clears the encode it had", () => {
    const { c } = checked();
    encode(c);
    expect(itemOf(c, VIDEO).encoded).not.toBeNull();

    must(media("fail", "--state", c.state, "--project", c.project, "--item", VIDEO, "--reason", "a late finding"));

    expect(itemOf(c, VIDEO)).toMatchObject({ state: "queued", encoded: null });
  });

  test("a media file written before encodes were recorded still reads, with none", () => {
    const { c } = checked();
    const path = join(c.project, "build-media.json");
    const older = JSON.parse(readFileSync(path, "utf8")) as { items: Record<string, unknown>[] };
    for (const item of older.items) delete item["encoded"];
    writeFileSync(path, JSON.stringify(older));

    expect(itemOf(c, VIDEO).encoded).toBeUndefined();
    expect(must(media("status", "--state", c.state)).queue).toHaveLength(3);
  });
});
