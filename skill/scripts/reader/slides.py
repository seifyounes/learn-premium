""".pptx slides rendered to PNG through PowerPoint's own export (COM automation, driven from
Windows PowerShell by powerpoint.ps1, so the venv needs no COM library)."""

import json
import os
import shutil
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from reader.errors import BadInput, ToolFailed
from reader.paths import shown
from reader.renders import DPI

PROG_ID = "PowerPoint.Application"
SCRIPT = Path(__file__).with_name("powerpoint.ps1")
# A whole deck, PowerPoint's start included; past it the read fails and PowerPoint is closed.
TIMEOUT = 600
# The longest path PowerPoint opens or exports to ("Filename cannot exceed 255 characters"); it
# takes no long-path prefix.
MAX_PATH = 255
LONGEST_NAME = "slide-000.png"
# How long the PowerPoint a read started gets to exit on its own after being quit (or after its
# PowerShell was killed) before it is ended.
EXIT_GRACE = 15
# Machine-wide, like PowerPoint itself.
LOCK = Path(tempfile.gettempdir()) / "learn-premium-powerpoint.lock"


def powerpoint_processes() -> set:
    """Process ids of every running POWERPNT.EXE."""
    if os.name != "nt":
        return set()
    listing = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq POWERPNT.EXE", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, check=True).stdout
    # One `"POWERPNT.EXE","<pid>",...` row per process; no row (only a localized notice) if none.
    return {int(row.split('","')[1]) for row in listing.splitlines()
            if row.upper().startswith('"POWERPNT.EXE"')}


def _end(which):
    """End the PowerPoint processes `which()` names, once they have had EXIT_GRACE seconds to exit
    on their own."""
    deadline = time.monotonic() + EXIT_GRACE
    while pids := which():
        if time.monotonic() > deadline:
            for pid in pids:
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True,
                               check=False)
            return
        time.sleep(0.25)


@contextmanager
def _one_read_at_a_time(timeout):
    """PowerPoint is one process per machine: a second read would share the first one's, and the
    first read's quit would end it mid-export. So reads (from any Course, e.g. both Blind readers
    at once) take turns. The OS drops the lock if a read's process dies."""
    import msvcrt

    with open(LOCK, "a+b") as lock:
        deadline = time.monotonic() + timeout
        while True:
            try:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise ToolFailed(f"another read kept PowerPoint busy for more than {timeout} "
                                     "s") from None
                time.sleep(0.25)
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def _openable(folder: Path) -> str:
    """`folder` as PowerPoint is given it: without the long-path prefix, and short enough for
    every file in it. (8.3 short names don't help: PowerPoint expands them before it opens.)"""
    spelling = shown(folder)
    if len(os.path.join(spelling, LONGEST_NAME)) > MAX_PATH:
        raise BadInput(f"the Private folder is too deep for PowerPoint to render slides in "
                       f"({spelling}); move it to a shorter path")
    return spelling


def _remove(folder: Path):
    """PowerPoint can hold the deck for a moment after it closes it."""
    for _ in range(20):
        try:
            shutil.rmtree(folder)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            time.sleep(0.25)
    # Still held: leave it (it is inside the Private folder) rather than hide why the read ended.
    shutil.rmtree(folder, ignore_errors=True)


class PowerPoint:
    """Renders a deck's slides at the PDF pages' DPI. PowerPoint never opens the Materials file:
    it opens a copy at a short path under `work_root` (inside the Private folder), so decks past
    Windows' 260 characters render and nothing (not even PowerPoint's lock file) is written beside
    the Materials. The copy is removed after the read, and PowerPoint is closed after it, even when
    the read fails."""

    def __init__(self, work_root: Path, prog_id=PROG_ID, timeout=TIMEOUT):
        self.work_root = work_root
        self.prog_id = prog_id
        self.timeout = timeout

    def __call__(self, deck: Path, out: Path) -> list:
        """Renders every slide of `deck` into `out` (created); returns the PNGs in slide order."""
        if os.name != "nt":
            raise ToolFailed("slides render through PowerPoint, which runs on Windows only")
        self.work_root.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix="~powerpoint-", dir=self.work_root))
        try:
            folder = _openable(work)
            shutil.copyfile(deck, work / "deck.pptx")
            with _one_read_at_a_time(self.timeout):
                count = self._export(folder)
            out.mkdir()
            images = []
            for number in range(1, count + 1):
                name = f"slide-{number:03d}.png"
                images.append(out / name)
                shutil.move(work / name, images[-1])
            return images
        finally:
            _remove(work)

    def _export(self, folder: str) -> int:
        running = powerpoint_processes()
        command = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                   "-File", str(SCRIPT), "-Folder", folder, "-Dpi", str(DPI),
                   "-ProgId", self.prog_id, *(["-LeaveRunning"] if running else [])]
        timed_out = False
        try:
            result = subprocess.run(command, capture_output=True, encoding="utf-8",
                                    errors="replace", timeout=self.timeout, check=False)
            output = result.stdout
        except FileNotFoundError:
            raise ToolFailed("Windows PowerShell (powershell.exe), which drives PowerPoint, is not "
                             "on the PATH") from None
        except subprocess.TimeoutExpired as e:
            timed_out, output = True, e.stdout or ""
            if isinstance(output, bytes):
                output = output.decode("utf-8", "replace")
        # {"pid"} once PowerPoint is up, then {"slides", "leftRunning"}.
        report = {}
        for line in output.splitlines():
            if line.startswith("{"):
                report.update(json.loads(line))
        pid = report.get("pid")
        if report.get("leftRunning"):
            pass  # it holds someone else's presentation: never end it
        elif pid:
            if pid not in running:
                _end(lambda: powerpoint_processes() & {pid})
        else:
            # PowerPoint didn't say which process it is (stopped while starting): end any that
            # started during the read.
            _end(lambda: powerpoint_processes() - running)
        if timed_out:
            raise ToolFailed(f"PowerPoint didn't finish rendering the slides within "
                             f"{self.timeout} s; the read was stopped")
        if result.returncode != 0:
            raise ToolFailed(result.stderr.strip()
                             or f"PowerPoint's slide export failed (exit {result.returncode})")
        return report["slides"]
