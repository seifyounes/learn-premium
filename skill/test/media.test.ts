// The Media pass's state scripts through their command interface (seam 2), NotebookLM faked.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FakeNotebookLM, must, placedPath, runMediaPass } from "./fake-notebooklm.ts";
import { jsonInput, ledger, media, tempDir, writeFiles } from "./helpers.ts";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Course registry", () => {
  test("a Course joins once, under its name from the Build ledger", () => {
    const state = tempDir("state");
    const project = fixtureCourse("Statics", { live: ["01"] });

    const first = media("register", "--state", state, "--project", project);
    const again = media("register", "--state", state, "--project", project);

    expect(first).toEqual({ code: 0, out: { ok: true, course: "Statics", added: true } });
    expect(again).toEqual({ code: 0, out: { ok: true, course: "Statics", added: false } });
    expect(must(media("gather", "--state", state)).queue).toHaveLength(3);
  });

  test("a folder with no Build ledger is refused", () => {
    const { code, out } = media("register", "--state", tempDir("state"), "--project", tempDir("project"));

    expect(code).toBe(3);
    expect(out.error).toMatch(/no Build ledger/);
  });
});

describe("gathering the Media queue", () => {
  test("takes every registered Course's live Modules and live sittings, nearest Exam sitting first", () => {
    const state = tempDir("state");
    registered(
      state,
      fixtureCourse("Heat Transfer", {
        sittings: [sitting("midterm", "2026-10-20"), sitting("final", "2026-12-20")],
        live: ["01", "02"],
        planned: ["03"],
      }),
      fixtureCourse("Statics", {
        sittings: [sitting("quiz", "2026-09-15"), sitting("midterm", "2026-10-05")],
        live: ["01"],
        liveSittings: ["midterm"],
      }),
      fixtureCourse("Chemistry", { sittings: [sitting("final", null)], live: ["01"] }),
    );

    const { queue, next } = must(media("gather", "--state", state));

    expect(queue.map((e: Entry) => [e.course, e.item, e.nearestSitting])).toEqual([
      ["Statics", "module-01-video", "2026-10-05"],
      ["Statics", "module-01-audio", "2026-10-05"],
      ["Statics", "module-01-infographic", "2026-10-05"],
      ["Statics", "sitting-midterm-audio", "2026-10-05"],
      ["Heat Transfer", "module-01-video", "2026-10-20"],
      ["Heat Transfer", "module-01-audio", "2026-10-20"],
      ["Heat Transfer", "module-01-infographic", "2026-10-20"],
      ["Heat Transfer", "module-02-video", "2026-10-20"],
      ["Heat Transfer", "module-02-audio", "2026-10-20"],
      ["Heat Transfer", "module-02-infographic", "2026-10-20"],
      ["Chemistry", "module-01-video", null],
      ["Chemistry", "module-01-audio", null],
      ["Chemistry", "module-01-infographic", null],
    ]);
    expect(queue.every((e: Entry) => e.state === "queued" && e.regenerations === 0)).toBe(true);
    expect(queue[3]).toMatchObject({ module: null, sitting: "midterm", kind: "sitting-audio" });
    expect(next).toEqual(queue[0]);
  });

  test("is gathered afresh: a Module that goes live later joins, and an item under way keeps its state and goes first", () => {
    const state = tempDir("state");
    const heat = fixtureCourse("Heat Transfer", {
      sittings: [sitting("final", "2026-12-20")],
      live: ["01"],
      planned: ["02"],
    });
    const statics = fixtureCourse("Statics", { sittings: [sitting("midterm", "2026-10-05")], live: ["01"] });
    registered(state, heat, statics);
    must(media("gather", "--state", state));
    must(media("start", "--state", state, "--project", heat, "--item", "module-01-audio"));

    makeLive(heat, "02");
    const { queue } = must(media("gather", "--state", state));

    expect(queue.map((e: Entry) => [e.course, e.item, e.state])).toEqual([
      ["Heat Transfer", "module-01-audio", "generating"],
      ["Statics", "module-01-video", "queued"],
      ["Statics", "module-01-audio", "queued"],
      ["Statics", "module-01-infographic", "queued"],
      ["Heat Transfer", "module-01-video", "queued"],
      ["Heat Transfer", "module-01-infographic", "queued"],
      ["Heat Transfer", "module-02-video", "queued"],
      ["Heat Transfer", "module-02-audio", "queued"],
      ["Heat Transfer", "module-02-infographic", "queued"],
    ]);
  });

  test("the nearest sitting moves on once a sitting's date has passed; with none ahead an item goes last", () => {
    const state = tempDir("state");
    registered(
      state,
      fixtureCourse("Statics", { sittings: [sitting("midterm", "2026-10-05")], live: ["01"] }),
      fixtureCourse("Heat Transfer", {
        sittings: [sitting("midterm", "2026-10-20"), sitting("final", "2026-12-20")],
        live: ["01"],
      }),
    );
    must(media("gather", "--state", state));

    vi.setSystemTime(Date.parse("2026-10-21T08:00:00.000Z"));
    const { queue } = must(media("gather", "--state", state));

    expect(queue.map((e: Entry) => [e.course, e.nearestSitting])).toEqual([
      ["Heat Transfer", "2026-12-20"],
      ["Heat Transfer", "2026-12-20"],
      ["Heat Transfer", "2026-12-20"],
      ["Statics", null],
      ["Statics", null],
      ["Statics", null],
    ]);
  });

  test("a registered Course that can't be read is reported and skipped; the others are still gathered", () => {
    const state = tempDir("state");
    const gone = fixtureCourse("Statics", { live: ["01"] });
    registered(state, gone, fixtureCourse("Heat Transfer", { live: ["01"] }));
    rmSync(join(gone, "build-ledger.json"));

    const { queue, skipped } = must(media("gather", "--state", state));

    expect(queue.map((e: Entry) => e.course)).toEqual(["Heat Transfer", "Heat Transfer", "Heat Transfer"]);
    expect(skipped).toEqual([{ project: gone, course: "Statics", error: expect.stringMatching(/no Build ledger/) }]);
  });
});

