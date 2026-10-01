"""The learn-premium machine install: lay it out, and check it at the start of every run.

The layout under the Claude folder (default ~/.claude):

    learn-premium/release   a git worktree of the repo, detached at a Template release tag
    learn-premium/state     the machine state folder
    learn-premium/venv      the one machine Python venv, synced from release/skill/uv.lock
    skills/learn-premium    a junction to release/skill

The install runs in two stages so the machine is set up by the release's own code, never by
whatever the Owner's clone has checked out. `install` (install.ps1, from the clone) fetches origin
and moves the release worktree to origin's latest Template release tag, then hands over to that
worktree's copy of this script, whose `finish` lays out the rest.

Windows only (only the Owner's Windows machine builds) and standard library only (it runs before
the venv exists).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Keep in step with playwright in the Site template: browsers are per Playwright version.
PLAYWRIGHT_VERSION = "1.63.0"
RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


class InstallError(Exception):
    pass


class Layout:
    def __init__(self, claude_home):
        self.claude_home = Path(claude_home)
        self.root = self.claude_home / "learn-premium"
        self.release = self.root / "release"
        self.skill_dir = self.release / "skill"
        self.state = self.root / "state"
        self.venv = self.root / "venv"
        self.venv_python = self.venv / "Scripts" / "python.exe"
        self.skill_link = self.claude_home / "skills" / "learn-premium"


def _run(program, *args, **kwargs):
    """Run a program found on PATH (so npx.cmd resolves), without raising on its exit code."""
    exe = shutil.which(program)
    if not exe:
        raise InstallError(f"{program} is not on PATH (see docs/install.md, Prerequisites).")
    return subprocess.run([exe, *args], check=False, **kwargs)


def _git(cwd, *args):
    result = _run("git", "-C", str(cwd), *args, capture_output=True, text=True)
    if result.returncode != 0:
        raise InstallError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _semver(tag):
    return tuple(int(n) for n in RELEASE_TAG.match(tag).groups())


def _release_tags(names):
    """Template release tags among `names`, oldest first. Pre-release tags don't count."""
    return sorted((n for n in names if RELEASE_TAG.match(n)), key=_semver)


def fetch_releases(repo):
    """Fetch origin, and return origin's Template release tags, oldest first.

    Tags are fetched with --force so a tag re-pointed on origin is followed. Tags that exist only
    in a local clone never count: a release is what reached origin. Moves no checkout.
    """
    try:
        _git(repo, "fetch", "--quiet", "--tags", "--force", "origin")
        refs = _git(repo, "ls-remote", "--tags", "--refs", "origin")
    except InstallError as e:
        raise InstallError(f"could not fetch origin: {e}") from None
    return _release_tags(line.split("refs/tags/", 1)[1] for line in refs.splitlines())


def _common_dir(path):
    """The shared .git folder of a clone or any of its worktrees, or None outside a repo."""
    try:
        common = _git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
    except InstallError:
        return None
    return os.path.normcase(os.path.realpath(common))


def _has_local_edits(worktree):
    return bool(_git(worktree, "status", "--porcelain", "--untracked-files=no"))


def _is_link(path):
    return os.path.islink(path) or os.path.isjunction(path)


def _skill_linked(layout):
    return _is_link(layout.skill_link) and (
        os.path.realpath(layout.skill_link) == os.path.realpath(layout.skill_dir))


def _refuse_what_a_run_would_lose(repo, layout):
    """Stop before changing anything if the install would overwrite something it doesn't own."""
    if layout.release.exists():
        if _common_dir(layout.release) != _common_dir(repo):
            raise InstallError(f"{layout.release} exists but is not a worktree of {repo}; "
                               "move it away.")
        if _has_local_edits(layout.release):
            raise InstallError(f"{layout.release} has local edits; commit them on a branch in "
                               f"{repo} or discard them.")
    if os.path.lexists(layout.skill_link) and not _is_link(layout.skill_link):
        raise InstallError(f"{layout.skill_link} is not a link to an install; move it away.")


def _checkout_release(repo, layout, tag):
    if layout.release.exists():
        _git(layout.release, "checkout", "--quiet", "--detach", tag)
    else:
        _git(repo, "worktree", "prune")
        _git(repo, "worktree", "add", "--quiet", "--detach", str(layout.release), tag)


def _uv_sync(layout, *extra):
    """`uv sync` of the machine venv from the release's lock file; returns the finished process."""
    return _run("uv", "sync", "--frozen", "--quiet", "--project", str(layout.skill_dir), *extra,
                env={**os.environ, "UV_PROJECT_ENVIRONMENT": str(layout.venv)},
                capture_output=True, text=True)


def _link_skill(layout):
    if _skill_linked(layout):
        return
    if os.path.lexists(layout.skill_link):
        os.rmdir(layout.skill_link)  # removes the link itself, never what it points to
    layout.skill_link.parent.mkdir(parents=True, exist_ok=True)
    import _winapi

    _winapi.CreateJunction(str(layout.skill_dir), str(layout.skill_link))


def _playwright(*args, **kwargs):
    return _run("npx", "--yes", f"playwright@{PLAYWRIGHT_VERSION}", "install", *args,
                "chromium", "webkit", **kwargs)


