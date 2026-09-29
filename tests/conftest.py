"""Synthetic fixtures for the installer tests: an origin with Template release tags, a clone of it
standing in for the Owner's learn-premium checkout, a throwaway Claude folder and a fake `npx`.
No real Materials, no network."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "skill" / "scripts"
sys.path.insert(0, str(SCRIPTS))

EMPTY_PYPROJECT = """\
[project]
name = "fixture-venv"
version = "0.0.0"
requires-python = ">=3.11"
dependencies = []
"""


def git(cwd, *args):
    return subprocess.run(
        ["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def _clone(origin, path):
    subprocess.run(["git", "clone", "-q", str(origin), str(path)], check=True)
    git(path, "config", "user.email", "fixture@example.test")
    git(path, "config", "user.name", "Fixture")
    git(path, "config", "commit.gpgsign", "false")


class FixtureRepo:
    """A bare origin plus a working clone. The clone carries this repo's real installer script,
    so a release tag holds the installer code that the install runs from."""

    def __init__(self, root: Path):
        self.origin = root / "origin.git"
        self.clone = root / "clone"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)],
                       check=True)
        _clone(self.origin, self.clone)
        skill = self.clone / "skill"
        (skill / "scripts").mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: learn-premium\n---\nfixture\n")
        (skill / "pyproject.toml").write_text(EMPTY_PYPROJECT)
        shutil.copy(SCRIPTS / "machine_install.py", skill / "scripts")
        (self.clone / ".gitignore").write_text("__pycache__/\n")
        subprocess.run(["uv", "lock", "--project", str(skill), "--quiet"], check=True)
        self.commit("initial")

    def commit(self, message, path="notes.txt"):
        f = self.clone / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text((f.read_text() if f.exists() else "") + message + "\n")
        self._commit_all(message)

    def pin_playwright(self, version):
        script = self.clone / "skill" / "scripts" / "machine_install.py"
        text = script.read_text()
        start = text.index('PLAYWRIGHT_VERSION = "')
        end = text.index('"', start + len('PLAYWRIGHT_VERSION = "'))
        script.write_text(f'{text[:start]}PLAYWRIGHT_VERSION = "{version}{text[end:]}')
        self._commit_all(f"pin Playwright {version}")

    def _commit_all(self, message):
        git(self.clone, "add", "-A")
        git(self.clone, "commit", "-q", "-m", message)
        git(self.clone, "push", "-q", "origin", "HEAD:main")

    def tag(self, name, push=True):
        git(self.clone, "tag", name)
        if push:
            git(self.clone, "push", "-q", "origin", name)

    def release_elsewhere(self, name, commits=1, move=False):
        """Push `commits` new commits and a release tag to origin from another checkout, so the
        Owner's clone and install only learn about them by fetching. `move` re-points a tag
        origin already has."""
        other = self.origin.parent / f"elsewhere-{name}-{len(list(self.origin.parent.iterdir()))}"
        _clone(self.origin, other)
        for i in range(commits):
            (other / "notes.txt").write_text(f"{name} {i}\n")
            git(other, "commit", "-qam", f"{name} work {i}")
        git(other, "tag", *(["-f"] if move else []), name)
        git(other, "push", "-q", *(["-f"] if move else []), "origin", "HEAD:main", name)
        return git(other, "rev-parse", name)


@pytest.fixture
def repo(tmp_path):
    return FixtureRepo(tmp_path / "repos")


@pytest.fixture
def claude_home(tmp_path):
    home = tmp_path / "claude-home"
    home.mkdir()
    return home


FAKE_NPX = r'''
import json, os, sys
from pathlib import Path

args = sys.argv[1:]
with open(os.environ["FAKE_NPX_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
version = next(a.split("@", 1)[1] for a in args if a.startswith("playwright@"))
cache = Path(os.environ["PLAYWRIGHT_BROWSERS_PATH"])
for browser in ("chromium", "webkit"):
    location = cache / f"{browser}-{version}"
    if "--dry-run" in args:
        print(f"{browser} (playwright {browser} v{version})")
        print(f"  Install location:    {location}")
    else:
        location.mkdir(parents=True, exist_ok=True)
'''


class FakeNpx:
    """An `npx` on PATH that plays Playwright's browser installer: it lays down one folder per
    browser named after the pinned version, lists them for --dry-run, and logs every call."""

    def __init__(self, root: Path, monkeypatch):
        self.cache = root / "ms-playwright"
        self.log = root / "npx-calls.jsonl"
        bin_dir = root / "bin"
        bin_dir.mkdir()
        script = bin_dir / "fake_npx.py"
        script.write_text(FAKE_NPX)
        (bin_dir / "npx.cmd").write_text(f'@"{sys.executable}" "{script}" %*\r\n')
        monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(self.cache))
        monkeypatch.setenv("FAKE_NPX_LOG", str(self.log))

    def installs(self):
        """The Playwright versions each real (not --dry-run) call installed browsers for."""
        if not self.log.exists():
            return []
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [next(a for a in c if a.startswith("playwright@")).split("@", 1)[1]
                for c in calls if "--dry-run" not in c]


@pytest.fixture
def npx(tmp_path, monkeypatch):
    return FakeNpx(tmp_path, monkeypatch)
