#!/usr/bin/env python3
"""Review license texts for all resolved hosted Flutter dependencies."""

import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

ALLOWED = {
    "Apache-2.0": "apache license version 2.0",
    "BSD": "redistribution and use in source and binary forms",
    "MIT": "permission is hereby granted, free of charge",
    "MPL-2.0": "mozilla public license version 2.0",
}


def main():
    config = Path(__file__).resolve().parents[1] / ".dart_tool/package_config.json"
    packages = json.loads(config.read_text())["packages"]
    unknown = []
    reviewed = 0
    for package in packages:
        uri = urlsplit(package["rootUri"])
        root = Path(unquote(uri.path))
        if uri.scheme not in ("", "file"):
            unknown.append(package["name"])
            continue
        if "hosted" not in root.parts:
            continue
        licenses = [path for path in root.glob("LICENSE*") if path.is_file()]
        for license_file in sorted(licenses):
            contents = " ".join(license_file.read_text(errors="replace").lower().split())
            matches = [name for name, marker in ALLOWED.items() if marker in contents]
            if not matches:
                unknown.append(f'{package["name"]}/{license_file.name}')
        if not licenses:
            unknown.append(package["name"])
        reviewed += 1
    if not reviewed:
        raise SystemExit("No hosted dependencies found. Run flutter pub get.")
    if unknown:
        raise SystemExit("License review required: " + ", ".join(unknown))
    print(f"Reviewed licenses for {reviewed} hosted packages")


if __name__ == "__main__":
    main()
