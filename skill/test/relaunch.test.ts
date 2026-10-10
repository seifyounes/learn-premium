// A relaunched subagent (`wave.ts relaunch open|close`) through its command interface, on synthetic
// Course projects: its dead predecessor's files are re-gated before reuse, and the Build ledger
// records what became of each one. The template's job gates are faked.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runWave, type WaveDeps } from "../scripts/wave/cli.ts";
import { fixtureCourse, materialsOf } from "./fixture-courses.ts";
import { must } from "./fake-notebooklm.ts";
import { jsonInput, ledger, writeFiles, type Result } from "./helpers.ts";

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function wave(args: string[], deps: Partial<WaveDeps> = {}): Result {
  const { code, stdout } = runWave(args, deps);
  return { code, out: JSON.parse(stdout) };
}

/** Module 01's running wave, with the files a writer that died mid-job left behind. */
function waveWithPredecessor() {
  const project = fixtureCourse("Heat Transfer", { planned: ["01"] });
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  const holder = ["--project", project, "--holder", "session-a"];
  const { wave: waveId } = must(
    ledger("wave", "start", ...holder, "--kind", "module", "--target", "01", "--branch", "module/01-m01"),
  );
  writeFiles(project, {
    "content/modules/01-m01/module.yaml": "title: Conduction\n",
    "content/modules/01-m01/summary/1.md": "Heat flows from hot to cold.\n",
    "content/modules/01-m01/summary/2.md": "In series, $R_{tot} = R_1 + R_2$, half written\n",
    "content/modules/01-m01/summary/3.md": "A beat the predecessor started and never finished\n",
  });
  return { project, privateFolder, holder, waveId };
}

/** The template's job gates, faked: they block on whatever `blocked` names at the moment they run. */
function jobGates(blocked: Set<string>) {
  const runs: string[] = [];
  const deps: Partial<WaveDeps> = {
    jobGates: {
      run: (_project, folder) => {
        runs.push(folder);
        return {
          ran: true,
          findings: [...blocked].map((at) => ({
            gate: "notation",
            at,
            message: "writes R_tot, not R_{\\mathrm{tot}}",
          })),
        };
      },
    },
  };
  return { deps, runs };
}

const open = (project: string, waveId: string, job: string, files: string[], deps: Partial<WaveDeps>) =>
  wave(
    [
      ...["relaunch", "open", "--project", project, "--holder", "session-a", "--wave", waveId, "--job", job],
      ...(files.length === 0 ? [] : ["--files", ...files]),
    ],
    deps,
  );

const close = (
  project: string,
  waveId: string,
  job: string,
  outcomes: Record<string, string>,
  deps: Partial<WaveDeps>,
) =>
  wave(
    [
      ...["relaunch", "close", "--project", project, "--holder", "session-a", "--wave", waveId, "--job", job],
      ...["--outcomes", jsonInput({ files: Object.entries(outcomes).map(([path, outcome]) => ({ path, outcome })) })],
    ],
    deps,
  );

const S1 = "content/modules/01-m01/summary/1.md";
const S2 = "content/modules/01-m01/summary/2.md";
const S3 = "content/modules/01-m01/summary/3.md";
const MODULE_YAML = "content/modules/01-m01/module.yaml";

