"""Isolated conversion worker.

Each conversion runs in its own short-lived OS process:  python -m app.worker <spec.json>
The parent enforces a wall-clock timeout and can kill the whole process group to cancel.
The worker prints one JSON line with the result.
"""
from __future__ import annotations

import importlib
import json
import sys
import traceback
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

TOOL_OPS = {
    "merge_pdf": ("pdf", "merge", True),
    "images_to_pdf": ("images", "images_to_pdf", True),
    "split_pdf": ("pdf", "split", False),
    "compress_pdf": ("pdf", "compress", False),
    "resize_image": ("images", "resize", False),
    "compress_image": ("images", "compress", False),
}


class UserFacingError(Exception):
    """An error whose message is safe and useful to show to the end user."""


def _resolve(engine: str):
    module, func = engine.split(":")
    return getattr(importlib.import_module(f"app.engines.{module}"), func)


def run(spec: dict) -> list[str]:
    out_dir = Path(spec["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    inputs = [Path(p) for p in spec["inputs"]]
    stem = spec["stem"]
    options = spec.get("options") or {}
    op = spec["op"]
    if op == "convert":
        from app import registry

        conv = registry.get(spec["src_format"], spec["dst"])
        if conv is None:
            raise UserFacingError("This conversion is not supported")
        fn = _resolve(conv.engine)
        outputs = fn(inputs[0], out_dir, stem, spec["dst"], options)
    elif op in TOOL_OPS:
        module, func, multi_input = TOOL_OPS[op]
        fn = _resolve(f"{module}:{func}")
        outputs = fn(inputs if multi_input else inputs[0], out_dir, stem, options)
    else:
        raise UserFacingError(f"Unknown operation {op}")
    return [str(p) for p in outputs]


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text())
    try:
        outputs = run(spec)
        result = {"ok": True, "outputs": outputs}
    except (UserFacingError, ValueError) as exc:
        result = {"ok": False, "error": str(exc) or "Conversion failed", "recoverable": False}
    except MemoryError:
        result = {"ok": False, "error": "File is too large to convert", "recoverable": False}
    except Exception as exc:  # engine crash: may be transient (e.g. LibreOffice startup)
        name = type(exc).__name__
        msg = str(exc).splitlines()[0][:200] if str(exc) else name
        recoverable = name in ("OfficeError", "TimeoutExpired", "OSError")
        if name in ("OfficeError",):
            text = msg
        else:
            text = f"The file could not be converted ({msg})"
        result = {"ok": False, "error": text, "recoverable": recoverable, "trace": traceback.format_exc()[-1500:]}
    sys.stdout.write("\n" + json.dumps(result) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
