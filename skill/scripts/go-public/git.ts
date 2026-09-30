// Reading a repo's whole history through git itself: every path any commit ever held with its
// blob, and the blobs' contents streamed through `git cat-file`. Nothing here writes to the repo.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export class GitError extends Error {}

/** Never prompt for credentials: a remote that needs them fails instead of hanging the check. */
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

/** A binary blob has a NUL in its first bytes, as git itself decides. */
const BINARY_PROBE = 8000;

export function git(repo: string, args: string[], input?: string): string {
  const child = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: ENV,
    maxBuffer: 1 << 30,
    ...(input === undefined ? {} : { input }),
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new GitError(child.stderr.trim() || `git ${args[0]} exited ${child.status}`);
  return child.stdout;
}

/** A path holding a blob, and the commits that put that blob there. */
export interface Appearance {
  path: string;
  blob: string;
  commits: string[];
}

export interface History {
  commits: number;
  appearances: Appearance[];
}

/**
 * Every (path, blob) pair any commit reachable from any ref (or from `extraRevs`) ever held. Each
 * pair shows up in the diff of the commit that introduced it, against a parent or, for a root
 * commit, against nothing; merges are diffed against every parent, so an evil merge's own files
 * count too. Submodule entries point at another repo and are skipped.
 */
export function readHistory(repo: string, extraRevs: string[]): History {
  const out = git(repo, [
    "-c",
    "log.showSignature=false",
    "log",
    "--all",
    ...extraRevs,
    "--diff-merges=separate",
    "--root",
    "--raw",
    "--no-renames",
    "--no-abbrev",
    "--no-color",
    "-z",
    "--format=%x01%H",
    "--",
  ]);
  const commits = new Set<string>();
  const appearances = new Map<string, Appearance>();
  const tokens = out.split("\0");
  let commit = "";
  for (let i = 0; i < tokens.length; i++) {
    const token = (tokens[i] ?? "").replace(/^\n/, "");
    if (token.startsWith("\x01")) {
      commit = token.slice(1);
      commits.add(commit);
      continue;
    }
    if (!token.startsWith(":")) continue;
    const path = tokens[++i] ?? "";
    const [, mode, , blob = ""] = token.slice(1).split(" ");
    if (mode === "160000" || /^0+$/.test(blob)) continue;
    const key = `${path}\0${blob}`;
    const seen = appearances.get(key) ?? { path, blob, commits: [] };
    if (!seen.commits.includes(commit)) seen.commits.push(commit);
    appearances.set(key, seen);
  }
  return { commits: commits.size, appearances: [...appearances.values()] };
}

export interface BlobContent {
  blob: string;
  sha256: string;
  /** The content as UTF-8, or null for a binary blob. */
  text: string | null;
}

/** Streams each blob in `blobs` through `visit`, holding only one blob's text at a time. */
export function forEachBlob(repo: string, blobs: string[], visit: (content: BlobContent) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, "cat-file", "--batch"], { env: ENV });
    const reader = new BatchReader(visit);
    let stderr = "";
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      child.kill();
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        reader.push(chunk);
      } catch (error) {
        fail(error as Error);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.stdin.on("error", fail);
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) fail(new GitError(stderr.trim() || `git cat-file exited ${code}`));
      else if (reader.read !== blobs.length)
        fail(new GitError(`git cat-file read ${reader.read} of ${blobs.length} blobs`));
      else resolve();
    });
    child.stdin.end(blobs.map((blob) => `${blob}\n`).join(""));
  });
}

interface Reading {
  blob: string;
  remaining: number;
  hash: ReturnType<typeof createHash>;
  seen: number;
  binary: boolean;
  chunks: Buffer[];
}

/** Parses `git cat-file --batch` output: `<sha> <type> <size>\n<content>\n`, repeated. */
class BatchReader {
  read = 0;
  #pending: Buffer = Buffer.alloc(0);
  #current: Reading | null = null;
  readonly #visit: (content: BlobContent) => void;

  constructor(visit: (content: BlobContent) => void) {
    this.#visit = visit;
  }

  push(chunk: Buffer): void {
    let buffer = this.#pending.length === 0 ? chunk : Buffer.concat([this.#pending, chunk]);
    for (;;) {
      if (this.#current === null) {
        const end = buffer.indexOf(10);
        if (end === -1) break;
        this.#current = this.#start(buffer.subarray(0, end).toString("utf8"));
        buffer = buffer.subarray(end + 1);
      }
      const current = this.#current;
      const take = Math.min(current.remaining, buffer.length);
      if (take > 0) {
        this.#take(current, buffer.subarray(0, take));
        buffer = buffer.subarray(take);
      }
      if (current.remaining > 0 || buffer.length === 0) break;
      buffer = buffer.subarray(1); // the newline after the content
      this.#finish(current);
    }
    this.#pending = buffer;
  }

  #start(header: string): Reading {
    const [blob = "", type, size] = header.split(" ");
    if (type !== "blob") throw new GitError(`git cat-file: expected a blob, got "${header}"`);
    return { blob, remaining: Number(size), hash: createHash("sha256"), seen: 0, binary: false, chunks: [] };
  }

  #take(current: Reading, part: Buffer): void {
    current.hash.update(part);
    current.remaining -= part.length;
    if (current.binary) return;
    if (current.seen < BINARY_PROBE && part.subarray(0, BINARY_PROBE - current.seen).includes(0)) {
      current.binary = true;
      current.chunks = [];
      return;
    }
    current.seen += part.length;
    current.chunks.push(part);
  }

  #finish(current: Reading): void {
    this.#current = null;
    this.read++;
    this.#visit({
      blob: current.blob,
      sha256: current.hash.digest("hex"),
      text: current.binary ? null : Buffer.concat(current.chunks).toString("utf8"),
    });
  }
}

/** Each object's type (`commit`, `tag`, …), or `missing` when the repo doesn't hold it. */
export function objectTypes(repo: string, shas: string[]): Map<string, string> {
  if (shas.length === 0) return new Map();
  const out = git(repo, ["cat-file", "--batch-check"], shas.map((sha) => `${sha}\n`).join(""));
  return new Map(
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", type = ""] = line.split(" ");
        return [sha, type];
      }),
  );
}