def install(repo, layout):
    """Stage 1: bring the release worktree to origin's latest Template release, then hand over
    to that release's own copy of this script. Safe to run again."""
    tags = fetch_releases(repo)
    if not tags:
        raise InstallError("No Template release tag yet (vX.Y.Z); cut one first.")
    _refuse_what_a_run_would_lose(repo, layout)
    _checkout_release(repo, layout, tags[-1])
    result = subprocess.run(
        [sys.executable, str(layout.skill_dir / "scripts" / "machine_install.py"), "finish",
         "--claude-home", str(layout.claude_home)],
        check=False,
    )
    if result.returncode != 0:
        raise InstallError(f"finishing the install at {tags[-1]} failed (see the output above).")


def finish(layout):
    """Stage 2, run from the release worktree: state folder, venv, skill junction, browsers."""
    layout.state.mkdir(parents=True, exist_ok=True)
    synced = _uv_sync(layout)
    if synced.returncode != 0:
        raise InstallError(f"uv sync failed: {synced.stderr.strip()}")
    _link_skill(layout)
    if _playwright().returncode != 0:
        raise InstallError("Playwright browser install failed (see the output above).")


def _missing_browsers():
    """Install locations Playwright needs for the pinned version that aren't on disk."""
    try:
        dry_run = _playwright("--dry-run", capture_output=True, text=True)
    except InstallError as e:
        return [str(e)]
    if dry_run.returncode != 0:
        return [f"playwright install --dry-run failed: {dry_run.stderr.strip()}"]
    locations = [line.split(":", 1)[1].strip() for line in dry_run.stdout.splitlines()
                 if line.strip().startswith("Install location:")]
    if not locations:
        return ["playwright install --dry-run listed no browsers"]
    return [f"no Playwright {PLAYWRIGHT_VERSION} browser at {p}" for p in locations
            if not Path(p).is_dir()]


def check(layout):
    """Report what the install lacks and how far it is behind origin's latest release.

    Fetches, but never moves the installed worktree: only an installer run the Owner asks for
    moves it to a newer release.
    """
    missing = []
    report = {
        "ok": False,
        "missing": missing,
        "installed_release": None,
        "latest_release": None,
        "commits_behind": None,
        "releases_behind": None,
        "fetch_error": None,
        "installer": None,
    }

    def lacks(piece, detail):
        missing.append({"piece": piece, "detail": detail})

    common = _common_dir(layout.release)
    if common is None:
        lacks("release", f"no worktree at {layout.release}")
    else:
        at_head = _release_tags(_git(layout.release, "tag", "--points-at", "HEAD").splitlines())
        installed = report["installed_release"] = at_head[-1] if at_head else None
        if installed is None:
            head = _git(layout.release, "rev-parse", "--short", "HEAD")
            lacks("release", f"HEAD {head} is not a Template release tag")
        elif _has_local_edits(layout.release):
            lacks("release", "the installed release has local edits")
        try:
            tags = fetch_releases(layout.release)
        except InstallError as e:
            report["fetch_error"] = str(e)
            tags = []
        if tags:
            report["latest_release"] = tags[-1]
        if installed and tags:
            report["commits_behind"] = int(
                _git(layout.release, "rev-list", "--count", f"HEAD..{tags[-1]}"))
            report["releases_behind"] = sum(_semver(t) > _semver(installed) for t in tags)
        # `uv sync --check` exits 0 when it would only create an empty venv, so look for one too.
        if not layout.venv_python.is_file() or _uv_sync(layout, "--check").returncode != 0:
            lacks("venv", f"{layout.venv} is missing or differs from the lock file")

    if not layout.state.is_dir():
        lacks("state", f"no state folder at {layout.state}")
    if not _skill_linked(layout):
        lacks("skill link", f"{layout.skill_link} does not link to {layout.skill_dir}")
    for detail in _missing_browsers():
        lacks("browsers", detail)

    report["ok"] = not missing
    report["installer"] = (str(Path(common).parent / "install.ps1") if common
                           else "install.ps1 in your learn-premium clone")
    return report


def _count(n, noun):
    return f"{n} {noun}" + ("" if n == 1 else "s")


def summary(report):
    """One line for the Owner: what's missing, or how far behind the install is."""
    if report["missing"]:
        pieces = ", ".join(dict.fromkeys(m["piece"] for m in report["missing"]))
        line = (f"learn-premium install is incomplete, missing: {pieces}. Run the installer: "
                f"{report['installer']}")
    elif report["releases_behind"]:
        line = (f"{_count(report['commits_behind'], 'commit')} / "
                f"{_count(report['releases_behind'], 'release')} behind: "
                f"{report['installed_release']} installed, {report['latest_release']} is out. "
                f"Moving to it is the Owner's call: re-run {report['installer']}.")
    else:
        line = f"learn-premium {report['installed_release']} is installed."
    if report["fetch_error"]:
        line += f" (Couldn't reach origin, so it may be behind: {report['fetch_error']})"
    return line


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["install", "finish", "check"])
    parser.add_argument("--claude-home", default=Path.home() / ".claude", type=Path)
    args = parser.parse_args(argv)
    layout = Layout(args.claude_home)

    if args.command == "check":
        report = check(layout)
        print(summary(report))
        print(json.dumps(report, indent=2))
        return 0 if report["ok"] else 1

    try:
        if args.command == "finish":
            finish(layout)
            return 0
        install(Path(__file__).resolve().parents[2], layout)
    except InstallError as e:
        print(f"install failed: {e}", file=sys.stderr)
        return 1
    print(summary(check(layout)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
