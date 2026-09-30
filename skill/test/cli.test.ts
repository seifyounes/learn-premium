// The ledger and media CLIs as the skill runs them: a separate Node process per command.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { jsonInput, tempDir, writeFiles } from "./helpers.ts";

const ENTRY = fileURLToPath(new URL("../scripts/ledger.ts", import.meta.url));
const MEDIA_ENTRY = fileURLToPath(new URL("../scripts/media.ts", import.meta.url));
const START_TOGETHER = new URL("./start-together.ts", import.meta.url).href;

function runSync(...args: string[]) {
  const child = spawnSync(process.execPath, [ENTRY, ...args], { encoding: "utf8" });
  return { code: child.status, out: JSON.parse(child.stdout), stderr: child.stderr };
}

/** Runs a command in a process that starts it at `startAt` (epoch ms), for racing several at once. */
function runAt(startAt: number, ...args: string[]): Promise<number | null> {
  const env = { ...process.env, START_AT: String(startAt) };
  return new Promise((resolve) =>
    spawn(process.execPath, ["--import", START_TOGETHER, ENTRY, ...args], { stdio: "ignore", env }).on(
      "close",
      resolve,
    ),
  );
}

function newCourse(): string {
  const project = tempDir("project");
  const materials = tempDir("materials");
  writeFiles(materials, { "L01.pdf": "l1" });
  const intake = {
    courseName: "Statics",
    materialsPath: materials,
    disciplines: ["machinery"],
    pad: "blueprint",
    arabicNotes: true,
    sittings: [],
  };
  const init = runSync(
    "init",
    "--project",
    project,
    "--holder",
    "setup",
    "--release",
    "v2.0.0",
    "--intake",
    jsonInput(intake),
  );
  if (init.code !== 0) throw new Error(`init failed: ${init.stderr}`);
  return project;
}

describe("ledger CLI", () => {
  test("prints one JSON document and exits 0 on success, without warnings on stderr", () => {
    const project = newCourse();

    const next = runSync("next", "--project", project);

    expect(next.code).toBe(0);
    expect(next.out).toMatchObject({ ok: true, action: "waves", newMaterials: [{ path: "L01.pdf", kind: "pdf" }] });
    expect(next.stderr).toBe("");
  });

  test("exits 2 with a JSON error on a bad command", () => {
    expect(runSync("frobnicate", "--project", tempDir("project"))).toMatchObject({ code: 2, out: { ok: false } });
  });

  test("the media commands run as their own process, in the same JSON shape and exit codes", () => {
    const project = newCourse();
    const state = tempDir("state");
    const media = (...args: string[]) => {
      const child = spawnSync(process.execPath, [MEDIA_ENTRY, ...args, "--state", state], { encoding: "utf8" });
      return { code: child.status, out: JSON.parse(child.stdout), stderr: child.stderr };
    };

    const registered = media("register", "--project", project);
    const gathered = media("gather");
    const refused = media("downloaded", "--project", project, "--item", "module-01-video");

    expect(registered).toMatchObject({ code: 0, out: { ok: true, course: "Statics", added: true }, stderr: "" });
    expect(gathered).toMatchObject({ code: 0, out: { ok: true, queue: [], next: null } });
    expect(refused).toMatchObject({ code: 2, out: { ok: false } });
  });

  test("when several sessions claim a free lock at the same moment, exactly one gets it", async () => {
    const project = newCourse();
    runSync("lock", "release", "--project", project, "--holder", "setup");

    const startAt = Date.now() + 1500;
    const codes = await Promise.all(
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((holder) =>
        runAt(startAt, "lock", "claim", "--project", project, "--holder", holder),
      ),
    );

    expect(codes.filter((code) => code === 0)).toHaveLength(1);
    expect(codes.filter((code) => code === 3)).toHaveLength(5);
  });
});
