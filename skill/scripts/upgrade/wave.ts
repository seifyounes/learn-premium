// The Upgrade wave: the Course project's template layer moved to a newer Template release on its own
// branch, and merged to `main` only when every gate is green on it. Each step here is one command of
// the skill's Upgrade wave; the ledger's `upgrades` rows are its record. Content and course config are
// never touched except by a shipped migration, and a red wave leaves `main` on the pinned release.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { HOOKS_PATH } from "../intake/create.ts";
import { templateAt } from "../intake/release.ts";
import { CONTENT_DIR, OVERRIDES_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { hashTree } from "../ledger/hash.ts";
import { mutate, requireLedger, runningUpgrade, templateHashes, verifyIntegrity } from "../ledger/ledger.ts";
import { current, TEMPLATE_DIR, type Ledger, type Upgrade } from "../ledger/model.ts";
import { moduleFolder, type Verifier } from "../wave/wave.ts";
import { heldReason, planUpgrade } from "./plan.ts";

const BRANCH = "main";

function git(project: string, args: string[]): { ok: boolean; out: string; err: string } {
  const child = spawnSync("git", ["-C", project, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (child.error !== undefined) throw child.error;
  return { ok: child.status === 0, out: child.stdout.trim(), err: child.stderr.trim() };
}

function checkedOutBranch(project: string): string | null {
  const head = git(project, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return head.ok ? head.out : null;
}

/** Refused unless `holder` holds the ledger lock: the same rule `mutate` applies to every ledger write. */
function assertHolder(ledger: Ledger, holder: string): void {
  if (ledger.lock?.holder === holder) return;
  const held = ledger.lock === null ? "nobody holds it" : `${ledger.lock.holder} holds it since ${ledger.lock.since}`;
  throw new LedgerError("refused", `${holder} doesn't hold the ledger lock: ${held}`);
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The running Upgrade wave, or a refusal saying there is none. */
function running(ledger: Ledger): Upgrade {
  const upgrade = runningUpgrade(ledger);
  if (upgrade === undefined) throw new LedgerError("refused", "no Upgrade wave is running: start one first");
  return upgrade;
}

/** Refused unless the Course project is checked out on the running wave's own branch. */
function onWaveBranch(project: string, upgrade: Upgrade): void {
  const branch = checkedOutBranch(project);
  if (branch !== upgrade.branch)
    throw new LedgerError(
      "refused",
      `the Course project is checked out on ${branch ?? "no branch"}, not the Upgrade wave's branch ${upgrade.branch}: switch to it first`,
    );
}

/**
 * Starts an Upgrade wave to `o.to`, on the Owner's yes (`o.answer`, in their words). Refused inside the
 * exam freeze, while any wave runs, off `main`, on a tree with uncommitted changes, or when the
 * template layer isn't the pinned release's. Records the wave, commits that on `main` and switches to the
 * wave's branch: everything after happens there, so `main` stays the pinned release until a green merge.
 */
export function startUpgrade(
  project: string,
  holder: string,
  o: { source: string; to: string; answer: string; today: string },
) {
  const ledger = requireLedger(project);
  assertHolder(ledger, holder);
  const upgrading = runningUpgrade(ledger);
  if (upgrading !== undefined)
    throw new LedgerError("refused", `the Upgrade wave ${upgrading.id} is already running: end or merge it first`);
  const waves = current(ledger.waves).filter((w) => w.state === "running");
  if (waves.length > 0)
    throw new LedgerError(
      "refused",
      `wave ${waves.map((w) => w.id).join(", ")} is running: the template layer can't move under it`,
    );
  const branch = checkedOutBranch(project);
  if (branch !== BRANCH)
    throw new LedgerError(
      "refused",
      `the Course project is on ${branch ?? "no branch"}: an Upgrade wave starts from ${BRANCH}`,
    );
  const status = git(project, ["status", "--porcelain"]);
  if (!status.ok) throw new LedgerError("refused", `can't read the Course project's git status: ${status.err}`);
  if (status.out !== "")
    throw new LedgerError(
      "refused",
      `the Course project has uncommitted changes (${status.out
        .split(/\r?\n/)
        .map((line) => line.slice(3))
        .join(", ")}): commit or discard them first`,
    );
  const integrity = verifyIntegrity(project);
  if (!integrity.intact)
    throw new LedgerError(
      "refused",
      `the template layer isn't the pinned release's (${[
        ...integrity.modified.map((p) => `modified ${p}`),
        ...integrity.added.map((p) => `added ${p}`),
        ...integrity.missing.map((p) => `missing ${p}`),
        ...integrity.unrecordedOverrides.map((p) => `unrecorded override ${p}`),
        ...integrity.missingOverrides.map((p) => `override ${p} missing`),
      ].join(", ")}): an upgrade would hide the edit`,
    );
  const { plan, reason } = planUpgrade(project, o.source, o.to, o.today);
  if (plan === null) throw new LedgerError("refused", `no Upgrade wave to ${o.to}: ${reason}`);
  if (plan.held) throw new LedgerError("refused", heldReason(plan));

  const files = Object.fromEntries([...templateAt(o.source, o.to)].map(([path, bytes]) => [path, sha256(bytes)]));
  // A checkout must not rewrite line endings: the pinned hashes are of the exact bytes.
  git(project, ["config", "core.autocrlf", "false"]);
  const base = git(project, ["rev-parse", "HEAD"]).out;
  const attempt = ledger.upgrades.filter((u) => u.to === o.to).length + 1;
  const id = `upgrade-${o.to}-${attempt}`;
  const waveBranch = `upgrade/${o.to}-${attempt}`;
  mutate(project, holder, (l) => {
    l.upgrades.push({
      id,
      from: plan.from,
      to: o.to,
      branch: waveBranch,
      base,
      answer: o.answer,
      state: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      commit: null,
      files,
      retire: plan.overridesRetired,
      kept: [],
      migrations: null,
      content: null,
      gateGap: null,
      superseded: null,
    });
  });
  const commit = git(project, ["add", "build-ledger.json", "build-records"]).ok
    ? git(project, ["commit", "-q", "-m", `chore: start the Upgrade wave to ${o.to}`])
    : { ok: false, err: "git add failed" };
  if (!commit.ok) {
    git(project, ["restore", "--source=HEAD", "--staged", "--worktree", "--", "build-ledger.json", "build-records"]);
    throw new LedgerError("refused", `the start commit failed, so the wave was not recorded: ${commit.err}`);
  }
  const switched = git(project, ["switch", "-c", waveBranch]);
  if (!switched.ok) throw new LedgerError("refused", `can't create the branch ${waveBranch}: ${switched.err}`);
  return {
    upgrade: id,
    branch: waveBranch,
    base,
    retire: plan.overridesRetired.map((r) => r.path),
    releases: plan.releases,
  };
}

/**
 * Re-copies the template layer to the target release's own files, on the wave's branch: every file
 * written as the release has it, every file the release dropped deleted, then the Course overrides the
 * release retires removed (those a gate failure put back, `kept`, stay). Installs and builds in the
 * template layer are not the release's and are left alone. Safe to run again.
 */
export function applyUpgrade(project: string, holder: string, source: string) {
  const ledger = requireLedger(project);
  assertHolder(ledger, holder);
  const upgrade = running(ledger);
  onWaveBranch(project, upgrade);
  const release = templateAt(source, upgrade.to);
  const offered = Object.fromEntries([...release].map(([path, bytes]) => [path, sha256(bytes)]));
  const differ = Object.keys({ ...offered, ...upgrade.files }).filter((path) => offered[path] !== upgrade.files[path]);
  if (differ.length > 0)
    throw new LedgerError(
      "refused",
      `${upgrade.to} in ${source} isn't the release this wave started from (differs in ${differ.slice(0, 5).join(", ")}): nothing was written`,
    );

  const root = join(project, TEMPLATE_DIR);
  let written = 0;
  for (const [path, bytes] of release) {
    const file = join(root, path);
    if (existsSync(file) && readFileSync(file).equals(bytes)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    written += 1;
  }
  const deleted = Object.keys(templateHashes(project)).filter((path) => !release.has(path));
  for (const path of deleted) rmSync(join(root, path), { force: true });
  // Git runs only an executable pre-commit hook; a file written from git's objects has no mode of its own on Windows.
  const hook = join(project, HOOKS_PATH, "pre-commit");
  if (existsSync(hook)) chmodSync(hook, 0o755);

  const after = templateHashes(project);
  const wrong = Object.keys({ ...after, ...upgrade.files }).filter((path) => after[path] !== upgrade.files[path]);
  if (wrong.length > 0)
    throw new LedgerError(
      "refused",
      `the template layer still isn't ${upgrade.to}'s after the copy: ${wrong.join(", ")}`,
    );

  const kept = new Set(upgrade.kept.map((k) => k.path));
  const dropped: string[] = [];
  for (const { path } of upgrade.retire) {
    const override = join(project, OVERRIDES_DIR, path);
    if (kept.has(path) || !existsSync(override)) continue;
    rmSync(override, { force: true });
    dropped.push(path);
  }
  return { written, deleted: deleted.sort(), dropped };
}

/** A finding that makes the wave red but isn't a refusal: a migration threw. */
export class UpgradeProblem extends Error {}

/** The Gate reports are committed with the content but are the gates' record of it, not content. */
const GATE_REPORTS = "build-records/gate-reports/";

/** The content's files and their hashes, without its Gate reports. */
export function contentHashes(project: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hashTree(join(project, CONTENT_DIR))).filter(([path]) => !path.startsWith(GATE_REPORTS)),
  );
}

/** The files under `folders` that differ from `base`'s: edited, deleted or added, committed or not (Gate reports aside). */
function changedSince(project: string, base: string, ...folders: string[]): string[] {
  const exclude = `:(exclude)${CONTENT_DIR}/${GATE_REPORTS}`;
  const changed = git(project, ["diff", "--name-only", base, "--", ...folders, exclude]);
  const untracked = git(project, ["status", "--porcelain", "--untracked-files=all", "--", ...folders, exclude]);
  if (!changed.ok || !untracked.ok)
    throw new LedgerError("refused", `can't compare ${folders.join(", ")} with ${base}`);
  return [
    ...changed.out.split(/\r?\n/),
    ...untracked.out
      .split(/\r?\n/)
      .filter((line) => line.startsWith("??"))
      .map((line) => line.slice(3)),
  ].filter((path) => path !== "");
}

/**
 * Runs the migrations the target release ships for the majors after the pinned release, oldest first,
 * on the Course's content and course config: the one thing that may change them in an upgrade. The
 * content has to be what it was when the wave started, and the template layer the release's own.
 * Records what ran and the content's hashes after, which the merge gate holds the content to. A
 * migration that throws is reported (the wave is red), and nothing is recorded.
 */
export async function migrateUpgrade(project: string, holder: string) {
  const ledger = requireLedger(project);
  assertHolder(ledger, holder);
  const upgrade = running(ledger);
  onWaveBranch(project, upgrade);
  const layer = templateHashes(project);
  if (Object.keys({ ...layer, ...upgrade.files }).some((path) => layer[path] !== upgrade.files[path]))
    throw new LedgerError("refused", `the template layer isn't ${upgrade.to}'s yet: run apply first`);
  if (upgrade.migrations !== null)
    throw new LedgerError(
      "refused",
      `the migrations already ran for ${upgrade.id}: a second run would apply them twice; end the wave failed and start again`,
    );
  const edited = changedSince(project, upgrade.base, CONTENT_DIR);
  if (edited.length > 0)
    throw new LedgerError(
      "refused",
      `the content has changed since the wave started (${edited.join(", ")}): only a migration may change it; restore it with git checkout ${upgrade.base} -- ${CONTENT_DIR}`,
    );
  const runner = join(project, TEMPLATE_DIR, "migrations", "runner.ts");
  let ran: { major: number; describe: string }[] = [];
  // A release from before migrations were shipped has no runner, and so no migration to run.
  if (existsSync(runner)) {
    const { runMigrations } = (await import(/* @vite-ignore */ pathToFileURL(runner).href)) as {
      runMigrations(options: { contentDir: string; from: string; to: string }): Promise<typeof ran>;
    };
    try {
      ran = await runMigrations({ contentDir: join(project, CONTENT_DIR), from: upgrade.from, to: upgrade.to });
    } catch (error) {
      throw new UpgradeProblem((error as Error).message);
    }
  }
  const content = contentHashes(project);
  mutate(project, holder, (l) => {
    const row = current(l.upgrades).find((u) => u.id === upgrade.id);
    if (row === undefined) throw new LedgerError("invalid", `no current Upgrade wave ${upgrade.id}`);
    row.migrations = ran;
    row.content = content;
  });
  return { migrations: ran };
}

/** The Course's override files at `base`, relative to the overrides area (its placeholder left out). */
function overridesAt(project: string, base: string): string[] {
  const listed = git(project, ["ls-tree", "-r", "--name-only", base, "--", OVERRIDES_DIR]);
  if (!listed.ok) throw new LedgerError("refused", `can't list the overrides at ${base}: ${listed.err}`);
  return listed.out
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => line.slice(OVERRIDES_DIR.length + 1))
    .filter((path) => path !== ".gitkeep");
}

/** A file's bytes as `base` committed them. */
function bytesAt(project: string, base: string, path: string): Buffer {
  const child = spawnSync("git", ["-C", project, "show", `${base}:${path}`], { maxBuffer: 1 << 28 });
  if (child.error !== undefined) throw child.error;
  return child.status === 0 ? child.stdout : Buffer.alloc(0);
}

/** The module-point Gate report's preview URL for a Module, or null. */
function previewOf(project: string, folder: string): string | null {
  try {
    const report = JSON.parse(
      readFileSync(join(project, CONTENT_DIR, GATE_REPORTS, `module-${folder}.json`), "utf8"),
    ) as { url?: unknown };
    return typeof report.url === "string" ? report.url : null;
  } catch {
    return null;
  }
}

/**
 * Every reason the running Upgrade wave may not merge yet; none means it may. The branch is checked
 * out and clean, `main` is behind it, the template layer is the release's own, the overrides area is the
 * Course's minus the retired ones (kept ones byte for byte), the migrations ran and the content is as
 * they left it. Only then are the Course's own gates asked, and they decide the rest: every Module's
 * per-job and per-Module gates, the per-deploy gate, each Module's gates run on the Vercel preview.
 */
export function upgradeProblems(project: string, verifier: Verifier): string[] {
  const ledger = requireLedger(project);
  const upgrade = running(ledger);
  const problems: string[] = [];

  // Every check below reads the checked-out tree and HEAD: they must be the wave's branch.
  const branch = checkedOutBranch(project);
  if (branch !== upgrade.branch)
    problems.push(
      `the Course project is checked out on ${branch ?? "no branch"}, not the Upgrade wave's branch ${upgrade.branch}: check it out and run ready again`,
    );
  const status = git(project, ["status", "--porcelain"]);
  if (!status.ok) problems.push("can't read the Course project's git status");
  else if (status.out !== "")
    problems.push(
      `the Course project has uncommitted changes (${status.out
        .split(/\r?\n/)
        .map((line) => line.slice(3))
        .join(", ")}): commit them (and re-run the gates if they matter), then run ready again`,
    );
  if (!git(project, ["merge-base", "--is-ancestor", upgrade.base, "HEAD"]).ok)
    problems.push(`the wave's base ${upgrade.base} isn't in this branch's history`);
  if (!git(project, ["merge-base", "--is-ancestor", `refs/heads/${BRANCH}`, "HEAD"]).ok)
    problems.push(`${BRANCH} has commits the Upgrade wave's branch doesn't: it moved since the wave started`);

  const layer = templateHashes(project);
  const changes = Object.keys({ ...layer, ...upgrade.files }).flatMap((path) =>
    layer[path] === upgrade.files[path]
      ? []
      : [`${path in upgrade.files ? (path in layer ? "modified" : "missing") : "added"} ${path}`],
  );
  if (changes.length > 0)
    problems.push(
      `the template layer isn't ${upgrade.to}'s: ${changes.join(", ")}; its gates can't verify this wave (a fix goes in as a Course override)`,
    );

  const kept = new Set(upgrade.kept.map((k) => k.path));
  const retired = new Set(upgrade.retire.map((r) => r.path));
  const expected = overridesAt(project, upgrade.base).filter((path) => kept.has(path) || !retired.has(path));
  const onDisk = Object.keys(hashTree(join(project, OVERRIDES_DIR))).filter((path) => path !== ".gitkeep");
  for (const path of onDisk.filter((p) => !expected.includes(p)))
    problems.push(
      `${OVERRIDES_DIR}/${path} is a Course override ${upgrade.to} retires: drop it, or keep it with a reopened gate gap`,
    );
  for (const path of expected) {
    const file = join(project, OVERRIDES_DIR, path);
    if (!existsSync(file)) problems.push(`${OVERRIDES_DIR}/${path} is missing: only a retired override is dropped`);
    else if (!readFileSync(file).equals(bytesAt(project, upgrade.base, `${OVERRIDES_DIR}/${path}`)))
      problems.push(`${OVERRIDES_DIR}/${path} differs from the Course's override at the wave's start`);
    if (!(path in upgrade.files))
      problems.push(`${OVERRIDES_DIR}/${path} shadows a file ${upgrade.to} no longer has: it can't be kept`);
  }

  if (upgrade.migrations === null) problems.push("the migrations haven't run: run migrate");
  if (upgrade.content !== null) {
    const now = contentHashes(project);
    const edited = Object.keys({ ...now, ...upgrade.content }).filter((path) => now[path] !== upgrade.content?.[path]);
    if (edited.length > 0)
      problems.push(
        `the content changed since the migrations ran (${edited.join(", ")}): only a migration may change it`,
      );
  }

  // The template layer's own gates verify the branch: an edited layer could verify anything.
  if (changes.length > 0) return problems;
  const modules = current(ledger.modules)
    .map((row) => moduleFolder(ledger, row.id).folder)
    .filter((folder) => existsSync(join(project, CONTENT_DIR, "modules", folder)))
    .sort();
  for (const folder of modules) {
    for (const point of ["job", "module"] as const) {
      const verdict = verifier.verify(project, point, folder);
      if (!verdict.green)
        problems.push(`the ${point} gates aren't green for ${folder}: ${verdict.problems.join("; ") || "red"}`);
    }
    const preview = previewOf(project, folder);
    if (preview === null || !/^https:\/\//.test(preview))
      problems.push(
        `the module gates for ${folder} didn't run on a Vercel preview: run the module point with --url <preview URL>`,
      );
  }
  const deploy = verifier.verify(project, "deploy", undefined);
  if (!deploy.green) problems.push(`the deploy gates aren't green for HEAD: ${deploy.problems.join("; ") || "red"}`);
  return problems;
}

/**
 * Merges the running Upgrade wave when `upgradeProblems` finds none: `main` fast-forwards to the
 * branch's tip (compare-and-swap, so it never moves a `main` someone else moved), the branch is checked
 * out as `main`, and the ledger moves to the release: its pinned template hashes are the release's, each
 * retired override's row is history. The caller commits that ledger and pushes `main`.
 */
export function mergeUpgrade(project: string, holder: string, verifier: Verifier) {
  assertHolder(requireLedger(project), holder);
  const problems = upgradeProblems(project, verifier);
  if (problems.length > 0) return { merged: false, problems };
  const upgrade = running(requireLedger(project));
  const tip = git(project, ["rev-parse", "HEAD"]).out;
  const oldMain = git(project, ["rev-parse", `refs/heads/${BRANCH}`]).out;
  const moved = git(project, ["update-ref", `refs/heads/${BRANCH}`, tip, oldMain]);
  if (!moved.ok) return { merged: false, problems: [`couldn't move ${BRANCH} to ${tip}: ${moved.err}`] };
  const switched = git(project, ["switch", BRANCH]);
  if (!switched.ok) {
    git(project, ["update-ref", `refs/heads/${BRANCH}`, oldMain, tip]);
    return { merged: false, problems: [`couldn't switch to ${BRANCH}: ${switched.err}`] };
  }
  const kept = new Set(upgrade.kept.map((k) => k.path));
  mutate(project, holder, (l) => {
    const at = new Date().toISOString();
    l.template.release = upgrade.to;
    l.template.files = upgrade.files;
    for (const row of current(l.template.overrides)) {
      if (upgrade.retire.some((r) => r.path === row.path) && !kept.has(row.path))
        row.superseded = { at, reason: `retired by ${upgrade.to}: gate gap #${row.gateGap} closed` };
    }
    const wave = current(l.upgrades).find((u) => u.id === upgrade.id);
    if (wave === undefined) throw new LedgerError("invalid", `no current Upgrade wave ${upgrade.id}`);
    wave.state = "merged";
    wave.endedAt = at;
    wave.commit = tip;
  });
  return { merged: true, problems: [], commit: tip };
}

/**
 * Ends the running Upgrade wave as failed, from `main`: the Course stays on its release, `main`'s
 * template layer, overrides and content untouched, and a gate gap this wave's own run found is filed
 * on the tracker. A red wave that leaves no gate gap would repeat itself.
 */
export function endUpgradeFailed(project: string, holder: string, gateGap: string): void {
  const ledger = requireLedger(project);
  assertHolder(ledger, holder);
  const upgrade = running(ledger);
  const branch = checkedOutBranch(project);
  if (branch !== BRANCH)
    throw new LedgerError(
      "refused",
      `the Course project is on ${branch ?? "no branch"}: a red wave ends from ${BRANCH}, after the branch is committed`,
    );
  const changed = changedSince(project, upgrade.base, TEMPLATE_DIR, OVERRIDES_DIR, CONTENT_DIR);
  if (changed.length > 0)
    throw new LedgerError(
      "refused",
      `${BRANCH} isn't the pinned release's: ${changed.join(", ")} (the template layer, the overrides and the content stay as they were)`,
    );
  const integrity = verifyIntegrity(project);
  if (!integrity.intact)
    throw new LedgerError("refused", `the template layer isn't the pinned release's: run the integrity check`);
  const gap = current(ledger.gateGaps).find((g) => g.id === gateGap);
  if (gap === undefined) throw new LedgerError("invalid", `no gate gap ${gateGap} in the ledger`);
  if (gap.issue === null)
    throw new LedgerError(
      "refused",
      `gate gap ${gateGap} isn't filed on the tracker yet: file it with the gate-gap step`,
    );
  if (gap.recordedAt < upgrade.startedAt)
    throw new LedgerError(
      "refused",
      `gate gap ${gateGap} was recorded before this wave started: a red wave ends with a gate gap its own run found`,
    );
  mutate(project, holder, (l) => {
    const wave = current(l.upgrades).find((u) => u.id === upgrade.id);
    if (wave === undefined) throw new LedgerError("invalid", `no current Upgrade wave ${upgrade.id}`);
    wave.state = "failed";
    wave.endedAt = new Date().toISOString();
    wave.gateGap = gateGap;
  });
}
