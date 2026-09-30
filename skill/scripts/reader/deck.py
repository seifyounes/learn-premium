""".pptx Materials: each slide's text and notes, its audio (transcribed) and its embedded video."""

import io
import json
import zipfile
from pathlib import Path

from lxml import etree
from reader.errors import BadInput

AUDIO = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio"
VIDEO = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video"
MEDIA = "http://schemas.microsoft.com/office/2007/relationships/media"
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
}
# PowerPoint's Record Slide Show marks the audio it records as narration in the slide's timing.
NARRATED_SHAPES = etree.XPath(
    ".//p:timing//p:audio[@isNarration='1']//p:spTgt/@spid", namespaces=NS)
MEDIA_RIDS = etree.XPath(
    ".//p:pic[p:nvPicPr/p:cNvPr/@id=$spid]/p:nvPicPr/p:nvPr//@r:link"
    " | .//p:pic[p:nvPicPr/p:cNvPr/@id=$spid]/p:nvPicPr/p:nvPr//@r:embed", namespaces=NS)


def _texts(shapes):
    for shape in shapes:
        if shape.shape_type is not None and shape.shape_type == 6:  # MSO_SHAPE_TYPE.GROUP
            yield from _texts(shape.shapes)
        elif shape.has_text_frame and shape.text_frame.text.strip():
            yield shape.text_frame.text
        elif getattr(shape, "has_table", False) and shape.has_table:
            for row in shape.table.rows:
                yield " | ".join(cell.text for cell in row.cells)


def _media(slide):
    """The slide's media, one entry per media file (a clip is linked by several relationships):
    (key, kind, part or None, external target or None)."""
    found = {}
    for rel in slide.part.rels.values():
        if rel.reltype not in (AUDIO, VIDEO, MEDIA):
            continue
        key = rel.target_ref if rel.is_external else rel.target_part.partname
        entry = found.setdefault(key, {"reltypes": set(), "rel": rel})
        entry["reltypes"].add(rel.reltype)
    for key, entry in found.items():
        rel = entry["rel"]
        if VIDEO in entry["reltypes"]:
            kind = "video"
        elif AUDIO in entry["reltypes"]:
            kind = "audio"
        else:
            kind = "video" if rel.target_part.content_type.startswith("video/") else "audio"
        yield key, kind, rel


def _narrated(slide):
    """Keys (as `_media` gives them) of the media PowerPoint recorded as narration."""
    rels = slide.part.rels
    keys = set()
    for spid in NARRATED_SHAPES(slide._element):
        for rid in MEDIA_RIDS(slide._element, spid=spid):
            rel = rels.get(rid)
            if rel is not None:
                keys.add(rel.target_ref if rel.is_external else rel.target_part.partname)
    return keys


def read_deck(data: bytes, out: Path, private: Path, transcriber) -> dict:
    from pptx import Presentation

    def rel(path):
        return path.relative_to(private).as_posix()

    try:
        presentation = Presentation(io.BytesIO(data))
    except (zipfile.BadZipFile, KeyError, ValueError) as e:
        raise BadInput(f"not a .pptx deck ({e})") from None
    slides = []
    for number, slide in enumerate(presentation.slides, start=1):
        title = slide.shapes.title.text if slide.shapes.title is not None else ""
        body = [t for t in _texts(slide.shapes) if t != title]
        notes = (slide.notes_slide.notes_text_frame.text
                 if slide.has_notes_slide and slide.notes_slide.notes_text_frame else "")
        entry = {"number": number, "title": title, "text": "\n".join(body), "notes": notes,
                 "audio": [], "video": []}
        narrated = _narrated(slide)
        for key, kind, rel_ in _media(slide):
            index = len(entry[kind]) + 1
            item = {}
            if rel_.is_external:
                item["linked"] = rel_.target_ref
            else:
                media_dir = out / "media"
                media_dir.mkdir(parents=True, exist_ok=True)
                path = media_dir / f"slide-{number:02d}-{kind}-{index}.{rel_.target_part.partname.ext}"
                path.write_bytes(rel_.target_part.blob)
                item["file"] = rel(path)
            if kind == "audio":
                item["narration"] = key in narrated
                if "file" in item:
                    transcripts = out / "transcripts"
                    transcripts.mkdir(exist_ok=True)
                    transcript = transcripts / f"slide-{number:02d}-audio-{index}.json"
                    heard = transcriber(private / item["file"])
                    transcript.write_text(json.dumps(heard, indent=2, ensure_ascii=False),
                                          encoding="utf-8")
                    item["transcript"] = rel(transcript)
            else:
                # Deck-embedded video is source only: never re-hosted, never copied into a Course project.
                item["sourceOnly"] = True
            entry[kind].append(item)
        slides.append(entry)
    return {"kind": "deck", "slides": slides}
