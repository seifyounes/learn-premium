"""The learn-premium machine install: lay it out, and check it at the start of every run.

The layout under the Claude folder (default ~/.claude):

    learn-premium/release   a git worktree of the repo, detached at a Template release tag
    learn-premium/state     the machine state folder
    learn-premium/venv      the one machine Python venv, synced from release/skill/uv.lock
    skills/learn-premium    a junction (a symlink off Windows) to release/skill

Standard library only: this runs before the venv exists.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Keep in step with @playwright/test in the Site template: browsers are per Playwright version.
PLAYWRIGHT_VERSION = "1.63.0"
RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


class InstallError(Exception):
    pass


class Layout:
    def __init__(self, claude_home):
        self.claude_home = Path(claude_home)
        self.root = self.claude_home / "learn-premium"
        self.release = self.root / "release"
        self.state = self.root / "state"
        self.venv = self.root / "venv"
        self.skill_link = self.claude_home / "skills" / "learn-premium"

    @property
    def venv_python(self):
        if sys.platform == "win32":
            return self.venv / "Scripts" / "python.exe"
        return self.venv / "bin" / "python"


def _git(cwd, *args):
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise InstallError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def release_tags(repo):
    """Every Template release tag in the repo, oldest first. Pre-release tags don't count."""
    tags = [t for t in _git(repo, "tag", "--list", "v*").splitlines() if RELEASE_TAG.match(t)]
    return sorted(tags, key=lambda t: tuple(int(n) for n in RELEASE_TAG.match(t).groups()))


def _common_dir(path):
    """The shared .git folder of a clone or any of its worktrees, or None outside a repo."""
    try:
        common = _git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
    except InstallError:
        return None
    return os.path.normcase(os.path.realpath(common))


def fetch_releases(repo):
    """Fetch origin's branches and tags. Moves no checkout: that is the installer's job alone."""
    _git(repo, "fetch", "--quiet", "--tags", "origin")


def _refuse_what_a_run_would_lose(repo, layout):
    """Stop before changing anything if the install would overwrite something it doesn't own."""
    if layout.release.exists():
        if _common_dir(layout.release) != _common_dir(repo):
            raise InstallError(f"{layout.release} exists but is not a worktree of {repo}; move it away.")
        if _git(layout.release, "status", "--porcelain", "--untracked-files=no"):
            raise InstallError(
                f"{layout.release} has local edits; commit them on a branch in {repo} or discard them."
            )
    if os.path.lexists(layout.skill_link) and not _is_link(layout.skill_link):
        raise InstallError(f"{layout.skill_link} is not a link to an install; move it away.")


def _checkout_release(repo, layout, tag):
    if layout.release.exists():
        _git(layout.release, "checkout", "--quiet", "--detach", tag)
    else:
        _git(repo, "worktree", "prune")
        _git(repo, "worktree", "add", "--detach", str(layout.release), tag)


