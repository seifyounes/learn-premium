import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { must } from "./fake-notebooklm.ts";
import { fixtureCourse, registered } from "./fixture-courses.ts";
import { intake, jsonInput, ledger, media, tempDir, writeFiles } from "./helpers.ts";

// sha256 of the literal file contents, computed independently of the code under test.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("pad", () => {
  test("a catalogue Discipline gets its own pad", async () => {
    const { code, out } = await intake("pad", "--discipline", "Heat transfer");

    expect(code).toBe(0);
    expect(out).toEqual({ ok: true, pad: "teal", label: "Teal", match: "catalogue", listed: "Heat transfer" });
  });

  test("names are matched loosely: case, 'and' for '&', and the short names the Owner uses", async () => {
    expect((await intake("pad", "--discipline", "MATHS")).out.pad).toBe("violet");
    expect((await intake("pad", "--discipline", "ML")).out.pad).toBe("green");
    expect((await intake("pad", "--discipline", "  logic   circuits ")).out.pad).toBe("graphite");
  });

  test("an unmapped Discipline gets the nearest listed Discipline's pad", async () => {
    const control = await intake("pad", "--discipline", "Automation & control");
    const fluids = await intake("pad", "--discipline", "Thermodynamics");
    const statics = await intake("pad", "--discipline", "Strength of materials");

    expect(control.out).toEqual({
      ok: true,
      pad: "bluegrey",
      label: "Blue-grey",
      match: "nearest",
      listed: "Electric circuits",
    });
    expect(fluids.out).toMatchObject({ pad: "teal", match: "nearest", listed: "Heat transfer" });
    expect(statics.out).toMatchObject({ pad: "steel", match: "nearest", listed: "Machinery" });
  });

  test("a Discipline nothing is close to gets Graphite-grey", async () => {
    const { code, out } = await intake("pad", "--discipline", "Surveying");

    expect(code).toBe(0);
    expect(out).toEqual({ ok: true, pad: "graphite", label: "Graphite-grey", match: "fallback", listed: null });
  });
});

