"""PDF Materials: every page rendered to a PNG, and every render looked at."""

from pathlib import Path

from reader.errors import BadInput, BlankRender

# Enough for subscripts and hand-written annotations in a crop.
DPI = 200


def read_pdf(data: bytes, out: Path, private: Path) -> dict:
    import pypdfium2 as pdfium

    try:
        document = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as e:
        raise BadInput(f"not a PDF the renderer can open ({e})") from None
    pages_dir = out / "pages"
    pages_dir.mkdir()
    pages, blank = [], []
    try:
        for number, page in enumerate(document, start=1):
            image = page.render(scale=DPI / 72).to_pil()
            empty = next(iter(page.get_objects()), None) is None
            flat = all(low == high for low, high in image.getextrema())
            if flat and not empty:
                blank.append(number)
            path = pages_dir / f"page-{number:03d}.png"
            image.save(path)
            pages.append({"number": number, "image": path.relative_to(private).as_posix(),
                          "empty": empty})
    finally:
        document.close()
    if blank:
        raise BlankRender(f"page(s) {', '.join(map(str, blank))} have content but rendered to "
                          "one flat colour; look at the PDF before trusting any render of it")
    return {"kind": "pdf", "pages": pages}
