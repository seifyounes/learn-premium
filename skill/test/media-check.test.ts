// The media fact check through its command interface: `evidence` gathers what the fact-check subagent reads,
// and `check` is the deterministic judge of the check file it writes. The Python kit, Whisper and the
// template's rulings are faked; Module 01 is the Fixture Course's own content.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeKit } from "./fake-media-kit.ts";
import { sitting } from "./fixture-courses.ts";
import { fakeVerifier, ingestFixture, itemOf, mediaCourse, mediaWith, type MediaCourse } from "./media-course.ts";
import { must } from "./fake-notebooklm.ts";
import { writeFiles } from "./helpers.ts";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const TRANSCRIPT: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/media-check/transcript.json", import.meta.url), "utf8"),
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The transcript with one number changed, as a Professor-less generator might say it wrong. */
const seeded = (from: string, to: string) => JSON.parse(JSON.stringify(TRANSCRIPT).replaceAll(from, to)) as unknown;

const flags = (c: MediaCourse, id: string) => ["--project", c.project, "--item", id, "--private", c.privateFolder];

interface Claim {
  at: string;
  said: string;
  kind: "number" | "symbol" | "claim";
  value: number | null;
  verdict: "matches" | "wrong" | "unsupported";
  content: string | null;
  why: string;
}

const number = (at: string, value: number, verdict: Claim["verdict"] = "matches"): Claim => ({
  at,
  said: String(value),
  kind: "number",
  value,
  verdict,
  content: "modules/01-m01/worked/1.json",
  why: "the worked example's table",
});

/** The claims a diligent subagent writes for the fixture transcript: every number it says, all verified. */
const CLAIMS = [
  number("0:06", 0.04),
  number("0:06", 0.25),
  number("0:06", 1.25),
  number("0:14", 1.54),
  number("0:20", 25),
  number("0:20", 16.2),
];

/**
 * The fact-check subagent's file for an item's attempt, standing in for the subagent: `evidence` has run, and
 * this writes the check where it said to.
 */
function writeCheck(
  c: MediaCourse,
  id: string,
  master: string,
  evidence: { check: string; attempt: number },
  over: Record<string, unknown> = {},
) {
  const check = {
    check: "learn-premium media check v1",
    item: id,
    attempt: evidence.attempt,
    masterHash: createHash("sha256").update(readFileSync(master)).digest("hex"),
    alt: null,
    readings: [],
    claims: CLAIMS,
    ...over,
  };
  mkdirSync(dirname(evidence.check), { recursive: true });
  writeFileSync(evidence.check, JSON.stringify(check));
  return check;
}

/** The audio item downloaded, its evidence gathered and its check written: one more step is `check`. */
function checkedAudio(transcript: unknown, attempt = 1, over: Record<string, unknown> = {}) {
  const c = mediaCourse();
  const kit = fakeKit({ transcript });
  const id = "module-01-audio";
  return { c, kit, id, ...evidenceFor(c, kit, id, attempt, over) };
}

function evidenceFor(
  c: MediaCourse,
  kit: ReturnType<typeof fakeKit>,
  id: string,
  attempt: number,
  over: Record<string, unknown> = {},
) {
  const master = ingestFixture(c, id, attempt);
  const evidence = must(mediaWith({ kit, verifier: fakeVerifier() }, "evidence", ...flags(c, id)));
  writeCheck(c, id, master, evidence as { check: string; attempt: number }, over);
  return { master, evidence };
}

const check = (c: MediaCourse, id: string, rulings?: Parameters<typeof fakeVerifier>[0]) =>
  mediaWith({ kit: fakeKit(), verifier: fakeVerifier(rulings) }, "check", ...flags(c, id));

describe("evidence", () => {
  test("gathers the transcript beside the folder the subagent's check file goes in", () => {
    const { c, evidence } = checkedAudio(TRANSCRIPT);

    expect(evidence).toMatchObject({ item: "module-01-audio", attempt: 1, kind: "audio", module: { id: "01" } });
    expect(String(evidence["check"])).toContain("checks");
    expect(String(evidence["transcript"]).replaceAll("\\", "/")).toMatch(
      /media\/evidence\/module-01-audio-1\/transcript\.json$/,
    );
    expect(itemOf(c, "module-01-audio").state).toBe("downloaded");
  });
});

