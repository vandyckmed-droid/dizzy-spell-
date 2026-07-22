#!/usr/bin/env python3
"""Inject the data snapshot into the HTML template -> dist/portfolio-screener.html.

Verifies the FMP API key does NOT appear anywhere in the delivered artifact.
"""
import os, re, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
snap_path = os.path.join(ROOT, "data", "snapshot.json")
tpl_path = os.path.join(HERE, "template.html")
out_dir = os.path.join(ROOT, "dist")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "portfolio-screener.html")
body_path = os.path.join(out_dir, "artifact-body.html")

with open(snap_path) as f:
    snap_text = f.read()
with open(tpl_path) as f:
    tpl = f.read()

# Guard: template must not accidentally contain a real secret
key = os.environ.get("API_KEY", "")
if key and key in tpl:
    sys.exit("ERROR: template contains the API key!")

# JSON is embedded inside a <script type="application/json"> block; the only
# sequence that could break out is a literal "</script". Escape it defensively.
safe = snap_text.replace("</script", "<\\/script").replace("</", "<\\/")
html = tpl.replace("__SNAPSHOT_JSON__", safe)

with open(out_path, "w") as f:
    f.write(html)

# Body-only variant for publishing via the Artifact tool (no <html>/<head>/<body>)
m = re.search(r"<body>(.*)</body>", html, re.S)
inner = m.group(1) if m else html
style = re.search(r"<style>.*?</style>", html, re.S).group(0)
with open(body_path, "w") as f:
    f.write(style + "\n" + inner)

# Final safety check: no API key in delivered files
for p in (out_path, body_path):
    with open(p) as f:
        content = f.read()
    if key and key in content:
        sys.exit(f"ERROR: API key leaked into {p}")
    assert "financialmodelingprep.com" not in content, "live FMP URL must not ship"

print(f"Wrote {out_path} ({os.path.getsize(out_path)/1e6:.2f} MB)")
print(f"Wrote {body_path} ({os.path.getsize(body_path)/1e6:.2f} MB)")
print("Verified: no API key, no live FMP endpoint in delivered artifact.")
