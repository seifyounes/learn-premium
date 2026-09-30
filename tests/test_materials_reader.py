"""The Materials reader through its command interface, on synthetic Materials folders."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import SCRIPTS
from materials import (DRAWN, PEN_ONLY, VIDEO, WHITE_BACKGROUND, WHITE_ON_WHITE, deck, pdf,
                       tone)
from PIL import Image
from reader.cli import run


@pytest.fixture
def folders(tmp_path):
    """A Materials folder and its Private folder beside it, outside any repo."""
    materials = tmp_path / "Heat Transfer"
    materials.mkdir()
    return materials, tmp_path / "Heat Transfer private"


def read(materials, private, rel, **kwargs):
    return run(["read", "--materials", str(materials), "--private", str(private), rel], **kwargs)


def test_pdf_pages_are_rendered_into_the_private_folder(folders):
    materials, private = folders
    (materials / "Lecture 1.pdf").write_bytes(pdf([DRAWN, DRAWN]))

    code, report = read(materials, private, "Lecture 1.pdf")

    assert code == 0, report
    manifest = json.loads((private / report["manifest"]).read_text(encoding="utf-8"))
    assert manifest["kind"] == "pdf"
    assert [p["number"] for p in manifest["pages"]] == [1, 2]
    for page in manifest["pages"]:
        image = Image.open(private / page["image"])
        assert image.getextrema() != ((255, 255), (255, 255), (255, 255))


def test_a_page_with_content_that_renders_blank_fails_loudly(folders):
    # Negative control: text drawn white on white is on the page but gives a render with no pixels.
    materials, private = folders
    (materials / "Sheet 2.pdf").write_bytes(pdf([DRAWN, WHITE_ON_WHITE]))

    code, report = read(materials, private, "Sheet 2.pdf")

    assert code == 1
    assert report["ok"] is False
    assert "page(s) 2" in report["error"]
    assert not (private / "reader" / "Sheet 2.pdf").exists()


def test_blank_pages_are_read_as_empty_and_a_pen_annotation_is_content(folders):
    materials, private = folders
    (materials / "Exam 2024.pdf").write_bytes(pdf([DRAWN, None, WHITE_BACKGROUND, PEN_ONLY]))

    code, report = read(materials, private, "Exam 2024.pdf")

    assert code == 0, report
    manifest = json.loads((private / report["manifest"]).read_text(encoding="utf-8"))
    assert [p["empty"] for p in manifest["pages"]] == [False, True, True, False]


def test_a_failed_read_keeps_the_earlier_read_of_the_file(folders):
    materials, private = folders
    (materials / "Sheet 3.pdf").write_bytes(pdf([DRAWN]))
    code, first = read(materials, private, "Sheet 3.pdf")
    assert code == 0, first
    (materials / "Sheet 3.pdf").write_bytes(pdf([WHITE_ON_WHITE]))

    code, report = read(materials, private, "Sheet 3.pdf")

    assert code == 1, report
    assert (private / first["manifest"]).is_file()
    assert sorted(p.name for p in (private / "reader").iterdir()) == ["Sheet 3.pdf"]


@pytest.mark.parametrize("where", ["inside the Materials", "inside a repo"])
def test_a_private_folder_that_is_not_beside_the_materials_is_refused(tmp_path, where):
    materials = tmp_path / "Heat Transfer"
    materials.mkdir()
    (materials / "Lecture 1.pdf").write_bytes(pdf([DRAWN]))
    if where == "inside the Materials":
        private = materials / "private"
    else:
        project = tmp_path / "heat-transfer-site"
        (project / ".git").mkdir(parents=True)
        private = project / "evidence"

    code, report = read(materials, private, "Lecture 1.pdf")

    assert code == 3
    assert where.split()[-1].lower() in report["error"].lower()
    assert not private.exists()


class FakeWhisper:
    """Stands in for faster-whisper: says which audio file it heard."""

    def __init__(self):
        self.heard = []

    def __call__(self, audio):
        with open(audio, "rb") as f:  # opened the way faster-whisper is given it
            assert f.read(4) == b"RIFF"
        self.heard.append(audio)
        return {"language": "en", "text": f"narration {len(self.heard)}",
                "segments": [{"start": 0.0, "end": 0.5, "text": f"narration {len(self.heard)}"}]}


NARRATED_DECK = [
    {"title": "Conduction", "body": "Fourier's law", "notes": "Stress the sign.",
     "narration": tone(hz=440)},
    {"title": "Fins", "body": "Fin efficiency", "narration": tone(hz=660), "video": VIDEO},
    {"title": "Summary", "body": "Recap"},
]


def files_under(folder):
    return {p for p in folder.rglob("*") if p.is_file()}


def test_a_narrated_deck_yields_slides_with_their_audio_video_and_transcripts(folders):
    materials, private = folders
    deck(materials / "Week 2" / "Lecture 2.pptx", NARRATED_DECK)
    whisper = FakeWhisper()

    code, report = read(materials, private, "Week 2/Lecture 2.pptx", transcriber=whisper)

    assert code == 0, report
    manifest = json.loads((private / report["manifest"]).read_text(encoding="utf-8"))
    assert manifest["kind"] == "deck"
    slides = manifest["slides"]
    assert [s["title"] for s in slides] == ["Conduction", "Fins", "Summary"]
    assert "Fourier's law" in slides[0]["text"]
    assert slides[0]["notes"] == "Stress the sign."
    assert [len(s["audio"]) for s in slides] == [1, 1, 0]
    assert [len(s["video"]) for s in slides] == [0, 1, 0]
    assert all(a["narration"] for s in slides for a in s["audio"])
    assert (private / slides[1]["video"][0]["file"]).read_bytes() == VIDEO
    assert slides[1]["video"][0]["sourceOnly"] is True

    assert len(whisper.heard) == 2
    for slide, said in zip(slides[:2], ["narration 1", "narration 2"]):
        transcript = json.loads((private / slide["audio"][0]["transcript"]).read_text("utf-8"))
        assert transcript["text"] == said


def test_everything_read_from_a_deck_lands_in_the_private_folder_only(folders):
    materials, private = folders
    deck(materials / "Lecture 2.pptx", NARRATED_DECK)
    root = materials.parent
    before = files_under(root)

    code, report = read(materials, private, "Lecture 2.pptx", transcriber=FakeWhisper())

    assert code == 0, report
    written = files_under(root) - before
    assert written
    assert all(p.is_relative_to(private) for p in written)
    # The deck's video exists only in the deck and in the Private folder, never anywhere else.
    copies = {p for p in files_under(root) if p.read_bytes() == VIDEO}
    assert copies and all(p.is_relative_to(private) for p in copies)


def test_a_deck_with_no_media_is_read_without_loading_whisper(folders):
    materials, private = folders
    deck(materials / "Lecture 3.pptx", [{"title": "Radiation", "body": "Stefan-Boltzmann"},
                                        {"title": "Emissivity", "body": "Emissivity"}])

    code, report = read(materials, private, "Lecture 3.pptx")

    assert code == 0, report
    manifest = json.loads((private / report["manifest"]).read_text(encoding="utf-8"))
    assert [s["text"] for s in manifest["slides"]] == ["Stefan-Boltzmann", "Emissivity"]


@pytest.mark.parametrize("name", ["Lecture 4.pdf", "Lecture 4.pptx"])
def test_a_file_that_is_not_what_its_name_says_is_bad_input(folders, name):
    materials, private = folders
    (materials / name).write_bytes(b"not really a " + name.encode())

    code, report = read(materials, private, name)

    assert code == 2
    assert name in report["error"]


def _short_form(path):
    """`path` with 8.3 short names, as %TEMP% often spells the user folder."""
    import ctypes

    buffer = ctypes.create_unicode_buffer(1024)
    assert ctypes.windll.kernel32.GetShortPathNameW(str(path), buffer, 1024)
    return Path(buffer.value)


@pytest.mark.skipif(os.name != "nt", reason="Windows' 260-character path limit")
def test_materials_past_260_characters_under_the_user_folder_read(tmp_path):
    assert tmp_path.is_relative_to(Path.home()), "the fixture must sit under the user folder"
    materials, private = tmp_path / "Heat Transfer", tmp_path / "Heat Transfer private"
    deep = materials / "Week 05 extracted archive" / " ".join(["Lecture materials"] * 4)
    deep = deep / " ".join(["Chapter 3 conduction through composite walls"] * 2)
    pdf_file, deck_file = deep / "Tutorial 5.pdf", deep / "Lecture 5.pptx"
    assert len(str(deck_file)) > 300, len(str(deck_file))

    def prefixed(path):
        return Path("\\\\?\\" + str(path))

    prefixed(deep).mkdir(parents=True)
    prefixed(pdf_file).write_bytes(pdf([DRAWN]))
    deck(prefixed(deck_file), NARRATED_DECK)
    short_materials = _short_form(materials)
    whisper = FakeWhisper()

    for material, reader in [(pdf_file, {}), (deck_file, {"transcriber": whisper})]:
        code, report = run(["read", "--materials", str(short_materials), "--private",
                            str(_short_form(tmp_path) / private.name),
                            str(material.relative_to(materials))], **reader)
        assert code == 0, report
        manifest = json.loads(prefixed(private / report["manifest"]).read_text(encoding="utf-8"))
        assert manifest["material"] == material.relative_to(materials).as_posix()
    assert len(whisper.heard) == 2


@pytest.mark.skipif(os.name != "nt", reason="8.3 short names are Windows'")
def test_a_private_folder_inside_the_materials_is_refused_however_the_user_folder_is_spelled(
        tmp_path):
    materials = tmp_path / "Heat Transfer"
    materials.mkdir()
    (materials / "Lecture 1.pdf").write_bytes(pdf([DRAWN]))
    short_materials = _short_form(materials)
    assert short_materials != materials, "this volume makes no 8.3 names"

    code, report = read(short_materials, materials / "private", "Lecture 1.pdf")

    assert code == 3, report


def reader_command(*args):
    """The reader as the skill runs it: its entry script, printing one JSON document."""
    script = SCRIPTS / "materials_reader.py"
    result = subprocess.run([sys.executable, str(script), *args], capture_output=True,
                            encoding="utf-8", check=False)
    return result.returncode, json.loads(result.stdout)


def test_the_entry_script_prints_one_json_report_and_exits_with_its_code(folders):
    materials, private = folders
    (materials / "محاضرة 1.pdf").write_bytes(pdf([DRAWN]))

    ok = reader_command("read", "--materials", str(materials), "--private", str(private),
                        "محاضرة 1.pdf")
    bad = reader_command("read", "--materials", str(materials), "محاضرة 1.pdf")

    assert ok == (0, {"ok": True, "kind": "pdf", "manifest": "reader/محاضرة 1.pdf/manifest.json"})
    assert bad[0] == 2 and "--private" in bad[1]["error"]


@pytest.mark.skipif(os.environ.get("LEARN_PREMIUM_WHISPER") != "1" or os.name != "nt",
                    reason="real faster-whisper (downloads a model): set LEARN_PREMIUM_WHISPER=1")
def test_real_narration_is_transcribed_by_faster_whisper(folders, tmp_path):
    materials, private = folders
    speech = tmp_path / "speech.wav"
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Add-Type -AssemblyName System.Speech; "
                    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                    f"$s.SetOutputToWaveFile('{speech}'); "
                    "$s.Speak('Heat flows from the hot wall to the cold wall.'); $s.Dispose()"],
                   check=True)
    deck(materials / "Lecture 6.pptx", [{"title": "Conduction", "narration": speech.read_bytes()}])

    code, report = reader_command("read", "--materials", str(materials), "--private",
                                  str(private), "--whisper-model", "tiny", "Lecture 6.pptx")

    assert code == 0, report
    manifest = json.loads((private / report["manifest"]).read_text(encoding="utf-8"))
    audio = manifest["slides"][0]["audio"][0]
    heard = json.loads((private / audio["transcript"]).read_text(encoding="utf-8"))
    assert "wall" in heard["text"].lower(), heard
