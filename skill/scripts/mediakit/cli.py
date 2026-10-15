"""The media kit's command line. Exit codes as the reader's: 0 done, 2 bad input, 3 refused (the file
would be written inside a repo), 4 internal (media_kit.py)."""

import argparse
import hashlib
from pathlib import Path

from mediakit.encode import KINDS, encode
from mediakit.evidence import EVERY, evidence
from reader.errors import BadInput, Refused
from reader.paths import _enclosing_repo, long_path, shown
from reader.transcribe import DEFAULT_MODEL, Whisper

EXIT_CODES = {BadInput: 2, Refused: 3}


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise BadInput(message)


def _parser():
    parser = _Parser(prog="media_kit.py", description="Re-encode or read one downloaded media file.")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    for name in ("encode", "evidence"):
        command = commands.add_parser(name)
        command.add_argument("--kind", required=True, choices=KINDS)
        command.add_argument("--master", required=True, help="the downloaded master (in the Private folder)")
        command.add_argument("--out", required=True,
                             help="the web file to write" if name == "encode" else "the evidence folder to write")
        if name == "encode":
            command.add_argument("--harder", action="store_true",
                                 help="the harder profile, for a file still over the size limit")
        else:
            command.add_argument("--whisper-model", default=DEFAULT_MODEL,
                                 help=f"faster-whisper model (default {DEFAULT_MODEL})")
            command.add_argument("--every", type=float, default=EVERY,
                                 help=f"seconds between the sampled video frames (default {EVERY:g})")
    return parser


def _outside_repo(out: Path):
    """What the kit writes derives from the masters: it sits outside any repo, so it can't be committed."""
    repo = _enclosing_repo(out)
    if repo is not None:
        raise Refused(f"{shown(out)} is inside the repo {shown(repo)}; the kit writes outside any repo")


def _master(args) -> Path:
    master = long_path(args.master)
    if not master.is_file():
        raise BadInput(f"no file {shown(master)}")
    return master


def run(argv, transcriber=None):
    """Run one command; returns (exit code, the JSON report)."""
    try:
        args = _parser().parse_args(argv)
        master, out = _master(args), long_path(args.out)
        _outside_repo(out)
        if args.command == "encode":
            return 0, {"ok": True, **encode(args.kind, master, out, args.harder)}
        transcriber = transcriber or Whisper(args.whisper_model, "en")
        digest = hashlib.sha256(master.read_bytes()).hexdigest()
        return 0, {"ok": True, **evidence(args.kind, master, args.master, out, digest, transcriber, args.every)}
    except tuple(EXIT_CODES) as e:
        return EXIT_CODES[type(e)], {"ok": False, "error": str(e)}
