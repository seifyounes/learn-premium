"""What the fact-check subagent reads: for a video, frames sampled across it and its narration transcribed;
for an audio, its transcript; for an infographic, the image itself."""

import json
from pathlib import Path

import av

from mediakit.encode import duration_of
from reader.errors import BadInput

EVERY = 15.0
MAX_FRAMES = 40
FORMAT = "learn-premium media evidence v1"


def sample_times(length: float, every: float):
    """t = 0 and then every `every` seconds through the video; past MAX_FRAMES samples the spacing widens
    to length / MAX_FRAMES, so the frames still span the whole video."""
    step = max(every, length / MAX_FRAMES)
    return [i * step for i in range(MAX_FRAMES) if i * step < max(length, 1e-9)]


def _frames(master: Path, out: Path, every: float, length: float):
    """The frames at `sample_times`, as frames/frame-NNN.png."""
    names = []
    (out / "frames").mkdir(parents=True, exist_ok=True)
    targets = sample_times(length, every)
    with open(master, "rb") as f, av.open(f) as container:
        stream = next(s for s in container.streams if s.type == "video")
        for target in targets:
            container.seek(int(target / stream.time_base), stream=stream, backward=True)
            picked = None
            for frame in container.decode(stream):
                picked = frame
                if frame.time is not None and frame.time + 1e-6 >= target:
                    break
            if picked is None:
                continue
            name = f"frames/frame-{len(names) + 1:03d}.png"
            picked.to_image().save(out / name)
            names.append(name)
    return names


def _has_audio(master: Path):
    with open(master, "rb") as f, av.open(f) as container:
        return any(s.type == "audio" for s in container.streams)


def evidence(kind, master: Path, given, out: Path, master_hash, transcriber, every):
    """Writes `evidence.json` (and the frames and transcript it names) into the folder `out`."""
    if every <= 0:
        raise BadInput("--every must be more than 0 seconds")
    out.mkdir(parents=True, exist_ok=True)
    frames, transcript, duration, image = [], None, None, None
    if kind == "infographic":
        image = str(given)
    else:
        duration = duration_of(master)
        if kind == "video":
            frames = _frames(master, out, every, duration or 0.0)
        # A video with no audio track has no narration to read.
        if kind == "audio" or _has_audio(master):
            (out / "transcript.json").write_text(
                json.dumps(transcriber(master), indent=2, ensure_ascii=False), encoding="utf-8")
            transcript = "transcript.json"
    record = {"evidence": FORMAT, "kind": kind, "masterHash": master_hash, "duration": duration,
              "transcript": transcript, "frames": frames, "image": image}
    (out / "evidence.json").write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"evidence": "evidence.json", "frames": len(frames), "transcript": transcript}
