"""The Materials reader's `crop`: the region of a rendered page a Blind-reader dispute is settled on,
cut into the Private folder. Synthetic renders only."""

import json

import pytest
from PIL import Image
from reader.cli import run


@pytest.fixture
def private(tmp_path):
    """A Private folder (beside a Materials folder, outside any repo) holding one rendered page:
    white, with a black square in its top-left quarter."""
    (tmp_path / "Heat Transfer").mkdir()
    private = tmp_path / "Heat Transfer private"
    page = private / "reader" / "Lecture 1.pdf" / "pages" / "page-001.png"
    page.parent.mkdir(parents=True)
    image = Image.new("RGB", (200, 100), "white")
    image.paste((0, 0, 0), (10, 10, 60, 40))
    image.save(page)
    return private


def crop(private, *args):
    materials = private.parent / "Heat Transfer"
    return run(["crop", "--materials", str(materials), "--private", str(private), *args])


def test_a_region_of_a_rendered_page_is_cut_into_the_private_folder(private):
    code, report = crop(private, "--render", "reader/Lecture 1.pdf/pages/page-001.png",
                        "--box", "0,0,0.5,0.5", "--out", "waves/01/crops/eq-1.png")

    assert code == 0, report
    assert report == {"ok": True, "crop": "waves/01/crops/eq-1.png", "size": [100, 50]}
    image = Image.open(private / "waves" / "01" / "crops" / "eq-1.png")
    assert image.size == (100, 50)
    assert image.getpixel((20, 20)) == (0, 0, 0)
    assert image.getpixel((90, 45)) == (255, 255, 255)


def test_a_box_that_is_not_a_region_of_the_page_is_bad_input(private):
    for box in ("0.5,0,0.5,1", "0,0,1.2,1", "a,b,c,d", "0,0,1"):
        code, report = crop(private, "--render", "reader/Lecture 1.pdf/pages/page-001.png",
                            "--box", box, "--out", "waves/01/crops/x.png")
        assert code == 2, (box, report)


def test_nothing_is_read_or_written_outside_the_private_folder(private):
    code, report = crop(private, "--render", "reader/Lecture 1.pdf/pages/page-001.png",
                        "--box", "0,0,1,1", "--out", "../escaped.png")
    assert code == 2, report
    assert not (private.parent / "escaped.png").exists()

    code, report = crop(private, "--render", "../elsewhere.png", "--box", "0,0,1,1",
                        "--out", "waves/01/crops/x.png")
    assert code == 2, report


def test_a_private_folder_inside_a_repo_is_refused(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "Heat Transfer").mkdir()
    private = tmp_path / "Heat Transfer private"
    private.mkdir()
    code, report = crop(private, "--render", "x.png", "--box", "0,0,1,1", "--out", "y.png")
    assert code == 3, report
    assert json.dumps(report).find("outside any repo") != -1