describe("a relaunched subagent re-gates its predecessor's files before reusing them", () => {
  test("each of the predecessor's files comes back with what the job gates found on it, and the relaunch is open in the ledger", () => {
    const { project, waveId } = waveWithPredecessor();
    const { deps, runs } = jobGates(new Set(["modules/01-m01/summary/2.md"]));

    const { code, out } = open(project, waveId, "writer", ["content/modules/01-m01"], deps);

    expect(code).toBe(0);
    expect(runs).toEqual(["01-m01"]);
    expect(out.files).toEqual([
      { path: MODULE_YAML, covered: true, findings: [] },
      { path: S1, covered: true, findings: [] },
      { path: S2, covered: true, findings: ["notation: writes R_tot, not R_{\\mathrm{tot}}"] },
      { path: S3, covered: true, findings: [] },
    ]);
    expect(out.next).toMatch(/review each file.*kept, fixed or discarded/);
    const { relaunches } = must(ledger("status", "--project", project));
    expect(relaunches).toEqual([expect.objectContaining({ wave: waveId, job: "writer", closedAt: null })]);
  });

  test("the ledger shows each file kept, fixed or discarded, and the build report lists them", () => {
    const { project, waveId } = waveWithPredecessor();
    const blocked = new Set(["modules/01-m01/summary/2.md"]);
    const { deps } = jobGates(blocked);
    must(open(project, waveId, "writer", ["content/modules/01-m01"], deps));
    // The relaunched writer keeps the clean files, fixes the flagged one and drops the unfinished one.
    writeFileSync(join(project, S2), "In series, $R_{\\mathrm{tot}} = R_1 + R_2$.\n");
    blocked.clear();
    rmSync(join(project, S3));

    const { code } = close(
      project,
      waveId,
      "writer",
      { [MODULE_YAML]: "kept", [S1]: "kept", [S2]: "fixed", [S3]: "discarded" },
      deps,
    );

    expect(code).toBe(0);
    const [row] = must(ledger("status", "--project", project)).relaunches as {
      closedAt: string | null;
      files: { path: string; outcome: string; after: string | null; findings: number }[];
    }[];
    expect(row?.closedAt).not.toBeNull();
    expect(row?.files.map((f) => [f.path, f.outcome, f.findings, f.after === null ? "gone" : "hashed"])).toEqual([
      [MODULE_YAML, "kept", 0, "hashed"],
      [S1, "kept", 0, "hashed"],
      [S2, "fixed", 1, "hashed"],
      [S3, "discarded", 0, "gone"],
    ]);
    const report = readFileSync(join(project, "build-records", "build-report.md"), "utf8");
    expect(report).toContain(`| writer | ${S2} | fixed |`);
    expect(report).toContain(`| writer | ${S3} | discarded |`);
  });

  test("unchecked work is never counted as done: a flagged file kept, a fixed one the gates still block, an unchanged 'fix' and a 'discarded' file still there are refused", () => {
    const { project, waveId } = waveWithPredecessor();
    const blocked = new Set(["modules/01-m01/summary/2.md"]);
    const { deps } = jobGates(blocked);
    must(open(project, waveId, "writer", [S1, S2, S3], deps));

    const flaggedKept = close(project, waveId, "writer", { [S1]: "kept", [S2]: "kept", [S3]: "discarded" }, deps);
    writeFileSync(join(project, S2), "still R_tot\n");
    const stillBlocked = close(project, waveId, "writer", { [S1]: "fixed", [S2]: "fixed", [S3]: "kept" }, deps);
    const missing = close(project, waveId, "writer", { [S1]: "kept" }, deps);

    expect(flaggedKept.code).toBe(1);
    expect(flaggedKept.out.problems).toEqual([
      `${S2} had 1 re-gate finding: fix it or discard it, it can't be kept`,
      `${S3} is marked discarded but is still there: delete it`,
    ]);
    expect(stillBlocked.out.problems).toEqual([
      `${S1} is marked fixed but is unchanged since the re-gate: keep it or fix it`,
      `${S2} is marked fixed but the job gates still find: notation: writes R_tot, not R_{\\mathrm{tot}}`,
    ]);
    expect(missing.out.problems).toEqual([`no outcome for ${S2}`, `no outcome for ${S3}`]);
    expect(must(ledger("status", "--project", project)).relaunches[0].closedAt).toBeNull();
  });

  test("a finding the gate places on a field of the file (the notation lint's `file (body)`) is that file's", () => {
    const { project, waveId } = waveWithPredecessor();
    const { deps } = jobGates(new Set(["modules/01-m01/summary/2.md (body)", "modules/01-m01/summary/1.md:3"]));

    const { out } = open(project, waveId, "writer", [S1, S2, S3], deps);

    expect((out.files as { path: string; findings: string[] }[]).map((f) => [f.path, f.findings.length])).toEqual([
      [S1, 1],
      [S2, 1],
      [S3, 0],
    ]);
  });

  test("a finding on a folder (too many Summary beats) is every file's in it", () => {
    const { project, waveId } = waveWithPredecessor();
    const { deps } = jobGates(new Set(["modules/01-m01/summary"]));

    const { out } = open(project, waveId, "writer", ["content/modules/01-m01"], deps);

    expect((out.files as { path: string; findings: string[] }[]).map((f) => [f.path, f.findings.length])).toEqual([
      [MODULE_YAML, 0],
      [S1, 1],
      [S2, 1],
      [S3, 1],
    ]);
  });

  test("a wave with an open relaunch doesn't merge", () => {
    const { project, waveId } = waveWithPredecessor();
    const { deps } = jobGates(new Set());
    must(open(project, waveId, "writer", [S1], deps));

    const { out } = wave(["ready", "--project", project, "--wave", waveId], {
      ...deps,
      verifier: { verify: () => ({ green: true, problems: [] }), rulings: () => [] },
    });

    expect(out.problems).toContainEqual(
      expect.stringMatching(
        /writer was relaunched but its predecessor's files aren't settled: wave\.ts relaunch close/,
      ),
    );
  });

  test("a file outside the Course project and the Private folder, or one that isn't there, is refused", () => {
    const { project, waveId } = waveWithPredecessor();
    const { deps } = jobGates(new Set());

    expect(open(project, waveId, "writer", ["../elsewhere.md"], deps).code).toBe(2);
    expect(open(project, waveId, "writer", ["content/modules/01-m01/summary/9.md"], deps).code).toBe(2);
  });

  test("a file no gate covers is only reviewed: the re-gate says so", () => {
    const { project, privateFolder, waveId } = waveWithPredecessor();
    writeFiles(privateFolder, { "waves/01/youtube/notes.txt": "candidate cards" });
    const { deps } = jobGates(new Set());

    const { out } = open(project, waveId, "media-video", ["private:waves/01/youtube/notes.txt"], deps);

    expect(out.files).toEqual([{ path: "private:waves/01/youtube/notes.txt", covered: false, findings: [] }]);
  });
});

