"""PDF Materials: every page rendered to a PNG, and every render looked at."""

from pathlib import Path

from reader.errors import BadInput, BlankRender

# Enough for subscripts and hand-written annotations in a crop.
DPI = 200


def _has_ink(page, pdfium):
    """Whether the page carries anything a reader would see: text, an image or an annotation.
    A lone background fill (how Word and PowerPoint export a blank page) doesn't count."""
    if pdfium.raw.FPDFPage_GetAnnotCount(page.raw) > 0:
        return True
    if next(iter(page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE])), None) is not None:
        return True
    text = page.get_textpage()
    try:
        return bool(text.get_text_bounded().strip())
    finally:
        text.close()


def read_pdf(material: Path, out: Path) -> dict:
    import pypdfium2 as pdfium

    with open(material, "rb") as f:
        try:
            document = pdfium.PdfDocument(f, autoclose=False)
        except pdfium.PdfiumError as e:
            raise BadInput(f"not a PDF the renderer can open ({e})") from None
        try:
            pages_dir = out / "pages"
            pages_dir.mkdir()
            pages, blank = [], []
            for number, page in enumerate(document, start=1):
                image = page.render(scale=DPI / 72).to_pil()
                flat = all(low == high for low, high in image.getextrema())
                inked = _has_ink(page, pdfium)
                if flat and inked:
                    blank.append(number)
                path = pages_dir / f"page-{number:03d}.png"
                image.save(path)
                pages.append({"number": number, "image": path, "empty": flat and not inked})
        finally:
            document.close()
    if blank:
        raise BlankRender(f"page(s) {', '.join(map(str, blank))} have content but rendered to "
                          "one flat colour; look at the PDF before trusting any render of it")
    return {"kind": "pdf", "pages": pages}
