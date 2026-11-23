#!/usr/bin/env python3
"""Build architecture-independent Debian and RPM packages from this extension."""

import argparse
import datetime
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "gnome-shell-extension-system-monitor"


def run(command):
    subprocess.run(command, check=True)


def install_tree(destination):
    destination.mkdir(parents=True)
    for name in ("extension.js", "metadata.json", "stylesheet.css"):
        shutil.copy2(ROOT / name, destination / name)
    shutil.copytree(ROOT / "locale", destination / "locale")


def build_deb(version, output):
    with tempfile.TemporaryDirectory(prefix="system-monitor-deb-") as temporary:
        root = Path(temporary) / "root"
        ext_dir = root / "usr/share/gnome-shell/extensions/system-monitor@yeager-v3"
        install_tree(ext_dir)
        control_dir = root / "DEBIAN"
        control_dir.mkdir()
        (control_dir / "control").write_text(
            f"Package: {PACKAGE}\n"
            f"Version: {version}-1\n"
            "Section: gnome\n"
            "Priority: optional\n"
            "Architecture: all\n"
            "Depends: gnome-shell (>= 49)\n"
            "Maintainer: Daniel Nylander <po@danielnylander.se>\n"
            "Description: CPU, memory, and network monitor for GNOME Shell\n"
            " Compact panel graphs, process lists, Swedish localization,\n"
            " configurable refresh intervals, and sustained resource alerts.\n"
        )
        target = output / f"{PACKAGE}_{version}-1_all.deb"
        run(["dpkg-deb", "--build", "--root-owner-group", str(root), str(target)])
        control = subprocess.check_output(["dpkg-deb", "-f", str(target)], text=True)
        fields = dict(line.split(":", 1) for line in control.splitlines() if ":" in line)
        if [fields.get(key, "").strip() for key in ("Package", "Version", "Architecture")] != [PACKAGE, f"{version}-1", "all"]:
            raise RuntimeError(f"Unexpected DEB control metadata:\n{control}")


def build_rpm(version, output):
    with tempfile.TemporaryDirectory(prefix="system-monitor-rpm-") as temporary:
        top = Path(temporary) / "rpmbuild"
        for subdirectory in ("BUILD", "BUILDROOT", "RPMS", "SOURCES", "SPECS", "SRPMS"):
            (top / subdirectory).mkdir(parents=True)

        source = Path(temporary) / "extension"
        install_tree(source)
        with tarfile.open(top / "SOURCES/extension.tar.gz", "w:gz") as archive:
            archive.add(source, arcname="extension")

        spec = (ROOT / "packaging/rpm/system-monitor.spec.in").read_text()
        spec = spec.replace("@VERSION@", version)
        spec = spec.replace("@CHANGELOG_DATE@", datetime.datetime.now(datetime.timezone.utc).strftime("%a %b %d %Y"))
        changelog_date = datetime.datetime.now(datetime.timezone.utc).strftime("%a %b %d %Y")
        spec = re.sub(r"^\* .* - ", f"* {changelog_date} Daniel Nylander <po@danielnylander.se> - {version}-1", spec, count=1, flags=re.MULTILINE)
        spec_path = top / "SPECS/system-monitor.spec"
        spec_path.write_text(spec)
        rpmdb = Path(temporary) / "rpmdb"
        rpmdb.mkdir()
        run(["rpmbuild", "-bb", "--define", f"_dbpath {rpmdb}", "--define", f"_topdir {top}", str(spec_path)])

        built = list((top / "RPMS/noarch").glob("*.rpm"))
        if len(built) != 1:
            raise RuntimeError(f"Expected one RPM, got {built}")
        target = output / f"{PACKAGE}-{version}-1.noarch.rpm"
        shutil.copy2(built[0], target)
        header = subprocess.check_output(
            ["rpm", "--dbpath", str(Path(temporary) / "rpmdb"), "-qp", "--qf", "%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}\n", str(target)],
            text=True,
        ).splitlines()
        if header != [PACKAGE, version, "1", "noarch"]:
            raise RuntimeError(f"Unexpected RPM header: {header}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", args.version):
        raise SystemExit("Version must contain numeric dot-separated components")
    metadata = json.loads((ROOT / "metadata.json").read_text())
    if metadata["uuid"] != "system-monitor@yeager-v3":
        raise SystemExit("Unexpected extension UUID")
    args.output.mkdir(parents=True, exist_ok=True)
    build_deb(args.version, args.output)
    build_rpm(args.version, args.output)
    print(f"Built DEB and RPM packages for {args.version} in {args.output}")


if __name__ == "__main__":
    main()
