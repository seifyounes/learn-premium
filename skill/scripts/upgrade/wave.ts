// The Upgrade wave: the Course project's template layer moved to a newer Template release on its own
// branch, and merged to `main` only when every gate is green on it. Each step here is one command of
// the skill's Upgrade wave; the ledger's `upgrades` rows are its record. Content and course config are
// never touched except by a shipped migration, and a red wave leaves `main` on the pinned release.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOOKS_PATH } from "../intake/create.ts";
import { templateAt } from "../intake/release.ts";
import { OVERRIDES_DIR } from "../intake/scaffold.ts";
import { LedgerError } from "../ledger/file.ts";
import { mutate, requireLedger, runningUpgrade, templateHashes, verifyIntegrity } from "../ledger/ledger.ts";
import { current, TEMPLATE_DIR, type Ledger, type Upgrade } from "../ledger/model.ts";
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
