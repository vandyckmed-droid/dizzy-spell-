#!/usr/bin/env python3
"""Publish the Expo app as an anonymous Snack on Expo's servers.

The repo is public, so the Snack references the app's raw GitHub files by URL
instead of baking them in. The result is a short, permanent link that
auto-updates every time this branch is pushed (Snack re-fetches the raw files
on open). No API key ships — the snapshot is key-free.

Falls back to inline `contents` (a frozen self-contained Snack) if run with
--inline, useful when the repo is private.
"""
import json, os, sys, subprocess, urllib.request, urllib.error

SDK = "57.0.0"
DEPS = {
    "expo-haptics": "~57.0.1",
    "expo-status-bar": "~57.0.1",
    "react-native-svg": "15.15.4",
    "react-native-safe-area-context": "~5.7.0",
    "@react-native-async-storage/async-storage": "2.2.0",
}
REPO = "vandyckmed-droid/dizzy-spell-"
INLINE = "--inline" in sys.argv

# External refs resolve against a PERMANENT public branch so the link never dies
# when a feature branch is deleted after merge. This matches DATA_URL in App.js,
# which already hydrates the full snapshot from `main`. Override with --branch=NAME
# (e.g. to preview an unmerged branch's app files) or --branch to use the checkout.
branch = "main"
for a in sys.argv:
    if a == "--branch":
        branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"]).decode().strip()
    elif a.startswith("--branch="):
        branch = a.split("=", 1)[1]
RAW = f"https://raw.githubusercontent.com/{REPO}/refs/heads/{branch}"

# in-Snack filename -> repo path
FILES = {
    "App.js": "app/App.js",
    "engine.js": "app/engine.js",
    # light snapshot for instant first paint; the full history is background-fetched
    # by the app from the raw `data/snapshot.json` URL (see DATA_URL in App.js)
    "snapshot.lite.json": "data/snapshot.lite.json",
    "package.json": "app/package.json",
    "app.json": "app/app.json",
}

def entry(repo_path):
    if INLINE:
        with open(repo_path) as f:
            return {"contents": f.read(), "type": "CODE"}
    return {"type": "CODE", "url": f"{RAW}/{repo_path}"}

code = {name: entry(path) for name, path in FILES.items()}
payload = {
    "manifest": {
        "name": "Momentum Screener",
        "description": "Sharpe-momentum screener + long-only HRP portfolios (iPhone)",
        "sdkVersion": SDK,
        "dependencies": DEPS,
    },
    "code": code,
    "dependencies": {k: {"version": v} for k, v in DEPS.items()},
}
body = json.dumps(payload).encode()
print(f"mode: {'inline (frozen)' if INLINE else 'external refs (auto-updating)'} · branch: {branch}")

req = urllib.request.Request("https://exp.host/--/api/v2/snack/save",
                             data=body, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
except urllib.error.HTTPError as e:
    print("SAVE FAILED", e.code, e.read()[:400].decode("utf8", "ignore"))
    raise SystemExit(1)

sid = res.get("id") or res.get("hashId")
url = f"https://snack.expo.dev/{sid}"
print("SNACK URL:", url)
with open("build/snack_url.txt", "w") as f:
    f.write(url + "\n")

# round-trip sanity
try:
    with urllib.request.urlopen(urllib.request.Request(
            f"https://exp.host/--/api/v2/snack/{sid}",
            headers={"Snack-Api-Version": "3.0.0"}), timeout=60) as r:
        back = json.load(r)
    man = back.get("manifest", back)
    c = back.get("code") or man.get("code") or {}
    print("sdk:", man.get("sdkVersion"), "· files:", list(c.keys()))
except Exception as e:
    print("round-trip note:", e)
