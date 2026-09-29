"""Synthetic git fixtures for the installer tests: an origin with Template release tags and a
clone of it standing in for the Owner's learn-premium checkout. No real Materials, no network."""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skill" / "scripts"))

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


class FixtureRepo:
    """A bare origin plus a working clone. Commits and tags go to the clone and are pushed."""

    def __init__(self, root: Path):
        self.origin = root / "origin.git"
        self.clone = root / "clone"
        subprocess.run(["git", "init", "--bare", "-b", "main", str(self.origin)], check=True,
                       capture_output=True)
        subprocess.run(["git", "clone", str(self.origin), str(self.clone)], check=True,
                       capture_output=True)
        git(self.clone, "config", "user.email", "fixture@example.test")
        git(self.clone, "config", "user.name", "Fixture")
        git(self.clone, "config", "commit.gpgsign", "false")
        skill = self.clone / "skill"
        skill.mkdir()
        (skill / "SKILL.md").write_text("---\nname: learn-premium\n---\nfixture\n")
        (skill / "pyproject.toml").write_text(EMPTY_PYPROJECT)
        subprocess.run(["uv", "lock", "--project", str(skill), "--quiet"], check=True)
        self.commit("initial")

    def commit(self, message, path="notes.txt"):
        f = self.clone / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text((f.read_text() if f.exists() else "") + message + "\n")
        git(self.clone, "add", "-A")
        git(self.clone, "commit", "-m", message)
        git(self.clone, "push", "-q", "origin", "HEAD:main")

    def tag(self, name):
        git(self.clone, "tag", name)
        git(self.clone, "push", "-q", "origin", name)

    def release_elsewhere(self, name, commits=1):
        """Push `commits` new commits and a release tag to origin from another checkout, so the
        Owner's clone and install only learn about them by fetching."""
        other = self.origin.parent / f"elsewhere-{name}"
        subprocess.run(["git", "clone", "-q", str(self.origin), str(other)], check=True)
        git(other, "config", "user.email", "fixture@example.test")
        git(other, "config", "user.name", "Fixture")
        git(other, "config", "commit.gpgsign", "false")
        for i in range(commits):
            (other / "notes.txt").write_text(f"{name} {i}\n")
            git(other, "commit", "-qam", f"{name} work {i}")
        git(other, "tag", name)
        git(other, "push", "-q", "origin", "HEAD:main", name)
        return git(other, "rev-parse", name)


@pytest.fixture
def repo(tmp_path):
    return FixtureRepo(tmp_path / "repos")


@pytest.fixture
def claude_home(tmp_path):
    home = tmp_path / "claude-home"
    home.mkdir()
    return home


class FakeBrowsers:
    """Stands in for Playwright's browser download: records calls and lays down the folders a
    real `playwright install chromium webkit` leaves in its cache."""

    def __init__(self, cache: Path):
        self.cache = cache
        self.calls = 0

    def __call__(self):
        self.calls += 1
        for name in ("chromium-1200", "webkit-2200"):
            (self.cache / name).mkdir(parents=True, exist_ok=True)


@pytest.fixture
def browsers(tmp_path):
    return FakeBrowsers(tmp_path / "ms-playwright")
