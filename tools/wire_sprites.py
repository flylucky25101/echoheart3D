#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wires the baked premium sheets into the game:
  * scripts/sprite-embedded.js  - sheet pixels as data: URIs (file:// safe)
  * scripts/sprite-imported.js  - per-sheet metadata + kind -> sheet mapping
Run: python3 tools/wire_sprites.py
"""
import os, re, json, base64
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPR = os.path.join(ROOT, "assets", "sprites_v2")
SCRIPTS = os.path.join(ROOT, "scripts")

SHEETS = json.load(open(os.path.join(SPR, "_sheets.json")))

# Which 3D mesh each sheet was baked from. `scale` and `footPad` are measured
# from the actual pixels against that mesh's bounds rather than hand-tuned - a
# hand-tuned number silently goes stale the moment a sheet is re-baked, which is
# how the actors ended up hovering above the floor.
SHEET_MESH = {
    "player_riftsword": "lian", "player_pulsebow": "lian", "player_chaingaunt": "lian",
    "enemy_stalker": "stalker", "enemy_gunner": "gunner", "enemy_orb": "orb",
    "enemy_shield": "shield", "enemy_summoner": "summoner", "enemy_sentinel": "sentinel",
    "boss": "chronovore",
}

ENEMY_KIND = {
    "enemy_stalker": "stalker", "enemy_gunner": "gunner", "enemy_orb": "orb",
    "enemy_shield": "shield", "enemy_summoner": "summoner", "enemy_sentinel": "sentinel",
}
PLAYER_WEAPON = {
    "player_riftsword": "riftsword",
    "player_pulsebow": "pulsebow",
    "player_chaingaunt": "chaingaunt",
}


def mesh_bounds():
    """Vertical extent of every generated mesh, read back out of the emitted JS."""
    out = {}
    for fn in os.listdir(SCRIPTS):
        if not fn.startswith("mesh-data-"):
            continue
        src = open(os.path.join(SCRIPTS, fn), encoding="utf-8").read()
        for m in re.finditer(r"EH\.Meshes\['([^']+)'\]=\{parts:\[.*?\],bounds:\{([^}]*)\}",
                             src, re.S):
            b = m.group(2)
            mn = re.search(r"min:\[([^\]]*)\]", b)
            mx = re.search(r"max:\[([^\]]*)\]", b)
            if mn and mx:
                out[m.group(1)] = (float(mn.group(1).split(",")[1]),
                                   float(mx.group(1).split(",")[1]))
    return out


def occupancy(alpha, cw, ch, rows):
    """Fraction of the cell the artwork actually covers, as (top, bottom) in 0..1.

    Averaging would let one stray frame drag the anchor around, so we take the
    union over the sampled rows - the sheet is drawn with a single scale and the
    feet must sit on the floor in every frame, not on average.
    """
    tops, bots = [], []
    for r in rows:
        for d in range(alpha.shape[1] // cw):
            cell = alpha[r * ch:(r + 1) * ch, d * cw:(d + 1) * cw]
            rr = np.where(cell.max(axis=1) > 16)[0]
            if len(rr):
                tops.append(rr[0])
                bots.append(rr[-1])
    if not tops:
        return 0.0, 1.0
    return min(tops) / float(ch), (max(bots) + 1) / float(ch)


def measure(key, meta, bounds):
    """Fill in `scale` + `footPad` (and prop rows) from the baked pixels."""
    alpha = np.asarray(Image.open(os.path.join(SPR, key + ".webp")).convert("RGBA"))[..., 3]
    cw, ch = meta["cw"], meta["ch"]
    sheet = SHEETS[key]

    if key == "props":
        rows = sheet.get("propRows") or {}
        info = {}
        for name, r in rows.items():
            t, b = occupancy(alpha, cw, ch, [r])
            lo, hi = bounds.get(name, (0.0, 1.0))
            info[name] = {"row": r, "occ": round(b - t, 4), "footPad": round(1.0 - b, 4),
                          "meshH": round(hi - lo, 3),
                          "cellPerUnit": round(1.0 / max(1e-4, b - t), 4)}
        meta["propRows"] = rows
        meta["propInfo"] = info
        return "props %d종" % len(info)

    # idle + walk are the states the actor spends most of its time in
    sample = [si * meta["dirs"] + d
              for si in range(min(2, len(meta["states"])))
              for d in range(meta["dirs"])]
    t, b = occupancy(alpha, cw, ch, sample)
    lo, hi = bounds.get(SHEET_MESH.get(key, ""), (0.0, 1.8))
    meta["scale"] = round((hi - lo) / max(1e-4, b - t), 3)
    meta["footPad"] = round(1.0 - b, 4)
    return "scale %.3f footPad %.4f" % (meta["scale"], meta["footPad"])


def main():
    bounds = mesh_bounds()
    metas, embedded, manifest = {}, {}, {}
    char, enemy, boss = {}, {}, None
    total = 0

    for key, m in sorted(SHEETS.items()):
        path = os.path.join(SPR, key + ".webp")
        if not os.path.exists(path):
            print("건너뜀(파일 없음):", key)
            continue
        raw = open(path, "rb").read()
        total += len(raw)
        embedded[key] = "data:image/webp;base64," + base64.b64encode(raw).decode("ascii")
        meta = {
            "key": key, "cols": m["cols"], "rows": m["rows"], "dirs": m["dirs"],
            "states": m["states"], "cw": m["cw"], "ch": m["ch"],
            "W": m["W"], "H": m["H"], "fps": m.get("fps", 10),
        }
        print("  %-20s %s" % (key, measure(key, meta, bounds)))
        metas[key] = meta
        manifest[key] = {"path": "assets/sprites_v2/%s.webp" % key,
                         "w": m["W"], "h": m["H"], "type": "sheet"}
        if key in PLAYER_WEAPON:
            char[PLAYER_WEAPON[key]] = key
        elif key in ENEMY_KIND:
            enemy[ENEMY_KIND[key]] = key
        elif key == "boss":
            boss = key

    # ---- pixels ----
    p = os.path.join(SCRIPTS, "sprite-embedded.js")
    with open(p, "w", encoding="utf-8") as f:
        f.write("'use strict';\n")
        f.write("// Pre-rendered sprite sheets as data URIs.\n")
        f.write("// Embedded so gl.texImage2D works under file:// (local files are\n")
        f.write("// treated as cross-origin and would otherwise taint the texture).\n")
        f.write("(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("var D=EH.TextureData=EH.TextureData||{};\n")
        for k, v in embedded.items():
            f.write("D[%s]=%s;\n" % (json.dumps(k), json.dumps(v)))
        f.write("EH.SpriteEmbeddedCount=%d;\n})();\n" % len(embedded))

    # ---- metadata + routing ----
    p2 = os.path.join(SCRIPTS, "sprite-imported.js")
    with open(p2, "w", encoding="utf-8") as f:
        f.write("'use strict';\n")
        f.write("// Baked by tools/bake_premium.py + tools/wire_sprites.py.\n")
        f.write("// Empty objects here would make the game fall back to live 3D meshes.\n")
        f.write("(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.SpriteImported=" + json.dumps(metas) + ";\n")
        f.write("EH.__spriteEnemy=" + json.dumps(enemy) + ";\n")
        f.write("EH.__spriteChar=" + json.dumps(char) + ";\n")
        f.write("EH.__spriteBoss=" + (json.dumps(boss) if boss else "null") + ";\n")
        f.write("EH.__spriteManifest=" + json.dumps(manifest) + ";\n")
        f.write("var M=EH.AssetManifest;\n")
        f.write("if(M){for(var k in EH.__spriteManifest){M[k]=EH.__spriteManifest[k];}}\n")
        f.write("})();\n")

    print("임베드 %d시트  원본 %.2fMB -> base64 %.2fMB"
          % (len(embedded), total / 1e6,
             sum(len(v) for v in embedded.values()) / 1e6))
    print("플레이어:", char)
    print("적:", enemy, "| 보스:", boss)


if __name__ == "__main__":
    main()
