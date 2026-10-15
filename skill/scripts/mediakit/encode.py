"""The web profile: H.264 up to 720p with faststart and speech-grade audio, 64 kbps mono mp3, an optimised
PNG. `harder` is the second try for a file still over GitHub's limit. PyAV's FFmpeg does it all, so no
system ffmpeg is needed. Files are opened here and handed to PyAV, which can't take Windows long paths."""

import io
import os
from fractions import Fraction
from pathlib import Path

import av
from PIL import Image

from reader.errors import BadInput

KINDS = ("video", "audio", "infographic")
MAX_FPS = 30


def _even(n):
    return max(2, int(n) // 2 * 2)


def _fit(width, height, cap):
    """Never upscaled: the short side is at most `cap`, both sides even."""
    scale = min(1.0, cap / min(width, height))
    return _even(width * scale), _even(height * scale)


def _mono(dest, codec, rate, bit_rate):
    stream = dest.add_stream(codec, rate=rate)
    stream.layout = "mono"
    stream.bit_rate = bit_rate
    return stream


def encode_video(master: Path, out: Path, harder: bool):
    with open(master, "rb") as source, open(out, "w+b") as sink:
        with av.open(source) as inp, av.open(sink, "w", format="mp4", options={"movflags": "+faststart"}) as dest:
            in_video = next((s for s in inp.streams if s.type == "video"), None)
            if in_video is None:
                raise BadInput(f"{master.name} has no video stream")
            in_audio = next((s for s in inp.streams if s.type == "audio"), None)
            fps = max(1, round(min(float(in_video.average_rate or MAX_FPS), MAX_FPS)))
            width, height = _fit(in_video.codec_context.width, in_video.codec_context.height,
                                 540 if harder else 720)
            video = dest.add_stream("libx264", rate=fps)
            video.width, video.height, video.pix_fmt = width, height, "yuv420p"
            video.options = {"crf": "34" if harder else "28", "preset": "medium", "profile": "high"}
            audio = resampler = None
            if in_audio is not None:
                audio = _mono(dest, "aac", 48000, 48_000 if harder else 64_000)
                resampler = av.AudioResampler(format="fltp", layout="mono", rate=48000, frame_size=1024)
            last = -1
            for packet in inp.demux(*[s for s in (in_video, in_audio) if s is not None]):
                for frame in packet.decode():
                    if packet.stream.type == "video":
                        # Frames keep their time, on the output's grid; one past 30 fps lands on a taken slot and is dropped.
                        pts = round(float(frame.time or 0) * fps)
                        if pts <= last:
                            continue
                        last = pts
                        scaled = frame.reformat(width=width, height=height, format="yuv420p")
                        scaled.pts, scaled.time_base = pts, Fraction(1, fps)
                        dest.mux(video.encode(scaled))
                    else:
                        for part in resampler.resample(frame):
                            dest.mux(audio.encode(part))
            dest.mux(video.encode(None))
            if audio is not None:
                for part in resampler.resample(None):
                    dest.mux(audio.encode(part))
                dest.mux(audio.encode(None))


def encode_audio(master: Path, out: Path, harder: bool):
    rate, bit_rate = (22050, 32_000) if harder else (44100, 64_000)
    with open(master, "rb") as source, open(out, "w+b") as sink:
        with av.open(source) as inp, av.open(sink, "w", format="mp3") as dest:
            in_audio = next((s for s in inp.streams if s.type == "audio"), None)
            if in_audio is None:
                raise BadInput(f"{master.name} has no audio stream")
            audio = _mono(dest, "libmp3lame", rate, bit_rate)
            resampler = av.AudioResampler(format="s16p", layout="mono", rate=rate, frame_size=1152)
            for frame in inp.decode(in_audio):
                for part in resampler.resample(frame):
                    dest.mux(audio.encode(part))
            for part in resampler.resample(None):
                dest.mux(audio.encode(part))
            dest.mux(audio.encode(None))


def _png(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def encode_image(master: Path, out: Path, harder: bool):
    """Lossless by default; `harder` quantises to 256 colours. Never larger than the master."""
    original = master.read_bytes()
    image = Image.open(io.BytesIO(original))
    image.load()
    best = _png(image)
    if harder:
        alpha = "A" in image.getbands()
        quantised = image.convert("RGBA" if alpha else "RGB").quantize(
            256, method=Image.Quantize.FASTOCTREE if alpha else Image.Quantize.MEDIANCUT)
        best = min(best, _png(quantised), key=len)
    out.write_bytes(min(best, original, key=len))


def duration_of(path: Path):
    """Seconds, rounded to hundredths; null when the container doesn't say."""
    with open(path, "rb") as f, av.open(f) as container:
        return round(container.duration / av.time_base, 2) if container.duration else None


def encode(kind, master: Path, out: Path, harder: bool):
    """Writes the web copy of `master` at `out`; returns its duration in seconds (null for an image)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        {"video": encode_video, "audio": encode_audio, "infographic": encode_image}[kind](master, out, harder)
    except BaseException:
        if out.exists():
            os.remove(out)
        raise
    return {"duration": None if kind == "infographic" else duration_of(out)}
