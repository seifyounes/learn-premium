// The Sitting wave: the Owner's word that a sitting is complete, the reading of its past papers, the
// merge gate (`ready`) for a Sitting wave and its batched Checkpoint. Synthetic Fixture Course
// projects only: no Materials of any real Course, no Vercel, the template's gates and dump faked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave } from "../scripts/wave/cli.ts";
import {
  settledSittingProblem,
  settledSittingReading,
  sittingCheckpointItems,
  type ReadItem,
} from "../scripts/wave/reading.ts";
import { faithfulProblems, type DumpPaper } from "../scripts/wave/sitting.ts";
import { must } from "./fake-notebooklm.ts";
import { fixtureCourse, materialsOf, ownerSaysComplete, sitting } from "./fixture-courses.ts";
import { jsonInput, ledger, writeFiles } from "./helpers.ts";
import { midtermDump, readingItems, sittingReading } from "./sitting-fixtures.ts";

const holder = (project: string) => ["--project", project, "--holder", "session-a"];

/** One wave command, as the CLI would run it. */
function run(args: string[]) {
  const { code, stdout } = runWave(args);
  return { code, out: JSON.parse(stdout) as Record<string, unknown> };
}
const runCode = run;

/** Module 01 live, 02 planned; two sittings; `L01.pdf` and `L02.pdf` in the map. */
function course() {
  return fixtureCourse("Heat Transfer", {
    sittings: [sitting("midterm", "2026-11-10"), sitting("final", "2027-01-20")],
    live: ["01"],
    planned: ["02"],
    materials: {
      "01": { "L01.pdf": "lecture one", "midterm-2025.pdf": "the 2025 midterm" },
      "02": { "L02.pdf": "lecture two" },
    },
  });
}

const startSitting = (project: string, target: string) =>
  ledger("wave", "start", ...holder(project), "--kind", "sitting", "--target", target, "--branch", `sitting/${target}`);

