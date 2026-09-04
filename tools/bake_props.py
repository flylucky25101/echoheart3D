#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bakes the static scenery props (pillar / altar / forge / device / door / gear /
crystal) into one 8-direction billboard atlas, shaded to match the character
sheets so the whole scene reads as a single art style.

Layout: rows = props, cols = 8 directions.
Output: assets/sprites_v2/props.webp + entry in _sheets.json
Run: python3 tools/bake_props.py
"""
import os, sys, math, json
import numpy as np
from PIL import Image
import spritelib as SL
import premium_shade as PS
import clips as C
import bake_premium as B

OUT = B.OUT
DIRS = 8
CELL = 144

PROPS = ["pillar", "altar", "forge", "device", "door", "gear", "crystal"]
LOOK = B.prof("prop", ramp_amount=0.82, sat=1.20, emis_mul=0.70)


def main():
    meshes = B.MESHES
    have = [p for p in PROPS if p in meshes]
    sheet = Image.new("RGBA", (DIRS * CELL, len(have) * CELL), (0, 0, 0, 0))
    rows = {}
    for ri, name in enumerate(have):
        parts = meshes[name]
        # static: fit the rest pose over all facings
        ppu, oy = B.fit_all_poses(parts, {"idle": (lambda a, t, c: None, 1.0, True)},
                                  {}, CELL, 0.90)
        for d in range(DIRS):
            mats = SL.compose(parts, {}, d * (2 * math.pi / DIRS))
            img = PS.render_frame(parts, mats, B.MATS, CELL, ppu, oy, ss=2, **LOOK)
            sheet.paste(img, (d * CELL, ri * CELL))
        rows[name] = ri
        sys.stderr.write("  prop %s (row %d)\n" % (name, ri))

    path = os.path.join(OUT, "props.webp")
    sheet.save(path, "WEBP", quality=88, method=5)
    meta = {
        "key": "props", "cols": DIRS, "rows": len(have), "dirs": DIRS,
        "states": ["idle"], "cw": CELL, "ch": CELL,
        "W": sheet.width, "H": sheet.height, "fps": 1,
        "propRows": rows, "bytes": os.path.getsize(path),
    }
    mp = os.path.join(OUT, "_sheets.json")
    m = json.load(open(mp)) if os.path.exists(mp) else {}
    m["props"] = meta
    json.dump(m, open(mp, "w"), indent=1)
    sys.stderr.write("props.webp %dx%d %dKB  rows=%s\n"
                     % (sheet.width, sheet.height, meta["bytes"] // 1024, rows))


if __name__ == "__main__":
    main()
