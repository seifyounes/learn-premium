"""The install check a /learn-premium run starts with: what's missing, and how far behind it is."""

import json
import os
import shutil
import subprocess
import sys

import pytest
from conftest import SCRIPTS, git
from machine_install import Layout, check, install


@pytest.fixture
def installed(repo, claude_home, npx):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    install(repo.clone, layout)
    return layout


def test_a_complete_install_at_the_latest_release_is_ok(installed):
    report = check(installed)

    assert report["ok"] is True
    assert report["missing"] == []
    assert report["installed_release"] == "v0.1.0"
    assert report["latest_release"] == "v0.1.0"
    assert (report["commits_behind"], report["releases_behind"]) == (0, 0)


@pytest.mark.parametrize("piece, break_it", [
    ("release", lambda layout, npx: shutil.rmtree(layout.release)),
    ("state", lambda layout, npx: shutil.rmtree(layout.state)),
    ("venv", lambda layout, npx: shutil.rmtree(layout.venv)),
    ("skill link", lambda layout, npx: os.rmdir(layout.skill_link)),
    ("browsers", lambda layout, npx: shutil.rmtree(npx.cache / "webkit-1.63.0")),
])
def test_each_missing_piece_is_detected(installed, npx, piece, break_it):
    break_it(installed, npx)

    report = check(installed)

    assert report["ok"] is False
    assert piece in [m["piece"] for m in report["missing"]]


def test_browsers_from_another_playwright_version_do_not_count(installed, npx):
    for browser in ("chromium", "webkit"):
        (npx.cache / f"{browser}-1.63.0").rename(npx.cache / f"{browser}-1.50.0")

    report = check(installed)

    assert "browsers" in [m["piece"] for m in report["missing"]]


def test_a_newer_release_on_origin_is_reported_and_never_pulled(repo, installed):
    installed_head = git(installed.release, "rev-parse", "HEAD")
    repo.release_elsewhere("v0.2.0", commits=2)
    repo.release_elsewhere("v0.3.0", commits=1)

    report = check(installed)

    assert report["ok"] is True
    assert (report["installed_release"], report["latest_release"]) == ("v0.1.0", "v0.3.0")
    assert (report["commits_behind"], report["releases_behind"]) == (3, 2)
    assert git(installed.release, "rev-parse", "HEAD") == installed_head


def test_an_install_moved_off_its_release_tag_is_broken(repo, installed):
    repo.commit("untagged work on main")
    git(installed.release, "fetch", "-q", "origin")
    git(installed.release, "checkout", "-q", "--detach", "origin/main")

    report = check(installed)

    assert report["ok"] is False
    assert report["installed_release"] is None
    assert any("not a Template release tag" in m["detail"] for m in report["missing"])


def run_check_cli(layout):
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "machine_install.py"), "check",
         "--claude-home", str(layout.claude_home)],
        capture_output=True, text=True, check=False,
    )
    return result.returncode, result.stdout


def test_the_check_cli_says_how_far_behind_the_install_is(repo, installed):
    repo.release_elsewhere("v0.2.0", commits=3)

    code, out = run_check_cli(installed)

    assert code == 0
    assert "3 commits / 1 release behind" in out
    assert json.loads(out.split("\n", 1)[1])["latest_release"] == "v0.2.0"


def test_the_check_cli_fails_and_names_the_installer_when_a_piece_is_missing(installed):
    shutil.rmtree(installed.state)

    code, out = run_check_cli(installed)

    assert code == 1
    assert "missing: state" in out
    assert "install.ps1" in out