describe("the Owner's word that a sitting is complete", () => {
  test("wave start --kind sitting is refused without the Owner's word", () => {
    const project = course();

    const none = startSitting(project, "midterm");
    expect(none.code).toBe(3);
    expect(none.out.error).toMatch(/only the Owner's word starts its Sitting wave/);

    // His word on another sitting doesn't start this one.
    must(ownerSaysComplete(project, "final", { modules: ["01"] }));
    const other = startSitting(project, "midterm");
    expect(other.code).toBe(3);

    must(ownerSaysComplete(project, "midterm", { modules: ["01"] }));
    const started = startSitting(project, "midterm");
    expect(started.code).toBe(0);
    expect(started.out.wave).toBe("sitting-midterm-1");
  });

  test("records the Modules, the past papers by name and the announced format in his words, and doesn't start the wave", () => {
    const project = course();
    const done = ownerSaysComplete(project, "midterm", {
      modules: ["01"],
      papers: [{ slug: "2025", path: "midterm-2025.pdf" }],
      announced: "Two written questions, 6 and 4 marks, 20 minutes.",
    });
    expect(done.code).toBe(0);

    const { sittings, waves } = must(ledger("status", "--project", project)) as {
      sittings: { id: string; state: string; complete: Record<string, unknown> | null }[];
      waves: unknown[];
    };
    const midterm = sittings.find((s) => s.id === "midterm");
    expect(midterm?.state).toBe("open");
    expect(midterm?.complete).toMatchObject({
      sitting: "midterm",
      modules: ["01"],
      papers: [{ slug: "2025", path: "midterm-2025.pdf" }],
      announced: "Two written questions, 6 and 4 marks, 20 minutes.",
      answer: "midterm is complete.",
      superseded: null,
    });
    expect(sittings.find((s) => s.id === "final")?.complete).toBeNull();
    expect(waves.filter((w) => (w as { kind: string }).kind === "sitting")).toEqual([]);
  });

  test("a later word for the sitting supersedes the earlier one", () => {
    const project = course();
    must(ownerSaysComplete(project, "midterm", { modules: ["01"] }));
    must(
      ownerSaysComplete(project, "midterm", {
        modules: ["01", "02"],
        papers: [{ slug: "2025", path: "midterm-2025.pdf" }],
        announced: "A written paper.",
      }),
    );

    const { sittings } = must(ledger("status", "--project", project)) as {
      sittings: { id: string; complete: { modules: string[]; announced: string | null } | null }[];
    };
    const row = sittings.find((s) => s.id === "midterm")?.complete;
    expect(row?.modules).toEqual(["01", "02"]);
    expect(row?.announced).toBe("A written paper.");
  });

  test("is refused (2) for an unknown sitting, no Module, a Module not in the map, a paper that isn't a Material, a repeated name", () => {
    const project = course();
    const refused = (words: Parameters<typeof ownerSaysComplete>[2], id = "midterm") => {
      const { code, out } = ownerSaysComplete(project, id, words);
      expect(code).toBe(2);
      return out.error as string;
    };
    expect(refused({ modules: ["01"] }, "quiz")).toMatch(/no Exam sitting "quiz"/);
    expect(refused({ modules: [] })).toMatch(/covers no Module/);
    expect(refused({ modules: ["07"] })).toMatch(/Module 07 isn't in the Module map/);
    expect(refused({ modules: ["01", "01"] })).toMatch(/listed twice/);
    expect(refused({ modules: ["01"], papers: [{ slug: "2025", path: "nowhere.pdf" }] })).toMatch(
      /nowhere.pdf isn't a Materials file/,
    );
    expect(
      refused({
        modules: ["01"],
        papers: [
          { slug: "2025", path: "midterm-2025.pdf" },
          { slug: "2025", path: "L01.pdf" },
        ],
      }),
    ).toMatch(/used twice/);
    // Nothing was recorded by any of them.
    const { sittings } = must(ledger("status", "--project", project)) as { sittings: { complete: unknown }[] };
    expect(sittings.every((s) => s.complete === null)).toBe(true);
  });

  test("is refused (2) for an announced format when no past paper is named: nothing could be built to match it", () => {
    const project = course();
    const { code, out } = ownerSaysComplete(project, "midterm", { modules: ["01"], announced: "A written paper." });
    expect(code).toBe(2);
    expect(out.error).toMatch(/announced format but no past paper/);
  });

  test("is refused (2) for a bad input file, and for a past paper name that isn't kebab-case", () => {
    const project = course();
    const bad = ledger(
      ...["sitting", "complete", ...holder(project)],
      ...[
        "--input",
        jsonInput({
          sitting: "midterm",
          modules: ["01"],
          papers: [{ slug: "2025 Midterm", path: "L01.pdf" }],
          announced: null,
          answer: "yes",
        }),
      ],
    );
    expect(bad.code).toBe(2);
    expect(bad.out.error).toMatch(/papers\[0\]\.slug/);
    const missing = ledger("sitting", "complete", ...holder(project));
    expect(missing.code).toBe(2);
  });

  test("is refused (3) for a session that doesn't hold the lock", () => {
    const project = course();
    const { code } = ledger(
      ...["sitting", "complete", "--project", project, "--holder", "session-b"],
      ...["--input", jsonInput({ sitting: "midterm", modules: ["01"], papers: [], announced: null, answer: "yes" })],
    );
    expect(code).toBe(3);
  });

  test("next never proposes a Sitting wave, even for a sitting the Owner has called complete", () => {
    const project = course();
    must(ownerSaysComplete(project, "midterm", { modules: ["01"] }));
    const next = must(ledger("next", "--project", project)) as { action: string; waves: { kind: string }[] };
    expect(next.action).toBe("waves");
    expect(next.waves.every((w) => w.kind === "module")).toBe(true);
    expect(next.waves.map((w) => w.kind)).toEqual(["module"]);
  });
});

describe("the two Blind readers' reading of the past papers", () => {
  const read = (project: string) =>
    must(run(["reconcile", "--project", project, "--sitting", "midterm"])) as Record<string, unknown>;
  const privateOf = (project: string) => privateFolderOf(materialsOf(project));
  const [paper] = midtermDump().papers;

  test("two agreeing readings settle into a reading in the sitting's own Private folder", () => {
    const project = course();
    const folder = privateOf(project);
    const items = readingItems(paper as DumpPaper, "2025");
    writeFiles(folder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", items)),
      "sittings/midterm/reading-b.json": JSON.stringify(sittingReading("b", items)),
    });

    const out = read(project);

    expect(out).toMatchObject({ agreed: items.length, disputes: 0, settled: items.length, checkpointItems: [] });
    expect(settledSittingProblem(folder, "midterm")).toBeNull();
    expect(settledSittingReading(folder, "midterm").map((i) => i.key)).toEqual(items.map((i) => i.key));
    expect(JSON.parse(readFileSync(join(folder, "sittings/midterm/reading.json"), "utf8"))).toMatchObject({
      reader: "settled",
      sitting: "midterm",
    });
    // Its folder is the sitting's, not a Module's.
    expect(existsSync(join(folder, "waves"))).toBe(false);
  });

  test("a disagreement waits for a ruling on its crop, as a Module's does", () => {
    const project = course();
    const folder = privateOf(project);
    const a = readingItems(paper as DumpPaper, "2025");
    const b = a.map((i) => (i.key === "2025/q1/marks" ? { ...i, value: "5" } : i));
    writeFiles(folder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", a)),
      "sittings/midterm/reading-b.json": JSON.stringify(sittingReading("b", b)),
    });

    const { code, out } = runCode(["reconcile", "--project", project, "--sitting", "midterm"]);

    expect(code).toBe(1);
    expect(out["disputes"]).toEqual([expect.objectContaining({ key: "2025/q1/marks", a: "4", b: "5" })]);
    expect(settledSittingProblem(folder, "midterm")).toMatch(/run reconcile/);
  });

  test("an unreadable value in a past paper becomes a Checkpoint item under the sitting's own key", () => {
    const project = course();
    const folder = privateOf(project);
    const a = readingItems(paper as DumpPaper, "2025").map((i) =>
      i.key === "2025/q2/key" ? { ...i, value: null } : i,
    );
    const b = readingItems(paper as DumpPaper, "2025").map((i) =>
      i.key === "2025/q2/key" ? { ...i, value: null } : i,
    );
    writeFiles(folder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", a)),
      "sittings/midterm/reading-b.json": JSON.stringify(sittingReading("b", b)),
      "sittings/midterm/crops/q2-key.png": "png",
      "sittings/midterm/resolutions.json": JSON.stringify({
        resolutions: [
          {
            key: "2025/q2/key",
            a: null,
            b: null,
            crop: "sittings/midterm/crops/q2-key.png",
            ruling: "unreadable",
            value: null,
          },
        ],
      }),
    });

    const out = read(project);

    expect(out["checkpointItems"]).toEqual([
      expect.objectContaining({ key: expect.stringMatching(/^midterm\/unreadable\//), kind: "unreadable" }),
    ]);
    expect(sittingCheckpointItems(folder, "midterm")).toHaveLength(1);
  });

  test("a reading of another sitting, or of a Module, is refused", () => {
    const project = course();
    const folder = privateOf(project);
    const items = readingItems(paper as DumpPaper, "2025");
    writeFiles(folder, {
      "sittings/midterm/reading-a.json": JSON.stringify(sittingReading("a", items, "final")),
      "sittings/midterm/reading-b.json": JSON.stringify(sittingReading("b", items)),
    });
    expect(runCode(["reconcile", "--project", project, "--sitting", "midterm"])).toMatchObject({
      code: 2,
      out: { error: expect.stringMatching(/reading-a\.json reads sitting final, not midterm/) },
    });
    writeFiles(folder, {
      "sittings/midterm/reading-a.json": JSON.stringify({
        ...sittingReading("a", items),
        sitting: undefined,
        module: "01",
      }),
    });
    expect(runCode(["reconcile", "--project", project, "--sitting", "midterm"]).code).toBe(2);
  });

  test("a Module's reconcile is unchanged: it still reads waves/NN and a Module reading", () => {
    const project = course();
    const folder = privateOf(project);
    const items = [{ key: "eq-1", file: "L01.pdf", page: 3, box: null, quantity: null, kind: "number", value: "0.25" }];
    const reading = (reader: string) => ({ reading: "learn-premium blind reading v1", reader, module: "01", items });
    writeFiles(folder, {
      "waves/01/reading-a.json": JSON.stringify(reading("a")),
      "waves/01/reading-b.json": JSON.stringify(reading("b")),
    });
    expect(must(run(["reconcile", "--project", project, "--module", "01"]))).toMatchObject({ agreed: 1, settled: 1 });
    expect(JSON.parse(readFileSync(join(folder, "waves/01/reading.json"), "utf8"))).toMatchObject({ module: "01" });
  });
});

describe("a past paper must match its settled reading", () => {
  const dump = midtermDump();
  const settled = () => dump.papers.flatMap((p) => readingItems(p, p.name));
  const withPaper = (change: (p: DumpPaper) => DumpPaper) => dump.papers.map(change);

  test("the Fixture's midterm, read faithfully, has no problem", () => {
    expect(faithfulProblems(dump.papers, settled())).toEqual([]);
  });

  test("swapped questions, an edited text, marks 4 to 5 and a key 0.25 to 0.26 each name their problem", () => {
    const swapped = withPaper((p) => ({
      ...p,
      questions: p.questions.map((q, i, all) => ({
        ...q,
        question: (all[i === 0 ? 1 : i === 1 ? 0 : i] ?? q).question,
      })),
    }));
    expect(faithfulProblems(swapped, settled())).toEqual([
      expect.stringMatching(/question 1: the content's question text isn't the paper's/),
      expect.stringMatching(/question 2: the content's question text isn't the paper's/),
    ]);
    const edited = withPaper((p) => ({
      ...p,
      questions: p.questions.map((q) => (q.n === 3 ? { ...q, question: `${q.question} Show your working.` } : q)),
    }));
    expect(faithfulProblems(edited, settled())).toEqual([expect.stringMatching(/question 3: .*question text/)]);
    const marks = withPaper((p) => ({ ...p, questions: p.questions.map((q) => (q.n === 1 ? { ...q, marks: 5 } : q)) }));
    expect(faithfulProblems(marks, settled())).toEqual([
      expect.stringMatching(/question 1: the content gives 5 marks, the paper 4/),
    ]);
    const key = withPaper((p) => ({
      ...p,
      questions: p.questions.map((q) => (q.n === 1 ? { ...q, key: "0.26" } : q)),
    }));
    expect(faithfulProblems(key, settled())).toEqual([
      expect.stringMatching(/question 1: the content's key 0\.26 isn't the Professor's printed 0\.25/),
    ]);
  });

  test("a reading listed out of order still holds the content to the printed numbers", () => {
    // Reader A wrote q3 before q2: the reading's listing order is not the paper's.
    const listed = (items: ReadItem[]) => {
      const rank = (i: ReadItem) => (i.key.includes("/q2/") ? 3 : i.key.includes("/q3/") ? 2 : 0);
      return [...items].sort((a, b) => rank(a) - rank(b));
    };
    const outOfOrder = listed(settled());
    expect(outOfOrder.map((i) => i.key).indexOf("2025/q3/text")).toBeLessThan(
      outOfOrder.map((i) => i.key).indexOf("2025/q2/text"),
    );
    // Content in the paper's own order is faithful.
    expect(faithfulProblems(dump.papers, outOfOrder)).toEqual([]);
    // Content with Q2 and Q3 swapped is not, and each swapped question says so.
    const swapped = withPaper((p) => ({
      ...p,
      questions: p.questions.map((q) => {
        const other = q.n === 2 ? 3 : q.n === 3 ? 2 : q.n;
        const from = p.questions.find((x) => x.n === other) ?? q;
        return { ...q, question: from.question };
      }),
    }));
    expect(faithfulProblems(swapped, outOfOrder)).toEqual([
      expect.stringMatching(/question 2: the content's question text isn't the paper's/),
      expect.stringMatching(/question 3: the content's question text isn't the paper's/),
    ]);
  });

  test("a reading label that isn't one of 1..N is named", () => {
    const relabelled = settled().map((i) => ({ ...i, key: i.key.replace("/q3/", "/q4/") }));
    const problems = faithfulProblems(dump.papers, relabelled);
    expect(problems).toContainEqual(expect.stringMatching(/question label "4".*1\.\.3/));
    expect(problems).toContainEqual(
      expect.stringMatching(/question 3: the settled reading has no text for question 3/),
    );
  });

  test("whitespace aside, the same reading holds; a key keeps its printed precision", () => {
    const loose = settled().map((i) => (i.key === "2025/q3/text" ? { ...i, value: `  ${i.value}  ` } : i));
    expect(faithfulProblems(dump.papers, loose)).toEqual([]);
    // The Professor printed 0.250: the content's 0.25 is a shorter key, whose precision the gate would take as the paper's.
    const precise = settled().map((i) => (i.key === "2025/q1/key" ? { ...i, value: "0.250" } : i));
    expect(faithfulProblems(dump.papers, precise)).toEqual([
      expect.stringMatching(/question 1: the content's key 0\.25 isn't the Professor's printed 0\.250/),
    ]);
  });

  test("an item read from a file other than the one named for its paper is refused", () => {
    const named = { "2025": "midterm-2025.pdf" };
    expect(faithfulProblems(dump.papers, settled(), { "2025": "2025.pdf" })).toEqual([]);
    const items = dump.papers.flatMap((p) => readingItems(p, p.name, "other.pdf"));
    expect(faithfulProblems(dump.papers, items, named)).toEqual([
      expect.stringMatching(
        /past paper "2025" was read from other\.pdf, not the file the Owner named for it \(midterm-2025\.pdf\)/,
      ),
    ]);
  });

  test("a total or a time that differs is named, and so are a missing question and an extra one", () => {
    expect(
      faithfulProblems(
        withPaper((p) => ({ ...p, marks: 11 })),
        settled(),
      ),
    ).toEqual([expect.stringMatching(/the content gives 11 total marks, the paper 10/)]);
    expect(
      faithfulProblems(
        withPaper((p) => ({ ...p, minutes: 45 })),
        settled(),
      ),
    ).toEqual([expect.stringMatching(/the content gives 45 minutes, the paper 30/)]);
    const fewer = withPaper((p) => ({ ...p, questions: p.questions.slice(0, 2) }));
    expect(faithfulProblems(fewer, settled())).toEqual([
      expect.stringMatching(/3 questions in the settled reading and 2 in the content/),
    ]);
  });

  test("an extra content paper, or a paper the content lacks, is named", () => {
    const [paper] = dump.papers as [DumpPaper];
    expect(faithfulProblems([...dump.papers, { ...paper, name: "2024" }], settled())).toEqual([
      expect.stringMatching(/past paper "2024" that no Blind reader read/),
    ]);
    expect(faithfulProblems([], settled())).toEqual([
      expect.stringMatching(/the settled reading has a past paper "2025" that the content doesn't have/),
    ]);
  });

  test("a key item exists exactly when the Professor's paper prints one", () => {
    const [paper] = dump.papers as [DumpPaper];
    const keyless: DumpPaper = {
      ...paper,
      key: "solved",
      questions: paper.questions.map((q) => ({ ...q, key: null })),
    };
    // The reading found a key the content (a solved paper) doesn't carry.
    expect(faithfulProblems([keyless], settled())).toEqual([
      expect.stringMatching(/question 1: the Professor's paper prints a key, which the content doesn't carry/),
      expect.stringMatching(/question 2: the Professor's paper prints a key, which the content doesn't carry/),
    ]);
    // No key printed and none carried: faithful.
    const noKeys = settled().filter((i) => !i.key.endsWith("/key"));
    expect(faithfulProblems([keyless], noKeys)).toEqual([]);
    // A key the content carries that the paper doesn't print.
    expect(faithfulProblems(dump.papers, noKeys)).toEqual([
      expect.stringMatching(/question 1: the content carries a key \(0\.25\) that the Professor's paper doesn't print/),
      expect.stringMatching(/question 2: the content carries a key \(0\.1\) that the Professor's paper doesn't print/),
    ]);
  });

  test("a Professor's paper that prints a key for only some questions is faithful to a reading with only those keys", () => {
    // The key sheet gives question 1 but not question 2 (both numeric): the reading has q1/key only.
    const partial = withPaper((p) => ({
      ...p,
      questions: p.questions.map((q) => (q.n === 2 ? { ...q, key: null } : q)),
    }));
    const items = settled().filter((i) => i.key !== "2025/q2/key");
    expect(faithfulProblems(partial, items)).toEqual([]);
    // Negative control: a key the reading found but the content dropped is still named.
    expect(faithfulProblems(partial, settled())).toEqual([
      expect.stringMatching(/question 2: the Professor's paper prints a key, which the content doesn't carry/),
    ]);
    // And a key the content invents for question 2 is still named.
    expect(faithfulProblems(dump.papers, items)).toEqual([
      expect.stringMatching(/question 2: the content carries a key \(0\.1\) that the Professor's paper doesn't print/),
    ]);
  });

  test("a time or total the paper doesn't print is a null item, which the content may not contradict", () => {
    const unprinted = settled().map((i) =>
      i.key === "2025/minutes" || i.key === "2025/total" ? { ...i, value: null } : i,
    );
    expect(faithfulProblems(dump.papers, unprinted)).toEqual([]);
    // Negative control: an item left out altogether is still a reading that didn't look.
    const left = settled().filter((i) => i.key !== "2025/minutes");
    expect(faithfulProblems(dump.papers, left)).toEqual([expect.stringMatching(/the settled reading has no minutes/)]);
  });

  test("a value the readers couldn't read is the Owner's Checkpoint item, not a mismatch", () => {
    const unreadable = settled().map((i) => (i.key === "2025/q1/marks" ? { ...i, value: null } : i));
    expect(faithfulProblems(dump.papers, unreadable)).toEqual([]);
  });
});
