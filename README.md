# SNIPEX — Every File. One Click.

Universal batch file converter. Drop up to 30 mixed files, pick one output format (or one per file), convert everything in one click, then download the files one by one or as a single ZIP.

## Run it locally

Requirements: Python 3.11+, Node 20+, and **LibreOffice** for office formats (`brew install --cask libreoffice` on macOS, `apt install libreoffice` on Debian/Ubuntu).

```bash
# one-time setup
cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..

./dev.sh            # API on :8000, UI on http://127.0.0.1:5173
```

Production (one origin, one container): `docker build -t snipex . && docker run -p 8000:8000 snipex`.
Alternatively, run `npm run build` in `frontend/`; FastAPI then serves `frontend/dist` automatically.

## Tests

```bash
cd backend
.venv/bin/python -m pytest -q                      # every registry conversion + API end-to-end
.venv/bin/python tests/e2e_ui.py /tmp/e2e          # real-browser UI run (needs ./dev.sh + `playwright install chromium`)
```

`tests/test_conversions.py` generates a real sample of every input format, runs **every** conversion in the registry, and checks the output's actual file signature (not just its extension). A conversion that is not in the registry is never offered in the UI.

## Architecture

```
frontend/ (React + TS + Tailwind v4 + Framer Motion + Lucide)
   │  multipart upload (XHR, real upload progress) → poll batch status → download
backend/app/
   main.py         FastAPI routes, size limits, rate limiting, secure downloads
   registry.py     central conversion registry: src, dst, engine, quality, notes, dependencies
   validation.py   magic-byte / container checks, zip-bomb guard, safe filenames, defusedxml
   jobs.py         batch queue: bounded parallelism, retries, cancel, ZIP, auto-cleanup
   worker.py       isolated per-conversion process (timeout, rlimits, killable process group)
   engines/
     office.py     LibreOffice headless: DOC/DOCX/ODT/RTF, PPT/PPTX/ODP, XLS/XLSX/ODS
     images.py     Pillow (+ MuPDF for SVG): format conversion, resize, compress, images→PDF
     pdf.py        PyMuPDF: render pages, merge, split/extract, compress; pdf2docx for PDF→DOCX
     text.py       TXT/MD/HTML/EPUB (MuPDF Story layout engine for →PDF; never runs scripts)
     data.py       CSV/XLSX/JSON/XML
```

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/formats` | Live registry: formats, conversions, limits, tools |
| POST | `/api/conversions` | `files` (repeated) + `target` *or* `targets` (JSON list, one per file) → batch + secret token |
| GET | `/api/conversions/{id}` | Batch + per-file status, progress, ETA |
| GET | `/api/conversions/{id}/files/{file_id}` | Download one output |
| GET | `/api/conversions/{id}/download-zip` | All successful outputs as one ZIP |
| POST | `/api/conversions/{id}/cancel` | Cancel (kills running workers) |
| DELETE | `/api/conversions/{id}` | Delete batch and its files now |
| POST | `/api/tools/{merge-pdf,split-pdf,compress-pdf,images-to-pdf,resize-images,compress-images}` | Advanced tools (same batch model) |

Every batch endpoint requires the batch token (`X-Batch-Token` header or `?token=`).

### Adding a format

Write an engine function `fn(src, out_dir, stem, dst, options) -> list[Path]`, `register()` it in `registry.py`, add a sample to `tests/samples.py`, and run the tests. The UI picks it up automatically.

## Configuration (env vars)

`SNIPEX_MAX_FILES` (30), `SNIPEX_MAX_FILE_MB` (100), `SNIPEX_MAX_BATCH_MB` (500), `SNIPEX_WORKERS` (CPU-based, 2–4), `SNIPEX_TIMEOUT` (180 s), `SNIPEX_MAX_ATTEMPTS` (2), `SNIPEX_RETENTION_S` (3600), `SNIPEX_RATE_LIMIT` (20 requests/min/IP), `SNIPEX_STORAGE`, `SNIPEX_SOFFICE`, `SNIPEX_SCAN_COMMAND` (e.g. `clamdscan --no-summary`; exit code 1 rejects the file), `SNIPEX_CORS`.

## Honest limits

- **Queue is in-process.** Concurrency is bounded and every conversion runs in its own process, but batches live in one server's memory. To run multiple API instances, put `JobManager._run_task` behind Celery/RQ with Redis. The HTTP API and data model stay the same.
- **No accounts.** History and presets are kept in the browser (localStorage). There is no Sign In, by design: core conversion needs no registration.
- **Malware scanning** is a hook (`SNIPEX_SCAN_COMMAND`) and is off by default.
- **Memory limits** (`RLIMIT_AS`) are enforced on Linux only; macOS ignores them. CPU-time and file-size limits plus the wall-clock timeout apply everywhere.
- **Fidelity:** PDF→DOCX rebuilds the layout, so complex pages can shift. HTML/EPUB→PDF render text and structure without external CSS or images. Scanned PDFs have no OCR. Spreadsheet formulas export their last saved values.
- **No end-to-end encryption.** Use TLS in front of the server. Files are deleted after the retention window, or immediately via “Clear Session”.
