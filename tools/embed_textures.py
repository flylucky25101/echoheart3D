#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Embeds the PBR textures into scripts/texture-data.js as data: URIs.
Reason: on file:// Chrome treats local images as cross-origin, so
gl.texImage2D(img) throws SecurityError and every surface falls back to a
flat colour. data: URIs are same-origin, so they always upload.
Runtime picks embedded on file://, real files on http(s).
"""
import os, base64, io, json, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
TEX = os.path.join(ROOT, "assets", "textures")
OUT = os.path.join(ROOT, "scripts", "texture-data.js")
SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 256
Q = 80

GROUPS = {
    "riftSteel": "environments", "darkMetal": "environments", "energyCyan": "environments",
    "stone": "environments", "wallPanel": "environments", "cloth": "player", "leather": "player", "skin": "player",
    "crystalRed": "player", "circuit": "player", "organic": "enemies", "magenta": "enemies",
    "bossShell": "boss", "bossMetal": "boss", "bossCore": "boss", "chainMetal": "weapons",
}
KINDS = ["albedo", "normal", "orm", "emissive"]

BIG = {"stone": 512, "wallPanel": 512}   # terrain tiles keep more detail

def enc(path, size, hq=False):
    im = Image.open(path).convert("RGB")
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=(95 if hq else Q), method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii"), len(buf.getvalue())

def main():
    out, total, count = {}, 0, 0
    for g, folder in GROUPS.items():
        for kind in KINDS:
            ext = "webp" if kind in ("albedo", "emissive") else "png"
            p = os.path.join(TEX, folder, "%s_%s.%s" % (g, kind, ext))
            if not os.path.exists(p):
                print("  MISSING", p); continue
            # normal maps suffer most from lossy compression -> keep them cleaner
            uri, nbytes = enc(p, BIG.get(g, SIZE), hq=(kind == "normal"))   # normals carry the surface feel
            out["%s_%s" % (g, kind)] = uri
            total += nbytes; count += 1
    # UI icon atlas (has alpha) - PNG, used by the HUD renderer
    icons = os.path.join(TEX, "ui", "icons.png")
    if os.path.exists(icons):
        im = Image.open(icons).convert("RGBA")
        buf = io.BytesIO(); im.save(buf, "WEBP", quality=90, method=4)
        out["ui_icons"] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        total += len(buf.getvalue()); count += 1
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("'use strict';\n")
        f.write("// Embedded PBR textures (data URIs) - guarantees WebGL upload under file://\n")
        f.write("(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.TextureData=" + json.dumps(out) + ";\n")
        f.write("EH.TextureDataSize=%d;\n})();\n" % SIZE)
    js = os.path.getsize(OUT)
    print("  embedded %d textures @ %dpx  raw %.2f MB  -> texture-data.js %.2f MB"
          % (count, SIZE, total/1048576, js/1048576))

if __name__ == "__main__":
    main()
