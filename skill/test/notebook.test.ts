// Driving NotebookLM's side of the Media pass through its command interface (seam 2): the Course
// notebook record, the Notebook recipe, the media inbox and the Chrome profile. NotebookLM is faked.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FakeNotebookLM, must, placedPath } from "./fake-notebooklm.ts";
import { fixtureCourse, makeLive, materialsOf, registered, sitting } from "./fixture-courses.ts";
import { media, tempDir, writeFiles } from "./helpers.ts";

const NOW = Date.parse("2026-10-01T08:00:00.000Z");
const URL = "https://notebook.google.com/notebook/0f1e2d3c-aaaa-bbbb-cccc-0123456789ab";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the Course notebook record", () => {
  test("keeps the notebook's address and each Material uploaded, at the hash the Module was built from", () => {
    const { project } = course();

    must(media("notebook", "--project", project, "--url", URL));
    const { source } = must(media("source", "--project", project, "--material", "L01.pdf", "--title", "L01.pdf"));

    expect(source).toMatchObject({ material: "L01.pdf", title: "L01.pdf", addedAt: new Date(NOW).toISOString() });
    expect(source.hash).toMatch(/^[0-9a-f]{64}$/);
    const { notebook } = must(media("notebook", "--project", project));
    expect(notebook).toEqual({ url: URL, sources: [source] });
  });

  test("an address that isn't a NotebookLM notebook is refused", () => {
    const { project } = course();

    const { code, out } = media("notebook", "--project", project, "--url", "https://example.com/notebook/1");

    expect(code).toBe(2);
    expect(out.error).toMatch(/NotebookLM notebook/);
  });

  test("a source waits for the notebook, and must be one of the Course's current Materials", () => {
    const { project } = course();

    const early = media("source", "--project", project, "--material", "L01.pdf", "--title", "L01.pdf");
    must(media("notebook", "--project", project, "--url", URL));
    const stranger = media("source", "--project", project, "--material", "nope.pdf", "--title", "nope.pdf");

    expect(early.code).toBe(3);
    expect(early.out.error).toMatch(/notebook/);
    expect(stranger.code).toBe(2);
    expect(stranger.out.error).toMatch(/nope\.pdf/);
  });

  test("a Material changed on disk since its Module was built is refused: the Module is rebuilt first", () => {
    const { project } = course();
    must(media("notebook", "--project", project, "--url", URL));
    writeFileSync(join(materialsOf(project), "L01.pdf"), "a newer lecture");

    const { code, out } = media("source", "--project", project, "--material", "L01.pdf", "--title", "L01.pdf");

    expect(code).toBe(3);
    expect(out.error).toMatch(/changed/);
  });
});