describe("propose", () => {
  test("builds the hashed Materials inventory: every file with its kind, hash and size, OS clutter and git internals left out", async () => {
    const materials = tempDir("materials");
    writeFiles(materials, {
      "Lectures/L01 Conduction.pdf": "abc",
      "Thumbs.db": "junk",
      ".git/HEAD": "ref: refs/heads/main",
    });

    const { code, out } = await intake("propose", "--materials", materials);

    expect(code).toBe(0);
    expect(out.materials).toBe(materials);
    expect(out.inventory).toEqual([{ path: "Lectures/L01 Conduction.pdf", kind: "pdf", hash: SHA256_ABC, bytes: 3 }]);
  });

  test("proposes a Module per lecture number, and leaves the files with none for the Owner to place", async () => {
    const materials = tempDir("materials");
    writeFiles(materials, {
      "Lectures/L01 Conduction.pdf": "1",
      "Lectures/Lecture 1 - board photo.jpg": "1b",
      "Lectures/Lec_02_Convection.pptx": "2",
      "Week 3/notes.pdf": "3",
      "Sheets/sheet1.JPG": "s1",
      "Past papers/Midterm 2025.pdf": "p",
    });

    const { out } = await intake("propose", "--materials", materials);

    expect(out.proposal).toEqual({
      modules: [
        {
          id: "01",
          slug: "conduction",
          title: "Conduction",
          materials: ["Lectures/L01 Conduction.pdf", "Lectures/Lecture 1 - board photo.jpg"],
        },
        { id: "02", slug: "convection", title: "Convection", materials: ["Lectures/Lec_02_Convection.pptx"] },
        { id: "03", slug: "module-03", title: "Module 03", materials: ["Week 3/notes.pdf"] },
      ],
      unmapped: ["Past papers/Midterm 2025.pdf", "Sheets/sheet1.JPG"],
    });
  });

  test("a Materials folder that isn't there is refused", async () => {
    const { code, out } = await intake("propose", "--materials", join(tempDir("materials"), "missing"));

    expect(code).toBe(2);
    expect(out.error).toMatch(/isn't a folder/);
  });
});

/** A date `days` from today, as the answers write it. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The intake answers for a new Course, with its Materials folder; `overrides` replaces any answer. */
function answers(materials: string, overrides: Record<string, unknown> = {}) {
  return {
    courseName: "Heat Transfer",
    code: "MEP 321",
    slug: "heat-transfer",
    materialsPath: materials,
    disciplines: ["Heat transfer", "Mathematics"],
    pad: "teal",
    arabicNotes: false,
    sittings: [
      { id: "midterm", name: "Midterm", date: daysFromNow(14) },
      { id: "final", name: "Final", date: daysFromNow(28) },
    ],
    expectedModules: 4,
    professor: "A. Professor",
    university: "Example University",
    owner: "A. N. Owner",
    ...overrides,
  };
}

/** NotebookLM's measured numbers: a weekly cap of 100 units; a Module's three items cost 19, a sitting audio 6. */
function measured(state: string): void {
  must(
    media(
      "quota",
      "--state",
      state,
      "--limit-5-hour",
      "50",
      "--limit-weekly",
      "100",
      "--cost-video",
      "10",
      "--cost-audio",
      "5",
      "--cost-infographic",
      "4",
      "--cost-sitting-audio",
      "6",
    ),
  );
}

describe("budget", () => {
  test("reports this Course's semester demand against what the plan has left once the registered Courses' demand is met", async () => {
    const state = tempDir("state");
    measured(state);
    // Course A: two Modules (no expected count recorded, so its mapped ones), one sitting: 2 × 19 + 6 = 44,
    // less the video already started (10): 34 still to make.
    const a = fixtureCourse("Course A", {
      live: ["01"],
      planned: ["02"],
      sittings: [{ id: "final", name: "Final", date: null }],
    });
    registered(state, a);
    must(media("gather", "--state", state));
    must(media("start", "--state", state, "--project", a, "--item", "module-01-video"));

    const { code, out } = await intake(
      "budget",
      "--answers",
      jsonInput(answers(tempDir("materials"))),
      "--state",
      state,
    );

    expect(code).toBe(0);
    expect(out.course).toEqual({
      modules: 4,
      sittings: 2,
      items: { video: 4, audio: 4, infographic: 4, "sitting-audio": 2 },
      units: 88,
    });
    expect(out.window).toEqual({ from: daysFromNow(0), to: daysFromNow(28), weeks: 4 });
    expect(out.others).toEqual([
      { project: a, course: "Course A", items: { video: 1, audio: 2, infographic: 2, "sitting-audio": 1 }, units: 34 },
    ]);
    expect(out.capacity).toEqual({ weeklyLimit: 100, units: 400, committed: 34, remaining: 366 });
    expect(out.verdict).toBe("fits");
  });

  test("a registered Course counts the Modules its intake expected, not only those mapped so far", async () => {
    const state = tempDir("state");
    measured(state);
    const b = tempDir("project");
    const intakeB = { ...answers(tempDir("materials")), expectedModules: 3, sittings: [] };
    const { courseName, materialsPath, disciplines, pad, arabicNotes, sittings, expectedModules } = intakeB;
    must(
      ledger(
        "init",
        "--project",
        b,
        "--holder",
        "s",
        "--release",
        "v2.0.0",
        "--intake",
        jsonInput({ courseName, materialsPath, disciplines, pad, arabicNotes, sittings, expectedModules }),
      ),
    );
    registered(state, b);

    const { out } = await intake("budget", "--answers", jsonInput(answers(tempDir("materials"))), "--state", state);

    expect(out.others).toEqual([
      {
        project: b,
        course: "Heat Transfer",
        items: { video: 3, audio: 3, infographic: 3, "sitting-audio": 0 },
        units: 57,
      },
    ]);
  });

  test("a registered Course whose every sitting is past wants nothing more, and isn't counted", async () => {
    const state = tempDir("state");
    measured(state);
    const past = fixtureCourse("Last term", {
      planned: ["01"],
      sittings: [{ id: "final", name: "Final", date: daysFromNow(-30) }],
    });
    registered(state, past);

    const { out } = await intake("budget", "--answers", jsonInput(answers(tempDir("materials"))), "--state", state);

    expect(out.others).toEqual([]);
    expect(out.ended).toEqual([{ project: past, course: "Last term" }]);
    expect(out.capacity.committed).toBe(0);
  });

  test("more demand than the plan has left before the last sitting is over budget", async () => {
    const state = tempDir("state");
    measured(state);

    const { code, out } = await intake(
      "budget",
      "--answers",
      jsonInput(answers(tempDir("materials"), { expectedModules: 30 })),
      "--state",
      state,
    );

    expect(code).toBe(0);
    expect(out.course.units).toBe(30 * 19 + 2 * 6);
    expect(out.capacity).toEqual({ weeklyLimit: 100, units: 400, committed: 0, remaining: 400 });
    expect(out.verdict).toBe("over");
  });

  test("before NotebookLM's usage is measured the demand is counted in items and the verdict is unknown", async () => {
    const { out } = await intake(
      "budget",
      "--answers",
      jsonInput(answers(tempDir("materials"))),
      "--state",
      tempDir("state"),
    );

    expect(out.course).toMatchObject({
      items: { video: 4, audio: 4, infographic: 4, "sitting-audio": 2 },
      units: null,
    });
    expect(out.capacity).toEqual({ weeklyLimit: null, units: null, committed: null, remaining: null });
    expect(out.verdict).toBe("unknown");
    expect(out.reason).toMatch(/measured/);
  });

  test("with no dated Exam sitting there is no window to fit the media in, and the verdict is unknown", async () => {
    const state = tempDir("state");
    measured(state);
    const undated = answers(tempDir("materials"), { sittings: [{ id: "final", name: "Final", date: null }] });

    const { out } = await intake("budget", "--answers", jsonInput(undated), "--state", state);

    expect(out.window).toBeNull();
    expect(out.verdict).toBe("unknown");
    expect(out.reason).toMatch(/dated Exam sitting/);
  });
});
