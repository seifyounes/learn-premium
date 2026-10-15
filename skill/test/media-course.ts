// A Course project for the media fact check, re-encode and placement tests: the Fixture Course's Module 01
// content (its numbers are what the fact check reads) in a synthetic project, and its existing media as the
// downloads. Each ingested master gets a marker appended, so it never equals a committed blob.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";
import { privateFolderOf } from "../scripts/intake/create.ts";
import { run as runMedia } from "../scripts/media/cli.ts";
import type { MediaDeps } from "../scripts/media/kit.ts";
import type { MediaFile, MediaItem } from "../scripts/media/model.ts";
import type { Verifier } from "../scripts/wave/wave.ts";
import { must } from "./fake-notebooklm.ts";
import { fixtureCourse, materialsOf, registered } from "./fixture-courses.ts";
import { media, tempDir, writeFiles, type Result } from "./helpers.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "..", "fixture-course");
export const FIXTURE_MEDIA = join(FIXTURE, "modules", "01-thermal-resistance", "media");

/** The files the fixture's downloads are saved as, per kind. */
export const DOWNLOAD = {
  video: { from: "explainer.mp4", name: "module-01-video.mp4" },
  audio: { from: "deep-dive.mp3", name: "module-01-audio.mp3" },
  infographic: { from: "infographic.png", name: "module-01-infographic.png" },
} as const;

/**
 * Template-layer files in place before the ledger pins them: the pre-commit gate hook, which a media branch's
 * commits run through. Only the git courses carry it.
 */
const HOOK = { "gates/hooks/pre-commit": "#!/bin/sh\n" };

/** A synthetic `youtube:` card, which #73's Watch owns: the merge keeps it byte for byte, whatever its shape. */
export const YOUTUBE_BLOCK = "youtube:\n  - id: dQw4w9WgXcQ\n    title: 'A synthetic card'\n";
export const MEDIA_YAML = `# Synthetic media slots for the media tests.\n${YOUTUBE_BLOCK}`;

const privates: string[] = [];
afterEach(() => {
  for (const dir of privates.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface MediaCourse {
  project: string;
  state: string;
  privateFolder: string;
}

/**
 * Module 01 live (the Fixture Course's own content, minus its media) and Module 02 planned, registered and
 * gathered: three queued items for Module 01. `git` makes the project a repo on `main`, as a Course project is.
 */
export function mediaCourse(
  options: {
    git?: boolean;
    sittings?: { id: string; name: string; date: string | null }[];
    liveSittings?: string[];
  } = {},
): MediaCourse {
  const project = fixtureCourse("Fixture Course", {
    live: ["01"],
    planned: ["02"],
    ...(options.sittings === undefined ? {} : { sittings: options.sittings }),
    ...(options.liveSittings === undefined ? {} : { liveSittings: options.liveSittings }),
    template: options.git === true ? HOOK : {},
  });
  const content = join(project, "content");
  cpSync(join(FIXTURE, "modules", "01-thermal-resistance"), join(content, "modules", "01-m01"), {
    recursive: true,
    filter: (source) => !/[\\/](media|media\.yaml)$/.test(source),
  });
  cpSync(
    join(FIXTURE, "build-records", "recompute", "01-thermal-resistance"),
    join(content, "build-records", "recompute", "01-m01"),
    { recursive: true },
  );
  cpSync(join(FIXTURE, "style-sheet.yaml"), join(content, "style-sheet.yaml"));
  writeFiles(project, { "content/modules/01-m01/media.yaml": MEDIA_YAML });
  const state = tempDir("state");
  registered(state, project);
  must(media("gather", "--state", state));
  const privateFolder = privateFolderOf(materialsOf(project));
  privates.push(privateFolder);
  mkdirSync(privateFolder, { recursive: true });
  if (options.git === true) initGit(project);
  return { project, state, privateFolder };
}

export function gitIn(repo: string, ...args: string[]): string {
  const child = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")}: ${child.stderr}`);
  return child.stdout;
}

/** The project a repo on `main`, with CRLF off and the hook's exec bit set before the first add (as parallel-waves). */
function initGit(project: string): void {
  gitIn(project, "init", "-q", "-b", "main");
  gitIn(project, "config", "user.name", "Fixture");
  gitIn(project, "config", "user.email", "fixture@example.test");
  gitIn(project, "config", "commit.gpgsign", "false");
  gitIn(project, "config", "core.autocrlf", "false");
  gitIn(project, "config", "core.hooksPath", "template/gates/hooks");
  chmodSync(join(project, "template/gates/hooks/pre-commit"), 0o755);
  gitIn(project, "add", "-A");
  gitIn(project, "commit", "-q", "-m", "feat: Module 01");
}

/** A media item's row in the Course's media file. */
export function itemOf(c: MediaCourse, id: string): MediaItem {
  const file = JSON.parse(readFileSync(join(c.project, "build-media.json"), "utf8")) as MediaFile;
  const item = file.items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`no item ${id}`);
  return item;
}

/** One media command with the fake kit and verifier as its deps, as the CLI would run it. */
export function mediaWith(deps: Partial<MediaDeps>, ...args: string[]): Result {
  const { code, stdout } = runMedia(args, deps);
  return { code, out: JSON.parse(stdout) };
}

/** Starts an item and takes the fixture's file for it into `downloaded`, as `ingest` does. `attempt` marks the master. */
export function ingestFixture(c: MediaCourse, id: string, attempt: number): string {
  const item = itemOf(c, id);
  const kind = item.kind === "sitting-audio" ? "audio" : item.kind;
  const { from, name } = DOWNLOAD[kind];
  const ext = name.slice(name.lastIndexOf("."));
  if (item.state === "queued") must(media("start", "--state", c.state, "--project", c.project, "--item", id));
  mkdirSync(join(c.project, "media-inbox"), { recursive: true });
  writeFileSync(
    join(c.project, "media-inbox", `${id}${ext}`),
    Buffer.concat([readFileSync(join(FIXTURE_MEDIA, from)), Buffer.from(`#attempt-${attempt}`)]),
  );
  must(media("ingest", "--state", c.state, "--project", c.project, "--private", c.privateFolder));
  return join(c.privateFolder, "media", "masters", `${id}-${attempt}${ext}`);
}

/** The fake verifier: every gate green, and the Slip Fixture Module 01 ships (mirrors rulings.test.ts). */
export function fakeVerifier(
  rulings: ReturnType<Verifier["rulings"]> = [
    { entry: "modules/01-m01/worked/1.json", kind: "slip", printed: [1.45], cell: "D4" },
  ],
): Verifier {
  return { verify: () => ({ green: true, problems: [] }), rulings: () => rulings };
}