describe("the Notebook recipe", () => {
  test("a Module's video: a new notebook, its sources to add, the Explainer in the pad's Custom style, in English", () => {
    const { project } = course({ pad: "green" });

    const recipe = must(media("recipe", "--project", project, "--item", "module-01-video"));

    expect(recipe).toMatchObject({
      item: "module-01-video",
      kind: "video",
      course: "Heat Transfer",
      module: { id: "01", title: "Module 01" },
      notebook: { title: "Heat Transfer", url: null },
      sources: [
        {
          material: "L01.pdf",
          path: join(materialsOf(project), "L01.pdf"),
          title: "L01.pdf",
          action: "add",
          replaces: null,
          viaDrive: false,
        },
      ],
      skipped: [],
      output: {
        studio: "Video Overview",
        settings: { format: "Explainer", visualStyle: "Custom" },
        language: "English",
      },
      save: { folder: join(project, "media-inbox"), name: "module-01-video", extensions: [".mp4"] },
    });
    expect(recipe.output.style).toContain("#E6EFDC");
    expect(recipe.output.style).toContain("#2E5A38");
    expect(recipe.output.style).toContain("#C0341D");
    expect(recipe.output.prompt).toContain("Module 01");
    expect(recipe.steps.join("\n")).toMatch(/English/);
    expect(recipe.steps.join("\n")).toContain("module-01-video.mp4");
  });

  test("the inbox exists and ignores itself, so nothing dropped there is ever committed", () => {
    const { project } = course();

    must(media("recipe", "--project", project, "--item", "module-01-audio"));

    expect(readFileSync(join(project, "media-inbox", ".gitignore"), "utf8").trim()).toBe("*");
  });

  test("the audio is a Deep Dive and the infographic a landscape one in the pad's style", () => {
    const { project } = course({ pad: "teal" });

    const audio = must(media("recipe", "--project", project, "--item", "module-01-audio"));
    const infographic = must(media("recipe", "--project", project, "--item", "module-01-infographic"));

    expect(audio.output).toMatchObject({
      studio: "Audio Overview",
      settings: { format: "Deep Dive", length: "Default" },
      style: null,
    });
    expect(audio.save.extensions).toEqual([".mp3", ".m4a", ".wav"]);
    expect(infographic.output).toMatchObject({
      studio: "Infographic",
      settings: { orientation: "Landscape", detail: "Standard" },
    });
    expect(infographic.output.style).toContain("#035455");
    expect(infographic.save.extensions).toEqual([".png"]);
  });

  test("a custom pad describes the colour the Owner named", () => {
    const { project } = course({ pad: "#5A7D9A" });

    const { output } = must(media("recipe", "--project", project, "--item", "module-01-video"));

    expect(output.style).toContain("#5A7D9A");
  });

  test("recorded sources are selected, changed ones replaced, and only this Module's", () => {
    const project = fixtureCourse("Heat Transfer", {
      live: ["01", "02"],
      materials: { "01": { "L01.pdf": "one", "L01-notes.pdf": "notes" }, "02": { "L02.pdf": "two" } },
    });
    registeredAndGathered(project);
    must(media("notebook", "--project", project, "--url", URL));
    for (const material of ["L01.pdf", "L01-notes.pdf", "L02.pdf"]) {
      must(media("source", "--project", project, "--material", material, "--title", `${material} (uploaded)`));
    }
    writeFileSync(join(materialsOf(project), "L01-notes.pdf"), "notes, corrected");
    makeLive(project, "01");

    const { notebook, sources } = must(media("recipe", "--project", project, "--item", "module-01-video"));

    expect(notebook.url).toBe(URL);
    expect(sources.map((s: Source) => [s.material, s.action, s.title, s.replaces])).toEqual([
      ["L01-notes.pdf", "replace", "L01-notes.pdf", "L01-notes.pdf (uploaded)"],
      ["L01.pdf", "select", "L01.pdf (uploaded)", null],
    ]);
  });

  test("a file over 10 MB goes through Drive, and a video Material is left out", () => {
    const project = fixtureCourse("Heat Transfer", {
      live: ["01"],
      materials: { "01": { "L01.pdf": Buffer.alloc(10_000_001), "demo.mp4": "video" } },
    });
    registeredAndGathered(project);

    const { sources, skipped } = must(media("recipe", "--project", project, "--item", "module-01-video"));

    expect(sources).toMatchObject([{ material: "L01.pdf", bytes: 10_000_001, viaDrive: true }]);
    expect(skipped).toEqual([{ material: "demo.mp4", reason: expect.stringMatching(/NotebookLM/) }]);
  });

  test("a sitting audio has no recipe until the ledger says which Modules a sitting covers", () => {
    const project = fixtureCourse("Heat Transfer", {
      sittings: [sitting("midterm", "2026-11-10")],
      live: ["01"],
      liveSittings: ["midterm"],
    });
    registeredAndGathered(project);

    const { code, out } = media("recipe", "--project", project, "--item", "sitting-midterm-audio");

    expect(code).toBe(3);
    expect(out.error).toMatch(/sitting/);
  });

  test("an unknown item is refused", () => {
    const { project } = course();

    expect(media("recipe", "--project", project, "--item", "module-09-video").code).toBe(2);
  });
});

