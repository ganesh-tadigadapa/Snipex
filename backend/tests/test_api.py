"""End-to-end API tests: real uploads, real worker processes, real downloads."""
from __future__ import annotations

import io
import json
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _wait(client, batch, timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/conversions/{batch['id']}", headers={"X-Batch-Token": batch["token"]})
        assert r.status_code == 200
        body = r.json()
        if body["status"] in ("completed", "failed", "cancelled"):
            return body
        time.sleep(0.3)
    raise AssertionError("batch did not finish")


def _files(samples, *keys):
    return [("files", (samples[k].name, samples[k].read_bytes())) for k in keys]


def test_formats_endpoint(client):
    body = client.get("/api/formats").json()
    assert "pdf" in body["inputs"] and body["limits"]["max_files"] == settings.max_files_per_batch
    assert any(c["src"] == "csv" and c["dst"] == "xlsx" for c in body["conversions"])


def test_mixed_batch_single_target_with_partial_failure(client, samples):
    files = _files(samples, "jpg", "png", "txt", "csv") + [
        ("files", ("fake.pdf", b"this is not a pdf")),
        ("files", ("virus.exe", b"MZ....")),
    ]
    if settings.soffice:
        files += _files(samples, "docx", "pptx", "xlsx")
    r = client.post("/api/conversions", files=files, data={"target": "pdf"})
    assert r.status_code == 201, r.text
    batch = r.json()
    body = _wait(client, batch)
    by_name = {t["inputs"][0]["name"]: t for t in body["tasks"]}
    assert by_name["fake.pdf"]["status"] == "failed" and "PDF" in by_name["fake.pdf"]["error"]
    assert by_name["virus.exe"]["status"] == "failed"
    assert by_name["data.csv"]["status"] == "completed"
    completed = [t for t in body["tasks"] if t["status"] == "completed"]
    assert len(completed) == (7 if settings.soffice else 4)
    # individual download
    t = completed[0]
    d = client.get(f"/api/conversions/{batch['id']}/files/{t['output']['id']}", params={"token": batch["token"]})
    assert d.status_code == 200 and d.content.startswith(b"%PDF")
    # zip download
    z = client.get(f"/api/conversions/{batch['id']}/download-zip", params={"token": batch["token"]})
    assert z.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert len(names) == len(completed) and len(set(names)) == len(names)
    # photo.jpg and photo.png both become photo*.pdf -> collision avoided
    assert "photo.pdf" in names and "photo (2).pdf" in names


def test_per_file_targets_and_skips(client, samples):
    files = _files(samples, "jpg", "csv", "json")
    r = client.post("/api/conversions", files=files, data={"targets": json.dumps(["webp", "xlsx", "docx"])})
    body = _wait(client, r.json())
    statuses = [t["status"] for t in body["tasks"]]
    assert statuses == ["completed", "completed", "skipped"]
    assert body["tasks"][0]["output"]["filename"] == "photo.webp"


def test_token_required(client, samples):
    r = client.post("/api/conversions", files=_files(samples, "png"), data={"target": "jpg"})
    batch = r.json()
    assert client.get(f"/api/conversions/{batch['id']}").status_code == 404
    assert client.get(f"/api/conversions/{batch['id']}", params={"token": "wrong"}).status_code == 404
    _wait(client, batch)
    assert client.delete(f"/api/conversions/{batch['id']}", headers={"X-Batch-Token": batch["token"]}).status_code == 204
    assert client.get(f"/api/conversions/{batch['id']}", params={"token": batch["token"]}).status_code == 404


def test_path_traversal_filename_is_neutralised(client, samples):
    r = client.post("/api/conversions", files=[("files", ("../../etc/passwd.png", samples["png"].read_bytes()))],
                    data={"target": "jpg"})
    body = _wait(client, r.json())
    t = body["tasks"][0]
    assert t["inputs"][0]["name"] == "passwd.png"
    assert t["output"]["filename"] == "passwd.jpg"


def test_too_many_files_rejected(client):
    files = [("files", (f"f{i}.txt", b"x")) for i in range(settings.max_files_per_batch + 1)]
    r = client.post("/api/conversions", files=files, data={"target": "pdf"})
    assert r.status_code == 400


def test_thirty_file_batch(client, samples):
    files = []
    for i in range(30):
        key = ["png", "jpg", "txt", "csv", "json", "md"][i % 6]
        files.append(("files", (f"item-{i}.{samples[key].suffix.lstrip('.')}", samples[key].read_bytes())))
    targets = [{"png": "webp", "jpg": "png", "txt": "pdf", "csv": "xlsx", "json": "csv", "md": "html"}[f[1][0].rsplit(".", 1)[1]]
               for f in files]
    r = client.post("/api/conversions", files=files, data={"targets": json.dumps(targets)})
    assert r.status_code == 201
    body = _wait(client, r.json())
    assert body["counts"]["completed"] == 30, body["counts"]


def test_cancel(client, samples):
    files = [("files", (f"p{i}.pdf", samples["pdf"].read_bytes())) for i in range(12)]
    r = client.post("/api/conversions", files=files, data={"target": "docx"})
    batch = r.json()
    c = client.post(f"/api/conversions/{batch['id']}/cancel", headers={"X-Batch-Token": batch["token"]})
    assert c.status_code == 200
    body = _wait(client, batch)
    assert body["status"] == "cancelled" and body["counts"]["cancelled"] >= 1


def test_tools_merge_and_compress(client, samples):
    r = client.post("/api/tools/merge-pdf", files=_files(samples, "pdf") + [("files", ("b.pdf", samples["pdf"].read_bytes()))])
    body = _wait(client, r.json())
    assert body["tasks"][0]["status"] == "completed" and body["tasks"][0]["output"]["filename"] == "merged.pdf"
    r = client.post("/api/tools/resize-images", files=_files(samples, "jpg", "png"), data={"options": json.dumps({"percent": 50})})
    body = _wait(client, r.json())
    assert body["counts"]["completed"] == 2
    r = client.post("/api/tools/resize-images", files=_files(samples, "jpg"), data={"options": json.dumps({"percent": 9999})})
    assert r.status_code == 400
