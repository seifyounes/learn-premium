"""The installer, driven end to end against a synthetic tagged repo and a throwaway Claude home."""

import os

import pytest
from conftest import git
from machine_install import InstallError, Layout, install


def test_fresh_install_lays_out_the_machine_at_the_latest_release(repo, claude_home, npx):
    repo.tag("v0.1.0")
    repo.commit("work after the release")
    repo.tag("v0.2.0")
    repo.commit("untagged work on main")

    install(repo.clone, Layout(claude_home))

    layout = Layout(claude_home)
    assert git(layout.release, "rev-parse", "HEAD") == git(repo.clone, "rev-parse", "v0.2.0")
    assert layout.state.is_dir()
    assert layout.venv_python.is_file()
    assert os.path.realpath(layout.skill_link) == os.path.realpath(layout.skill_dir)
    assert (layout.skill_link / "SKILL.md").is_file()
    assert npx.installs() == ["1.63.0"]


def test_the_machine_steps_run_the_release_s_own_code_not_main_s(repo, claude_home, npx):
    repo.pin_playwright("1.50.0")
    repo.tag("v0.1.0")
    repo.pin_playwright("1.99.0")  # untagged, on main

    install(repo.clone, Layout(claude_home))

    assert npx.installs() == ["1.50.0"]


def test_running_the_installer_twice_leaves_the_same_result(repo, claude_home, npx):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)

    install(repo.clone, layout)
    first = (git(layout.release, "rev-parse", "HEAD"), os.path.realpath(layout.skill_link))
    install(repo.clone, layout)

    assert (git(layout.release, "rev-parse", "HEAD"), os.path.realpath(layout.skill_link)) == first
    assert layout.venv_python.is_file()
    assert git(repo.clone, "worktree", "list").count(layout.release.name) == 1


def test_a_rerun_moves_the_install_to_a_release_published_since(repo, claude_home, npx):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    install(repo.clone, layout)

    newer = repo.release_elsewhere("v0.2.0")
    install(repo.clone, layout)

    assert git(layout.release, "rev-parse", "HEAD") == newer


def test_a_tag_that_never_reached_origin_is_not_installed(repo, claude_home, npx):
    repo.tag("v0.1.0")
    repo.commit("local work")
    repo.tag("v0.2.0", push=False)

    install(repo.clone, Layout(claude_home))

    assert git(Layout(claude_home).release, "rev-parse", "HEAD") == git(repo.clone, "rev-parse",
                                                                        "v0.1.0")


def test_a_release_tag_moved_on_origin_is_followed(repo, claude_home, npx):
    repo.tag("v0.1.0")
    moved = repo.release_elsewhere("v0.1.0", move=True)

    install(repo.clone, Layout(claude_home))

    assert git(Layout(claude_home).release, "rev-parse", "HEAD") == moved


def test_without_a_release_tag_the_installer_refuses_and_installs_nothing(repo, claude_home, npx):
    repo.tag("v0.1.0-rc.1")  # a pre-release is not a Template release

    with pytest.raises(InstallError, match="No Template release tag"):
        install(repo.clone, Layout(claude_home))

    assert list(claude_home.iterdir()) == []
    assert npx.installs() == []


def test_when_origin_cannot_be_reached_the_installer_refuses(repo, claude_home, npx):
    repo.tag("v0.1.0")
    git(repo.clone, "remote", "set-url", "origin", str(repo.origin.parent / "gone.git"))

    with pytest.raises(InstallError, match="origin"):
        install(repo.clone, Layout(claude_home))

    assert list(claude_home.iterdir()) == []


def test_a_skill_link_left_pointing_elsewhere_is_repointed(repo, claude_home, npx, tmp_path):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    stale = tmp_path / "old-checkout" / "skill"
    stale.mkdir(parents=True)
    layout.skill_link.parent.mkdir(parents=True)
    os.symlink(stale, layout.skill_link, target_is_directory=True)

    install(repo.clone, layout)

    assert os.path.realpath(layout.skill_link) == os.path.realpath(layout.skill_dir)
    assert stale.is_dir()


def test_a_real_folder_where_the_skill_link_goes_is_never_replaced(repo, claude_home, npx):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    layout.skill_link.mkdir(parents=True)
    (layout.skill_link / "SKILL.md").write_text("someone's own copy\n")

    with pytest.raises(InstallError, match="not a link"):
        install(repo.clone, layout)

    assert (layout.skill_link / "SKILL.md").read_text() == "someone's own copy\n"
    assert not layout.root.exists()


def test_a_rerun_refuses_to_move_an_install_with_local_edits(repo, claude_home, npx):
    repo.tag("v0.1.0")
    layout = Layout(claude_home)
    install(repo.clone, layout)
    installed = git(layout.release, "rev-parse", "HEAD")
    (layout.skill_dir / "SKILL.md").write_text("edited in place\n")

    repo.release_elsewhere("v0.2.0")
    with pytest.raises(InstallError, match="local edits"):
        install(repo.clone, layout)

    assert git(layout.release, "rev-parse", "HEAD") == installed
    assert (layout.skill_dir / "SKILL.md").read_text() == "edited in place\n"
