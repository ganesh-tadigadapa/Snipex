"""Text, Markdown, HTML and EPUB conversions.

HTML is laid out into PDF with MuPDF's Story engine. It never executes scripts and never
fetches remote resources, which makes it safe for untrusted input (at the cost of CSS fidelity).
"""
from __future__ import annotations

import html as html_lib
import re
import zipfile
from pathlib import Path

BASE_CSS = """
body { font-family: sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
h1 { font-size: 22pt; margin: 0 0 10pt 0; } h2 { font-size: 17pt; margin: 14pt 0 8pt 0; }
h3 { font-size: 14pt; margin: 12pt 0 6pt 0; } p { margin: 0 0 8pt 0; }
pre, code { font-family: monospace; font-size: 9.5pt; }
pre { background-color: #f4f4f5; padding: 6pt; white-space: pre-wrap; }
table { border-collapse: collapse; } td, th { border: 0.5pt solid #999; padding: 2pt 4pt; font-size: 9pt; }
th { background-color: #ede9fe; } blockquote { margin-left: 12pt; color: #444; }
"""


def read_text(src: Path) -> str:
    data = src.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def html_to_pdf_file(html: str, target: Path, css: str = BASE_CSS) -> None:
    import pymupdf

    # Drop scripts/styles/remote embeds we can't (and shouldn't) render.
    html = re.sub(r"(?is)<(script|style|iframe|object|embed|noscript)\b.*?</\1\s*>", "", html)
    html = re.sub(r"(?is)<(img|link|meta|source|video|audio)\b[^>]*>", "", html)
    story = pymupdf.Story(html=html, user_css=css)
    page = pymupdf.paper_rect("a4")
    where = page + (54, 54, -54, -54)
    writer = pymupdf.DocumentWriter(str(target))
    more = True
    pages = 0
    while more:
        device = writer.begin_page(page)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
        pages += 1
        if pages > 2000:
            break
    writer.close()


def _html_doc(body: str, title: str) -> str:
    return (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>"
        + html_lib.escape(title)
        + "</title></head><body>\n"
        + body
        + "\n</body></html>\n"
    )


def _md_to_html(text: str) -> str:
    import markdown

    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])


def _html_to_text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    text = soup.get_text("\n")
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", text).strip() + "\n"


# ---- TXT --------------------------------------------------------------------------------

def txt_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    text = read_text(src)
    target = out_dir / f"{stem}.{dst}"
    if dst == "pdf":
        paras = "".join(f"<p>{html_lib.escape(p) or '&nbsp;'}</p>" for p in text.splitlines())
        css = BASE_CSS + " p { margin: 0; white-space: pre-wrap; font-size: 10.5pt; }"
        html_to_pdf_file(f"<body>{paras}</body>", target, css)
    elif dst == "docx":
        from docx import Document

        doc = Document()
        for line in text.splitlines():
            doc.add_paragraph(_xml_safe(line))
        doc.save(target)
    elif dst == "html":
        target.write_text(_html_doc(f"<pre>{html_lib.escape(text)}</pre>", stem), encoding="utf-8")
    else:
        raise ValueError(dst)
    return [target]


def _xml_safe(s: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)


# ---- Markdown -----------------------------------------------------------------------------

def md_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    body = _md_to_html(read_text(src))
    target = out_dir / f"{stem}.{dst}"
    if dst == "html":
        target.write_text(_html_doc(body, stem), encoding="utf-8")
    elif dst == "pdf":
        html_to_pdf_file(body, target)
    elif dst == "txt":
        target.write_text(_html_to_text(body), encoding="utf-8")
    else:
        raise ValueError(dst)
    return [target]


# ---- HTML ---------------------------------------------------------------------------------

def html_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    html = read_text(src)
    target = out_dir / f"{stem}.{dst}"
    if dst == "pdf":
        html_to_pdf_file(html, target)
    elif dst == "txt":
        target.write_text(_html_to_text(html), encoding="utf-8")
    elif dst == "md":
        target.write_text(_html_to_markdown(html), encoding="utf-8")
    else:
        raise ValueError(dst)
    return [target]


