"""Where the reader reads from and writes to: Windows long paths, and the Private folder rule."""

import os
from pathlib import Path

from reader.errors import Refused


def long_path(path) -> Path:
    """`path` as Windows opens it past 260 characters, with long paths off in the registry (the
    default): absolute, every 8.3 short name expanded (%TEMP% is often `C:\\Users\\ALAAYO~1\\...`),
    and prefixed `\\\\?\\`. Other systems get the absolute path."""
    absolute = os.path.abspath(path)
    if os.name != "nt" or absolute.startswith("\\\\?\\"):
        return Path(absolute)
    return Path(_prefixed(_expand_short_names(absolute)))


def _prefixed(path):
    return "\\\\?\\UNC\\" + path[2:] if path.startswith("\\\\") else "\\\\?\\" + path


def _unprefixed(path):
    if path.startswith("\\\\?\\UNC\\"):
        return "\\\\" + path[8:]
    return path[4:] if path.startswith("\\\\?\\") else path


def _expand_short_names(path):
    """Expand the longest part of `path` that exists (GetLongPathNameW needs it on disk)."""
    import ctypes

    get_long = ctypes.windll.kernel32.GetLongPathNameW
    head, rest = path, []
    while True:
        prefixed = _prefixed(head)
        size = get_long(prefixed, None, 0)
        if size:
            buffer = ctypes.create_unicode_buffer(size)
            if get_long(prefixed, buffer, size):
                return os.path.join(_unprefixed(buffer.value), *reversed(rest))
        parent, name = os.path.split(head)
        if not name or parent == head:
            return path
        head = parent
        rest.append(name)


def is_within(child: Path, parent: Path) -> bool:
    """Both from `long_path`. Windows paths compare case-insensitively."""
    child, parent = os.path.normcase(child), os.path.normcase(parent)
    return child == parent or child.startswith(parent.rstrip(os.sep) + os.sep)


def _enclosing_repo(path: Path):
    for folder in (path, *path.parents):
        if (folder / ".git").exists():
            return folder
    return None


def check_private_folder(private: Path, materials: Path):
    """The Private folder sits beside the Materials, outside any repo, so nothing the reader
    writes (renders, the Professor's narration, deck videos) can be committed to a Course project
    or be taken for a Material by the next hash diff."""
    if is_within(private, materials):
        raise Refused(f"the Private folder {shown(private)} is inside the Materials "
                      "folder; it sits beside it")
    repo = _enclosing_repo(private)
    if repo is not None:
        raise Refused(f"the Private folder {shown(private)} is inside the repo "
                      f"{shown(repo)}; it sits outside any repo")


def shown(path: Path) -> str:
    """A path for a message: without the long-path prefix."""
    return _unprefixed(str(path))
