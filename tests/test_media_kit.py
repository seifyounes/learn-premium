"""The media kit (re-encode and fact-check evidence) through its command interface, on the Fixture
Course's own media and on synthetic HD clips made in tmp_path. FakeWhisper stands in for the model:
nothing is downloaded."""

import hashlib
import json
import shutil
from pathlib import Path

import av
import pytest
from clips import hd_clip, stereo_m4a
from conftest import git
from mediakit.cli import run
from PIL import Image, ImageChops

FIXTURE = Path(__file__).resolve().parents[1] / "fixture-course" / "modules" / "01-thermal-resistance" / "media"


class FakeWhisper:
    """Stands in for faster-whisper: says which audio file it heard."""

    def __init__(self):
        self.heard = []

    def __call__(self, audio):
        with open(audio, "rb") as f:  # opened the way faster-whisper is given it
            assert f.read(4)
        self.heard.append(audio)
        return {"model": "fake", "language": "en", "text": "A wall resists heat.",
                "segments": [{"start": 0.0, "end": 1.0, "text": "A wall resists heat."}]}


def encode(kind, master, out, *flags):
    return run(["encode", "--kind", kind, "--master", str(master), "--out", str(out), *flags])


def streams(path):
    with av.open(str(path)) as container:
        return {s.type: s for s in container.streams if s.type in ("video", "audio")}, container.duration


def faststart(path):
    data = Path(path).read_bytes()
    return data.find(b"moov") != -1 and data.find(b"moov") < data.find(b"mdat")


@pytest.fixture(scope="module")
def hd(tmp_path_factory):
    path = tmp_path_factory.mktemp("clips") / "hd.mp4"
    hd_clip(path)
    return path


def test_a_1080p_clip_becomes_h264_720p_faststart_with_64k_mono_aac(hd, tmp_path):
    code, report = encode("video", hd, tmp_path / "web.mp4")

    assert code == 0, report
    got, _ = streams(tmp_path / "web.mp4")
    video, audio = got["video"], got["audio"]
    assert (video.codec_context.name, video.width, video.height) == ("h264", 1280, 720)
    assert video.codec_context.pix_fmt == "yuv420p"
    assert faststart(tmp_path / "web.mp4")
    assert audio.codec_context.name == "aac"
    assert audio.codec_context.channels == 1
    assert 56_000 <= audio.bit_rate <= 72_000
    assert report["duration"] == pytest.approx(2, abs=0.2)


def test_a_smaller_video_is_never_upscaled(tmp_path):
    code, report = encode("video", FIXTURE / "explainer.mp4", tmp_path / "web.mp4")

    assert code == 0, report
    got, _ = streams(tmp_path / "web.mp4")
    assert (got["video"].width, got["video"].height) == (640, 360)
    assert "audio" not in got
    assert faststart(tmp_path / "web.mp4")


def test_audio_becomes_64k_mono_mp3(tmp_path):
    stereo_m4a(tmp_path / "talk.m4a")
    for master in (FIXTURE / "deep-dive.mp3", tmp_path / "talk.m4a"):
        out = tmp_path / f"{master.stem}-web.mp3"
        code, report = encode("audio", master, out)

        assert code == 0, report
        got, _ = streams(out)
        assert got["audio"].codec_context.name.startswith("mp3")  # the decoder is mp3float
        assert got["audio"].codec_context.channels == 1
        assert got["audio"].bit_rate == 64_000


def test_the_infographic_is_optimised_and_pixel_identical(tmp_path):
    master = FIXTURE / "infographic.png"
    code, report = encode("infographic", master, tmp_path / "web.png")

    assert code == 0, report
    assert (tmp_path / "web.png").stat().st_size <= master.stat().st_size
    diff = ImageChops.difference(Image.open(master).convert("RGB"), Image.open(tmp_path / "web.png").convert("RGB"))
    assert diff.getbbox() is None


def test_an_unoptimised_png_shrinks(tmp_path):
    big = tmp_path / "raw.png"
    Image.open(FIXTURE / "infographic.png").convert("RGB").save(big, compress_level=0)

    code, _ = encode("infographic", big, tmp_path / "web.png")

    assert code == 0
    assert (tmp_path / "web.png").stat().st_size < big.stat().st_size


