"""Structured data conversions: CSV, XLSX, JSON, XML."""
from __future__ import annotations

import csv
import html as html_lib
import io
import json
import re
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET  # only used to *build* XML (output), never to parse input

from defusedxml import ElementTree as SafeET

from .text import BASE_CSS, html_to_pdf_file, read_text

MAX_ROWS = 1_048_576  # Excel's row limit


def read_csv(src: Path) -> list[list[str]]:
    text = read_text(src)
    sample = text[:64 * 1024]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if len(rows) > MAX_ROWS:
        raise ValueError("CSV has more rows than a spreadsheet can hold")
    return rows


def _coerce(value: str) -> Any:
    """Turn numeric-looking CSV cells into numbers so spreadsheets can calculate with them."""
    v = value.strip()
    if re.fullmatch(r"-?(0|[1-9]\d{0,14})", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v) and len(v) < 18:
        return float(v)
    return value


def _write_xlsx(sheets: dict[str, list[list[Any]]], target: Path) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook(write_only=False)
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(re.sub(r"[\[\]:*?/\\]", "_", name)[:31] or "Sheet1")
        for row in rows:
            ws.append([_cell(v) for v in row])
        if rows:
            for cell in ws[1]:
                cell.font = Font(bold=True)
                cell.fill = PatternFill("solid", fgColor="EDE9FE")
            ws.freeze_panes = "A2"
            for col in ws.columns:
                width = max((len(str(c.value)) for c in col[:200] if c.value is not None), default=8)
                ws.column_dimensions[col[0].column_letter].width = min(60, max(8, width + 2))
    wb.save(target)


def _cell(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, str):
        v = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", v)
        return _coerce(v)
    return v