describe("the item state machine", () => {
  test("an item goes queued → generating → downloaded → checked → placed, and leaves the queue once placed", () => {
    const { state, project } = oneCourse();
    const at = ["--state", state, "--project", project, "--item", "module-01-video"];

    must(media("start", ...at));
    must(media("downloaded", ...at));
    must(media("checked", ...at));
    placeFile(project, "module-01-video");
    must(media("placed", ...at, "--file", placedPath("module-01-video")));

    expect(itemsOf(project)["module-01-video"]).toMatchObject({
      state: "placed",
      regenerations: 0,
      file: placedPath("module-01-video"),
    });
    expect(must(media("gather", "--state", state)).queue.map((e: Entry) => e.item)).toEqual([
      "module-01-audio",
      "module-01-infographic",
    ]);
  });

  test("a step out of order is refused and changes nothing", () => {
    const { state, project } = oneCourse();
    const at = ["--state", state, "--project", project, "--item", "module-01-video"];

    expect(media("downloaded", ...at).code).toBe(3);
    must(media("start", ...at));
    expect(media("start", ...at).code).toBe(0); // a repeated start is the same start (see the crash test)
    expect(media("checked", ...at).code).toBe(3);
    placeFile(project, "module-01-video");
    expect(media("placed", ...at, "--file", placedPath("module-01-video")).code).toBe(3);

    expect(itemsOf(project)["module-01-video"]).toMatchObject({ state: "generating", file: null });
  });

  test("placing needs the file in the Course project, and an unknown item is bad input", () => {
    const { state, project } = oneCourse();
    const at = ["--state", state, "--project", project, "--item", "module-01-video"];
    must(media("start", ...at));
    must(media("downloaded", ...at));
    must(media("checked", ...at));

    expect(media("placed", ...at, "--file", "public/media/missing.mp4").code).toBe(2);
    expect(media("start", "--state", state, "--project", project, "--item", "module-09-video").code).toBe(2);
    expect(itemsOf(project)["module-01-video"]?.state).toBe("checked");
  });

  test("a failed item is made once more, then dropped, and a dropped item leaves the queue", () => {
    const { state, project } = oneCourse();
    const at = ["--state", state, "--project", project, "--item", "module-01-audio"];

    must(media("start", ...at));
    must(media("downloaded", ...at));
    const first = must(media("fail", ...at, "--reason", "says 3.2 W where the Module has 2.3 W"));
    must(media("start", ...at));
    must(media("downloaded", ...at));
    must(media("checked", ...at));
    const second = must(media("fail", ...at, "--reason", "still over 100 MB after the harder re-encode"));

    expect(first).toMatchObject({ state: "queued", regenerations: 1 });
    expect(second).toMatchObject({ state: "dropped", regenerations: 1 });
    expect(itemsOf(project)["module-01-audio"]?.failures).toEqual([
      { at: iso(NOW), state: "downloaded", reason: "says 3.2 W where the Module has 2.3 W" },
      { at: iso(NOW), state: "checked", reason: "still over 100 MB after the harder re-encode" },
    ]);
    expect(must(media("gather", "--state", state)).queue.map((e: Entry) => e.item)).not.toContain("module-01-audio");
    expect(media("start", ...at).code).toBe(3);
  });

  test("--final drops a failure a regeneration can't fix, without making it again", () => {
    const { state, project } = oneCourse();
    const at = ["--state", state, "--project", project, "--item", "module-01-video"];
    must(media("start", ...at));

    const failed = must(media("fail", ...at, "--reason", "NotebookLM gave up", "--final"));

    expect(failed).toMatchObject({ state: "dropped", regenerations: 0 });
  });

  test("through a full pass, a wrong output is regenerated once and a twice-wrong one is dropped", () => {
    const { state, project } = oneCourse();
    const notebook = new FakeNotebookLM({
      costs: COSTS,
      limits: { "5-hour": 100, weekly: 100 },
      inaccurate: ["module-01-audio#1", "module-01-infographic#1", "module-01-infographic#2"],
    });

    const last = runMediaPass(state, notebook);

    expect(last).toMatchObject({ next: null, stopped: null, queue: [] });
    expect(stateOf(project)).toEqual({
      "module-01-video": "placed",
      "module-01-audio": "placed",
      "module-01-infographic": "dropped",
    });
    expect(notebook.timesMade(project, "module-01-audio")).toBe(2);
    expect(notebook.timesMade(project, "module-01-infographic")).toBe(2);
    expect(readFileSync(join(project, placedPath("module-01-audio")), "utf8")).toBe("module-01-audio#2");
  });
});

