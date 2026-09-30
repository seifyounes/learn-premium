"""The Materials reader's command line. Commands, flags and exit codes: README.md."""

import argparse
import json
import shutil

from reader.deck import read_deck
from reader.errors import BadInput, BlankRender, Refused
from reader.paths import check_private_folder, is_within, long_path, shown
from reader.pdf import read_pdf
from reader.transcribe import DEFAULT_MODEL, Whisper

READERS = {".pdf": "pdf", ".pptx": "deck"}


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise BadInput(message)


def _parser():
    parser = _Parser(prog="materials_reader.py", description="Read one Materials file.")
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    read = commands.add_parser("read")
    read.add_argument("--materials", required=True, help="the Course's Materials folder")
    read.add_argument("--private", required=True, help="the Course's Private folder")
    read.add_argument("--whisper-model", default=DEFAULT_MODEL,
                      help=f"faster-whisper model for narration (default {DEFAULT_MODEL})")
    read.add_argument("file", help="the Materials file, relative to --materials")
    return parser


def _read(args, transcriber):
    materials, private = long_path(args.materials), long_path(args.private)
    material = long_path(materials / args.file)
    if not is_within(material, materials) or material == materials:
        raise BadInput(f"{args.file} is not inside the Materials folder {shown(materials)}")
    if not material.is_file():
        raise BadInput(f"no file {shown(material)}")
    kind = READERS.get(material.suffix.lower())
    if kind is None:
        raise BadInput(f"{args.file}: the reader reads {', '.join(READERS)}; look at other "
                       "files directly")
    check_private_folder(private, materials)

    relative = material.relative_to(materials)
    out = private / "reader" / relative
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    data = material.read_bytes()
    try:
        if kind == "pdf":
            manifest = read_pdf(data, out, private)
        else:
            manifest = read_deck(data, out, private, transcriber or Whisper(args.whisper_model))
    except BadInput as e:
        shutil.rmtree(out)
        raise BadInput(f"{args.file}: {e}") from None
    except BlankRender as e:
        shutil.rmtree(out)
        raise BlankRender(f"{args.file}: {e}") from None
    manifest = {"material": relative.as_posix(), **manifest}
    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"manifest": manifest_path.relative_to(private).as_posix(), "kind": kind}


def run(argv, transcriber=None):
    """Run one command; returns (exit code, the JSON report)."""
    try:
        args = _parser().parse_args(argv)
        return 0, {"ok": True, **_read(args, transcriber)}
    except BadInput as e:
        return 2, {"ok": False, "error": str(e)}
    except BlankRender as e:
        return 1, {"ok": False, "error": str(e)}
    except Refused as e:
        return 3, {"ok": False, "error": str(e)}
