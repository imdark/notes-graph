#!/usr/bin/env python3
"""Rebrand the onboarding template a new workspace is seeded with.

Rewrites only USER-VISIBLE copy and outbound links inside
packages/frontend/templates/onboarding/onboarding.zip — the `--affine-*`
CSS variable names inside the snapshots are real style tokens and are left
untouched. Idempotent: safe to re-run after upstream template updates.

Run from the repo root:  python3 tools/rebrand-onboarding-template.py
"""
import json
import re
import shutil
import zipfile
from pathlib import Path

ZIP = Path("packages/frontend/templates/onboarding/onboarding.zip")

# Visible text: AFFiNE -> NotesGraph (never touches `--affine-*` tokens,
# which are matched by the CSS-var guard below).
TEXT_SUBS = [
    (re.compile(r"\bAFFiNE\b"), "NotesGraph"),
    (re.compile(r"\bAffine\b"), "NotesGraph"),
]

LINK_SUBS = {
    "https://github.com/toeverything/AFFiNE": "https://github.com/imdark/notes-graph",
    "https://affine.pro/redirect/discord": "https://notesgraph.com",
    "https://docs.affine.pro/docs/self-host-affine": "https://notesgraph.com/download",
    "https://affine.pro/blog/import-your-data-from-notion-into-affine": "https://notesgraph.com",
    "https://chromewebstore.google.com/detail/affine-web-clipper/mpbbkmbdpleomiogkbkkpfoljjpahmoi": "https://notesgraph.com/download",
    "https://x.com/AFFiNEOfficial/status/1909756452815925555": "https://notesgraph.com",
}

CSS_VAR = re.compile(r"--affine-|var\(--affine")


def fix_text(value: str) -> str:
    # never rewrite CSS custom properties / theme tokens
    if CSS_VAR.search(value):
        return value
    out = value
    for pattern, repl in TEXT_SUBS:
        out = pattern.sub(repl, out)
    # bare urls that appear as visible text
    for old, new in LINK_SUBS.items():
        out = out.replace(old, new)
    return out


def walk(node):
    if isinstance(node, dict):
        return {
            key: (
                LINK_SUBS.get(value, value)
                if key == "link" and isinstance(value, str)
                else fix_text(value)
                if key == "insert" and isinstance(value, str)
                else walk(value)
            )
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [walk(v) for v in node]
    return node


def main() -> None:
    src = zipfile.ZipFile(ZIP)
    entries = {name: src.read(name) for name in src.namelist()}
    src.close()

    changed = 0
    for name, raw in entries.items():
        if not name.endswith(".json"):
            continue
        data = json.loads(raw.decode("utf-8"))
        fixed = walk(data)
        out = json.dumps(fixed, ensure_ascii=False, separators=(",", ":")).encode()
        if out != raw:
            entries[name] = out
            changed += 1

    shutil.copy(ZIP, ZIP.with_suffix(".zip.bak"))
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as dst:
        for name, raw in entries.items():
            dst.writestr(name, raw)
    print(f"rewrote {changed} snapshot(s); backup at {ZIP.with_suffix('.zip.bak')}")


if __name__ == "__main__":
    main()
