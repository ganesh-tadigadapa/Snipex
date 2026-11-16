"""PDF operations using PyMuPDF (rendering, merge/split/compress) and pdf2docx (PDF -> DOCX)."""
from __future__ import annotations

import io
import re
from pathlib import Path

import pymupdf
from PIL import Image

from .images import save_image

MAX_RENDER_PAGES = 300


def _open(src: Path) -> pymupdf.Document:
    doc = pymupdf.open(src, filetype="pdf")
    if doc.needs_pass:
        doc.close()
        raise ValueError("This PDF is password-protected")
    return doc


def to_images(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    dpi = max(50, min(300, int(options.get("dpi", 150))))
    results = []
    with _open(src) as doc:
        if doc.page_count == 0:
            raise ValueError("PDF has no pages")
        if doc.page_count > MAX_RENDER_PAGES:
            raise ValueError(f"PDF has more than {MAX_RENDER_PAGES} pages")
        width = len(str(doc.page_count))
        for i, page in enumerate(doc):
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            name = f"{stem}.{dst}" if doc.page_count == 1 else f"{stem}-page-{i + 1:0{width}d}.{dst}"
            target = out_dir / name
            save_image(img, target, dst, quality=90)
            results.append(target)
    return results


def to_docx(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    from pdf2docx import Converter

    with _open(src):
        pass  # surface password / corruption errors with a clear message first
    target = out_dir / f"{stem}.docx"
    cv = Converter(str(src))
    try:
        cv.convert(str(target), multi_processing=False)
    finally:
        cv.close()
    return [target]


def to_txt(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    target = out_dir / f"{stem}.txt"
    with _open(src) as doc, target.open("w", encoding="utf-8") as fh:
        for i, page in enumerate(doc):
            if i:
                fh.write("\n\f\n")
            fh.write(page.get_text("text", sort=True))
    return [target]


# ---- PDF tools ---------------------------------------------------------------------------

def merge(srcs: list[Path], out_dir: Path, stem: str, options: dict) -> list[Path]:
    target = out_dir / f"{stem}.pdf"
    with pymupdf.open() as out:
        for src in srcs:
            with _open(src) as doc:
                out.insert_pdf(doc)
        out.save(target, garbage=3, deflate=True)
    return [target]


def parse_ranges(spec: str, page_count: int) -> list[tuple[int, int]]:
    """'1-3, 5, 8-' -> [(0,2), (4,4), (7,last)] (0-based inclusive)."""
    ranges = []
    for part in re.split(r"[,\s]+", spec.strip()):
        if not part:
            continue
        m = re.fullmatch(r"(\d*)\s*-\s*(\d*)|(\d+)", part)
        if not m:
            raise ValueError(f"Invalid page range '{part}'")
        if m.group(3):
            a = b = int(m.group(3))
        else:
            a = int(m.group(1) or 1)
            b = int(m.group(2) or page_count)
        if a < 1 or b > page_count or a > b:
            raise ValueError(f"Page range '{part}' is outside 1-{page_count}")
        ranges.append((a - 1, b - 1))
    if not ranges:
        raise ValueError("No page ranges given")
    return ranges


def split(src: Path, out_dir: Path, stem: str, options: dict) -> list[Path]:
    """mode=pages: one PDF per page. mode=ranges: one PDF per range. mode=extract: one PDF with the selected pages."""
    mode = options.get("mode", "pages")
    results = []
    with _open(src) as doc:
        n = doc.page_count
        if mode == "pages":
            ranges = [(i, i) for i in range(n)]
        else:
            ranges = parse_ranges(str(options.get("ranges", "")), n)
        if mode == "extract":
            target = out_dir / f"{stem}-extracted.pdf"
            with pymupdf.open() as out:
                for a, b in ranges:
                    out.insert_pdf(doc, from_page=a, to_page=b)
                out.save(target, garbage=3, deflate=True)
            return [target]
        width = len(str(n))
        for a, b in ranges:
            label = f"{a + 1:0{width}d}" if a == b else f"{a + 1:0{width}d}-{b + 1:0{width}d}"
            target = out_dir / f"{stem}-p{label}.pdf"
            with pymupdf.open() as out:
                out.insert_pdf(doc, from_page=a, to_page=b)
                out.save(target, garbage=3, deflate=True)
            results.append(target)
    return results


COMPRESSION_LEVELS = {
    # level: (dpi threshold, dpi target, jpeg quality)
    "low": (300, 200, 85),
    "medium": (200, 150, 70),
    "high": (150, 96, 55),
}


def compress(src: Path, out_dir: Path, stem: str, options: dict) -> list[Path]:
    level = options.get("level", "medium")
    threshold, target_dpi, quality = COMPRESSION_LEVELS.get(level, COMPRESSION_LEVELS["medium"])
    target = out_dir / f"{stem}.pdf"
    with _open(src) as doc:
        doc.rewrite_images(dpi_threshold=threshold, dpi_target=target_dpi, quality=quality, lossy=True, lossless=True)
        doc.subset_fonts()
        doc.scrub(metadata=False, xml_metadata=False, thumbnails=True, reset_fields=False, reset_responses=False)
        buf = io.BytesIO()
        doc.save(buf, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, clean=True, use_objstms=True)
    data = buf.getvalue()
    original = src.read_bytes()
    target.write_bytes(data if len(data) < len(original) else original)
    return [target]