describe("the fact check", () => {
  test("a transcript whose numbers all round from the Module's own passes the item to checked", () => {
    const { c, id } = checkedAudio(TRANSCRIPT);

    const { code, out } = check(c, id);

    expect(code, JSON.stringify(out)).toBe(0);
    expect(out).toMatchObject({ verdict: "pass", findings: [], state: "checked" });
    expect(itemOf(c, id).state).toBe("checked");
  });

  test("a seeded wrong number fails it, and the item goes back to be made again", () => {
    // Negative control for the whole check: the brick's 0.25 said as 0.52, which the subagent let through.
    const { c, id } = checkedAudio(seeded("the brick 0.25", "the brick 0.52"));

    const { code, out } = check(c, id);

    expect(code).toBe(1);
    expect(out.findings).toEqual([expect.objectContaining({ kind: "number", said: "0.52", at: "0:06" })]);
    expect(out).toMatchObject({ verdict: "fail", state: "queued", regenerations: 1 });
    expect(itemOf(c, id).failures.at(-1)?.reason).toMatch(/^fact check: said 0\.52 at 0:06/);
  });

  test("the Professor's slipped value (1.45 for 1.54) is a wrong number too", () => {
    // The sheet's wrong sum is in the content (worked/1.json prints it in the Slip), so only the Slip
    // subtraction sees that it must not count as verified.
    const { c, id } = checkedAudio(seeded("the total is 1.54", "the total is 1.45"));

    const { code, out } = check(c, id);

    expect(code).toBe(1);
    expect(out.findings).toEqual([expect.objectContaining({ kind: "number", said: "1.45", at: "0:14" })]);
  });

  test("without the Slip ruling the same transcript passes: the subtraction is what catches it", () => {
    const { c, id } = checkedAudio(seeded("the total is 1.54", "the total is 1.45"), 1, {
      claims: CLAIMS.map((claim) => (claim.value === 1.54 ? { ...claim, said: "1.45", value: 1.45 } : claim)),
    });

    const { code } = check(c, id, []);

    expect(code).toBe(0);
  });

  test("a wrong number seeded again on the regeneration drops the item", () => {
    const wrong = seeded("the brick 0.25", "the brick 0.52");
    const { c, id } = checkedAudio(wrong);
    expect(check(c, id).code).toBe(1);

    evidenceFor(c, fakeKit({ transcript: wrong }), id, 2);
    const { code, out } = check(c, id);

    expect(code).toBe(1);
    expect(out).toMatchObject({ state: "dropped", regenerations: 1 });
  });

  test("a claim the subagent marked wrong fails the item, whatever the numbers", () => {
    const { c, id } = checkedAudio(TRANSCRIPT, 1, {
      claims: [
        ...CLAIMS,
        {
          at: "0:14",
          said: "layers in series multiply",
          kind: "claim",
          value: null,
          verdict: "wrong",
          content: null,
          why: "the rules say they add",
        },
      ],
    });

    const { code, out } = check(c, id);

    expect(code).toBe(1);
    expect(out.findings).toEqual([
      expect.objectContaining({ kind: "claim", said: "layers in series multiply", at: "0:14" }),
    ]);
  });

  test("a number shown only in a claim, that the Module doesn't hold, fails", () => {
    const { c, id } = checkedAudio(TRANSCRIPT, 1, { claims: [...CLAIMS, number("0:20", 77.7)] });

    const { out } = check(c, id);

    expect(out.findings).toEqual([expect.objectContaining({ kind: "number", said: "77.7", at: "0:20" })]);
  });

  test("a signed value a claim carries is judged by its magnitude, as the numbers in the text are", () => {
    // The Module's worked table holds 0.65 (a layer's drop); a drop recorded as -0.65 is the same number.
    const { c, id } = checkedAudio(TRANSCRIPT, 1, { claims: [...CLAIMS, number("0:20", -0.65)] });

    const { code, out } = check(c, id);

    expect(code, JSON.stringify(out)).toBe(0);
  });

  test("a power of ten is one number: its coefficient and exponent aren't judged alone", () => {
    // Negative control: 4.06, 10 and 4 are each in the Module or exempt, but 4.06 × 10^-4 (0.000406) is not.
    const talk = {
      segments: [{ start: 0, end: 5, text: "A drop of 4.06 × 10^-4 kelvin across the brick." }],
    };
    const { c, id } = checkedAudio(talk, 1, { claims: [] });

    const { code, out } = check(c, id);

    expect(code).toBe(1);
    expect(out.findings).toEqual([expect.objectContaining({ kind: "number", said: "4.06 × 10^-4", at: "0:00" })]);
  });

  test("a power of ten the Module writes (in TeX) is verified, at its coefficient's digits", () => {
    const talk = { segments: [{ start: 0, end: 5, text: "A conductance of about 1.3 × 10^-3 watts per kelvin." }] };
    const { c, id } = checkedAudio(talk, 1, { claims: [] });
    writeFiles(c.project, {
      "content/modules/01-m01/summary/2.md": "The conductance is $1.25 \\times 10^{-3}$ W/K.\n",
    });

    const { code, out } = check(c, id);

    expect(code, JSON.stringify(out)).toBe(0);
  });

  test("an infographic's alt text is held to the Module's numbers like anything else it says", () => {
    const c = mediaCourse();
    const id = "module-01-infographic";
    evidenceFor(c, fakeKit(), id, 1, {
      readings: [{ at: "infographic", text: "R = L / (k A)" }],
      alt: "A wall of 99 layers resisting heat",
      claims: [],
    });

    const { code, out } = check(c, id);

    expect(code).toBe(1);
    expect(out.findings).toEqual([expect.objectContaining({ kind: "number", said: "99", at: "alt" })]);
  });

  test("a small claim value that JavaScript writes in exponent form keeps its decimals", () => {
    // 0.0000004 is "4e-7": read as a whole number it would round from anything within 0.5 of it.
    const { c, id } = checkedAudio(TRANSCRIPT, 1, { claims: [...CLAIMS, number("0:20", 0.0000004)] });

    const { out } = check(c, id);

    expect(out.findings).toEqual([expect.objectContaining({ kind: "number", said: "0.0000004", at: "0:20" })]);
  });

  test("a percentage or a thousand of a verified value is fine; a small whole number is exempt", () => {
    const talk = {
      segments: [
        { start: 0, end: 5, text: "The brick's 25 percent share is 0.25 of it, 250 mK per watt, in 3 layers." },
      ],
    };
    const { c, id } = checkedAudio(talk, 1, { claims: [] });

    expect(check(c, id).code).toBe(0);
  });
});