describe("quota", () => {
  test("the status report shows demand against remaining capacity", () => {
    const { state, project } = oneCourse({ live: ["01", "02"] });
    must(media("quota", "--state", state, ...measured({ "5-hour": 10, weekly: 40 })));
    for (const item of ["module-01-video", "module-01-audio"]) {
      must(media("start", "--state", state, "--project", project, "--item", item));
    }

    const report = must(media("status", "--state", state));

    expect(report.demand).toEqual({ items: { video: 1, audio: 1, infographic: 2, "sitting-audio": 0 }, units: 7 });
    expect(report.capacity).toEqual({
      "5-hour": { limit: 10, used: 5, remaining: 5, generations: 2 },
      weekly: { limit: 40, used: 5, remaining: 35, generations: 2 },
    });
  });

  test("before the Owner measures NotebookLM's numbers, demand and capacity are counted but not priced", () => {
    const { state, project } = oneCourse();
    must(media("start", "--state", state, "--project", project, "--item", "module-01-video"));

    const report = must(media("status", "--state", state));

    expect(report.demand).toEqual({ items: { video: 0, audio: 1, infographic: 1, "sitting-audio": 0 }, units: null });
    expect(report.capacity["5-hour"]).toEqual({ limit: null, used: null, remaining: null, generations: 1 });
  });

  test("status reads without writing: a Course's media file appears only at the first gather", () => {
    const state = tempDir("state");
    const project = fixtureCourse("Statics", { live: ["01"] });
    registered(state, project);

    const report = must(media("status", "--state", state));

    expect(report.queue).toHaveLength(3);
    expect(existsSync(join(project, "build-media.json"))).toBe(false);
  });

  test("with measured costs the pass stops before the 5-hour limit, leaves nothing half-done, and resumes when the window refreshes", () => {
    const { state, project } = oneCourse({ live: ["01", "02"] });
    must(media("quota", "--state", state, ...measured({ "5-hour": 6, weekly: 100 })));
    const notebook = new FakeNotebookLM({ costs: COSTS, limits: { "5-hour": 6, weekly: 100 } });

    const stopped = runMediaPass(state, notebook);

    expect(stopped.stopped).toEqual({ limit: "5-hour", until: iso(NOW + 5 * HOUR), observed: false });
    expect(notebook.refusals).toBe(0);
    expect(inFlight(project)).toEqual([]);
    expect(stopped.queue.map((e: Entry) => e.item)).toEqual([
      "module-02-video",
      "module-02-audio",
      "module-02-infographic",
    ]);
    expect(media("start", "--state", state, "--project", project, "--item", "module-02-video")).toMatchObject({
      code: 3,
      out: { ok: false, stopped: { limit: "5-hour", until: iso(NOW + 5 * HOUR) } },
    });

    vi.setSystemTime(NOW + 5 * HOUR);
    const done = runMediaPass(state, notebook);

    expect(done).toMatchObject({ next: null, stopped: null, queue: [] });
    expect(Object.values(stateOf(project))).toEqual(Array(6).fill("placed"));
    expect(notebook.generations).toHaveLength(6);
  });

  test("with measured costs the pass stops at the weekly cap and resumes a week after the oldest spend it needs back", () => {
    const { state, project } = oneCourse({ live: ["01", "02"] });
    must(media("quota", "--state", state, ...measured({ "5-hour": 6, weekly: 9 })));
    const notebook = new FakeNotebookLM({ costs: COSTS, limits: { "5-hour": 6, weekly: 9 } });
    runMediaPass(state, notebook);

    vi.setSystemTime(NOW + 5 * HOUR);
    const stopped = runMediaPass(state, notebook);

    expect(stopped.stopped).toEqual({ limit: "weekly", until: iso(NOW + 7 * DAY), observed: false });
    expect(inFlight(project)).toEqual([]);
    expect(stateOf(project)).toMatchObject({ "module-02-video": "placed", "module-02-audio": "queued" });
    expect(notebook.refusals).toBe(0);

    vi.setSystemTime(NOW + 7 * DAY);
    expect(runMediaPass(state, notebook)).toMatchObject({ next: null, stopped: null, queue: [] });
    expect(notebook.generations).toHaveLength(6);
  });

  test("when NotebookLM itself refuses, the item goes back to the queue unspent and the pass waits out each limit", () => {
    const { state, project } = oneCourse({ live: ["01", "02"] });
    const notebook = new FakeNotebookLM({ costs: COSTS, limits: { "5-hour": 6, weekly: 9 } });

    const fiveHour = runMediaPass(state, notebook);

    expect(fiveHour.stopped).toEqual({ limit: "5-hour", until: iso(NOW + 5 * HOUR), observed: true });
    expect(inFlight(project)).toEqual([]);
    expect(itemsOf(project)["module-02-video"]).toMatchObject({ state: "queued", regenerations: 0, failures: [] });
    expect(fiveHour.capacity["5-hour"].generations).toBe(notebook.generations.length);
    expect(must(media("gather", "--state", state)).next).toBeNull();

    vi.setSystemTime(NOW + 5 * HOUR);
    const weekly = runMediaPass(state, notebook);

    expect(weekly.stopped).toEqual({ limit: "weekly", until: iso(NOW + 5 * HOUR + 7 * DAY), observed: true });
    expect(inFlight(project)).toEqual([]);
    expect(weekly.capacity.weekly.generations).toBe(notebook.generations.length);

    vi.setSystemTime(NOW + 5 * HOUR + 7 * DAY);
    expect(runMediaPass(state, notebook)).toMatchObject({ next: null, stopped: null, queue: [] });
    for (const item of Object.keys(stateOf(project))) expect(notebook.timesMade(project, item)).toBe(1);
    expect(notebook.refusals).toBe(2);
  });

  test("a limit NotebookLM gives a reset time for lifts at that time", () => {
    const { state } = oneCourse();
    const until = "2026-10-06T00:00:00.000Z";

    must(media("limit", "--state", state, "--kind", "weekly", "--until", until));

    expect(must(media("gather", "--state", state))).toMatchObject({ next: null, stopped: { limit: "weekly", until } });
    vi.setSystemTime(Date.parse(until));
    expect(must(media("gather", "--state", state))).toMatchObject({ stopped: null, next: { item: "module-01-video" } });
  });

  test("a crash between logging the spend and moving the item counts the generation once", () => {
    const { state, project } = oneCourse();
    const at = ["--state", state, "--project", project, "--item", "module-01-video"];
    const before = readFileSync(join(project, "build-media.json"), "utf8");
    must(media("start", ...at));
    writeFileSync(join(project, "build-media.json"), before); // the media file write never happened

    expect(must(media("gather", "--state", state)).next).toMatchObject({ item: "module-01-video", state: "queued" });
    must(media("start", ...at));

    expect(itemsOf(project)["module-01-video"]?.state).toBe("generating");
    expect(must(media("status", "--state", state)).capacity["5-hour"].generations).toBe(1);
  });

  test("measured numbers must be positive", () => {
    expect(media("quota", "--state", tempDir("state"), "--cost-video", "-3").code).toBe(2);
  });
});

