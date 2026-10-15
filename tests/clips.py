"""Synthetic clips for the media kit tests, made in a test's tmp_path with PyAV (the venv's FFmpeg),
so no binary is ever committed: an HD video with stereo audio, and a stereo .m4a."""

from fractions import Fraction

import av
import numpy as np


def _tone(seconds, rate, channels):
    t = np.arange(int(seconds * rate)) / rate
    wave = (0.4 * np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
    return np.repeat(wave[:, None], channels, axis=1)


def _write_tone(container, stream, seconds, rate, channels):
    samples = _tone(seconds, rate, channels)
    layout = "stereo" if channels == 2 else "mono"
    step = 1024
    for start in range(0, len(samples), step):
        chunk = samples[start : start + step]
        frame = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout=layout)
        frame.sample_rate = rate
        frame.pts = start
        frame.time_base = Fraction(1, rate)
        container.mux(stream.encode(frame))
    container.mux(stream.encode(None))


def hd_clip(path, width=1920, height=1080, seconds=2, fps=30, stereo=True):
    """A moving gradient with a little noise, so a harder profile has something to save; with a
    stereo 440 Hz tone (48 kHz AAC) unless `stereo` is False."""
    rng = np.random.default_rng(7)
    xs = np.linspace(0, 255, width, dtype=np.float32)[None, :, None]
    ys = np.linspace(0, 255, height, dtype=np.float32)[:, None, None]
    with av.open(str(path), "w") as out:
        video = out.add_stream("libx264", rate=fps)
        video.width, video.height, video.pix_fmt = width, height, "yuv420p"
        video.options = {"crf": "18", "preset": "ultrafast"}
        audio = None
        if stereo:
            audio = out.add_stream("aac", rate=48000)
            audio.layout = "stereo"
            audio.bit_rate = 192_000
        for i in range(seconds * fps):
            shift = i * 4
            base = np.concatenate(
                [np.roll(xs, shift, axis=1).repeat(height, 0), ys.repeat(width, 1), 255 - xs.repeat(height, 0)],
                axis=2,
            )
            noise = rng.integers(-12, 12, size=base.shape)
            frame = av.VideoFrame.from_ndarray(np.clip(base + noise, 0, 255).astype(np.uint8), format="rgb24")
            frame.pts = i
            frame.time_base = Fraction(1, fps)
            out.mux(video.encode(frame))
        out.mux(video.encode(None))
        if audio is not None:
            _write_tone(out, audio, seconds, 48000, 2)


def stereo_m4a(path, seconds=2):
    """A stereo 440 Hz tone as AAC in an .m4a, the other audio NotebookLM saves."""
    with av.open(str(path), "w", format="ipod") as out:
        stream = out.add_stream("aac", rate=44100)
        stream.layout = "stereo"
        stream.bit_rate = 128_000
        _write_tone(out, stream, seconds, 44100, 2)
