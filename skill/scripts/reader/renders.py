"""What every render is held to, PDF page or slide: one DPI, and each render looked at."""

from reader.errors import BlankRender

# Enough for subscripts and hand-written annotations in a crop.
DPI = 200


def is_flat(image) -> bool:
    """Whether a render (a PIL image) is one colour all over."""
    return all(low == high for low, high in image.convert("RGB").getextrema())


def blank_render(what: str, numbers: list, source: str) -> BlankRender:
    """The failure for renders of content that came out flat: `what` is "page" or "slide"."""
    return BlankRender(f"{what}(s) {', '.join(map(str, numbers))} have content but rendered to "
                       f"one flat colour; look at {source} before trusting any render of it")
