#!/usr/bin/env python3
"""Create a minimal GNOME Shell extension bundle without shell build tools."""

import argparse
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    metadata = json.loads((ROOT / "metadata.json").read_text())
    extension_uuid = metadata.get("uuid")
    if extension_uuid != "system-monitor@yeager-v3":
        raise SystemExit(f"Unexpected extension UUID: {extension_uuid!r}")

    files = [ROOT / "extension.js", ROOT / "metadata.json", ROOT / "stylesheet.css"]
    locale_dir = ROOT / "locale"
    files.extend(path for path in locale_dir.rglob("*") if path.is_file())
    if not any(path.suffix == ".mo" for path in files):
        raise SystemExit("No compiled translations found under locale/")

    args.output.mkdir(parents=True, exist_ok=True)
    bundle = args.output / f"{extension_uuid}.shell-extension.zip"
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(files):
            archive.write(path, path.relative_to(ROOT).as_posix())
    print(f"Packed {bundle}")


if __name__ == "__main__":
    main()