def _html_to_markdown(html: str) -> str:
    from bs4 import BeautifulSoup, NavigableString, Tag

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "template", "head"]):
        tag.decompose()

    def inline(node) -> str:
        if isinstance(node, NavigableString):
            return re.sub(r"\s+", " ", str(node))
        if not isinstance(node, Tag):
            return ""
        inner = "".join(inline(c) for c in node.children)
        name = node.name
        if name in ("strong", "b"):
            return f"**{inner.strip()}**" if inner.strip() else ""
        if name in ("em", "i"):
            return f"*{inner.strip()}*" if inner.strip() else ""
        if name == "code":
            return f"`{inner}`"
        if name == "a" and node.get("href"):
            return f"[{inner.strip()}]({node['href']})"
        if name == "br":
            return "  \n"
        return inner

    out: list[str] = []

    def block(node, depth=0) -> None:
        if isinstance(node, NavigableString):
            text = str(node).strip()
            if text:
                out.append(re.sub(r"\s+", " ", text))
            return
        if not isinstance(node, Tag):
            return
        name = node.name
        if name and re.fullmatch(r"h[1-6]", name):
            out.append("#" * int(name[1]) + " " + inline(node).strip())
        elif name == "p":
            out.append(inline(node).strip())
        elif name in ("ul", "ol"):
            for i, li in enumerate(node.find_all("li", recursive=False), 1):
                marker = f"{i}." if name == "ol" else "-"
                out.append("  " * depth + f"{marker} " + inline(li).strip())
        elif name == "pre":
            out.append("```\n" + node.get_text() + "\n```")
        elif name == "blockquote":
            out.append("> " + inline(node).strip())
        elif name == "hr":
            out.append("---")
        elif name == "table":
            rows = [[c.get_text(" ", strip=True).replace("|", "\\|") for c in tr.find_all(["td", "th"])] for tr in node.find_all("tr")]
            rows = [r for r in rows if r]
            if rows:
                width = max(len(r) for r in rows)
                rows = [r + [""] * (width - len(r)) for r in rows]
                out.append("| " + " | ".join(rows[0]) + " |")
                out.append("|" + " --- |" * width)
                out.extend("| " + " | ".join(r) + " |" for r in rows[1:])
        else:
            for child in node.children:
                block(child, depth)

    block(soup.body or soup)
    return "\n\n".join(s for s in out if s.strip()) + "\n"


# ---- EPUB ---------------------------------------------------------------------------------

def _epub_chapters(src: Path) -> list[str]:
    """Return the XHTML bodies of an EPUB in reading (spine) order."""
    from bs4 import BeautifulSoup
    from defusedxml import ElementTree as ET

    with zipfile.ZipFile(src) as zf:
        container = ET.fromstring(zf.read("META-INF/container.xml"))
        ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container", "o": "http://www.idpf.org/2007/opf"}
        opf_path = container.find(".//c:rootfile", ns).get("full-path")
        base = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
        opf = ET.fromstring(zf.read(opf_path))
        manifest = {i.get("id"): i.get("href") for i in opf.findall(".//o:manifest/o:item", ns)}
        bodies = []
        for ref in opf.findall(".//o:spine/o:itemref", ns):
            href = manifest.get(ref.get("idref"))
            if not href:
                continue
            path = (base + href).split("#")[0]
            try:
                raw = zf.read(path)
            except KeyError:
                continue
            soup = BeautifulSoup(raw, "html.parser")
            body = soup.body or soup
            bodies.append(body.decode_contents())
    if not bodies:
        raise ValueError("EPUB has no readable chapters")
    return bodies


def epub_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    chapters = _epub_chapters(src)
    target = out_dir / f"{stem}.{dst}"
    if dst == "html":
        body = "\n<hr>\n".join(chapters)
        body = re.sub(r"(?is)<script\b.*?</script\s*>", "", body)
        target.write_text(_html_doc(body, stem), encoding="utf-8")
    elif dst == "txt":
        target.write_text("\n\n".join(_html_to_text(c) for c in chapters), encoding="utf-8")
    elif dst == "pdf":
        html_to_pdf_file("".join(f"<div>{c}</div>" for c in chapters), target)
    else:
        raise ValueError(dst)
    return [target]


# ---- DOCX (native, no LibreOffice needed) -----------------------------------------------

def docx_to_txt(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    from docx import Document

    doc = Document(src)
    lines = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        lines.append("")
        for row in table.rows:
            lines.append("\t".join(cell.text for cell in row.cells))
    target = out_dir / f"{stem}.txt"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return [target]
