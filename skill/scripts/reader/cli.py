"""The Materials reader's command line. Commands, flags and exit codes: README.md."""

import argparse
import json
import shutil
from functools import partial

from reader.crop import crop

from reader.deck import read_deck
from reader.errors import BadInput, BlankRender, Refused, ToolFailed
from reader.paths import check_private_folder, is_within, long_path, shown
from reader.pdf import read_pdf
from reader.slides import PowerPoint
from reader.transcribe import DEFAULT_MODEL, Whisper


EXIT_CODES = {BlankRender: 1, BadInput: 2, Refused: 3, ToolFailed: 5}


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
    read.add_argument("--language", default=None,
                      help="narration language code, e.g. ar (default: detected per clip)")
    read.add_argument("file", help="the Materials file, relative to --materials")
    cut = commands.add_parser("crop")
    cut.add_argument("--materials", required=True, help="the Course's Materials folder")
    cut.add_argument("--private", required=True, help="the Course's Private folder")
    cut.add_argument("--render", required=True,
                     help="the rendered page or slide, relative to --private")
    cut.add_argument("--box", required=True,
                     help="x0,y0,x1,y1: the region, as fractions of the render's width and height")
    cut.add_argument("--out", required=True, help="the crop to write (.png), relative to --private")
    return parser


def _crop(args):
    materials, private = long_path(args.materials), long_path(args.private)
    check_private_folder(private, materials)
    return crop(private, args.render, args.box, args.out)


def _read(args, transcriber, powerpoint):
    materials, private = long_path(args.materials), long_path(args.private)
    material = long_path(materials / args.file)
    if not is_within(material, materials) or material == materials:
        raise BadInput(f"{args.file} is not inside the Materials folder {shown(materials)}")
    if not material.is_file():
        raise BadInput(f"no file {shown(material)}")
    transcriber = transcriber or Whisper(args.whisper_model, args.language)
    readers = {".pdf": read_pdf,
               ".pptx": partial(read_deck, transcriber=transcriber,
                                render_slides=powerpoint(private / "reader"))}
    reader = readers.get(material.suffix.lower())
    if reader is None:
        raise BadInput(f"{args.file}: the reader reads {', '.join(readers)}; look at other "
                       "files directly")
    check_private_folder(private, materials)

    # Read into a staging folder, so a failed read leaves the last good one in place.
    relative = material.relative_to(materials)
    final = private / "reader" / relative
    staging = final.with_name(final.name + ".reading")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    def published(path):
        """A path a reader wrote, as the manifest gives it: relative to the Private folder."""
        return (final / path.relative_to(staging)).relative_to(private).as_posix()

    try:
        manifest = {"material": relative.as_posix(), **reader(material, staging)}
        (staging / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False, default=published),
            encoding="utf-8")
    except BaseException as e:
        shutil.rmtree(staging)
        if type(e) in EXIT_CODES:
            raise type(e)(f"{args.file}: {e}") from None
        raise
    if final.exists():
        shutil.rmtree(final)
    staging.rename(final)
    return {"manifest": published(staging / "manifest.json"), "kind": manifest["kind"]}


def run(argv, transcriber=None, powerpoint=PowerPoint):
    """Run one command; returns (exit code, the JSON report). `powerpoint(work_root)` makes the
    slide renderer."""
    try:
        args = _parser().parse_args(argv)
        if args.command == "crop":
            return 0, {"ok": True, **_crop(args)}
        return 0, {"ok": True, **_read(args, transcriber, powerpoint)}
    except tuple(EXIT_CODES) as e:
        return EXIT_CODES[type(e)], {"ok": False, "error": str(e)}