describe("a check that can't be judged is refused and moves nothing", () => {
  const stays = (c: MediaCourse, id: string, state = "downloaded") => expect(itemOf(c, id).state).toBe(state);

  test("a check of another master", () => {
    const { c, id, evidence } = checkedAudio(TRANSCRIPT);
    writeFileSync(
      String(evidence["check"]),
      JSON.stringify({ ...JSON.parse(readFileSync(String(evidence["check"]), "utf8")), masterHash: "0".repeat(64) }),
    );

    const { code, out } = check(c, id);

    expect(code).toBe(3);
    expect(out.error).toMatch(/another master/);
    stays(c, id);
  });

  test("a video check that has no reading of one of its frames", () => {
    const c = mediaCourse();
    const kit = fakeKit({ transcript: TRANSCRIPT });
    const id = "module-01-video";
    evidenceFor(c, kit, id, 1, { readings: [{ at: "frames/frame-001.png", text: "" }] });

    const { code, out } = check(c, id);

    expect(code).toBe(3);
    expect(out.error).toMatch(/frame-002\.png/);
    stays(c, id);
  });

  test("an infographic check with no alt text", () => {
    const c = mediaCourse();
    const id = "module-01-infographic";
    evidenceFor(c, fakeKit(), id, 1, {
      readings: [{ at: "infographic", text: "R = L / (k A)" }],
      alt: null,
      claims: [],
    });

    const { code, out } = check(c, id);

    expect(code).toBe(3);
    expect(out.error).toMatch(/alt/);
    stays(c, id);
  });

  test("a check before evidence", () => {
    const c = mediaCourse();
    ingestFixture(c, "module-01-audio", 1);

    const { code, out } = check(c, "module-01-audio");

    expect(code).toBe(3);
    expect(out.error).toMatch(/evidence/);
    stays(c, "module-01-audio");
  });

  test("a sitting audio: there is no Module content to check it against yet", () => {
    const c = mediaCourse({ sittings: [sitting("final", null)], liveSittings: ["final"] });
    ingestFixture(c, "sitting-final-audio", 1);

    const { code, out } = mediaWith(
      { kit: fakeKit(), verifier: fakeVerifier() },
      "evidence",
      ...flags(c, "sitting-final-audio"),
    );

    expect(code).toBe(3);
    expect(out.error).toMatch(/sitting audio/);
    stays(c, "sitting-final-audio");
  });

  test("an item that isn't downloaded", () => {
    const c = mediaCourse();

    const { code, out } = check(c, "module-01-audio");

    expect(code).toBe(3);
    expect(out.error).toMatch(/queued/);
  });

  test("a template that can't list the rulings", () => {
    const { c, id } = checkedAudio(TRANSCRIPT);

    const { code, out } = check(c, id, "the template layer has no gate runner" as never);

    expect(code).toBe(3);
    expect(out.error).toMatch(/no gate runner/);
    stays(c, id);
  });
});
