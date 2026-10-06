// Release notes: what a Template release closes and retires, written for the Owner and read back by
// the Upgrade wave's offer.
import { describe, expect, test } from "vitest";
import { overridesOnIssue, parseNotes, renderNotes, type NotesInput } from "../scripts/release/notes.ts";

const INPUT: NotesInput = {
  version: "v0.2.0",
  previous: "v0.1.0",
  kind: "minor",
  sha: "0123456789abcdef0123456789abcdef01234567",
  gateGaps: [
    {
      number: 12,
      title: "Summary beat figure overflows at 320 px",
      course: "Machine Learning",
      overrides: ["src/components/Beat.astro", "src/styles/beat.css"],
    },
    { number: 15, title: "STL *I not gated", course: null, overrides: [] },
  ],
  migrations: [],
  phonePass: {
    description: "iPhone 13 Safari, Pixel 7 Chrome · Pyodide 14 s",
    by: "seifyounes",
    at: "2026-10-07T09:00:00Z",
    url: "https://fixture.example/tool-gallery/",
  },
};

describe("release notes", () => {
  test("have a section for the gate gaps closed and one for the Course overrides retired", () => {
    const notes = renderNotes(INPUT);
    expect(notes).toContain(
      "## Gate gaps closed\n\n- #12 Summary beat figure overflows at 320 px\n- #15 STL *I not gated\n",
    );
    expect(notes).toContain(
      "## Course overrides retired\n\n" +
        "- `src/components/Beat.astro` (Machine Learning), gate gap #12\n" +
        "- `src/styles/beat.css` (Machine Learning), gate gap #12\n" +
        "- Gate gap #15: no Course override recorded on the issue\n",
    );
    expect(notes).toContain("## Real-phone pass\n\niPhone 13 Safari, Pixel 7 Chrome · Pyodide 14 s");
  });

  test("say so when a release closes nothing and migrates nothing", () => {
    const notes = renderNotes({ ...INPUT, gateGaps: [], previous: null });
    expect(notes).toContain("## Gate gaps closed\n\nNone.\n");
    expect(notes).toContain("## Course overrides retired\n\nNone.\n");
    expect(notes).toContain("## Migrations\n\nNone:");
    expect(notes).toContain("first Template release");
  });

  test("list a major's migrations", () => {
    const notes = renderNotes({
      ...INPUT,
      version: "v1.0.0",
      kind: "major",
      migrations: [{ major: 1, describe: "sims gain a units block" }],
    });
    expect(notes).toContain("## Migrations\n\n- v1: sims gain a units block\n");
  });

  test("read back into the gate gaps they close and the overrides they retire", () => {
    expect(parseNotes(renderNotes(INPUT))).toEqual({
      version: "v0.2.0",
      gateGapsClosed: [12, 15],
      overridesRetired: [
        { path: "src/components/Beat.astro", course: "Machine Learning", gateGap: 12 },
        { path: "src/styles/beat.css", course: "Machine Learning", gateGap: 12 },
      ],
    });
    expect(parseNotes(renderNotes({ ...INPUT, gateGaps: [] }))).toMatchObject({
      gateGapsClosed: [],
      overridesRetired: [],
    });
  });

  test("refuse to read notes missing either section (an Owner's edit that dropped one)", () => {
    const notes = renderNotes(INPUT);
    expect(() => parseNotes(notes.replace("## Gate gaps closed", "## Fixed"))).toThrow(/Gate gaps closed/);
    expect(() => parseNotes(notes.replace("## Course overrides retired", "## Overrides"))).toThrow(
      /Course overrides retired/,
    );
  });
});

describe("a gate gap's Course and overrides, read off its issue", () => {
  test("come from its Course and Course override lines", () => {
    const body = [
      "A Summary beat figure overflows the frame at 320 px.",
      "",
      "Course: Machine Learning",
      "- Course override: `src/components/Beat.astro`",
      "Course override: src/styles/beat.css",
      "",
      "Fixture: see the attached synthetic beat.",
    ].join("\n");
    expect(overridesOnIssue(body)).toEqual({
      course: "Machine Learning",
      overrides: ["src/components/Beat.astro", "src/styles/beat.css"],
    });
  });

  test("are empty on an issue that names none", () => {
    expect(overridesOnIssue("No override was needed.")).toEqual({ course: null, overrides: [] });
    expect(overridesOnIssue(null)).toEqual({ course: null, overrides: [] });
  });
});
