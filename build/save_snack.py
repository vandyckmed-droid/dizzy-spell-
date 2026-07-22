#!/usr/bin/env python3
"""Publish the Expo app as a self-contained anonymous Snack on Expo's servers.

Bundles app code + engine + the key-free market-data snapshot inline, so the
Snack runs in Expo Go with no external hosting and the private GitHub repo
stays private. Prints the shareable snack URL.
"""
import json, os, urllib.request, urllib.error

SDK = "57.0.0"
DEPS = {
    "expo-haptics": "~57.0.1",
    "expo-status-bar": "~57.0.1",
    "react-native-svg": "15.15.4",
    "react-native-safe-area-context": "~5.7.0",
    "@react-native-async-storage/async-storage": "2.2.0",
}

def read(p):
    with open(p) as f:
        return f.read()

code = {
    "App.js": {"contents": read("app/App.js"), "type": "CODE"},
    "engine.js": {"contents": read("app/engine.js"), "type": "CODE"},
    # data source of truth is data/snapshot.json (app/snapshot.json is a gitignored build copy)
    "snapshot.json": {"contents": read("data/snapshot.json"), "type": "CODE"},
    "package.json": {"contents": read("app/package.json"), "type": "CODE"},
    "app.json": {"contents": read("app/app.json"), "type": "CODE"},
}
payload = {
    "manifest": {
        "name": "Momentum Screener",
        "description": "Sharpe-momentum screener + HRP portfolios (iPhone)",
        "sdkVersion": SDK,
        "dependencies": DEPS,
    },
    "code": code,
    "dependencies": {k: {"version": v} for k, v in DEPS.items()},
}
body = json.dumps(payload).encode()
print(f"payload size: {len(body)/1e6:.2f} MB")

req = urllib.request.Request(
    "https://exp.host/--/api/v2/snack/save",
    data=body, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
except urllib.error.HTTPError as e:
    print("SAVE FAILED", e.code, e.read()[:500].decode("utf8", "ignore"))
    raise SystemExit(1)

sid = res.get("id") or res.get("hashId")
print("saved id:", sid)
url = f"https://snack.expo.dev/{sid}"
print("SNACK URL:", url)

# Round-trip: fetch it back and confirm files + deps were accepted
try:
    with urllib.request.urlopen(f"https://exp.host/--/api/v2/snack/{sid}", timeout=60) as r:
        back = json.load(r)
    man = back.get("manifest", back)
    files = (back.get("code") or man.get("code") or {})
    print("\nround-trip check:")
    print("  sdk:", man.get("sdkVersion"))
    print("  deps:", man.get("dependencies"))
    print("  files:", {k: (v.get("type"), len(v.get("contents", ""))) for k, v in files.items()})
except Exception as e:
    print("round-trip GET note:", e)

with open("build/snack_url.txt", "w") as f:
    f.write(url + "\n")