describe("a relaunched Blind reader", () => {
  const reading = (reader: "a" | "b", value: string) =>
    JSON.stringify({
      reading: "learn-premium blind reading v1",
      reader,
      module: "01",
      items: [{ key: "eq-1", file: "L01.pdf", page: 1, box: null, quantity: "k", kind: "number", value }],
    });

  test("is given only its own predecessor's reading, re-gated on its shape, never the other reader's output", () => {
    const { project, privateFolder, waveId } = waveWithPredecessor();
    writeFiles(privateFolder, {
      "waves/01/reading-a.json": reading("a", "0.25"),
      "waves/01/reading-b.json": reading("b", "OTHER-READER-VALUE-0.52"),
    });
    const { deps, runs } = jobGates(new Set());

    const { code, out, ...rest } = open(project, waveId, "blind-reader-a", [], deps);

    expect(code).toBe(0);
    expect(out.files).toEqual([{ path: "private:waves/01/reading-a.json", covered: true, findings: [] }]);
    expect(JSON.stringify({ out, rest })).not.toContain("OTHER-READER-VALUE");
    expect(out.next).toMatch(/only its brief, the Module's Materials and its own predecessor's reading/);
    expect(runs).toEqual([]);
  });

  test("handed the other reader's reading, or the settled one, the relaunch is refused (negative control)", () => {
    const { project, privateFolder, waveId } = waveWithPredecessor();
    writeFiles(privateFolder, {
      "waves/01/reading-a.json": reading("a", "0.25"),
      "waves/01/reading-b.json": reading("b", "0.52"),
      "waves/01/reading.json": "{}",
    });
    const { deps } = jobGates(new Set());

    const other = open(project, waveId, "blind-reader-a", ["private:waves/01/reading-b.json"], deps);
    const settled = open(project, waveId, "blind-reader-b", ["private:waves/01/reading.json"], deps);

    expect(other.code).toBe(2);
    expect(other.out.error).toMatch(
      /a relaunched Blind reader is given only its own predecessor's reading.*reading-a\.json/,
    );
    expect(settled.code).toBe(2);
  });

  test("whose predecessor died before writing anything starts fresh, still without the other reader's reading", () => {
    const { project, privateFolder, waveId } = waveWithPredecessor();
    writeFiles(privateFolder, { "waves/01/reading-b.json": reading("b", "OTHER-READER-VALUE") });
    const { deps } = jobGates(new Set());

    const opened = open(project, waveId, "blind-reader-a", [], deps);
    const closed = close(project, waveId, "blind-reader-a", {}, deps);

    expect(opened.code).toBe(0);
    expect(opened.out.files).toEqual([]);
    expect(JSON.stringify(opened.out)).not.toContain("OTHER-READER-VALUE");
    expect(closed.code).toBe(0);
  });

  test("a predecessor's reading that fails its shape is flagged, and only a fix or a fresh start follows", () => {
    const { project, privateFolder, waveId } = waveWithPredecessor();
    writeFiles(privateFolder, {
      "waves/01/reading-b.json": '{"reading": "learn-premium blind reading v1", "reader": "b"',
    });
    const { deps } = jobGates(new Set());

    const { out } = open(project, waveId, "blind-reader-b", [], deps);

    expect(out.files).toEqual([
      { path: "private:waves/01/reading-b.json", covered: true, findings: [expect.stringMatching(/JSON/)] },
    ]);
  });
});