def _rows_to_html_table(rows: list[list[Any]]) -> str:
    if not rows:
        return "<table></table>"
    head = "".join(f"<th>{html_lib.escape(str(c))}</th>" for c in rows[0])
    body = "".join(
        "<tr>" + "".join(f"<td>{html_lib.escape('' if c is None else str(c))}</td>" for c in r) + "</tr>" for r in rows[1:]
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _rows_to_records(rows: list[list[Any]]) -> list[dict]:
    if not rows:
        return []
    header = [str(h) if h not in (None, "") else f"column_{i + 1}" for i, h in enumerate(rows[0])]
    seen: dict[str, int] = {}
    for i, h in enumerate(header):  # de-duplicate column names
        if h in seen:
            seen[h] += 1
            header[i] = f"{h}_{seen[h]}"
        else:
            seen[h] = 1
    records = []
    for r in rows[1:]:
        if all(c in (None, "") for c in r):
            continue
        records.append({header[i]: (r[i] if i < len(r) else None) for i in range(len(header))})
    return records


# ---- CSV ----------------------------------------------------------------------------------

def csv_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    rows = read_csv(src)
    target = out_dir / f"{stem}.{dst}"
    if dst == "xlsx":
        _write_xlsx({stem[:31]: rows}, target)
    elif dst == "json":
        records = [{k: _coerce(v) if isinstance(v, str) else v for k, v in rec.items()} for rec in _rows_to_records(rows)]
        target.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    elif dst == "html":
        target.write_text(
            f"<!doctype html><html><head><meta charset='utf-8'><title>{html_lib.escape(stem)}</title>"
            f"<style>{BASE_CSS}</style></head><body>{_rows_to_html_table(rows)}</body></html>",
            encoding="utf-8",
        )
    elif dst == "pdf":
        if len(rows) > 20000:
            raise ValueError("CSV is too large to lay out as a PDF (20,000 row limit)")
        html_to_pdf_file(_rows_to_html_table(rows), target)
    else:
        raise ValueError(dst)
    return [target]


# ---- XLSX ---------------------------------------------------------------------------------

def _read_xlsx(src: Path) -> dict[str, list[list[Any]]]:
    from openpyxl import load_workbook

    wb = load_workbook(src, read_only=True, data_only=True)
    sheets = {}
    try:
        for ws in wb.worksheets:
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            while rows and all(c is None for c in rows[-1]):
                rows.pop()
            sheets[ws.title] = rows
    finally:
        wb.close()
    return sheets


def _safe_part(name: str) -> str:
    return re.sub(r"[^\w\-. ]+", "_", name).strip() or "sheet"


def xlsx_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    sheets = _read_xlsx(src)
    if dst == "csv":
        results = []
        non_empty = {k: v for k, v in sheets.items() if v} or sheets
        for name, rows in non_empty.items():
            fname = f"{stem}.csv" if len(non_empty) == 1 else f"{stem}-{_safe_part(name)}.csv"
            target = out_dir / fname
            with target.open("w", newline="", encoding="utf-8-sig") as fh:
                w = csv.writer(fh)
                for r in rows:
                    w.writerow(["" if c is None else c for c in r])
            results.append(target)
        return results
    if dst == "json":
        target = out_dir / f"{stem}.json"
        data: Any = {name: _rows_to_records(rows) for name, rows in sheets.items()}
        if len(data) == 1:
            data = next(iter(data.values()))
        target.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        return [target]
    raise ValueError(dst)


# ---- JSON ---------------------------------------------------------------------------------

def _flatten(obj: Any, prefix: str = "", out: dict | None = None) -> dict:
    out = {} if out is None else out
    if isinstance(obj, dict):
        for k, v in obj.items():
            _flatten(v, f"{prefix}.{k}" if prefix else str(k), out)
    elif isinstance(obj, list) and obj and all(not isinstance(x, (dict, list)) for x in obj):
        out[prefix or "value"] = "; ".join("" if x is None else str(x) for x in obj)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _flatten(v, f"{prefix}.{i}" if prefix else str(i), out)
    else:
        out[prefix or "value"] = obj
    return out


def _json_table(data: Any) -> list[list[Any]]:
    """Tabulate JSON: list of objects -> rows; {"key": [...]} wrapper -> that list; object -> 1 row."""
    if isinstance(data, dict):
        lists = [v for v in data.values() if isinstance(v, list)]
        if len(data) == 1 and lists:
            data = lists[0]
        else:
            data = [data]
    if not isinstance(data, list):
        data = [data]
    if data and all(isinstance(r, list) for r in data):
        return [list(r) for r in data]
    flat = [_flatten(r) if isinstance(r, (dict, list)) else {"value": r} for r in data]
    header: list[str] = []
    for r in flat:
        for k in r:
            if k not in header:
                header.append(k)
    return [header] + [[r.get(k) for k in header] for r in flat]


def _xml_name(key: str) -> str:
    name = re.sub(r"[^\w.\-]", "_", str(key)) or "item"
    if not re.match(r"[A-Za-z_]", name) or name.lower().startswith("xml"):
        name = "_" + name
    return name


def _build_xml(parent: ET.Element, value: Any) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, list):
                for item in v:
                    _build_xml(ET.SubElement(parent, _xml_name(k)), item)
            else:
                _build_xml(ET.SubElement(parent, _xml_name(k)), v)
    elif isinstance(value, list):
        for item in value:
            _build_xml(ET.SubElement(parent, "item"), item)
    elif value is None:
        parent.set("null", "true")
    else:
        text = str(value).lower() if isinstance(value, bool) else str(value)
        parent.text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def json_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    data = json.loads(read_text(src))
    target = out_dir / f"{stem}.{dst}"
    if dst == "csv":
        rows = _json_table(data)
        with target.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            for r in rows:
                w.writerow(["" if c is None else (json.dumps(c) if isinstance(c, (dict, list)) else c) for c in r])
    elif dst == "xlsx":
        _write_xlsx({stem[:31]: _json_table(data)}, target)
    elif dst == "xml":
        root = ET.Element("root")
        _build_xml(root, data)
        ET.indent(root)
        target.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    else:
        raise ValueError(dst)
    return [target]


# ---- XML ----------------------------------------------------------------------------------

def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[1] if tag.startswith("{") else tag


def _xml_to_obj(el) -> Any:
    children = list(el)
    obj: dict[str, Any] = {f"@{_strip_ns(k)}": v for k, v in el.attrib.items()}
    for child in children:
        key = _strip_ns(child.tag)
        val = _xml_to_obj(child)
        if key in obj:
            if not isinstance(obj[key], list):
                obj[key] = [obj[key]]
            obj[key].append(val)
        else:
            obj[key] = val
    text = (el.text or "").strip()
    if not obj:
        return text if text else None
    if text:
        obj["#text"] = text
    return obj


def xml_convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    root = SafeET.fromstring(src.read_bytes())  # defusedxml: no external entities / entity expansion
    target = out_dir / f"{stem}.{dst}"
    if dst == "json":
        target.write_text(json.dumps({_strip_ns(root.tag): _xml_to_obj(root)}, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        raise ValueError(dst)
    return [target]
