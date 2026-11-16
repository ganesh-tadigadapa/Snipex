"""Benchmark a realistic 30-file mixed batch through the running API.
Usage: python tests/bench.py <samples_dir> [base_url]"""
import json, sys, time
from pathlib import Path
import httpx

S = Path(sys.argv[1]); base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8000"
plan = [("report.docx", "pdf")] * 6 + [("deck.pptx", "pdf")] * 4 + [("book.xlsx", "pdf")] * 4 + \
       [("photo.png", "webp")] * 4 + [("photo.jpg", "png")] * 4 + [("report.pdf", "png")] * 2 + \
       [("report.pdf", "docx")] * 2 + [("data.csv", "xlsx")] * 2 + [("notes.txt", "pdf")] * 2
files = [("files", (f"{i:02d}-{name}", (S / name).read_bytes())) for i, (name, _) in enumerate(plan)]
t0 = time.time()
r = httpx.post(f"{base}/api/conversions", files=files, data={"targets": json.dumps([t for _, t in plan])}, timeout=120)
r.raise_for_status(); b = r.json(); t_up = time.time() - t0
done_at = {}
while True:
    s = httpx.get(f"{base}/api/conversions/{b['id']}", headers={"X-Batch-Token": b["token"]}).json()
    for t in s["tasks"]:
        if t["status"] in ("completed", "failed") and t["id"] not in done_at:
            done_at[t["id"]] = (time.time() - t0, t["inputs"][0]["name"], t["status"])
    if s["status"] in ("completed", "failed", "cancelled"):
        break
    time.sleep(0.05)
total = time.time() - t0
print(f"upload {t_up:.2f}s  total {total:.2f}s  completed {s['counts']['completed']}/{len(plan)}")
by = {}
for _, (ts, name, st) in sorted(done_at.items(), key=lambda x: x[1][0]):
    by.setdefault(name.split("-", 1)[1], []).append(ts)
for k, v in by.items():
    print(f"  {k:12s} done at {min(v):5.2f}s .. {max(v):5.2f}s")
httpx.delete(f"{base}/api/conversions/{b['id']}", headers={"X-Batch-Token": b["token"]})