describe("the driving session and the Media pass", () => {
  test("the Media pass runs while a session holds the ledger lock, never touching the ledger, and the session reads the media", () => {
    const { state, project } = oneCourse();
    const ledgerFile = join(project, "build-ledger.json");
    const ledgerBefore = readFileSync(ledgerFile, "utf8");
    writeFileSync(`${ledgerFile}.mutex`, ""); // a driving session mid-write

    runMediaPass(state, new FakeNotebookLM({ costs: COSTS, limits: { "5-hour": 100, weekly: 100 } }));

    expect(readFileSync(ledgerFile, "utf8")).toBe(ledgerBefore);
    expect(existsSync(`${ledgerFile}.mutex`)).toBe(true);
    expect(
      ledger("status", "--project", project).out.media.map((i: { id: string; state: string }) => [i.id, i.state]),
    ).toEqual([
      ["module-01-video", "placed"],
      ["module-01-audio", "placed"],
      ["module-01-infographic", "placed"],
    ]);

    rmSync(`${ledgerFile}.mutex`);
    const mediaBefore = readFileSync(join(project, "build-media.json"), "utf8");
    must(ledger("lock", "release", "--project", project, "--holder", "session-a"));
    must(ledger("lock", "claim", "--project", project, "--holder", "session-b"));
    expect(readFileSync(join(project, "build-media.json"), "utf8")).toBe(mediaBefore);
  });

  test("a hand-edited media file is refused, naming the field, and its Course is skipped", () => {
    const { state, project } = oneCourse();
    const file = join(project, "build-media.json");
    writeFileSync(file, readFileSync(file, "utf8").replace('"queued"', '"halfway"'));

    const start = media("start", "--state", state, "--project", project, "--item", "module-01-video");
    const { skipped } = must(media("gather", "--state", state));

    expect(start.code).toBe(2);
    expect(start.out.error).toMatch(/media\.items\[0\]\.state/);
    expect(skipped).toEqual([
      { project, course: "Heat Transfer", error: expect.stringMatching(/media\.items\[0\]\.state/) },
    ]);
  });

  test("the Course's media page is generated beside its status page", () => {
    const { state, project } = oneCourse();
    must(media("start", "--state", state, "--project", project, "--item", "module-01-video"));

    const page = readFileSync(join(project, "build-records", "media.md"), "utf8");

    expect(page).toContain("# Heat Transfer: Module media");
    expect(page).toMatch(/\| module-01-video \| Module 01 \| video \| generating \| 0 \|/);
    expect(page).toContain("Demand: 2 items queued");
  });
});