def test_harder_is_smaller(hd, tmp_path):
    assert encode("video", hd, tmp_path / "std.mp4")[0] == 0
    code, report = encode("video", hd, tmp_path / "hard.mp4", "--harder")
    assert code == 0, report
    assert (tmp_path / "hard.mp4").stat().st_size < (tmp_path / "std.mp4").stat().st_size
    got, _ = streams(tmp_path / "hard.mp4")
    assert got["video"].height <= 540

    assert encode("infographic", FIXTURE / "infographic.png", tmp_path / "std.png")[0] == 0
    assert encode("infographic", FIXTURE / "infographic.png", tmp_path / "hard.png", "--harder")[0] == 0
    assert (tmp_path / "hard.png").stat().st_size <= (tmp_path / "std.png").stat().st_size


def test_out_inside_a_repo_is_refused(tmp_path):
    # Negative control: the Private folder's rule holds for what the kit writes. Nothing is written.
    repo = tmp_path / "course"
    repo.mkdir()
    git(repo, "init", "-q")

    code, report = encode("infographic", FIXTURE / "infographic.png", repo / "web" / "out.png")

    assert code == 3
    assert report["ok"] is False
    assert not (repo / "web").exists()


def test_a_missing_master_is_bad_input(tmp_path):
    code, report = encode("audio", tmp_path / "nope.mp3", tmp_path / "web.mp3")

    assert code == 2
    assert not (tmp_path / "web.mp3").exists()


def test_video_evidence_samples_frames_and_transcribes(hd, tmp_path):
    whisper = FakeWhisper()
    out = tmp_path / "evidence"

    code, report = run(["evidence", "--kind", "video", "--master", str(hd), "--out", str(out), "--every", "1"],
                       transcriber=whisper)

    assert code == 0, report
    evidence = json.loads((out / "evidence.json").read_text(encoding="utf-8"))
    assert evidence["evidence"] == "learn-premium media evidence v1"
    assert evidence["kind"] == "video"
    assert evidence["masterHash"] == hashlib.sha256(hd.read_bytes()).hexdigest()
    assert evidence["frames"] == ["frames/frame-001.png", "frames/frame-002.png"]
    assert all((out / f).is_file() for f in evidence["frames"])
    assert evidence["duration"] == pytest.approx(2, abs=0.2)
    assert evidence["transcript"] == "transcript.json"
    assert json.loads((out / "transcript.json").read_text(encoding="utf-8"))["segments"][0]["start"] == 0.0
    assert evidence["image"] is None
    assert len(whisper.heard) == 1


def test_a_silent_video_has_frames_and_no_transcript(tmp_path):
    whisper = FakeWhisper()
    out = tmp_path / "evidence"

    code, report = run(["evidence", "--kind", "video", "--master", str(FIXTURE / "explainer.mp4"), "--out", str(out),
                        "--every", "1"], transcriber=whisper)

    assert code == 0, report
    evidence = json.loads((out / "evidence.json").read_text(encoding="utf-8"))
    assert len(evidence["frames"]) == 4
    assert evidence["transcript"] is None
    assert whisper.heard == []


def test_audio_evidence_is_its_transcript(tmp_path):
    whisper = FakeWhisper()
    out = tmp_path / "evidence"

    code, report = run(["evidence", "--kind", "audio", "--master", str(FIXTURE / "deep-dive.mp3"), "--out", str(out)],
                       transcriber=whisper)

    assert code == 0, report
    evidence = json.loads((out / "evidence.json").read_text(encoding="utf-8"))
    assert (evidence["frames"], evidence["transcript"]) == ([], "transcript.json")
    assert len(whisper.heard) == 1


def test_infographic_evidence_is_the_image_itself(tmp_path):
    whisper = FakeWhisper()
    out = tmp_path / "evidence"
    master = tmp_path / "info.png"
    shutil.copy(FIXTURE / "infographic.png", master)

    code, report = run(["evidence", "--kind", "infographic", "--master", str(master), "--out", str(out)],
                       transcriber=whisper)

    assert code == 0, report
    evidence = json.loads((out / "evidence.json").read_text(encoding="utf-8"))
    assert evidence["image"] == str(master)
    assert (evidence["frames"], evidence["transcript"], evidence["duration"]) == ([], None, None)
    assert whisper.heard == []


def test_evidence_inside_a_repo_is_refused(tmp_path):
    repo = tmp_path / "course"
    repo.mkdir()
    git(repo, "init", "-q")

    code, _ = run(["evidence", "--kind", "infographic", "--master", str(FIXTURE / "infographic.png"),
                   "--out", str(repo / "evidence")], transcriber=FakeWhisper())

    assert code == 3
    assert not (repo / "evidence").exists()
