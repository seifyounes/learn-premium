"""Makes the Fixture Course's synthetic Module media: a few seconds of video and audio and one
infographic, drawn here from nothing (no NotebookLM, no Professor's material). They only have to
exercise the Watch and Summary slots, so they are tiny.

Run from the repo root with the machine venv's PyAV and Pillow:

    uv run --project skill python fixture-course/tools/make-media.py
"""

from fractions import Fraction
from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "modules" / "01-thermal-resistance" / "media"

# The green pad (DESIGN.md) and the fixed inks.
SHEET = (230, 239, 220)
GRID_FINE = (202, 219, 187)
GRID_MAJOR = (185, 206, 167)
PRINT = (46, 90, 56)
GRAPHITE = (38, 43, 37)
PENCIL = (61, 67, 60)

SECONDS = 4
FPS = 12


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def paper(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), SHEET)
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 20):
        draw.line([(x, 0), (x, height)], fill=GRID_MAJOR if x % 100 == 0 else GRID_FINE)
    for y in range(0, height, 20):
        draw.line([(0, y), (width, y)], fill=GRID_MAJOR if y % 100 == 0 else GRID_FINE)
    return image


def video_frame(t: float) -> Image.Image:
    """A wall's temperature profile drawing itself in, under a printed caption."""
    image = paper(640, 360)
    draw = ImageDraw.Draw(image)
    draw.text((40, 24), "Synthetic explainer: Fixture Course", fill=PRINT, font=font(24))
    x0, x1, y_hot, y_cold = 120, 520, 110, 300
    draw.line([(x0, 90), (x0, 320)], fill=PENCIL, width=2)
    draw.line([(x1, 90), (x1, 320)], fill=PENCIL, width=2)
    progress = min(t / (SECONDS * 0.75), 1.0)
    x = x0 + (x1 - x0) * progress
    y = y_hot + (y_cold - y_hot) * progress
    draw.line([(x0, y_hot), (x, y)], fill=GRAPHITE, width=4)
    draw.ellipse([(x0 - 6, y_hot - 6), (x0 + 6, y_hot + 6)], fill=GRAPHITE)
    return image


def make_video() -> None:
    with av.open(str(OUT / "explainer.mp4"), "w", options={"movflags": "faststart"}) as out:
        stream = out.add_stream("libx264", rate=FPS)
        stream.width, stream.height, stream.pix_fmt = 640, 360, "yuv420p"
        stream.options = {"crf": "32", "preset": "veryslow"}
        for i in range(SECONDS * FPS):
            frame = av.VideoFrame.from_image(video_frame(i / FPS))
            out.mux(stream.encode(frame))
        out.mux(stream.encode(None))


def make_audio() -> None:
    """Silence: the slot needs a playable file, not a voice."""
    rate = 22050
    with av.open(str(OUT / "deep-dive.mp3"), "w") as out:
        stream = out.add_stream("libmp3lame", rate=rate)
        stream.bit_rate = 32_000
        stream.layout = "mono"
        samples = 1152
        for i in range(SECONDS * rate // samples):
            frame = av.AudioFrame(format="s16p", layout="mono", samples=samples)
            frame.planes[0].update(bytes(samples * 2))
            frame.sample_rate = rate
            frame.pts = i * samples
            frame.time_base = Fraction(1, rate)
            out.mux(stream.encode(frame))
        out.mux(stream.encode(None))


def make_captions() -> None:
    (OUT / "explainer.vtt").write_text(
        "WEBVTT\n\n00:00.000 --> 00:04.000\n[Synthetic fixture video: no narration]\n",
        encoding="utf-8",
        newline="\n",
    )


def make_infographic() -> None:
    image = paper(900, 1200)
    draw = ImageDraw.Draw(image)
    draw.rectangle([(40, 40), (860, 140)], outline=PRINT, width=4)
    draw.text((64, 62), "THERMAL RESISTANCE", fill=PRINT, font=font(52))
    panels = [
        ("A wall resists heat", "R = L / (k A)"),
        ("Layers add in series", "R total = R1 + R2 + R3"),
        ("The drop drives the heat", "Q = (T1 - T4) / R total"),
    ]
    for i, (title, rule) in enumerate(panels):
        top = 200 + i * 320
        draw.rectangle([(40, top), (860, top + 260)], outline=PENCIL, width=3)
        draw.text((72, top + 32), title, fill=GRAPHITE, font=font(44))
        draw.text((72, top + 140), rule, fill=PENCIL, font=font(40))
    draw.text((40, 1150), "Synthetic infographic: Fixture Course", fill=PENCIL, font=font(24))
    image.save(OUT / "infographic.png", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    make_video()
    make_audio()
    make_captions()
    make_infographic()
    for path in sorted(OUT.iterdir()):
        print(f"{path.name}: {path.stat().st_size} bytes")