// --- fixtures ---

const COSTS = { video: 3, audio: 2, infographic: 1, "sitting-audio": 2 };

interface Entry {
  project: string;
  course: string;
  item: string;
  module: string | null;
  sitting: string | null;
  kind: string;
  state: string;
  regenerations: number;
  nearestSitting: string | null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function sitting(id: string, date: string | null) {
  return { id, name: id, date };
}

function measured(limits: { "5-hour": number; weekly: number }): string[] {
  return [
    "--limit-5-hour",
    String(limits["5-hour"]),
    "--limit-weekly",
    String(limits.weekly),
    ...Object.entries(COSTS).flatMap(([kind, cost]) => [`--cost-${kind}`, String(cost)]),
  ];
}

/** One registered Course, "Heat Transfer", with a sitting ahead, already gathered once. */
function oneCourse(options: { live?: string[] } = {}) {
  const state = tempDir("state");
  const project = fixtureCourse("Heat Transfer", {
    sittings: [sitting("midterm", "2026-11-10")],
    live: options.live ?? ["01"],
  });
  registered(state, project);
  must(media("gather", "--state", state));
  return { state, project };
}

function registered(state: string, ...projects: string[]): void {
  for (const project of projects) must(media("register", "--state", state, "--project", project));
}

/**
 * A synthetic Course project built through the ledger commands: Modules `live` merged, `planned` only
 * mapped, and `liveSittings` with a merged Sitting wave. session-a keeps the ledger lock throughout.
 */
function fixtureCourse(
  name: string,
  options: {
    sittings?: { id: string; name: string; date: string | null }[];
    live?: string[];
    planned?: string[];
    liveSittings?: string[];
  },
): string {
  const { sittings = [], live = [], planned = [], liveSittings = [] } = options;
  const project = tempDir("project");
  const materials = tempDir("materials");
  const modules = [...live, ...planned];
  writeFiles(materials, Object.fromEntries(modules.map((id) => [`L${id}.pdf`, `${name} ${id}`])));
  const intake = {
    courseName: name,
    materialsPath: materials,
    disciplines: ["maths"],
    pad: "graph-green",
    arabicNotes: false,
    sittings,
  };
  must(
    ledger("init", "--project", project, "--holder", "session-a", "--release", "v2.0.0", "--intake", jsonInput(intake)),
  );
  const moduleMap = {
    modules: modules.map((id) => ({ id, slug: `m${id}`, title: `Module ${id}`, materials: [`L${id}.pdf`] })),
    unmapped: [],
  };
  must(ledger("map", "--project", project, "--holder", "session-a", "--input", jsonInput(moduleMap)));
  for (const id of live) makeLive(project, id);
  for (const id of liveSittings) mergeWave(project, "sitting", id);
  return project;
}

function makeLive(project: string, module: string): void {
  mergeWave(project, "module", module);
}

function mergeWave(project: string, kind: "module" | "sitting", target: string): void {
  const holder = ["--project", project, "--holder", "session-a"];
  const { wave } = must(
    ledger("wave", "start", ...holder, "--kind", kind, "--target", target, "--branch", `b-${target}`),
  );
  must(ledger("wave", "end", ...holder, "--wave", wave, "--result", "merged", "--commit", COMMIT));
}

function placeFile(project: string, item: string): void {
  writeFiles(project, { [placedPath(item)]: item });
}

/** The Course's media items by id, as the driving session reads them (ledger `status`). */
function itemsOf(
  project: string,
): Record<string, { state: string; regenerations: number; file: string | null; failures: unknown[] }> {
  const items = must(ledger("status", "--project", project)).media as {
    id: string;
    state: string;
    regenerations: number;
    file: string | null;
    failures: unknown[];
  }[];
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function stateOf(project: string): Record<string, string> {
  return Object.fromEntries(Object.entries(itemsOf(project)).map(([id, item]) => [id, item.state]));
}

/** Items left half-done: started and neither placed, dropped nor back in the queue. */
function inFlight(project: string): string[] {
  return Object.entries(stateOf(project))
    .filter(([, s]) => s === "generating" || s === "downloaded" || s === "checked")
    .map(([id]) => id);
}