describe("the media inbox", () => {
  test("a dropped file moves its generating item to downloaded, its master into the Private folder", () => {
    const { state, project } = course();
    const priv = tempDir("private");
    must(media("start", "--state", state, "--project", project, "--item", "module-01-video"));
    drop(project, "module-01-video.mp4", "video bytes");

    const result = must(media("ingest", "--state", state, "--project", project, "--private", priv));

    const master = join(priv, "media", "masters", "module-01-video-1.mp4");
    expect(result).toMatchObject({ ingested: [{ item: "module-01-video", attempt: 1, master }], ignored: [] });
    expect(readFileSync(master, "utf8")).toBe("video bytes");
    expect(inbox(project)).toEqual([]);
    expect(stateOf(project, "module-01-video")).toBe("downloaded");
  });

  test("a file made by hand for a queued item counts its generation, even past a limit", () => {
    const { state, project } = course();
    const priv = tempDir("private");
    must(media("limit", "--state", state, "--kind", "5-hour"));
    drop(project, "module-01-audio.mp3", "audio bytes");

    must(media("ingest", "--state", state, "--project", project, "--private", priv));

    expect(stateOf(project, "module-01-audio")).toBe("downloaded");
    expect(must(media("status", "--state", state)).capacity["5-hour"].generations).toBe(1);
  });

  test("a regeneration keeps the first master and adds the second", () => {
    const { state, project } = course();
    const priv = tempDir("private");
    const at = ["--state", state, "--project", project, "--item", "module-01-infographic"];
    must(media("start", ...at));
    drop(project, "module-01-infographic.png", "first");
    must(media("ingest", "--state", state, "--project", project, "--private", priv));
    must(media("fail", ...at, "--reason", "a wrong number"));
    must(media("start", ...at));
    drop(project, "module-01-infographic.png", "second");

    const { ingested } = must(media("ingest", "--state", state, "--project", project, "--private", priv));

    expect(ingested).toMatchObject([{ attempt: 2 }]);
    expect(readdirSync(join(priv, "media", "masters")).sort()).toEqual([
      "module-01-infographic-1.png",
      "module-01-infographic-2.png",
    ]);
  });

  test("a file it can't take stays in the inbox, with the reason", () => {
    const { state, project } = course();
    const priv = tempDir("private");
    must(media("start", "--state", state, "--project", project, "--item", "module-01-video"));
    drop(project, "module-01-video.png", "wrong type");
    drop(project, "lecture-notes.pdf", "stray");
    drop(project, "module-01-audio.mp3", "");

    const { ingested, ignored } = must(media("ingest", "--state", state, "--project", project, "--private", priv));

    expect(ingested).toEqual([]);
    expect(ignored.map((i: { file: string }) => i.file)).toEqual([
      "lecture-notes.pdf",
      "module-01-audio.mp3",
      "module-01-video.png",
    ]);
    expect(ignored.map((i: { reason: string }) => i.reason)).toEqual([
      expect.stringMatching(/no media item/),
      expect.stringMatching(/empty/),
      expect.stringMatching(/\.mp4/),
    ]);
    expect(inbox(project)).toHaveLength(3);
    expect(stateOf(project, "module-01-video")).toBe("generating");
  });

  test("a copy of a master already taken is cleared from the inbox", () => {
    const { state, project } = course();
    const priv = tempDir("private");
    must(media("start", "--state", state, "--project", project, "--item", "module-01-video"));
    drop(project, "module-01-video.mp4", "video bytes");
    must(media("ingest", "--state", state, "--project", project, "--private", priv));
    drop(project, "module-01-video.mp4", "video bytes");

    const result = must(media("ingest", "--state", state, "--project", project, "--private", priv));

    expect(result).toMatchObject({ ingested: [], cleared: ["module-01-video.mp4"], ignored: [] });
    expect(inbox(project)).toEqual([]);
  });

  test("a Private folder inside the Course project is refused", () => {
    const { state, project } = course();

    const { code, out } = media("ingest", "--state", state, "--project", project, "--private", join(project, "p"));

    expect(code).toBe(2);
    expect(out.error).toMatch(/Private folder/);
  });

  test("the Notebook recipe path drains the queue through the same state machine", () => {
    const { state, project } = course({ live: ["01", "02"] });
    const priv = tempDir("private");
    const notebook = new FakeNotebookLM({
      costs: { video: 4, audio: 2, infographic: 1, "sitting-audio": 2 },
      limits: { "5-hour": 100, weekly: 1000 },
      inaccurate: ["module-02-audio#1"],
    });

    const last = runByHand(state, priv, notebook);

    expect(last.queue).toEqual([]);
    expect(Object.values(itemStates(project))).toEqual(Array(6).fill("placed"));
    expect(readdirSync(join(priv, "media", "masters"))).toHaveLength(7);
  });
});

