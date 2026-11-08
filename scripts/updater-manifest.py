"""Builds latest.json for the Tauri updater from a release's signed update bundles and uploads it.

Run in CI with GH_TOKEN, GITHUB_REPOSITORY, RELEASE_ID and TAG set. Fails if a platform's bundle
or signature is missing, so a release never ships an updater feed that skips a platform.
"""

import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone

PLATFORMS = {
    "darwin-aarch64": r"_aarch64\.app\.tar\.gz$",
    "darwin-x86_64": r"_x64\.app\.tar\.gz$",
    "windows-x86_64": r"_x64-setup\.exe$",
    "linux-x86_64": r"_amd64\.AppImage$",
}


def gh(*args, binary=False):
    out = subprocess.run(["gh", "api", *args], check=True, capture_output=True).stdout
    return out if binary else json.loads(out or b"null")


repo = os.environ["GITHUB_REPOSITORY"]
release_id = os.environ["RELEASE_ID"]
tag = os.environ["TAG"]
release = gh(f"repos/{repo}/releases/{release_id}")
assets = {a["name"]: a for a in release["assets"]}

platforms = {}
for platform, pattern in PLATFORMS.items():
    bundle = next((n for n in assets if re.search(pattern, n)), None)
    if not bundle or f"{bundle}.sig" not in assets:
        raise SystemExit(f"Missing update bundle or signature for {platform}")
    signature = gh(
        "-H", "Accept: application/octet-stream",
        f"repos/{repo}/releases/assets/{assets[bundle + '.sig']['id']}",
        binary=True,
    ).decode().strip()
    platforms[platform] = {
        "signature": signature,
        "url": f"https://github.com/{repo}/releases/download/{tag}/{bundle}",
    }

notes = release.get("body") or ""
manifest = {
    "version": tag.removeprefix("v"),
    "notes": notes.split("\n\n")[0],
    "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": platforms,
}

if "latest.json" in assets:
    gh("-X", "DELETE", f"repos/{repo}/releases/assets/{assets['latest.json']['id']}")
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump(manifest, f, indent=2)
gh(
    "-X", "POST", "-H", "Content-Type: application/json", "--input", f.name,
    f"https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?name=latest.json",
)
print(f"latest.json: {manifest['version']} for {', '.join(platforms)}")
