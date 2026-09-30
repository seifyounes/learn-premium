"""Narration transcribed locally with faster-whisper: the audio never leaves the machine."""

from pathlib import Path

DEFAULT_MODEL = "small"


class Whisper:
    """Loads the model on first use (the first run downloads it into the Hugging Face cache), so a
    read with no audio never pays for it. CPU with int8: no CUDA libraries needed."""

    def __init__(self, model=DEFAULT_MODEL):
        self.model_name = model
        self._model = None

    def __call__(self, audio: Path) -> dict:
        from faster_whisper import WhisperModel

        if self._model is None:
            self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
        # An open file, not the path: PyAV's own path handling doesn't take the long-path prefix.
        with open(audio, "rb") as f:
            segments, info = self._model.transcribe(f, vad_filter=True)
            segments = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                        for s in segments]
        return {"model": self.model_name, "language": info.language,
                "text": " ".join(s["text"] for s in segments), "segments": segments}
