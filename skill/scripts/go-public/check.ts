// The Go-public check: before the Owner makes a Course project public, scan everything git holds
// for it (every commit on every ref, local and remote) for Materials, Professor-derived evidence
// and secrets, and confirm the Licences file is there and no licence of its own is. It reports;
// it never changes the repo, and flipping the visibility stays the Owner's.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hashTree } from "../ledger/hash.ts";
import type { Ledger } from "../ledger/model.ts";
import { readLedger } from "../ledger/store.ts";
import { evidenceShape } from "./evidence.ts";
import { forEachBlob, git, GitError, objectTypes, readHistory, type Appearance } from "./git.ts";
import { findSecrets, secretPath, type SecretMatch, type Severity } from "./secrets.ts";

/** Where a Course project keeps its Licences file: served at /licences.txt, a URL the UI never links to. */
export const LICENCES_FILE = "public/licences.txt";

/** A file GitHub would show as the repo's own licence. A public Course project carries none. */
const OWN_LICENCE = /^(un)?licen[cs]e|^copying/i;

/** Text Materials larger than this aren't checked for a copy with normalised line endings. */
const TEXT_LIMIT = 16 * 1024 * 1024;

/** Bad input: not a Course project the check can read. */
export class CheckError extends Error {}

const CHECKS = [
  "unscanned-ref",
  "remote-unreachable",
  "materials",
  "evidence",
  "secret",
  "licences-file",
  "own-licence",
] as const;

export interface Finding {
  check: (typeof CHECKS)[number];
  severity: Severity;
  detail: string;
  path?: string;
  commits?: string[];
  [field: string]: unknown;
}

export type Verdict = "clear" | "review" | "blocked";

interface Known {
  material: string;
  source: "ledger" | "materials-folder" | "private-folder";
}

export async function goPublicCheck(project: string, privateFolder: string | null) {
  readableRepo(project);
  const ledger = readLedger(project);
  if (ledger === null) {
    throw new CheckError(`${project} has no Build ledger; the check reads the Materials inventory from it`);
  }
  if (privateFolder !== null && !isFolder(privateFolder)) {
    throw new CheckError(`the Private folder ${privateFolder} isn't a folder`);
  }
  const head = headName(project);
  const findings: Finding[] = [];

  const remote = remoteRefs(project, findings);
  const history = readHistory(project, remote.revs);
  const materials = materialsFolder(ledger);
  const known = knownHashes(ledger, materials, privateFolder);

  for (const appearance of history.appearances) {
    const evidence = evidenceShape(appearance.path);
    if (evidence !== null) findings.push(at(appearance, "evidence", "block", evidence.reason, { rule: evidence.rule }));
    const secret = secretPath(appearance.path);
    if (secret !== null) findings.push(at(appearance, "secret", "block", secret.reason, { rule: secret.rule }));
  }

  const byBlob = Map.groupBy(history.appearances, (appearance) => appearance.blob);
  let textBlobs = 0;
  await forEachBlob(project, [...byBlob.keys()], ({ blob, sha256, text }) => {
    const appearances = byBlob.get(blob) ?? [];
    const material = known.get(sha256);
    if (material !== undefined) {
      const detail = `the ${material.source === "private-folder" ? "Private folder's" : "Materials"} file ${material.material}`;
      for (const appearance of appearances)
        findings.push(at(appearance, "materials", "block", detail, { ...material }));
    }
    if (text === null) return;
    textBlobs++;
    for (const [rule, hits] of Map.groupBy(findSecrets(text), (hit) => hit.rule)) {
      for (const appearance of appearances) findings.push(secretFinding(appearance, rule, hits));
    }
  });

  const licences = licencesFile(project);
  if (!licences.present) {
    findings.push({
      check: "licences-file",
      severity: "block",
      path: LICENCES_FILE,
      detail: `no Licences file at ${head}`,
    });
  }
  for (const path of ownLicences(project)) {
    findings.push({
      check: "own-licence",
      severity: "block",
      path,
      detail: "a public Course project carries no licence of its own",
    });
  }

  findings.sort(byCheckThenPath);
  return {
    verdict: verdictOf(findings),
    head,
    scanned: {
      commits: history.commits,
      paths: new Set(history.appearances.map((appearance) => appearance.path)).size,
      blobs: byBlob.size,
      textBlobs,
      remoteRefs: remote.count,
    },
    materials: {
      hashes: known.size,
      ledgerRows: ledger.materials.length,
      materialsFolder: materials,
      privateFolder,
    },
    licencesFile: licences,
    findings,
  };
}

