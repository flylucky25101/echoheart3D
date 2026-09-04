#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bakes the rigged 3D meshes into 2D sprite sheets + scripts/sprite-data.js.
Chunkable / resumable:   python3 render_sprites.py player
                         python3 render_sprites.py enemy:stalker
                         python3 render_sprites.py boss props vfx manifest
"""
import os, sys, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import spritelib as S
import clips as C

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPR = os.path.join(ROOT, "assets", "sprites")
SCRIPTS = os.path.join(ROOT, "scripts")
os.makedirs(SPR, exist_ok=True)

PLAYER_PX, ENEMY_PX, BOSS_PX, PROP_PX, VFX_PX = 72, 72, 144, 96, 64
ATLAS_MAX = 2048
MESHES = S.load_meshes()
C_WEAPON_MESH = {"riftsword": "riftsword", "pulsebow": "pulsebow", "chaingaunt": "chaingaunt"}
MATS = S.load_materials()

def anchor_px(size, ppu, origin_y):
    """pixel position of world origin (character's ground point) inside a frame"""
    vv = S.VIEW[:3, 3]
    ax = vv[0]*ppu + size*0.5
    ay = size*0.5 - vv[1]*ppu + origin_y
    return [round(float(ax), 2), round(float(ay), 2)]

def bake(mesh_name, clipset, dirs, size, ctx_extra=None, flat=False):
    """returns (list of PIL frames, list of clip records)"""
    parts = MESHES[mesh_name]
    names = set(p["n"] for p in parts)
    ppu, oy = S.fit_scale(parts, size)
    ctx = {"legs": ("thighR" in names or "thighL" in names)}
    if ctx_extra: ctx.update(ctx_extra)
    frames, records, idx = [], [], 0
    for cname, (fn, dur, nf, loop) in clipset.items():
        ndir = 1 if flat else dirs
        rec = {"start": idx, "dirs": ndir, "frames": nf,
               "fps": round(nf/max(dur, 1e-3), 2), "loop": bool(loop)}
        for d in range(ndir):
            facing = 0.0 if flat else (d*(2*math.pi/8))
            for f in range(nf):
                t = (f/nf)*dur if loop else (f/max(1, nf-1))*dur
                pose = C.Pose(); fn(pose, t, ctx)
                mats = S.compose(parts, pose.final(), facing)
                frames.append(S.render_frame(parts, mats, MATS, size, ppu, oy, ss=2))
                idx += 1
        records.append((cname, rec))
    return frames, records, anchor_px(size, ppu, oy), size

def pack(frames, size, path):
    cols = max(1, ATLAS_MAX//size)
    rows = int(math.ceil(len(frames)/cols))
    atlas = Image.new("RGBA", (cols*size, rows*size), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        atlas.paste(fr, ((i % cols)*size, (i//cols)*size))
    atlas.save(path, "PNG", optimize=True)
    return {"path": os.path.relpath(path, ROOT).replace("\\", "/"),
            "w": atlas.width, "h": atlas.height, "cell": size, "cols": cols, "count": len(frames)}

def out_json(name): return os.path.join(SPR, "_%s.json" % name)

def save_part(name, atlas, anims, anchor, size):
    json.dump({"atlas": atlas, "anims": anims, "anchor": anchor, "cell": size},
              open(out_json(name), "w"), indent=1)

# ------------------------------------------------------------------ targets
def _render_group(key, clipset, mesh_name, size, dirs, ctx, force):
    if os.path.exists(out_json(key)) and not force: return "skip"
    parts = MESHES[mesh_name]
    ppu, oy = S.fit_scale(parts, size)
    frames, anims, idx = [], {}, 0
    for cname, (fn, dur, nf, loop) in clipset.items():
        rec = {"start": idx, "dirs": dirs, "frames": nf,
               "fps": round(nf/max(dur, 1e-3), 2), "loop": bool(loop), "mirror": dirs == 5}
        for d in range(dirs):
            for fi in range(nf):
                t = (fi/nf)*dur if loop else (fi/max(1, nf-1))*dur
                pose = C.Pose(); fn(pose, t, ctx)
                frames.append(S.render_frame(parts, S.compose(parts, pose.final(), d*(2*math.pi/8)),
                                             MATS, size, ppu, oy, ss=2))
                idx += 1
        anims[cname] = rec
    atlas = pack(frames, size, os.path.join(SPR, key + ".png"))
    save_part(key, atlas, anims, anchor_px(size, ppu, oy), size)
    return "%d frames" % len(frames)

PLAYER_PAD = 0.68          # head-room so a swung weapon stays inside the frame
GRIP_ROT = (1.25, 0.0, 0.0)   # blade points forward+up so swings read clearly

def do_player_weapon(w, force=False):
    """One sheet per weapon: locomotion + that weapon's attacks, weapon rendered in hand."""
    key = "player_" + w
    if os.path.exists(out_json(key)) and not force: return "skip"
    parts = MESHES["lian"]
    wparts = MESHES[C_WEAPON_MESH[w]]
    wmi = [i for i, p in enumerate(parts) if p["n"] == "weaponMount"][0]
    ppu, oy = S.fit_scale(parts, PLAYER_PX, pad=PLAYER_PAD)
    allclips = dict(C.PLAYER)
    for k, v in C.WEAPON_CLIPS[w].items():
        allclips[k] = v
    frames, anims, idx = [], {}, 0
    for cname, (fn, dur, nf, loop) in allclips.items():
        rec = {"start": idx, "dirs": 8, "frames": nf,
               "fps": round(nf/max(dur, 1e-3), 2), "loop": bool(loop), "mirror": False}
        for d in range(8):
            for fi in range(nf):
                t = (fi/nf)*dur if loop else (fi/max(1, nf-1))*dur
                pose = C.Pose(); fn(pose, t, {})
                mats = S.compose(parts, pose.final(), d*(2*math.pi/8))
                grip = mats[wmi] @ S.mat_from_qts(S.quat_euler(*GRIP_ROT), np.zeros(3), 1.0)
                wmats = [grip @ S.mat_from_qts(S.quat_euler(0, 0, 0), wp["rest"], 1.0) for wp in wparts]
                frames.append(S.render_frame(parts + wparts, list(mats) + wmats,
                                             MATS, PLAYER_PX, ppu, oy, ss=2))
                idx += 1
        anims[cname] = rec
    atlas = pack(frames, PLAYER_PX, os.path.join(SPR, key + ".png"))
    save_part(key, atlas, anims, anchor_px(PLAYER_PX, ppu, oy), PLAYER_PX)
    return "%d frames" % len(frames)

def do_enemy(kind, force=False):
    if os.path.exists(out_json("enemy_"+kind)) and not force: return "skip"
    mesh = {"stalker": "stalker", "gunner": "gunner", "orb": "orb",
            "shield": "shield", "summoner": "summoner", "sentinel": "sentinel"}[kind]
    frames, recs, anchor, size = bake(mesh, C.ENEMY, 5, ENEMY_PX, {"tell": 0.5})
    anims = {}
    for cname, rec in recs:
        rec["mirror"] = True          # 5 rendered dirs -> 8 via horizontal flip
        anims[cname] = rec
    atlas = pack(frames, size, os.path.join(SPR, "enemy_%s.png" % kind))
    save_part("enemy_"+kind, atlas, anims, anchor, size)
    return "%d frames" % len(frames)

def do_boss_dir_part(part, force=False):
    keys = list(C.BOSS_DIR.keys())
    sel = keys[:3] if part == 1 else keys[3:]
    sub = {k: C.BOSS_DIR[k] for k in sel}
    return _render_group("boss_dir%d" % part, sub, "chronovore", BOSS_PX, 5, {"phase": 1}, force)

def do_boss_flat(force=False):
    if os.path.exists(out_json("boss_flat")) and not force: return "skip"
    parts = MESHES["chronovore"]
    ppu, oy = S.fit_scale(parts, BOSS_PX)
    frames, anims, idx = [], {}, 0
    for cname, (fn, dur, nf, loop) in C.BOSS_FLAT.items():
        anims[cname] = {"start": idx, "dirs": 1, "frames": nf,
                        "fps": round(nf/max(dur, 1e-3), 2), "loop": bool(loop), "mirror": False}
        for f in range(nf):
            t = (f/max(1, nf-1))*dur
            pose = C.Pose(); fn(pose, t, {"phase": 1})
            frames.append(S.render_frame(parts, S.compose(parts, pose.final(), 0.0),
                                         MATS, BOSS_PX, ppu, oy, ss=2))
            idx += 1
    atlas = pack(frames, BOSS_PX, os.path.join(SPR, "boss_flat.png"))
    save_part("boss_flat", atlas, anims, anchor_px(BOSS_PX, ppu, oy), BOSS_PX)
    return "%d frames" % len(frames)

PROPS = ["wall", "pillar", "crystal", "altar", "device", "forge", "door", "floorTile"]
def do_props(force=False):
    if os.path.exists(out_json("props")) and not force: return "skip"
    frames, anims, idx = [], {}, 0
    anchors = {}
    for name in PROPS:
        parts = MESHES[name]
        ppu, oy = S.fit_scale(parts, PROP_PX, pad=0.92)
        pose = C.Pose()
        frames.append(S.render_frame(parts, S.compose(parts, pose.final(), 0.0),
                                     MATS, PROP_PX, ppu, oy, ss=2))
        anims[name] = {"start": idx, "dirs": 1, "frames": 1, "fps": 1, "loop": False, "mirror": False}
        anchors[name] = anchor_px(PROP_PX, ppu, oy)
        idx += 1
    # spinning gear (8 frames)
    parts = MESHES["gear"]; ppu, oy = S.fit_scale(parts, PROP_PX, pad=0.92)
    anims["gear"] = {"start": idx, "dirs": 1, "frames": 8, "fps": 10, "loop": True, "mirror": False}
    for f in range(8):
        pose = C.Pose()
        frames.append(S.render_frame(parts, S.compose(parts, pose.final(), f*(2*math.pi/8/3)),
                                     MATS, PROP_PX, ppu, oy, ss=2))
        idx += 1
    anchors["gear"] = anchor_px(PROP_PX, ppu, oy)
    atlas = pack(frames, PROP_PX, os.path.join(SPR, "props.png"))
    json.dump({"atlas": atlas, "anims": anims, "anchors": anchors, "cell": PROP_PX},
              open(out_json("props"), "w"), indent=1)
    return "%d frames" % len(frames)

# ------------------------------------------------------------------ VFX (drawn, not 3D)
def do_vfx(force=False):
    if os.path.exists(out_json("vfx")) and not force: return "skip"
    N = VFX_PX; c = N//2
    frames, anims, idx = [], {}, 0
    def newf():
        return Image.new("RGBA", (N, N), (0, 0, 0, 0))
    def add(name, imgs, fps, loop=False):
        nonlocal idx
        anims[name] = {"start": idx, "dirs": 1, "frames": len(imgs), "fps": fps,
                       "loop": loop, "mirror": False}
        frames.extend(imgs); idx += len(imgs)
    rng = np.random.default_rng(7)

    # impact burst
    im = []
    for f in range(6):
        img = newf(); d = ImageDraw.Draw(img)
        k = f/5.0; r = 4+k*26; a = int(255*(1-k))
        d.ellipse([c-r, c-r, c+r, c+r], outline=(255, 245, 220, a), width=max(1, int(4*(1-k))+1))
        for s in range(9):
            ang = s*0.7+k*1.2; L = r*(0.7+0.5*rng.random())
            d.line([c+math.cos(ang)*r*0.4, c+math.sin(ang)*r*0.4,
                    c+math.cos(ang)*L, c+math.sin(ang)*L], fill=(255, 220, 170, a), width=2)
        im.append(img.filter(ImageFilter.GaussianBlur(0.6)))
    add("impact", im, 24)

    # explosion
    im = []
    for f in range(8):
        img = newf(); d = ImageDraw.Draw(img)
        k = f/7.0; r = 6+k*28; a = int(255*(1-k*k))
        d.ellipse([c-r, c-r, c+r, c+r], fill=(255, int(160-90*k), 60, int(a*0.55)))
        d.ellipse([c-r*0.6, c-r*0.6, c+r*0.6, c+r*0.6], fill=(255, 240, 190, int(a*0.85)))
        for s in range(10):
            ang = rng.random()*6.28; L = r*(0.8+0.6*rng.random())
            rr = 2+3*(1-k)
            px, py = c+math.cos(ang)*L, c+math.sin(ang)*L
            d.ellipse([px-rr, py-rr, px+rr, py+rr], fill=(255, 190, 90, a))
        im.append(img.filter(ImageFilter.GaussianBlur(1.0)))
    add("explosion", im, 20)

    # slash arc (tinted at runtime)
    im = []
    for f in range(5):
        img = newf(); d = ImageDraw.Draw(img)
        k = f/4.0; a = int(255*(1-k*0.85)); sweep = 150
        st = -40 - k*70
        for w in range(3):
            rr = 26-w*5
            d.arc([c-rr, c-rr, c+rr, c+rr], st, st+sweep,
                  fill=(255, 255, 255, max(0, a-w*60)), width=4-w)
        im.append(img.filter(ImageFilter.GaussianBlur(0.7)))
    add("slash", im, 26)

    # shockwave ring
    im = []
    for f in range(6):
        img = newf(); d = ImageDraw.Draw(img)
        k = f/5.0; r = 3+k*29; a = int(230*(1-k))
        d.ellipse([c-r, c-r, c+r, c+r], outline=(255, 255, 255, a), width=max(1, int(5*(1-k))+1))
        im.append(img.filter(ImageFilter.GaussianBlur(0.8)))
    add("ring", im, 22)

    # soft glow (projectiles / particles) - single frame, tinted at runtime
    img = newf(); d = ImageDraw.Draw(img)
    for r in range(c, 0, -1):
        al = int(255*(1-r/c)**2.2)
        d.ellipse([c-r, c-r, c+r, c+r], fill=(255, 255, 255, al))
    add("glow", [img.filter(ImageFilter.GaussianBlur(1.2))], 1, True)

    # ground decal ring (telegraphs)
    img = newf(); d = ImageDraw.Draw(img)
    d.ellipse([2, 2, N-3, N-3], outline=(255, 255, 255, 235), width=4)
    d.ellipse([8, 8, N-9, N-9], outline=(255, 255, 255, 90), width=2)
    add("decalRing", [img], 1, True)
    img = newf(); d = ImageDraw.Draw(img)
    d.ellipse([1, 1, N-2, N-2], fill=(255, 255, 255, 120))
    add("decalDisc", [img], 1, True)

    # shadow blob
    img = newf(); d = ImageDraw.Draw(img)
    for r in range(c, 0, -1):
        al = int(150*(1-r/c)**1.6)
        d.ellipse([c-r, c-r*0.55, c+r, c+r*0.55], fill=(0, 0, 0, al))
    add("shadow", [img.filter(ImageFilter.GaussianBlur(1.5))], 1, True)

    atlas = pack(frames, N, os.path.join(SPR, "vfx.png"))
    save_part("vfx", atlas, anims, [N/2, N/2], N)
    return "%d frames" % len(frames)

# ------------------------------------------------------------------ manifest
SHEET_MESH = {"player_riftsword": ("lian", PLAYER_PX),
              "player_pulsebow": ("lian", PLAYER_PX), "player_chaingaunt": ("lian", PLAYER_PX),
              "boss_dir1": ("chronovore", BOSS_PX), "boss_dir2": ("chronovore", BOSS_PX),
              "boss_flat": ("chronovore", BOSS_PX),
              "stalker": ("stalker", ENEMY_PX), "gunner": ("gunner", ENEMY_PX),
              "orb": ("orb", ENEMY_PX), "shield": ("shield", ENEMY_PX),
              "summoner": ("summoner", ENEMY_PX), "sentinel": ("sentinel", ENEMY_PX)}

def _ppu_for(sheet_key, anim_name):
    """pixels-per-world-unit used when baking -> lets the runtime keep true relative scale"""
    if sheet_key == "props":
        return S.fit_scale(MESHES[anim_name], PROP_PX, pad=0.92)[0] if anim_name in MESHES else PROP_PX
    if sheet_key == "vfx":
        return VFX_PX
    mesh, size = SHEET_MESH[sheet_key]
    pad = PLAYER_PAD if mesh == "lian" else 0.80
    return S.fit_scale(MESHES[mesh], size, pad=pad)[0]

def do_manifest():
    sheets, anims = {}, {}
    def load(name, key):
        p = out_json(name)
        if not os.path.exists(p): return False
        j = json.load(open(p))
        sheets[key] = j["atlas"]
        for cname, rec in j["anims"].items():
            r = dict(rec); r["sheet"] = key
            anims[key+":"+cname] = r
        if "anchors" in j:
            for k, v in j["anchors"].items():
                anims[key+":"+k]["anchor"] = v
        else:
            for cname in j["anims"]:
                anims[key+":"+cname]["anchor"] = j["anchor"]
        for cname in j["anims"]:
            anims[key+":"+cname]["ppu"] = round(float(_ppu_for(key, cname)), 3)
        return True
    ok = [load("boss_dir1", "boss_dir1"), load("boss_dir2", "boss_dir2"),
          load("boss_flat", "boss_flat"), load("props", "props"), load("vfx", "vfx")]
    for w in ["riftsword", "pulsebow", "chaingaunt"]:
        ok.append(load("player_" + w, "player_" + w))
    for k in ["stalker", "gunner", "orb", "shield", "summoner", "sentinel"]:
        ok.append(load("enemy_"+k, k))
    with open(os.path.join(SCRIPTS, "sprite-data.js"), "w", encoding="utf-8") as f:
        f.write("'use strict';\n(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.SpriteSheets=" + json.dumps(sheets) + ";\n")
        f.write("EH.SpriteAnims=" + json.dumps(anims) + ";\n})();\n")
    return "sheets=%d anims=%d (missing %d)" % (len(sheets), len(anims), ok.count(False))

# ------------------------------------------------------------------ main
if __name__ == "__main__":
    args = sys.argv[1:] or ["all"]
    force = "force" in args
    if "all" in args:
        args = ["player:"+w for w in ["riftsword", "pulsebow", "chaingaunt"]] + \
               ["boss_dir1", "boss_dir2", "boss_flat", "props", "vfx"] + \
               ["enemy:"+k for k in ["stalker", "gunner", "orb", "shield", "summoner", "sentinel"]] + \
               ["manifest"]
    for a in args:
        if a in ("force",): continue
        import time; t0 = time.time()
        if False: pass
        elif a.startswith("player:"): r = do_player_weapon(a.split(":")[1], force)
        elif a == "boss_dir1": r = do_boss_dir_part(1, force)
        elif a == "boss_dir2": r = do_boss_dir_part(2, force)
        elif a == "boss_flat": r = do_boss_flat(force)
        elif a == "props":    r = do_props(force)
        elif a == "vfx":      r = do_vfx(force)
        elif a == "manifest": r = do_manifest()
        elif a.startswith("enemy:"): r = do_enemy(a.split(":")[1], force)
        else: r = "unknown target"
        print("  %-16s %-14s %.1fs" % (a, r, time.time()-t0))
