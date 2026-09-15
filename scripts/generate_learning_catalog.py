"""Regenerate the Learning page's pinned Essentia Python interface registry.

Run from the repository root with the optional pinned Essentia runtime:
    apps/api/.venv/bin/python scripts/generate_learning_catalog.py

Only technical identifiers and interface types are included. Descriptions remain
in the linked official Essentia documentation. No model inference or audio IO runs.
"""

import json
from importlib.metadata import version
from pathlib import Path

import essentia.standard as standard
import essentia.streaming as streaming

PINNED_VERSION = "2.1b6.dev1389"
if version("essentia-tensorflow") != PINNED_VERSION:
    raise RuntimeError(f"This catalog requires essentia-tensorflow {PINNED_VERSION}")

catalog = {}
for mode, module in [("standard", standard), ("streaming", streaming)]:
    for name in module.algorithmNames():
        struct = getattr(module, name).__struct__
        row = catalog.setdefault(
            name,
            {"name": name, "category": struct["category"], "modes": [], "interfaces": {}},
        )
        row["modes"].append(mode)
        row["interfaces"][mode] = {
            key: [{"name": item["name"], "type": item["type"]} for item in struct[key]]
            for key in ["inputs", "outputs", "parameters"]
        }

payload = {
    "version": PINNED_VERSION,
    "scope": (
        "All registered standard and streaming Python algorithms in the pinned "
        "essentia-tensorflow build; excludes C++-only templates and separately distributed "
        "model weights."
    ),
    "generated": "2026-09-05",
    "algorithms": sorted(catalog.values(), key=lambda item: (item["category"], item["name"])),
}
root = Path(__file__).resolve().parents[1]
(root / "apps/web/src/lib/learning/essentiaCatalog.json").write_text(
    json.dumps(payload, indent=2) + "\n"
)
print(f"Generated {len(catalog)} registered algorithms for {PINNED_VERSION}")
