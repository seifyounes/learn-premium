"""The installer, driven end to end against a synthetic tagged repo and a throwaway Claude home."""

import os

import pytest
from conftest import git
from machine_install import InstallError, Layout, install


def test_fresh_install_lays_out_the_machine_at_the_latest_release(repo, claude_home, browsers):
    repo.tag("v0.1.0")
    repo.commit("work after the release")
    repo.tag("v0.2.0")
    repo.commit("untagged work on main")

    install(repo.clone, Layout(claude_home), install_browsers=browsers)

    layout = Layout(claude_home)
    assert git(layout.release, "rev-parse", "HEAD") == git(repo.clone, "rev-parse", "v0.2.0")
    assert (layout.state).is_dir()
    assert (layout.venv / "pyvenv.cfg").is_file()
    assert os.path.realpath(layout.skill_link) == os.path.realpath(layout.release / "skill")
    assert (layout.skill_link / "SKILL.md").is_file()
    assert browsers.calls == 1


def test_running_the_installer_twice_leaves_the_same_result(repo, claude_home, browsers):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)

    install(repo.clone, layout, install_browsers=browsers)
    first = (git(layout.release, "rev-parse", "HEAD"), os.path.realpath(layout.skill_link))
    install(repo.clone, layout, install_browsers=browsers)

    assert (git(layout.release, "rev-parse", "HEAD"), os.path.realpath(layout.skill_link)) == first
    assert (layout.venv / "pyvenv.cfg").is_file()
    assert git(repo.clone, "worktree", "list").count(str(layout.release.name)) == 1


def test_a_rerun_moves_the_install_to_a_release_published_since(repo, claude_home, browsers):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    install(repo.clone, layout, install_browsers=browsers)

    newer = repo.release_elsewhere("v0.2.0")
    install(repo.clone, layout, install_browsers=browsers)

    assert git(layout.release, "rev-parse", "HEAD") == newer


def test_without_a_release_tag_the_installer_refuses_and_installs_nothing(repo, claude_home, browsers):
    repo.tag("v0.1.0-rc.1")  # a pre-release is not a Template release

    with pytest.raises(InstallError, match="No Template release tag"):
        install(repo.clone, Layout(claude_home), install_browsers=browsers)

    assert list(claude_home.iterdir()) == []
    assert browsers.calls == 0


def test_a_skill_link_left_pointing_elsewhere_is_repointed(repo, claude_home, browsers, tmp_path):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    stale = tmp_path / "old-checkout" / "skill"
    stale.mkdir(parents=True)
    layout.skill_link.parent.mkdir(parents=True)
    os.symlink(stale, layout.skill_link, target_is_directory=True)

    install(repo.clone, layout, install_browsers=browsers)

    assert os.path.realpath(layout.skill_link) == os.path.realpath(layout.release / "skill")
    assert stale.is_dir()


def test_a_real_folder_where_the_skill_link_goes_is_never_replaced(repo, claude_home, browsers):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    layout.skill_link.mkdir(parents=True)
    (layout.skill_link / "SKILL.md").write_text("someone's own copy\n")

    with pytest.raises(InstallError, match="not a link"):
        install(repo.clone, layout, install_browsers=browsers)

    assert (layout.skill_link / "SKILL.md").read_text() == "someone's own copy\n"
    assert not layout.root.exists()


def test_a_rerun_refuses_to_move_an_install_with_local_edits(repo, claude_home, browsers):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    install(repo.clone, layout, install_browsers=browsers)
    installed = git(layout.release, "rev-parse", "HEAD")
    (layout.release / "skill" / "SKILL.md").write_text("edited in place\n")

    repo.release_elsewhere("v0.2.0")
    with pytest.raises(InstallError, match="local edits"):
        install(repo.clone, layout, install_browsers=browsers)

    assert git(layout.release, "rev-parse", "HEAD") == installed
    assert (layout.release / "skill" / "SKILL.md").read_text() == "edited in place\n"