def _sync_venv(layout):
    env = {**os.environ, "UV_PROJECT_ENVIRONMENT": str(layout.venv)}
    uv = shutil.which("uv")
    if not uv:
        raise InstallError("uv is not on PATH. Install it: winget install astral-sh.uv")
    result = subprocess.run(
        [uv, "sync", "--frozen", "--quiet", "--project", str(layout.release / "skill")],
        env=env, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise InstallError(f"uv sync failed: {result.stderr.strip()}")


def _is_link(path):
    return os.path.islink(path) or os.path.isjunction(path)


def _link_skill(layout):
    target = layout.release / "skill"
    if os.path.lexists(layout.skill_link):
        if os.path.realpath(layout.skill_link) == os.path.realpath(target):
            return
        # Removes the link itself, never what it points to.
        (os.rmdir if sys.platform == "win32" else os.unlink)(layout.skill_link)
    layout.skill_link.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        import _winapi

        _winapi.CreateJunction(str(target), str(layout.skill_link))
    else:
        os.symlink(target, layout.skill_link, target_is_directory=True)


def playwright_browsers():
    npx = shutil.which("npx")
    if not npx:
        raise InstallError("npx is not on PATH. Install Node.js LTS first.")
    result = subprocess.run(
        [npx, "--yes", f"playwright@{PLAYWRIGHT_VERSION}", "install", "chromium", "webkit"],
        check=False,
    )
    if result.returncode != 0:
        raise InstallError("Playwright browser install failed (see the output above).")


def install(repo, layout, install_browsers=playwright_browsers):
    """Bring the machine to the latest Template release. Safe to run again."""
    try:
        fetch_releases(repo)
    except InstallError as e:
        print(f"warning: {e}; installing from the release tags already fetched", file=sys.stderr)
    tags = release_tags(repo)
    if not tags:
        raise InstallError("No Template release tag yet (v1.2.3); cut one first (ticket #48).")
    _refuse_what_a_run_would_lose(repo, layout)
    _checkout_release(repo, layout, tags[-1])
    layout.state.mkdir(parents=True, exist_ok=True)
    _sync_venv(layout)
    _link_skill(layout)
    install_browsers()


def default_browsers_dir():
    """Where Playwright keeps its browsers, as Playwright itself resolves it."""
    if os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        return Path(os.environ["PLAYWRIGHT_BROWSERS_PATH"])
    if sys.platform == "win32":
        return Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def _release_at_head(layout):
    at_head = _git(layout.release, "tag", "--points-at", "HEAD").splitlines()
    tags = [t for t in release_tags(layout.release) if t in at_head]
    return tags[-1] if tags else None


def _venv_in_sync(layout):
    uv = shutil.which("uv")
    # `uv sync --check` exits 0 when it would only create an empty venv, so look for one first.
    if not uv or not layout.venv_python.is_file():
        return False
    env = {**os.environ, "UV_PROJECT_ENVIRONMENT": str(layout.venv)}
    result = subprocess.run(
        [uv, "sync", "--frozen", "--check", "--quiet", "--project", str(layout.release / "skill")],
        env=env, capture_output=True, text=True, check=False,
    )
    return result.returncode == 0


def check(layout, browsers_dir=None):
    """Report what the install lacks and how far it is behind origin's latest release.

    Fetches, but never moves the installed worktree: updating is the installer's job, run on
    the Owner's word.
    """
    browsers_dir = Path(browsers_dir) if browsers_dir else default_browsers_dir()
    missing = []
    report = {
        "ok": False,
        "missing": missing,
        "installed_release": None,
        "latest_release": None,
        "commits_behind": None,
        "releases_behind": None,
        "fetch_error": None,
    }

    if _common_dir(layout.release) is None:
        missing.append({"piece": "release", "detail": f"no worktree at {layout.release}"})
    else:
        installed = _release_at_head(layout)
        report["installed_release"] = installed
        if installed is None:
            head = _git(layout.release, "rev-parse", "--short", "HEAD")
            missing.append({"piece": "release",
                            "detail": f"HEAD {head} is not a Template release tag"})
        elif _git(layout.release, "status", "--porcelain", "--untracked-files=no"):
            missing.append({"piece": "release", "detail": "the installed release has local edits"})
        try:
            fetch_releases(layout.release)
        except InstallError as e:
            report["fetch_error"] = str(e)
        tags = release_tags(layout.release)
        if tags:
            report["latest_release"] = tags[-1]
        if installed and tags:
            report["commits_behind"] = int(
                _git(layout.release, "rev-list", "--count", f"HEAD..{tags[-1]}"))
            report["releases_behind"] = len(tags) - 1 - tags.index(installed)
        if not _venv_in_sync(layout):
            missing.append({"piece": "venv",
                            "detail": f"{layout.venv} is missing or differs from the lock file"})

    if not layout.state.is_dir():
        missing.append({"piece": "state", "detail": f"no state folder at {layout.state}"})
    if not (_is_link(layout.skill_link) and os.path.realpath(layout.skill_link)
            == os.path.realpath(layout.release / "skill")):
        missing.append({"piece": "skill link",
                        "detail": f"{layout.skill_link} does not link to {layout.release / 'skill'}"})
    for browser in ("chromium", "webkit"):
        if not any(browsers_dir.glob(f"{browser}-*")):
            missing.append({"piece": "browsers", "detail": f"no Playwright {browser} in {browsers_dir}"})

    report["ok"] = not missing
    report["installer"] = _installer_path(layout)
    return report


def _installer_path(layout):
    """The installer in the clone the install was made from, if it can still be found."""
    common = _common_dir(layout.release)
    name = "install.ps1" if sys.platform == "win32" else "install.sh"
    return str(Path(common).parent / name) if common else f"{name} in your learn-premium clone"


def _count(n, noun):
    return f"{n} {noun}" + ("" if n == 1 else "s")


def summary(report):
    """One line for the Owner: what's missing, or how far behind the install is."""
    if report["missing"]:
        pieces = ", ".join(dict.fromkeys(m["piece"] for m in report["missing"]))
        line = f"learn-premium install is incomplete, missing: {pieces}. Run the installer: " \
               f"{report['installer']}"
    elif report["releases_behind"]:
        line = (f"{_count(report['commits_behind'], 'commit')} / "
                f"{_count(report['releases_behind'], 'release')} behind: "
                f"{report['installed_release']} installed, {report['latest_release']} is out. "
                f"Updating is the Owner's call: re-run {report['installer']}.")
    else:
        line = f"learn-premium {report['installed_release']} is installed and up to date."
    if report["fetch_error"]:
        line += f" (Could not reach origin, so this may be stale: {report['fetch_error']})"
    return line


def main(argv=None):
    import argparse
    import json

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["install", "check"])
    parser.add_argument("--claude-home", default=Path.home() / ".claude", type=Path)
    parser.add_argument("--browsers-dir", type=Path, help="check only: Playwright's browser cache")
    args = parser.parse_args(argv)
    layout = Layout(args.claude_home)

    if args.command == "check":
        report = check(layout, browsers_dir=args.browsers_dir)
        print(summary(report))
        print(json.dumps(report, indent=2))
        return 0 if report["ok"] else 1

    repo = Path(__file__).resolve().parents[2]
    try:
        install(repo, layout)
    except InstallError as e:
        print(f"install failed: {e}", file=sys.stderr)
        return 1
    print(summary(check(layout)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
