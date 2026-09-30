"""The machine venv's lock file: current with pyproject.toml, and pinning every tool the spec needs."""

import subprocess
import tomllib
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1] / "skill"
SPEC_TOOLS = ["build123d", "faster-whisper", "control", "sympy", "coolprop", "awlsim", "python-pptx",
              "pypdfium2"]  # pypdfium2: the PDF renderer the Materials reader needs


def test_the_lock_file_is_current_with_pyproject():
    result = subprocess.run(["uv", "lock", "--check", "--project", str(SKILL)],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_every_venv_tool_is_pinned_to_one_version():
    lock = tomllib.loads((SKILL / "uv.lock").read_text(encoding="utf-8"))
    pinned = {}
    for package in lock["package"]:
        pinned.setdefault(package["name"], set()).add(package["version"])

    for tool in SPEC_TOOLS:
        assert len(pinned.get(tool, ())) == 1, f"{tool} is not pinned exactly once"
