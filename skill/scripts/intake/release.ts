// The Site template's files exactly as a Template release tagged them, read from the release repo's
// git objects (never its working tree), so nothing committed after the tag, nothing untracked
// (node_modules, a build) and no local edit can reach a Course project.
import { spawnSync } from "node:child_process";
import { LedgerError } from "../ledger/file.ts";
import { TEMPLATE_DIR } from "../ledger/model.ts";

function git(repo: string, args: string[], input?: string): Buffer {
  const child = spawnSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) {
    throw new LedgerError("invalid", `git ${args.join(" ")} failed in ${repo}: ${child.stderr.toString().trim()}`);
  }
  return child.stdout;
}

/** Template-layer path (relative to `template/`) → its contents at `release`. */
export function templateAt(repo: string, release: string): Map<string, Buffer> {
  const tag = `refs/tags/${release}`;
  const known = spawnSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${tag}^{commit}`]);
  if (known.status !== 0) throw new LedgerError("invalid", `the release repo ${repo} has no tag ${release}`);

  const entries = git(repo, ["ls-tree", "-r", "-z", "--full-tree", tag, "--", TEMPLATE_DIR])
    .toString("utf8")
    .split("\0")
    .filter((line) => line !== "")
    .map((line) => {
      const [meta = "", path = ""] = line.split("\t");
      const [mode, type, sha] = meta.split(" ");
      if (type !== "blob" || mode === "120000") {
        throw new LedgerError(
          "invalid",
          `${path} at ${release} is a ${mode === "120000" ? "symlink" : type}, not a file`,
        );
      }
      return { path: path.slice(TEMPLATE_DIR.length + 1), sha: sha ?? "" };
    });
  if (entries.length === 0) throw new LedgerError("invalid", `${release} has no ${TEMPLATE_DIR}/ folder`);

  // One `cat-file --batch` for every blob: "<sha> blob <size>\n<contents>\n" each, in input order.
  const out = git(repo, ["cat-file", "--batch"], entries.map((e) => `${e.sha}\n`).join(""));
  const files = new Map<string, Buffer>();
  let at = 0;
  for (const { path, sha } of entries) {
    const header = out.subarray(at, out.indexOf(0x0a, at)).toString("utf8");
    const [gotSha, , size] = header.split(" ");
    if (gotSha !== sha) throw new Error(`git cat-file answered ${header} for ${sha}`);
    const start = at + header.length + 1;
    files.set(path, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return files;
}