function readableRepo(project: string): void {
  let top: string;
  try {
    top = git(project, ["rev-parse", "--show-cdup"]).trim();
  } catch (error) {
    if (error instanceof GitError) throw new CheckError(`${project} isn't a git repository`);
    throw error;
  }
  if (top !== "") throw new CheckError(`${project} is inside a git repository, not the root of one`);
  try {
    git(project, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  } catch (error) {
    if (error instanceof GitError) throw new CheckError(`${project} has nothing committed`);
    throw error;
  }
}

/** The branch HEAD is on, or its commit when detached: what the Licences file is looked for in. */
function headName(project: string): string {
  try {
    return git(project, ["symbolic-ref", "-q", "HEAD"]).trim();
  } catch (error) {
    if (error instanceof GitError) return git(project, ["rev-parse", "HEAD"]).trim();
    throw error;
  }
}

function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function materialsFolder(ledger: Ledger): string | null {
  return isFolder(ledger.intake.materialsPath) ? ledger.intake.materialsPath : null;
}

/**
 * Every Materials hash the check matches blobs against: each ledger row, superseded ones too (an
 * old version of a lecture is still the Professor's), then the Materials folder as it is now (files
 * not mapped yet) and the Private folder. A text file also matches with its line endings
 * normalised, as git stores it under `core.autocrlf` or `text=auto`.
 */
function knownHashes(ledger: Ledger, materials: string | null, privateFolder: string | null): Map<string, Known> {
  const known = new Map<string, Known>();
  const add = (hash: string, entry: Known) => {
    if (!known.has(hash)) known.set(hash, entry);
  };
  for (const row of ledger.materials) add(row.hash, { material: row.path, source: "ledger" });
  const folders: [string | null, Known["source"]][] = [
    [materials, "materials-folder"],
    [privateFolder, "private-folder"],
  ];
  for (const [root, source] of folders) {
    if (root === null) continue;
    for (const [path, hash] of Object.entries(hashTree(root))) {
      add(hash, { material: path, source });
      const normalised = lfHash(join(root, path));
      if (normalised !== null) add(normalised, { material: path, source });
    }
  }
  return known;
}

function lfHash(file: string): string | null {
  if (statSync(file).size > TEXT_LIMIT) return null;
  const content = readFileSync(file);
  if (content.subarray(0, 8000).includes(0) || !content.includes("\r\n")) return null;
  const lf = Buffer.from(content.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
  return createHash("sha256").update(lf).digest("hex");
}

/**
 * Refs each remote holds. Their commits become public with the repo, so each must be here to be
 * scanned: one that was never fetched, or a remote that can't be reached, blocks.
 */
function remoteRefs(project: string, findings: Finding[]): { revs: string[]; count: number } {
  const revs = new Set<string>();
  let count = 0;
  for (const remote of git(project, ["remote"]).split("\n").filter(Boolean)) {
    let listed: string;
    try {
      listed = git(project, ["ls-remote", remote]);
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      const reason = error.message.split("\n")[0] ?? "";
      findings.push({
        check: "remote-unreachable",
        severity: "block",
        remote,
        detail: `can't list ${remote}'s refs: ${reason}`,
      });
      continue;
    }
    const refs = Map.groupBy(
      listed
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha = "", ref = ""] = line.split("\t");
          return { sha, ref: ref.replace(/\^\{\}$/, "") };
        }),
      (entry) => entry.ref,
    );
    const types = objectTypes(project, [...new Set([...refs.values()].flat().map((entry) => entry.sha))]);
    for (const [ref, entries] of refs) {
      count++;
      const held = entries.filter((entry) => types.get(entry.sha) !== "missing");
      for (const entry of held) if (types.get(entry.sha) === "commit") revs.add(entry.sha);
      if (held.length === 0) {
        findings.push({
          check: "unscanned-ref",
          severity: "block",
          ref: `${remote} ${ref}`,
          detail: `${remote} holds ${ref} at a commit that was never fetched, so it wasn't scanned; fetch it and run the check again`,
        });
      }
    }
  }
  return { revs: [...revs], count };
}

function licencesFile(project: string): { path: string; present: boolean } {
  const entry = git(project, ["ls-tree", "-z", "-l", "HEAD", "--", LICENCES_FILE]).split("\0")[0] ?? "";
  const [, type, , size] = entry.split(/\s+/);
  return { path: LICENCES_FILE, present: type === "blob" && Number(size) > 0 };
}

function ownLicences(project: string): string[] {
  return git(project, ["ls-tree", "-z", "--name-only", "HEAD"])
    .split("\0")
    .filter((name) => OWN_LICENCE.test(name));
}

function at(
  appearance: Appearance,
  check: Finding["check"],
  severity: Severity,
  detail: string,
  extra: Record<string, unknown>,
): Finding {
  return { check, severity, path: appearance.path, commits: appearance.commits, detail, ...extra };
}

function secretFinding(appearance: Appearance, rule: string, hits: SecretMatch[]): Finding {
  const [first] = hits;
  return at(appearance, "secret", first?.severity ?? "block", `looks like a ${rule}: ${first?.preview ?? ""}`, {
    rule,
    lines: hits.map((hit) => hit.line),
  });
}

function byCheckThenPath(a: Finding, b: Finding): number {
  return (
    CHECKS.indexOf(a.check) - CHECKS.indexOf(b.check) ||
    compare(a.path ?? "", b.path ?? "") ||
    compare(String(a["rule"] ?? ""), String(b["rule"] ?? ""))
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((finding) => finding.severity === "block")) return "blocked";
  return findings.length > 0 ? "review" : "clear";
}
