#!/usr/bin/env python3
"""Generate the note manifest and an allowlisted GitHub Pages artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRECTORIES = {
    ".git",
    ".github",
    ".idea",
    ".vscode",
    "_site",
    "node_modules",
    "scripts",
    "vendor",
}
EXCLUDED_FILENAMES = {
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CHANGELOG.md",
    "LICENSE.md",
}
SITE_FILES = (
    "index.html",
    "styles.css",
    "app.js",
    "service-worker.js",
    "manifest.webmanifest",
)
SITE_DIRECTORIES = ("icons", "vendor")
HEADING_PATTERN = re.compile(r"^\s*#\s+(.+?)\s*#*\s*$")


def is_note(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if path.name.upper() in {name.upper() for name in EXCLUDED_FILENAMES}:
        return False
    return not any(part in EXCLUDED_DIRECTORIES or part.startswith(".") for part in relative.parts[:-1])


def title_for(path: Path) -> str:
    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for line in handle:
            match = HEADING_PATTERN.match(line)
            if match:
                return re.sub(r"\s+", " ", match.group(1)).strip()
    return path.stem.replace("-", " ").replace("_", " ").strip()


def discover_notes() -> list[dict[str, object]]:
    notes = []
    for path in ROOT.rglob("*.md"):
        if not is_note(path):
            continue
        relative = PurePosixPath(path.relative_to(ROOT)).as_posix()
        notes.append({
            "path": relative,
            "title": title_for(path),
            "bytes": path.stat().st_size,
        })
    return sorted(notes, key=lambda note: (str(note["title"]).casefold(), str(note["path"]).casefold()))


def manifest_data() -> dict[str, object]:
    return {
        "version": 1,
        "notes": discover_notes(),
    }


def write_manifest(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_site(output: Path, data: dict[str, object]) -> None:
    output = output.resolve()
    if output == ROOT or ROOT not in output.parents:
        raise ValueError("Output directory must be a child of the repository")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    for relative in SITE_FILES:
        shutil.copy2(ROOT / relative, output / relative)
    for relative in SITE_DIRECTORIES:
        shutil.copytree(ROOT / relative, output / relative)
    for note in data["notes"]:
        relative = Path(str(note["path"]))
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, destination)

    write_manifest(output / "notes-manifest.json", data)
    digest = hashlib.sha256()
    for path in sorted(output.rglob("*")):
        if path.is_file() and path.name != "service-worker.js":
            digest.update(path.relative_to(output).as_posix().encode())
            digest.update(path.read_bytes())
    service_worker = output / "service-worker.js"
    service_worker.write_text(
        service_worker.read_text(encoding="utf-8").replace("__BUILD_VERSION__", digest.hexdigest()[:12]),
        encoding="utf-8",
    )
    (output / ".nojekyll").touch()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, help="Build an allowlisted Pages artifact in this directory")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=ROOT / "notes-manifest.json",
        help="Manifest path for local/static use",
    )
    args = parser.parse_args()

    output = None
    if args.output_dir:
        output = (args.output_dir if args.output_dir.is_absolute() else ROOT / args.output_dir).resolve()
        if output == ROOT or ROOT not in output.parents:
            raise ValueError("Output directory must be a child of the repository")
        if output.exists():
            shutil.rmtree(output)

    data = manifest_data()
    write_manifest(args.manifest, data)
    if output:
        build_site(output, data)
    print(f"Generated manifest for {len(data['notes'])} note(s)")


if __name__ == "__main__":
    main()
