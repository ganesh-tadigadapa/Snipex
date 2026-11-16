"""Upload validation: file signatures (magic bytes), container inspection, filename hygiene.

The extension a user supplies is never trusted on its own: the file's bytes must match
the claimed format before it is handed to any conversion engine.
"""
from __future__ import annotations

import json
import re
import unicodedata
import zipfile
from pathlib import Path

from defusedxml import ElementTree as SafeET

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP_MAGIC = (b"PK\x03\x04", b"PK\x05\x06")
# Uncompressed-size ceiling for ZIP-based formats (zip-bomb protection).
MAX_UNCOMPRESSED_ZIP = 1024 * 1024 * 1024  # 1 GiB
MAX_ZIP_RATIO = 200


class ValidationError(Exception):
    pass


def safe_filename(name: str, max_len: int = 120) -> str:
    """Reduce a user-provided filename to something safe to show and to put in a download header."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").split("/")[-1]  # strip any directory components
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")  # control chars
    name = re.sub(r'[<>:"|?*]', "_", name).strip().strip(".")
    if not name:
        name = "file"
    if len(name) > max_len:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            name = stem[: max_len - len(ext) - 1] + "." + ext
        else:
            name = name[:max_len]
    return name


def _check_zip(path: Path, required: list[str] | None = None, mimetype: str | None = None) -> None:
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            total = sum(i.file_size for i in infos)
            packed = max(1, sum(i.compress_size for i in infos))
            if total > MAX_UNCOMPRESSED_ZIP or total / packed > MAX_ZIP_RATIO:
                raise ValidationError("Archive expands to an unsafe size")
            names = set(zf.namelist())
            for entry in required or []:
                if entry.endswith("/"):
                    if not any(n.startswith(entry) for n in names):
                        raise ValidationError("File structure does not match its extension")
                elif entry not in names:
                    raise ValidationError("File structure does not match its extension")
            if mimetype is not None:
                if "mimetype" not in names or zf.read("mimetype").strip() != mimetype.encode():
                    raise ValidationError("File structure does not match its extension")
    except zipfile.BadZipFile as exc:
        raise ValidationError("File is corrupted or not a valid archive") from exc


def _read_text(path: Path, limit: int | None = None) -> str:
    data = path.read_bytes() if limit is None else path.open("rb").read(limit)
    if b"\x00" in data:
        raise ValidationError("Binary content in a text file")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return data.decode("latin-1")
        except UnicodeDecodeError as exc:  # pragma: no cover - latin-1 always decodes
            raise ValidationError("Unreadable text encoding") from exc


def validate_file(path: Path, fmt: str) -> None:
    """Raise ValidationError if the bytes at `path` are not a plausible `fmt` file."""
    size = path.stat().st_size
    if size == 0:
        raise ValidationError("File is empty")
    head = path.open("rb").read(64)

    def need(cond: bool) -> None:
        if not cond:
            raise ValidationError(f"File content does not look like {fmt.upper()}")

    if fmt == "pdf":
        need(b"%PDF-" in head[:16])
    elif fmt in ("doc", "xls", "ppt"):
        need(head.startswith(OLE_MAGIC))
    elif fmt == "rtf":
        need(head.lstrip().startswith(b"{\\rtf"))
    elif fmt in ("docx", "xlsx", "pptx"):
        need(head.startswith(ZIP_MAGIC))
        part = {"docx": "word/", "xlsx": "xl/", "pptx": "ppt/"}[fmt]
        _check_zip(path, required=["[Content_Types].xml", part])
    elif fmt in ("odt", "ods", "odp"):
        need(head.startswith(ZIP_MAGIC))
        kind = {"odt": "text", "ods": "spreadsheet", "odp": "presentation"}[fmt]
        _check_zip(path, mimetype=f"application/vnd.oasis.opendocument.{kind}")
    elif fmt == "epub":
        need(head.startswith(ZIP_MAGIC))
        _check_zip(path, mimetype="application/epub+zip")
    elif fmt == "jpg":
        need(head.startswith(b"\xff\xd8\xff"))
    elif fmt == "png":
        need(head.startswith(b"\x89PNG\r\n\x1a\n"))
    elif fmt == "gif":
        need(head[:6] in (b"GIF87a", b"GIF89a"))
    elif fmt == "webp":
        need(head[:4] == b"RIFF" and head[8:12] == b"WEBP")
    elif fmt == "bmp":
        need(head[:2] == b"BM")
    elif fmt == "tiff":
        need(head[:4] in (b"II*\x00", b"MM\x00*"))
    elif fmt == "svg":
        text = _read_text(path, 256 * 1024)
        need("<svg" in text.lower())
        try:
            SafeET.fromstring(path.read_bytes())
        except Exception as exc:
            raise ValidationError("SVG is not well-formed XML") from exc
    elif fmt == "json":
        try:
            json.loads(_read_text(path))
        except json.JSONDecodeError as exc:
            raise ValidationError(f"Invalid JSON: {exc.msg} (line {exc.lineno})") from exc
    elif fmt == "xml":
        try:
            SafeET.fromstring(path.read_bytes())
        except Exception as exc:
            raise ValidationError("XML is not well-formed or uses forbidden entities") from exc
    elif fmt in ("txt", "csv", "md", "html"):
        _read_text(path, 1024 * 1024)
    else:
        raise ValidationError("Unsupported format")
