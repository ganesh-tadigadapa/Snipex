"""Runtime configuration. Every limit is overridable through SNIPEX_* environment variables."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _find_soffice() -> str | None:
    explicit = os.environ.get("SNIPEX_SOFFICE")
    if explicit and Path(explicit).exists():
        return explicit
    for candidate in (
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
        "/opt/libreoffice/program/soffice",
    ):
        if candidate and Path(candidate).exists():
            return candidate
    return None


@dataclass
class Settings:
    max_files_per_batch: int = field(default_factory=lambda: _int("SNIPEX_MAX_FILES", 30))
    max_file_mb: int = field(default_factory=lambda: _int("SNIPEX_MAX_FILE_MB", 100))
    max_batch_mb: int = field(default_factory=lambda: _int("SNIPEX_MAX_BATCH_MB", 500))
    # Number of conversions that may run at the same time (each one is its own OS process).
    max_workers: int = field(default_factory=lambda: _int("SNIPEX_WORKERS", max(2, min(4, (os.cpu_count() or 2) // 2))))
    conversion_timeout_s: int = field(default_factory=lambda: _int("SNIPEX_TIMEOUT", 180))
    max_attempts: int = field(default_factory=lambda: _int("SNIPEX_MAX_ATTEMPTS", 2))
    # Batches (uploads + outputs) are deleted this many seconds after creation.
    retention_s: int = field(default_factory=lambda: _int("SNIPEX_RETENTION_S", 3600))
    cleanup_interval_s: int = field(default_factory=lambda: _int("SNIPEX_CLEANUP_INTERVAL_S", 60))
    # Rate limit: conversion requests per IP per minute.
    rate_limit_per_minute: int = field(default_factory=lambda: _int("SNIPEX_RATE_LIMIT", 20))
    storage_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("SNIPEX_STORAGE", Path(tempfile.gettempdir()) / "snipex-storage"))
    )
    soffice: str | None = field(default_factory=_find_soffice)
    # Optional malware scanner command, e.g. "clamdscan --no-summary". Exit code 1 = infected.
    scan_command: str | None = field(default_factory=lambda: os.environ.get("SNIPEX_SCAN_COMMAND") or None)
    cors_origins: list[str] = field(
        default_factory=lambda: os.environ.get("SNIPEX_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    )
    python: str = sys.executable

    @property
    def max_file_bytes(self) -> int:
        return self.max_file_mb * 1024 * 1024

    @property
    def max_batch_bytes(self) -> int:
        return self.max_batch_mb * 1024 * 1024


settings = Settings()
