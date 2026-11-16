"""Central conversion registry.

Every supported (input -> output) pair is declared here with the engine that performs it,
its expected quality and known limitations. A conversion is only advertised to clients when
it is `enabled` AND every external dependency it `requires` is present on this server.
Each entry is exercised by tests/test_conversions.py.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from .config import settings
from .formats import FORMATS


@dataclass(frozen=True)
class Conversion:
    src: str
    dst: str
    engine: str          # "module:function" inside app.engines
    quality: str         # "high" | "good" | "basic"
    notes: str = ""
    requires: tuple[str, ...] = ()
    enabled: bool = True

    @property
    def available(self) -> bool:
        return self.enabled and all(_dependency_available(d) for d in self.requires)


def _dependency_available(dep: str) -> bool:
    if dep == "libreoffice":
        return settings.soffice is not None
    return True


LO = ("libreoffice",)
_registry: dict[tuple[str, str], Conversion] = {}


def register(src: str, dsts: list[str], engine: str, quality: str = "high", notes: str = "", requires: tuple = ()) -> None:
    for dst in dsts:
        assert src in FORMATS and dst in FORMATS, (src, dst)
        assert src != dst
        _registry[(src, dst)] = Conversion(src, dst, engine, quality, notes, requires)


# ---- Office documents (LibreOffice) -------------------------------------------------------
register("docx", ["pdf", "odt", "rtf", "doc", "html"], "office:convert", requires=LO)
register("docx", ["txt"], "text:docx_to_txt", notes="Text and table contents only; formatting is dropped.")
register("doc", ["pdf", "docx", "odt", "rtf", "txt", "html"], "office:convert", requires=LO)
register("odt", ["pdf", "docx", "doc", "rtf", "txt", "html"], "office:convert", requires=LO)
register("rtf", ["pdf", "docx", "odt", "txt"], "office:convert", requires=LO)

# ---- Presentations ------------------------------------------------------------------------
register("pptx", ["pdf", "odp", "ppt"], "office:convert", requires=LO)
register("ppt", ["pdf", "pptx", "odp"], "office:convert", requires=LO)
register("odp", ["pdf", "pptx", "ppt"], "office:convert", requires=LO)

# ---- Spreadsheets -------------------------------------------------------------------------
register("xlsx", ["pdf", "ods", "xls"], "office:convert", requires=LO)
register("xlsx", ["csv"], "data:xlsx_convert", notes="Each sheet becomes its own CSV (zipped when there are several). Formulas export their last saved values.")
register("xlsx", ["json"], "data:xlsx_convert", notes="First row is used as field names. Formulas export their last saved values.")
register("xls", ["pdf", "xlsx", "ods", "csv"], "office:convert", requires=LO, notes="CSV: one file per sheet.")
register("ods", ["pdf", "xlsx", "xls", "csv"], "office:convert", requires=LO, notes="CSV: one file per sheet.")
register("csv", ["xlsx", "json", "html", "pdf"], "data:csv_convert", notes="Delimiter is detected automatically.")
register("csv", ["ods"], "office:convert", requires=LO)

# ---- Plain text / markup ------------------------------------------------------------------
register("txt", ["pdf", "docx", "html"], "text:txt_convert")
register("md", ["html", "pdf", "txt"], "text:md_convert")
register("html", ["pdf"], "text:html_convert", quality="basic", notes="Scripts, external images and stylesheets are not loaded; layout is simplified.")
register("html", ["txt", "md"], "text:html_convert", quality="good")
register("epub", ["pdf"], "text:epub_convert", quality="basic", notes="Text and structure only; book images and styling are not included.")
register("epub", ["txt", "html"], "text:epub_convert", quality="good")

# ---- Images -------------------------------------------------------------------------------
RASTER = ["jpg", "png", "webp", "bmp", "tiff", "gif"]
for _src in RASTER:
    register(_src, [d for d in RASTER + ["pdf"] if d != _src], "images:convert",
             notes="Transparency is flattened onto white for JPG, BMP and PDF. Animated images keep only the first frame unless converting to GIF or PDF.")
register("svg", ["png", "jpg", "webp", "pdf"], "images:convert_svg", quality="good",
         notes="Rendered by MuPDF; external fonts and linked images are not fetched.")

# ---- PDF ----------------------------------------------------------------------------------
register("pdf", ["png", "jpg", "webp"], "pdf:to_images", notes="One image per page at 150 DPI; multi-page PDFs are delivered as a ZIP.")
register("pdf", ["docx"], "pdf:to_docx", quality="good", notes="Layout reconstruction: complex layouts may shift. Scanned PDFs without a text layer produce images only.")
register("pdf", ["txt"], "pdf:to_txt", quality="good", notes="Extracts the text layer; scanned pages without OCR yield no text.")

# ---- Data ---------------------------------------------------------------------------------
register("json", ["csv", "xlsx"], "data:json_convert", quality="good", notes="Nested objects are flattened to dotted column names.")
register("json", ["xml"], "data:json_convert")
register("xml", ["json"], "data:xml_convert", notes="Attributes become '@name' keys; repeated elements become arrays.")


def get(src: str, dst: str) -> Conversion | None:
    conv = _registry.get((src, dst))
    return conv if conv and conv.available else None


def all_conversions(include_unavailable: bool = False) -> list[Conversion]:
    return [c for c in _registry.values() if include_unavailable or c.available]


def targets_for(src: str) -> list[str]:
    return [c.dst for c in all_conversions() if c.src == src]


def describe() -> dict:
    """Public, client-facing description of formats and conversions."""
    convs = all_conversions()
    inputs = sorted({c.src for c in convs})
    used = {c.src for c in convs} | {c.dst for c in convs}
    return {
        "formats": [
            {"id": f.id, "label": f.label, "category": f.category, "extensions": list(f.extensions)}
            for f in FORMATS.values() if f.id in used
        ],
        "inputs": inputs,
        "conversions": [
            {k: v for k, v in asdict(c).items() if k in ("src", "dst", "quality", "notes")} for c in convs
        ],
        "unavailable": [
            {"src": c.src, "dst": c.dst, "missing": [d for d in c.requires if not _dependency_available(d)]}
            for c in all_conversions(include_unavailable=True) if not c.available
        ],
    }
