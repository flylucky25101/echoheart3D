#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECHOHEART premium sprite-sheet baker.

Renders every character / enemy / boss through premium_shade into a regular
grid sheet:

    rows = STATES x 8 directions   (row = stateIndex * 8 + direction)
    cols = frames per state

Output: assets/sprites_v2/<key>.webp  +  _sheets.json manifest.
Run:    python3 tools/bake_premium.py [only_key ...]
"""
import os, sys, math, json, time
import numpy as np
from PIL import Image
import spritelib as SL
import premium_shade as PS
import clips as C

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "assets", "sprites_v2")
os.makedirs(OUT, exist_ok=True)

MESHES = SL.load_meshes()
MATS = SL.load_materials()

STATES = ["idle", "move", "attack", "death"]
DIRS = 8
COLS = 6

# ---------------------------------------------------------------- look profiles
# User direction: stronger neon + thicker ink outline.
BASE = dict(alb_lift=2.4, alb_gamma=0.75, key_mul=1.9, rim_mul=2.2,
            outline_dark=1.0, outline_px=3.8, bloom=1.0, sat=1.32,
            style="toon", bands=4, ramp_amount=0.80, ramp_gain=1.18,
            ramp_bias=0.03, alb_blur=0.6, emis_mul=0.85)


def prof(ramp, **over):
    d = dict(BASE); d["ramp"] = ramp; d.update(over); return d


HERO_LOOK = prof("cyber")
FOE_LOOK = prof("hostile", ramp_amount=0.85, sat=1.22)
FOE_GLOW = prof("hostile", ramp_amount=0.85, sat=1.22, emis_mul=0.45)  # orb / shield
BOSS_LOOK = prof("boss", ramp_amount=0.80, emis_mul=0.70)

# ---------------------------------------------------------------- weapon grips
# Mirrors EH.WEAPONS[*].grip in scripts/config.js so the in-hand weapon matches
# exactly what the 3D build renders.
WEAPON = {
    "riftsword":  dict(mesh="riftsword",  rot=(0.55, 0.0, -0.1), off=(0.0, -0.05, 0.02), scale=1.0,
                       atk=C.l_sword3, atk_dur=0.56),
    "pulsebow":   dict(mesh="pulsebow",   rot=(1.30, 0.0, 0.0),  off=(0.0, -0.02, 0.02), scale=0.82,
                       atk=C.l_bowShoot, atk_dur=0.30),
    "chaingaunt": dict(mesh="chaingaunt", rot=(1.45, 0.0, 0.0),  off=(0.0, -0.03, 0.0),  scale=1.0,
                       atk=C.l_gaunt4, atk_dur=0.44),
}

# state -> (clip fn, duration, loops)
PLAYER_STATES = {
    "idle":  (C.l_idle, 2.0, True),
    "move":  (C.l_run,  0.70, True),
    "death": (C.l_death, 0.95, False),
}
FOE_STATES = {
    "idle":   (C.f_idle,  2.0, True),
    "move":   (C.f_move,  0.65, True),
    "attack": (C.f_attack, 0.40, False),
    "death":  (C.f_death, 0.95, False),
}
BOSS_STATES = {
    "idle":   (C.b_idle,  2.4, True),
    "move":   (C.b_dash,  0.85, True),
    "attack": (C.b_sweep, 0.80, False),
    "death":  (C.b_death, 1.60, False),
}


_WORK = {}


def _run_one(i):
    """Module-level trampoline so the forked pool can call the local closure."""
    return _WORK["fn"](i)


def frame_times(dur, loop, n):
    if loop:
        return [(i / n) * dur for i in range(n)]
    return [(i / max(1, n - 1)) * dur for i in range(n)]


def fit_all_poses(parts, states, base_ctx, cell, pad, wparts=None, wmi=None, wlocal=None):
    """Pixels-per-unit that keeps every pose of every state inside the cell,
    weapon included. A static rest-pose fit clips big swings."""
    lo = np.array([1e9, 1e9]); hi = np.array([-1e9, -1e9])
    for sname in STATES:
        fn, dur, loop = states.get(sname, states["idle"])
        for t in frame_times(dur, loop, COLS):
            pose = C.Pose(); fn(pose, t, base_ctx)
            for facing in (0.0, math.pi * 0.5, math.pi, math.pi * 1.5):
                mats = SL.compose(parts, pose.final(), facing)
                allp, allm = parts, list(mats)
                if wparts is not None:
                    grip = mats[wmi] @ wlocal
                    allp = parts + wparts
                    allm = list(mats) + [grip @ SL.mat_from_qts(SL.quat_euler(0, 0, 0),
                                                                wp["rest"], 1.0)
                                         for wp in wparts]
                for i, p in enumerate(allp):
                    if p["pos"].size == 0 or allm[i] is None:
                        continue
                    v = (allm[i][:3, :3] @ p["pos"].T).T + allm[i][:3, 3]
                    vv = (SL.VIEW[:3, :3] @ v.T).T + SL.VIEW[:3, 3]
                    lo = np.minimum(lo, vv[:, :2].min(axis=0))
                    hi = np.maximum(hi, vv[:, :2].max(axis=0))
    w = max(hi[0] - lo[0], 1e-3); h = max(hi[1] - lo[1], 1e-3)
    ppu = cell * pad / max(w, h)
    cy = (hi[1] + lo[1]) * 0.5
    return ppu, cy * ppu


def bake_sheet(key, mesh_name, states, look, cell, ss=2, weapon=None, ctx=None,
               pad=0.90, log=print, budget=None, start=0):
    """Render frames [start..] into the sheet. Stops early when the time budget
    runs out and returns (meta_or_None, next_index) so the caller can resume."""
    parts = MESHES[mesh_name]
    names = set(p["n"] for p in parts)
    base_ctx = {"legs": ("thighR" in names or "thighL" in names)}
    if ctx:
        base_ctx.update(ctx)

    wparts, wmi, wlocal = None, None, None
    if weapon:
        w = WEAPON[weapon]
        wparts = MESHES[w["mesh"]]
        wmi = [i for i, p in enumerate(parts) if p["n"] == "weaponMount"][0]
        wlocal = SL.mat_from_qts(SL.quat_euler(*w["rot"]), np.array(w["off"]), w["scale"])
    ppu, oy = fit_all_poses(parts, states, base_ctx, cell, pad, wparts, wmi, wlocal)

    rows = len(STATES) * DIRS
    total = rows * COLS
    part_path = os.path.join(OUT, key + ".partial.png")
    if start > 0 and os.path.exists(part_path):
        sheet = Image.open(part_path).convert("RGBA")
    else:
        sheet = Image.new("RGBA", (COLS * cell, rows * cell), (0, 0, 0, 0))

    def one(i):
        row, ci = divmod(i, COLS)
        si, d = divmod(row, DIRS)
        fn, dur, loop = states.get(STATES[si], states["idle"])
        t = frame_times(dur, loop, COLS)[ci]
        pose = C.Pose()
        fn(pose, t, base_ctx)
        mats = SL.compose(parts, pose.final(), d * (2 * math.pi / DIRS))
        allp, allm = parts, list(mats)
        if wparts is not None:
            grip = mats[wmi] @ wlocal
            allp = parts + wparts
            allm = list(mats) + [grip @ SL.mat_from_qts(SL.quat_euler(0, 0, 0),
                                                        wp["rest"], 1.0)
                                 for wp in wparts]
        img = PS.render_frame(allp, allm, MATS, cell, ppu, oy, ss=ss, **look)
        return i, img.tobytes()

    t0 = time.time()
    i = start
    # 2 worker processes (fork inherits the loaded meshes/textures)
    import multiprocessing as mp
    nproc = max(1, min(2, (os.cpu_count() or 1)))
    if nproc > 1:
        _WORK["fn"] = one
        with mp.get_context("fork").Pool(nproc) as pool:
            batch = 4
            while i < total:
                if budget is not None and (time.time() - t0) > budget:
                    break
                chunk = list(range(i, min(total, i + batch)))
                for idx, raw in pool.imap_unordered(_run_one, chunk, chunksize=2):
                    row, ci = divmod(idx, COLS)
                    sheet.paste(Image.frombytes("RGBA", (cell, cell), raw),
                                (ci * cell, row * cell))
                i += len(chunk)
    else:
        while i < total:
            if budget is not None and (time.time() - t0) > budget:
                break
            idx, raw = one(i)
            row, ci = divmod(idx, COLS)
            sheet.paste(Image.frombytes("RGBA", (cell, cell), raw), (ci * cell, row * cell))
            i += 1

    if i < total:
        sheet.save(part_path)
        log("  %s  %d/%d (이어하기)  %.0fs" % (key, i, total, time.time() - t0))
        return None, i

    path = os.path.join(OUT, key + ".webp")
    sheet.save(path, "WEBP", quality=86, method=5)
    try:
        if os.path.exists(part_path):
            os.remove(part_path)
    except OSError:
        pass          # read-only mount: harmless leftover
    meta = {
        "key": key, "cols": COLS, "rows": rows, "dirs": DIRS,
        "states": STATES, "cw": cell, "ch": cell,
        "W": sheet.width, "H": sheet.height,
        "fps": 10, "anchorY": round(float(oy) / cell, 4),
        "bytes": os.path.getsize(path),
    }
    log("  -> %s 완료 %dx%d %dKB" % (key, sheet.width, sheet.height, meta["bytes"] // 1024))
    return meta, total


# ---------------------------------------------------------------- targets
ENEMIES = ["stalker", "gunner", "orb", "shield", "summoner", "sentinel"]
GLOWY = {"orb", "shield"}


def build_jobs():
    jobs = []
    for w in WEAPON:
        st = dict(PLAYER_STATES)
        st["attack"] = (WEAPON[w]["atk"], WEAPON[w]["atk_dur"], False)
        jobs.append(dict(key="player_" + w, mesh="lian", states=st,
                         look=HERO_LOOK, cell=104, weapon=w))
    for e in ENEMIES:
        jobs.append(dict(key="enemy_" + e, mesh=e, states=FOE_STATES,
                         look=(FOE_GLOW if e in GLOWY else FOE_LOOK), cell=96))
    jobs.append(dict(key="boss", mesh="chronovore", states=BOSS_STATES,
                     look=BOSS_LOOK, cell=152, ctx={"phase": 1}))
    return jobs


if __name__ == "__main__":
    # Each invocation works for --budget seconds then checkpoints, so the bake
    # can be driven across several short runs.
    args = sys.argv[1:]
    budget = 33.0
    if "--budget" in args:
        budget = float(args[args.index("--budget") + 1])
    only = set(a for a in args if not a.startswith("-") and not a.replace(".", "").isdigit())

    jobs = [j for j in build_jobs() if not only or j["key"] in only]
    mpath = os.path.join(OUT, "_sheets.json")
    ppath = os.path.join(OUT, "_progress.json")
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    progress = json.load(open(ppath)) if os.path.exists(ppath) else {}

    t0 = time.time()
    for j in jobs:
        k = j["key"]
        if k in manifest and progress.get(k, 0) >= manifest[k]["rows"] * COLS:
            continue
        left = budget - (time.time() - t0)
        if left < 4:
            break
        m, nxt = bake_sheet(k, j["mesh"], j["states"], j["look"], j["cell"],
                            weapon=j.get("weapon"), ctx=j.get("ctx"),
                            log=lambda s: print(s, flush=True),
                            budget=left, start=progress.get(k, 0))
        progress[k] = nxt
        json.dump(progress, open(ppath, "w"))
        if m:
            manifest[k] = m
            json.dump(manifest, open(mpath, "w"), indent=1)

    allj = build_jobs()
    done = sum(1 for j in allj if j["key"] in manifest)
    tot_frames = len(STATES) * DIRS * COLS
    cur = sum(min(progress.get(j["key"], 0), tot_frames) for j in allj)
    print("진행 %d/%d 시트  프레임 %d/%d  (%.0f%%)  누적 %.2fMB"
          % (done, len(allj), cur, tot_frames * len(allj),
             100.0 * cur / (tot_frames * len(allj)),
             sum(v["bytes"] for v in manifest.values()) / 1e6), flush=True)