describe("the Chrome profile", () => {
  test("is kept in the machine state folder", () => {
    const state = tempDir("state");

    const before = must(media("chrome", "--state", state));
    must(media("chrome", "--state", state, "--profile", "NotebookLM"));
    const after = must(media("chrome", "--state", state));

    expect(before.profile).toBeNull();
    expect(after.profile).toBe("NotebookLM");
  });
});

interface Source {
  material: string;
  action: string;
  title: string;
  replaces: string | null;
}

/** One registered, gathered Course with Module 01 live. */
function course(options: { pad?: string; live?: string[] } = {}) {
  const state = tempDir("state");
  const project = fixtureCourse("Heat Transfer", {
    sittings: [sitting("midterm", "2026-11-10")],
    live: options.live ?? ["01"],
    ...(options.pad === undefined ? {} : { pad: options.pad }),
  });
  registered(state, project);
  must(media("gather", "--state", state));
  return { state, project };
}

function registeredAndGathered(project: string): string {
  const state = tempDir("state");
  registered(state, project);
  must(media("gather", "--state", state));
  return state;
}

function drop(project: string, name: string, content: string): void {
  writeFiles(join(project, "media-inbox"), { [name]: content });
}

function inbox(project: string): string[] {
  const folder = join(project, "media-inbox");
  return existsSync(folder) ? readdirSync(folder).filter((f) => f !== ".gitignore") : [];
}

function itemStates(project: string): Record<string, string> {
  const file = JSON.parse(readFileSync(join(project, "build-media.json"), "utf8")) as {
    items: { id: string; state: string }[];
  };
  return Object.fromEntries(file.items.map((i) => [i.id, i.state]));
}

function stateOf(project: string, item: string): string | undefined {
  return itemStates(project)[item];
}

/**
 * A Media pass where Chrome failed: each queued item is started and its recipe printed, the Owner
 * makes it in NotebookLM and drops the file in the inbox, and ingest takes it from there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON output of `gather`
function runByHand(state: string, priv: string, notebook: FakeNotebookLM): any {
  for (let step = 0; step < 200; step++) {
    const { out: gathered } = media("gather", "--state", state);
    const next = gathered.next;
    if (next === null) return gathered;
    const at = ["--state", state, "--project", next.project, "--item", next.item];
    const attempt = next.regenerations + 1;
    switch (next.state) {
      case "queued":
        must(media("start", ...at));
        break;
      case "generating": {
        const recipe = must(media("recipe", "--project", next.project, "--item", next.item));
        expect(notebook.generate(next.project, next.item, next.kind)).toBe("ok");
        writeFiles(recipe.save.folder, {
          [`${recipe.save.name}${recipe.save.extensions[0]}`]: `${next.item}#${attempt}`,
        });
        must(media("ingest", "--state", state, "--project", next.project, "--private", priv));
        break;
      }
      case "downloaded":
        if (notebook.inaccurate.has(`${next.item}#${attempt}`))
          must(media("fail", ...at, "--reason", "a wrong number"));
        else must(media("checked", ...at));
        break;
      case "checked":
        writeFiles(next.project, { [placedPath(next.item)]: next.item });
        must(media("placed", ...at, "--file", placedPath(next.item)));
        break;
      default:
        throw new Error(`gather offered an item in state ${next.state}`);
    }
  }
  throw new Error("the Media pass never finished");
}
