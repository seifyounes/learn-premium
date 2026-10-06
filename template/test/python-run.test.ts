// A Pyodide tool's code run once, the way the build's preview and the page's live run both do
// (`runCode`), and the build's preview around it (`previewRun`): its own process per package set,
// and a deadline on the code's run.
import { loadPyodide, type PyodideAPI } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";
import { previewRun } from "../src/python/preview.ts";
import { runCode } from "../src/python/run.ts";
import { FIXTURE_COURSE } from "./build-course";

const PLOT = 'plot = [{"id": "p", "kind": "point", "at": [1, 2]}]';

describe("runCode", () => {
  let py: PyodideAPI;
  beforeAll(async () => {
    py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
  });

  it("keeps output the code printed without a newline, and none of it reaches the next run", async () => {
    const first = await runCode(py, `import sys\nprint("a", end="")\nsys.stdout.write("b")\n${PLOT}`);
    expect(first.printout).toEqual(["ab"]);
    const second = await runCode(py, `print("c")\n${PLOT}`);
    expect(second.printout).toEqual(["c"]);
  });

  it("keeps partial output when the code fails", async () => {
    const outcome = await runCode(py, 'print("half", end="")\nraise ValueError("planted")');
    expect(outcome).toMatchObject({ traceback: true, printout: ["half"] });
  });

  it("keeps blank lines and splits lines the way they were printed", async () => {
    const outcome = await runCode(py, `print("a")\nprint()\nprint("b\\nc")\n${PLOT}`);
    expect(outcome.printout).toEqual(["a", "", "b", "c"]);
  });

  it('runs the code as __main__, so work under if __name__ == "__main__" runs', async () => {
    const outcome = await runCode(py, `if __name__ == "__main__":\n    ${PLOT}`);
    expect(outcome).toEqual({ plot: [{ id: "p", kind: "point", at: [1, 2] }], printout: [] });
  });

  it("releases the value the code's last expression gives", async () => {
    py.runPython("import sys\nprobe = object()");
    const refs = () => py.runPython("sys.getrefcount(probe)") as number;
    const before = refs();
    for (let i = 0; i < 3; i++) await runCode(py, `import __main__\n${PLOT}\n__main__.probe`);
    expect(refs()).toBe(before);
  });
});

describe("previewRun", () => {
  it("fails a tool whose code never finishes, at the deadline, saying so", async () => {
    await expect(previewRun(FIXTURE_COURSE, [], "while True:\n    pass", { deadlineMs: 2_000 })).rejects.toThrow(
      /the code was still running 2 s after it started, so it has no preview/,
    );
  });

  it("fails a tool whose code awaits something that never settles", async () => {
    await expect(
      previewRun(FIXTURE_COURSE, [], "import asyncio\nawait asyncio.Future()", { deadlineMs: 2_000 }),
    ).rejects.toThrow(/the code was still running 2 s after it started/);
  });

  it("runs the next tool after one that stuck", async () => {
    const outcome = await previewRun(FIXTURE_COURSE, [], `print("after")\n${PLOT}`);
    expect(outcome).toEqual({ plot: [{ id: "p", kind: "point", at: [1, 2] }], printout: ["after"] });
  });

  it("doesn't let a tool use a package an earlier tool loaded but it doesn't name", async () => {
    const numpy = await previewRun(FIXTURE_COURSE, ["numpy"], `import numpy\n${PLOT}`);
    expect(numpy).not.toHaveProperty("error");
    // find_imports doesn't see __import__: only running it alone shows it fails on the page.
    const hidden = await previewRun(FIXTURE_COURSE, [], `np = __import__("numpy")\n${PLOT}`);
    expect(hidden).toMatchObject({ traceback: true, error: expect.stringMatching(/ModuleNotFoundError/) });
  });
});
