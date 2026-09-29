"""The install check a /learn-premium run starts with: what's missing, and how far behind it is."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import git
from machine_install import Layout, check, install


@pytest.fixture
def installed(repo, claude_home, browsers):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    install(repo.clone, layout, install_browsers=browsers)
    return layout


def test_a_complete_install_at_the_latest_release_is_ok(installed, browsers):
    report = check(installed, browsers_dir=browsers.cache)

    assert report["ok"] is True
    assert report["missing"] == []
    assert report["installed_release"] == "v0.1.0"
    assert report["latest_release"] == "v0.1.0"
    assert (report["commits_behind"], report["releases_behind"]) == (0, 0)


def _remove_link(path):
    (os.rmdir if os.name == "nt" else os.unlink)(path)


@pytest.mark.parametrize("piece, break_it", [
    ("release", lambda layout, browsers: shutil.rmtree(layout.release)),
    ("state", lambda layout, browsers: shutil.rmtree(layout.state)),
    ("venv", lambda layout, browsers: shutil.rmtree(layout.venv)),
    ("skill link", lambda layout, browsers: _remove_link(layout.skill_link)),
    ("browsers", lambda layout, browsers: shutil.rmtree(browsers.cache / "webkit-2200")),
])
def test_each_missing_piece_is_detected(installed, browsers, piece, break_it):
    break_it(installed, browsers)

    report = check(installed, browsers_dir=browsers.cache)

    assert report["ok"] is False
    assert piece in [m["piece"] for m in report["missing"]]


def test_a_newer_release_on_origin_is_reported_and_never_pulled(repo, installed, browsers):
    installed_head = git(installed.release, "rev-parse", "HEAD")
    repo.release_elsewhere("v0.2.0", commits=2)
    repo.release_elsewhere("v0.3.0", commits=1)

    report = check(installed, browsers_dir=browsers.cache)

    assert report["ok"] is True
    assert (report["installed_release"], report["latest_release"]) == ("v0.1.0", "v0.3.0")
    assert (report["commits_behind"], report["releases_behind"]) == (3, 2)
    assert git(installed.release, "rev-parse", "HEAD") == installed_head


def test_an_install_moved_off_its_release_tag_is_broken(repo, installed, browsers):
    repo.commit("untagged work on main")
    git(installed.release, "fetch", "-q", "origin")
    git(installed.release, "checkout", "-q", "--detach", "origin/main")

    report = check(installed, browsers_dir=browsers.cache)

    assert report["ok"] is False
    assert report["installed_release"] is None
    assert any("not a Template release tag" in m["detail"] for m in report["missing"])


def run_check_cli(layout, browsers):
    script = Path(__file__).resolve().parents[1] / "skill" / "scripts" / "machine_install.py"
    result = subprocess.run(
        [sys.executable, str(script), "check", "--claude-home", str(layout.claude_home),
         "--browsers-dir", str(browsers.cache)],
        capture_output=True, text=True, check=False,
    )
    return result.returncode, result.stdout


def test_the_check_cli_says_how_far_behind_the_install_is(repo, installed, browsers):
    repo.release_elsewhere("v0.2.0", commits=3)

    code, out = run_check_cli(installed, browsers)

    assert code == 0
    assert "3 commits / 1 release behind" in out
    assert json.loads(out.split("\n", 1)[1])["latest_release"] == "v0.2.0"


def test_the_check_cli_fails_and_names_the_installer_when_a_piece_is_missing(installed, browsers):
    shutil.rmtree(installed.state)

    code, out = run_check_cli(installed, browsers)

    assert code == 1
    assert "missing: state" in out
    assert "install.ps1" in out
