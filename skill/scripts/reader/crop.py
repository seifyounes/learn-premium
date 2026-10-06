"""Cutting a region out of a rendered page: the crop a Blind-reader dispute is settled on. Both the
render and the crop sit in the Private folder; nothing is read or written anywhere else."""

import math

from PIL import Image

from reader.errors import BadInput
from reader.paths import is_within, long_path, shown


def parse_box(text):
    """`x0,y0,x1,y1` as fractions of the page's width and height, top-left origin."""
    try:
        box = [float(part) for part in text.split(",")]
    except ValueError:
        box = []
    if len(box) != 4 or not (0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1):
        raise BadInput(f"--box {text}: give x0,y0,x1,y1 as fractions of the page, "
                       "0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1")
    return box


def inside(private, relative, flag):
    """`relative` (to the Private folder) as a path, refused unless it stays inside it."""
    path = long_path(private / relative)
    if not is_within(path, private) or path == private:
        raise BadInput(f"{flag} {relative} is not inside the Private folder {shown(private)}")
    return path


def crop(private, render_rel, box_text, out_rel):
    """Writes the region `box_text` of the render at `render_rel` to `out_rel` (a .png); returns
    the crop's path relative to the Private folder and its size in pixels."""
    box = parse_box(box_text)
    render = inside(private, render_rel, "--render")
    out = inside(private, out_rel, "--out")
    if out.suffix.lower() != ".png":
        raise BadInput(f"--out {out_rel}: a crop is written as a .png")
    if not render.is_file():
        raise BadInput(f"no render {shown(render)}")
    with Image.open(render) as image:
        width, height = image.size
        # Rounded outwards, so the region the reader gave is all in the crop.
        pixels = (math.floor(box[0] * width), math.floor(box[1] * height),
                  math.ceil(box[2] * width), math.ceil(box[3] * height))
        region = image.crop(pixels)
        out.parent.mkdir(parents=True, exist_ok=True)
        region.save(out)
    return {"crop": out.relative_to(private).as_posix(), "size": list(region.size)}
