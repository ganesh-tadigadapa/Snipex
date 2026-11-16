"""LibreOffice (headless) adapter for office documents, presentations and spreadsheets."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

# LibreOffice export filter per target format. Filters are explicit so the right component
# (Writer / Calc / Impress) export is used.
FILTERS = {
    "pdf": "pdf",
    "docx": 'docx:MS Word 2007 XML',
    "doc": "doc:MS Word 97",
    "odt": "odt",
    "rtf": "rtf:Rich Text Format",
    "txt": "txt:Text (encoded):UTF8",
    "html": "html:XHTML Writer File:UTF8",
    "pptx": "pptx:Impress MS PowerPoint 2007 XML",
    "ppt": "ppt:MS PowerPoint 97",
    "odp": "odp",
    "xlsx": "xlsx:Calc MS Excel 2007 XML",
    "xls": "xls:MS Excel 97",
    "ods": "ods",
    # Comma separated, double-quoted, UTF-8 (76), export ALL sheets (-1) as separate files.
    "csv": "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1",
}


class OfficeError(RuntimeError):
    pass


def convert(src: Path, out_dir: Path, stem: str, dst: str, options: dict) -> list[Path]:
    soffice = options.get("_soffice")
    if not soffice:
        raise OfficeError("LibreOffice is not installed on this server")
    profile = Path(options.get("_lo_profile") or tempfile.mkdtemp(prefix="snipex-lo-"))
    work = Path(tempfile.mkdtemp(prefix="lo-out-", dir=out_dir))
    # LibreOffice names the output after the input file, so give the input a clean name.
    staged = work / f"{stem}{src.suffix.lower()}"
    shutil.copyfile(src, staged)
    export_dir = work / "export"
    export_dir.mkdir()
    cmd = [
        soffice,
        f"-env:UserInstallation={profile.resolve().as_uri()}",
        "--headless", "--invisible", "--nologo", "--norestore", "--nodefault", "--nolockcheck",
        "--convert-to", FILTERS[dst],
        "--outdir", str(export_dir),
        str(staged),
    ]
    if src.suffix.lower() == ".csv":
        cmd[1:1] = ["--infilter=CSV:44,34,76,1"]
    env = {**os.environ, "SAL_USE_VCLPLUGIN": "svp", "HOME": str(profile)}
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=options.get("_timeout", 170))
    produced = sorted(p for p in export_dir.iterdir() if p.is_file())
    if proc.returncode != 0 or not produced:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()[-1:] or ["no output produced"]
        raise OfficeError(f"LibreOffice could not convert this file ({detail[0][:200]})")
    results = []
    for p in produced:
        if p.stat().st_size == 0:
            continue
        target = out_dir / p.name
        shutil.move(str(p), target)
        results.append(target)
    shutil.rmtree(work, ignore_errors=True)
    if not results:
        raise OfficeError("LibreOffice produced an empty file")
    return results
