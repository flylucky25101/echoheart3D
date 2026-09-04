#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECHOHEART - 2D sprite-sheet importer (for AI-generated / CC0 sheets).
Slices a REGULAR GRID sheet, embeds it as a data URI (file:// safe), and wires
it to the player / an enemy / the boss so it renders as a camera-facing
billboard in the 3D world (2.5D). Transparent PNG expected.

Layout (what to ask your image AI for):
  * one PNG, regular grid, transparent background, top-down 3/4 view
  * ROWS   = facing directions (recommended 4 rows: front(down), left, right, back(up))
  * COLUMNS= animation frames (e.g. 6): frame 0 = idle rest, then a short walk cycle

  python3 tools/import_spritesheet.py <folder-or-file> --as player
  python3 tools/import_spritesheet.py <folder> --file hero.png --as enemy:stalker --cols 6 --rows 4 --fps 8 --scale 1.7
"""
import os, sys, io, json, base64, re
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
IMPORT = os.path.join(ROOT, "assets", "import")
SCRIPTS = os.path.join(ROOT, "scripts")

# row index -> facing bucket (0=front/down .. going clockwise) for common layouts
DIR_ORDERS = {
    1: [0],
    4: [0, 6, 2, 4],          # front(down), left, right, back(up)  [game 8-dir buckets]
    8: [0, 1, 2, 3, 4, 5, 6, 7],
}

def find_png(folder_or_file, fname):
    if os.path.isfile(folder_or_file):
        return folder_or_file
    if fname:
        p = os.path.join(folder_or_file, fname)
        if os.path.isfile(p):
            return p
    if os.path.isdir(folder_or_file):
        pngs = [f for f in os.listdir(folder_or_file) if f.lower().endswith(".png")]
        pngs = [f for f in pngs if "preview" not in f.lower()]
        if pngs:
            return os.path.join(folder_or_file, sorted(pngs)[0])
    return None

def autotrim_uniform(im):
    """if the sheet has a solid (non-transparent) background colour, key it out"""
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    px = im.load()
    a_min = min(px[x, y][3] for x in range(0, im.width, max(1, im.width // 20))
                for y in range(0, im.height, max(1, im.height // 20)))
    if a_min > 250:  # fully opaque -> assume corner colour is the background
        bg = px[0, 0]
        import numpy as np
        arr = np.asarray(im).astype(int)
        d = (abs(arr[:, :, 0] - bg[0]) + abs(arr[:, :, 1] - bg[1]) + abs(arr[:, :, 2] - bg[2]))
        mask = d < 40
        arr[mask, 3] = 0
        im = Image.fromarray(arr.astype("uint8"), "RGBA")
    return im

def embed_texture(key, im):
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=92, method=4)
    uri = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    # merge into texture-data.js
    p = os.path.join(SCRIPTS, "texture-data.js")
    data = {}
    size = 384
    if os.path.exists(p):
        src = open(p).read()
        m = re.search(r"EH\.TextureData=(\{.*?\});", src, re.S)
        if m: data = json.loads(m.group(1))
        sm = re.search(r"EH\.TextureDataSize=(\d+)", src)
        if sm: size = int(sm.group(1))
    data[key] = uri
    with open(p, "w") as f:
        f.write("'use strict';\n// Embedded textures (data URIs) incl. sprite sheets\n")
        f.write("(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.TextureData=" + json.dumps(data) + ";\nEH.TextureDataSize=%d;\n})();\n" % size)
    return len(uri)

def write_meta(name, meta, target):
    p = os.path.join(SCRIPTS, "sprite-imported.js")
    imported = {}; char = None; enemy = {}; boss = None; manifest = {}
    if os.path.exists(p):
        src = open(p).read()
        def grab(v):
            m = re.search(r"EH\." + v + r"=(\{.*?\});", src, re.S); return json.loads(m.group(1)) if m else {}
        imported = grab("SpriteImported"); enemy = grab("__spriteEnemy"); manifest = grab("__spriteManifest")
        m = re.search(r"EH\.__spriteChar='([^']*)'", src); char = m.group(1) if m else None
        m = re.search(r"EH\.__spriteBoss='([^']*)'", src); boss = m.group(1) if m else None
    imported[name] = meta
    manifest[meta["key"]] = {"path": "assets/import/_sheet_" + name + ".webp", "w": meta["W"], "h": meta["H"], "type": "sheet"}
    if target == "player": char = name
    elif target == "boss": boss = name
    elif target.startswith("enemy:"): enemy[target.split(":")[1]] = name
    with open(p, "w") as f:
        f.write("'use strict';\n(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.SpriteImported=" + json.dumps(imported) + ";\n")
        f.write("EH.__spriteEnemy=" + json.dumps(enemy) + ";\n")
        f.write("EH.__spriteManifest=" + json.dumps(manifest) + ";\n")
        f.write("EH.__spriteChar=" + (("'%s'" % char) if char else "null") + ";\n")
        f.write("EH.__spriteBoss=" + (("'%s'" % boss) if boss else "null") + ";\n")
        # register sheets into AssetManifest so the loader fetches them (embedded on file://)
        f.write("EH.AssetManifest=EH.AssetManifest||{};var __sm=" + json.dumps(manifest) +
                ";for(var k in __sm){EH.AssetManifest[k]=__sm[k];}\n")
        f.write("})();\n")

def main():
    a = sys.argv[1:]
    if not a:
        print("usage: import_spritesheet.py <folder|file> --as player|enemy:<kind>|boss "
              "[--file NAME] [--cols C] [--rows R] [--fps F] [--scale S]")
        return
    src = a[0]
    if not os.path.isabs(src) and not os.path.exists(src):
        src = os.path.join(IMPORT, src)
    target = "player"; cols = None; rows = None; fps = 8; scale = None; fname = None
    for i, x in enumerate(a):
        if x == "--as" and i + 1 < len(a): target = a[i + 1]
        if x == "--file" and i + 1 < len(a): fname = a[i + 1]
        if x == "--cols" and i + 1 < len(a): cols = int(a[i + 1])
        if x == "--rows" and i + 1 < len(a): rows = int(a[i + 1])
        if x == "--fps" and i + 1 < len(a): fps = float(a[i + 1])
        if x == "--scale" and i + 1 < len(a): scale = float(a[i + 1])
    png = find_png(src, fname)
    if not png:
        print("no PNG found at", src); return
    im = Image.open(png).convert("RGBA")
    im = autotrim_uniform(im)
    W, H = im.size
    # infer grid if not given: assume square-ish cells
    if not cols or not rows:
        # guess: 4 rows if H roughly divides, else 1
        rows = rows or (4 if H % 4 == 0 and H >= W else 1)
        cw = H // rows
        cols = cols or max(1, round(W / cw))
    cw = W // cols; ch = H // rows
    dirs = rows if rows in (1, 4, 8) else 1
    if scale is None:
        scale = {"player": 1.9, "boss": 4.0}.get(target, 1.7)
        if target.startswith("enemy"): scale = 1.7
    name = re.sub(r"[^A-Za-z0-9_]", "_", os.path.splitext(os.path.basename(png))[0]) + "_" + target.replace(":", "_")
    key = "sheet_" + name
    # re-embed at a sane max size to keep the data URI reasonable
    maxpx = 1024
    if max(W, H) > maxpx:
        r = maxpx / max(W, H)
        im = im.resize((int(W * r), int(H * r)), Image.LANCZOS)
        W, H = im.size; cw = W // cols; ch = H // rows
    nbytes = embed_texture(key, im)
    meta = {
        "key": key, "cols": cols, "rows": rows, "cw": cw, "ch": ch, "W": W, "H": H,
        "dirs": dirs, "dirOrder": DIR_ORDERS.get(dirs, [0]), "fps": fps, "scale": scale
    }
    write_meta(name, meta, target)
    print("imported sheet '%s'  grid=%dx%d cell=%dx%d dirs=%d fps=%s scale=%.1f  (~%.0fKB embedded)  -> %s"
          % (name, cols, rows, cw, ch, dirs, fps, scale, nbytes / 1024, target))
    print("  index.html 에 <script src=\"scripts/sprite-imported.js\" defer></script> 필요(1회)")

if __name__ == "__main__":
    main()
