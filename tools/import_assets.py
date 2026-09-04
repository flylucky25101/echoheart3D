#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECHOHEART - CC0 asset importer  (OBJ + MTL + textures -> runtime JS).
Handles nested pack layouts (Models/OBJ format/...), maps limb-grouped
characters onto the game rig so they actually animate, embeds textures as
data: URIs (file:// safe). No network, no external libs beyond Pillow.

  python3 tools/import_assets.py <folder> [--model NAME] [--as prop|weapon|char]
                                          [--rig kenney] [--player] [--height H]
"""
import os, sys, io, json, base64, re
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
IMPORT = os.path.join(ROOT, "assets", "import")
SCRIPTS = os.path.join(ROOT, "scripts")

# kenney group name -> (rig part, parent, pivot-rule)
RIG_KENNEY = {
    "torso":     ("torso",     "pelvis", "waist"),
    "head":      ("head",      "torso",  "neck"),
    "arm-left":  ("upperArmL", "torso",  "shoulder"),
    "arm-right": ("upperArmR", "torso",  "shoulder"),
    "leg-left":  ("thighL",    "pelvis", "hip"),
    "leg-right": ("thighR",    "pelvis", "hip"),
}

# ---------------------------------------------------------------- parse
def parse_obj(path):
    verts, uvs, norms = [], [], []
    groups = {}; cur = "default"; groups[cur] = []
    facemat = {}; mtllib = None; matname = None
    for line in open(path, "r", errors="ignore"):
        t = line.split()
        if not t: continue
        k = t[0]
        if k == "v": verts.append([float(t[1]), float(t[2]), float(t[3])])
        elif k == "vt": uvs.append([float(t[1]), float(t[2]) if len(t) > 2 else 0.0])
        elif k == "vn": norms.append([float(t[1]), float(t[2]), float(t[3])])
        elif k in ("g", "o"):
            cur = "_".join(t[1:]) or "default"; groups.setdefault(cur, [])
        elif k == "mtllib": mtllib = " ".join(t[1:])
        elif k == "usemtl": matname = t[1]; facemat[cur] = matname
        elif k == "f":
            poly = []
            for part in t[1:]:
                a = (part.split("/") + ["", ""])[:3]
                poly.append((int(a[0]), int(a[1]) if a[1] else 0, int(a[2]) if a[2] else 0))
            for i in range(1, len(poly) - 1):
                groups[cur].append((poly[0], poly[i], poly[i + 1]))
    return verts, uvs, norms, groups, facemat, mtllib

def parse_mtl(path):
    mats = {}; cur = None; base = os.path.dirname(path)
    if not os.path.exists(path): return mats
    for line in open(path, "r", errors="ignore"):
        t = line.split()
        if not t: continue
        if t[0] == "newmtl": cur = t[1]; mats[cur] = {}
        elif cur is None: continue
        elif t[0] == "Kd": mats[cur]["Kd"] = [float(t[1]), float(t[2]), float(t[3])]
        elif t[0] == "Ke": mats[cur]["Ke"] = [float(x) for x in t[1:4]]
        elif t[0].lower() == "map_kd": mats[cur]["albedo"] = os.path.join(base, " ".join(t[1:]))
        elif t[0].lower() in ("map_bump", "bump", "norm"): mats[cur]["normal"] = os.path.join(base, t[-1])
        elif t[0].lower() in ("map_ns", "map_pr"): mats[cur]["rough"] = os.path.join(base, t[-1])
        elif t[0].lower() in ("map_ke",): mats[cur]["emis"] = os.path.join(base, t[-1])
    return mats


def detect_and_orient(verts, norms, groups, forward):
    """Ensure the model faces +Z (the game's forward). Auto-detect from foot
    position when forward='auto': whichever Z the feet toes point toward is 'front'."""
    do_flip = (forward == "-z")
    if forward == "auto":
        leg_v = []
        for g in groups:
            if "leg" in g.lower() or "foot" in g.lower():
                for tri in groups[g]:
                    for (vi, ti, ni) in tri: leg_v.append(vi - 1)
        if leg_v and verts:
            allz = np.array([verts[i][2] for i in range(len(verts))])
            ly = np.array([verts[i][1] for i in leg_v])
            lz = np.array([verts[i][2] for i in leg_v])
            foot = lz[ly <= np.percentile(ly, 30)]
            # feet point -Z (front is -Z) -> flip so it becomes +Z
            do_flip = foot.mean() < allz.mean()
    if do_flip:
        for v in verts: v[0] = -v[0]; v[2] = -v[2]
        for n in norms: n[0] = -n[0]; n[2] = -n[2]
    return do_flip

# ---------------------------------------------------------------- geometry helpers
def compute_normals(pos, idx):
    n = np.zeros_like(pos)
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t + 1], idx[t + 2]
        fn = np.cross(pos[b] - pos[a], pos[c] - pos[a])
        n[a] += fn; n[b] += fn; n[c] += fn
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln < 1e-9] = 1
    return n / ln

def fix_orientation(pos, nrm, idx):
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t + 1], idx[t + 2]
        fn = np.cross(pos[b] - pos[a], pos[c] - pos[a])
        if np.dot(fn, nrm[a] + nrm[b] + nrm[c]) < 0:
            idx[t + 1], idx[t + 2] = idx[t + 2], idx[t + 1]

def extract_group(verts, uvs, norms, faces):
    pos, nrm, uv, idx = [], [], [], []; vmap = {}
    for tri in faces:
        for (vi, ti, ni) in tri:
            key = (vi, ti, ni)
            if key not in vmap:
                vmap[key] = len(pos) // 3
                pos += verts[vi - 1]
                nrm += (norms[ni - 1] if ni and abs(ni) <= len(norms) else [0, 0, 0])
                if ti and abs(ti) <= len(uvs):
                    u = uvs[ti - 1]; uv += [u[0], 1.0 - u[1]]
                else: uv += [0, 0]
            idx.append(vmap[key])
    pos = np.array(pos, np.float64).reshape(-1, 3)
    nrm = np.array(nrm, np.float64).reshape(-1, 3)
    idx = np.array(idx, np.int64)
    if np.abs(nrm).sum() < 1e-6: nrm = compute_normals(pos, idx)
    return pos, nrm, np.array(uv, np.float64), idx

# ---------------------------------------------------------------- builders
def norm_transform(verts, target_height):
    V = np.array(verts, np.float64)
    mn = V.min(0); mx = V.max(0)
    scale = target_height / max(mx[1] - mn[1], 1e-6)
    cx = (mn[0] + mx[0]) * 0.5; cz = (mn[2] + mx[2]) * 0.5
    def tf(P):
        Q = P.copy()
        Q[:, 0] = (P[:, 0] - cx) * scale
        Q[:, 1] = (P[:, 1] - mn[1]) * scale
        Q[:, 2] = (P[:, 2] - cz) * scale
        return Q
    return tf, scale

def build_static(verts, uvs, norms, groups, facemat, height, single):
    tf, scale = norm_transform(verts, height)
    order = [g for g in groups if groups[g]]
    if single and len(order) > 1:
        merged = []; 
        for g in order: merged += groups[g]
        groups = {"root": merged}; order = ["root"]; facemat = {"root": None}
    parts = []
    for gi, g in enumerate(order):
        pos, nrm, uv, idx = extract_group(verts, uvs, norms, groups[g])
        pos = tf(pos); fix_orientation(pos, nrm, idx)
        parts.append({"name": ("root" if len(order) == 1 else g), "mat": facemat.get(g),
                      "par": -1, "rest": [0, 0, 0], "pos": pos, "nrm": nrm, "uv": uv, "idx": idx})
    return parts, scale

def build_rigged(verts, uvs, norms, groups, facemat, height, rigmap):
    tf, scale = norm_transform(verts, height)
    # 1) extract + normalize each mapped group, gather bbox
    raw = {}
    for g in groups:
        if g not in rigmap or not groups[g]: continue
        pos, nrm, uv, idx = extract_group(verts, uvs, norms, groups[g])
        pos = tf(pos)
        raw[g] = {"pos": pos, "nrm": nrm, "uv": uv, "idx": idx,
                  "min": pos.min(0), "max": pos.max(0), "mat": facemat.get(g)}
    if not raw: return None, scale
    # 2) pivots (joint positions)
    waistY = raw["torso"]["min"][1] if "torso" in raw else 0.9
    piv = {"pelvis": np.array([0.0, waistY, 0.0])}
    for g, (pname, parent, rule) in rigmap.items():
        if g not in raw: continue
        b = raw[g]
        cx = (b["min"][0] + b["max"][0]) * 0.5
        if rule == "waist": p = [0.0, b["min"][1], 0.0]
        elif rule == "neck": p = [0.0, b["min"][1], 0.0]
        elif rule == "shoulder": p = [cx, b["max"][1], 0.0]
        elif rule == "hip": p = [cx, b["max"][1], 0.0]
        else: p = [0.0, (b["min"][1] + b["max"][1]) * 0.5, 0.0]
        piv[pname] = np.array(p, np.float64)
    # 3) assemble parts in parent-before-child order
    mat0 = next((v["mat"] for v in raw.values() if v["mat"]), None)
    parts = [{"name": "pelvis", "parent": None, "pos": np.zeros((0, 3)), "nrm": np.zeros((0, 3)),
              "uv": np.zeros((0,)), "idx": np.zeros((0,), np.int64), "mat": mat0}]
    order = [("torso", "pelvis"), ("head", "torso"), ("upperArmL", "torso"),
             ("upperArmR", "torso"), ("thighL", "pelvis"), ("thighR", "pelvis")]
    gbyrig = {v[0]: k for k, v in rigmap.items()}
    for pname, parent in order:
        g = gbyrig.get(pname)
        if g is None or g not in raw: continue
        b = raw[g]; pv = piv[pname]
        local = b["pos"] - pv
        fix_orientation(local, b["nrm"], b["idx"])
        parts.append({"name": pname, "parent": parent, "pos": local, "nrm": b["nrm"],
                      "uv": b["uv"], "idx": b["idx"], "mat": b["mat"] or mat0, "pivot": pv})
    # weapon mount: stable "ready" pose in front of the chest (arms-at-side rigs look
    # bad holding a weapon at the hip). front-right, chest height, forward.
    if "torso" in piv:
        H = max(v["max"][1] for v in raw.values())     # character height
        ready = np.array([0.20 * H, 0.58 * H, 0.22 * H], np.float64)
        piv["weaponMount"] = ready
        parts.append({"name": "weaponMount", "parent": "torso", "pos": np.zeros((0, 3)),
                      "nrm": np.zeros((0, 3)), "uv": np.zeros((0,)), "idx": np.zeros((0,), np.int64),
                      "mat": mat0, "pivot": ready})
    # rest offsets from pivots
    pivmap = {"pelvis": piv["pelvis"]}
    for p in parts[1:]: pivmap[p["name"]] = p["pivot"]
    for p in parts:
        par = p.get("parent")
        pv = pivmap[p["name"]] if p["name"] in pivmap else piv["pelvis"]
        p["rest"] = (pv - (pivmap[par] if par else np.zeros(3))).tolist()
    return parts, scale


def bake_weapon(parts, length=0.62, lift=0.02):
    """Fit a weapon mesh to the hand: scale by its longest axis, translate so the
    grip (bottom-rear) sits at the origin, barrel pointing +Z (game forward)."""
    allp = np.concatenate([p["pos"] for p in parts if len(p["pos"])], 0)
    mn = allp.min(0); mx = allp.max(0); ext = mx - mn
    s = length / max(ext.max(), 1e-6)
    # grip hold point: centre in X, bottom in Y, ~30% from the rear in Z
    grip = np.array([(mn[0] + mx[0]) * 0.5, mn[1], mn[2] + ext[2] * 0.30])
    for p in parts:
        if len(p["pos"]):
            p["pos"] = (p["pos"] - grip) * s
            p["pos"][:, 1] += lift
    return s
# ---------------------------------------------------------------- textures / export
def enc_tex(path, size, default_rgb):
    if path and os.path.exists(path):
        im = Image.open(path).convert("RGB")
        resample = Image.NEAREST if min(im.size) <= 64 else Image.LANCZOS  # keep palette atlases crisp
        im = im.resize((size, size), resample)
    else:
        im = Image.new("RGB", (size, size), default_rgb)
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=88, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def fmt(v, d=4):
    s = ("%.*f" % (d, v)).rstrip("0").rstrip("."); return "0" if s in ("", "-0") else s
def arr(a, d=4): return "[" + ",".join(fmt(x, d) for x in np.asarray(a, np.float64).reshape(-1)) + "]"

def export_mesh(name, parts):
    idxmap = {p["name"]: i for i, p in enumerate(parts)}
    allp = np.concatenate([p["pos"] for p in parts if len(p["pos"])], 0)
    mn, mx = allp.min(0).tolist(), allp.max(0).tolist()
    pjs = []
    for p in parts:
        par = idxmap.get(p.get("parent"), -1) if p.get("parent") else -1
        pjs.append("{n:'%s',mat:'%s',par:%d,rest:%s,pos:new Float32Array(%s),"
                   "nrm:new Float32Array(%s),uv:new Float32Array(%s),idx:new Uint16Array([%s])}"
                   % (p["name"], p["mat"], par, arr(p.get("rest", [0, 0, 0])),
                      arr(p["pos"]), arr(p["nrm"]), arr(p["uv"]),
                      ",".join(str(int(x)) for x in p["idx"])))
    entry = "EH.Meshes['%s']={parts:[%s],bounds:{min:%s,max:%s}};\n" % (name, ",".join(pjs), arr(mn), arr(mx))
    path = os.path.join(SCRIPTS, "mesh-data-imported.js")
    ex = {}
    if os.path.exists(path):
        for m in re.finditer(r"EH\.Meshes\['([^']+)'\]=(\{.*?\});\n", open(path).read(), re.S):
            ex[m.group(1)] = m.group(0)
    ex[name] = entry
    with open(path, "w") as f:
        f.write("'use strict';\n(function(){var EH=window.EchoHeart=window.EchoHeart||{};EH.Meshes=EH.Meshes||{};\n")
        for v in ex.values(): f.write(v)
        f.write("})();\n")

def merge_kv(path, varname, extra):
    d = {}
    if os.path.exists(path):
        m = re.search(varname.replace(".", r"\.") + r"=(\{.*?\});", open(path).read(), re.S)
        if m: d = json.loads(m.group(1))
    d.update(extra); return d

def export_materials(mats_map, player_mesh=None, manifest=None, enemy=None, weapon=None):
    path = os.path.join(SCRIPTS, "imported-materials.js")
    d = merge_kv(path, "EH.__imp", mats_map)
    # carry forward previously-set player mesh + enemy map so repeated imports accumulate
    prev = open(path).read() if os.path.exists(path) else ""
    pm = player_mesh
    if pm is None:
        m = re.search(r"playerMesh='([^']+)'", prev)
        if m: pm = m.group(1)
    emap = {}
    m = re.search(r"EH\.__enemyMesh=(\{.*?\});", prev, re.S)
    if m: emap = json.loads(m.group(1))
    if enemy: emap[enemy[0]] = enemy[1]
    wmap = {}; wimp = {}
    m = re.search(r"EH\.__weaponMesh=(\{.*?\});", prev, re.S)
    if m: wmap = json.loads(m.group(1))
    m = re.search(r"EH\.__weaponImported=(\{.*?\});", prev, re.S)
    if m: wimp = json.loads(m.group(1))
    if weapon: wmap[weapon[0]] = weapon[1]; wimp[weapon[1]] = True
    # accumulate manifest entries across imports (was overwritten before -> only last kept)
    accm = {}
    m = re.search(r"EH\.__impManifest=(\{.*?\});", prev, re.S)
    if m: accm = json.loads(m.group(1))
    if manifest: accm.update(manifest)
    extra = ""
    if pm: extra += "EH.CONFIG=EH.CONFIG||{};EH.CONFIG.playerMesh='%s';\n" % pm
    extra += "EH.__enemyMesh=%s;\n" % json.dumps(emap)
    extra += "EH.__weaponMesh=%s;\n" % json.dumps(wmap)
    extra += "EH.__weaponImported=%s;\n" % json.dumps(wimp)
    with open(path, "w") as f:
        f.write("'use strict';\n(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.__imp=" + json.dumps(d) + ";\n")
        f.write("EH.MATERIALS=EH.MATERIALS||{};for(var k in EH.__imp){EH.MATERIALS[k]=EH.__imp[k];}\n")
        f.write("EH.__impManifest=" + json.dumps(accm) + ";\n")
        f.write("EH.AssetManifest=EH.AssetManifest||{};for(var mk in EH.__impManifest){EH.AssetManifest[mk]=EH.__impManifest[mk];}\n")
        f.write(extra)
        f.write("})();\n")

def append_textures(tex):
    path = os.path.join(SCRIPTS, "texture-data.js")
    size = 384
    if os.path.exists(path):
        sm = re.search(r"EH\.TextureDataSize=(\d+)", open(path).read())
        if sm: size = int(sm.group(1))
    d = merge_kv(path, "EH.TextureData", tex)
    with open(path, "w") as f:
        f.write("'use strict';\n// Embedded textures (data URIs) incl. imported assets\n")
        f.write("(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.TextureData=" + json.dumps(d) + ";\nEH.TextureDataSize=%d;\n})();\n" % size)

# ---------------------------------------------------------------- main
def find_obj(folder, model):
    hits = []
    for r, _, fs in os.walk(folder):
        for f in fs:
            if f.lower().endswith(".obj"): hits.append(os.path.join(r, f))
    if not hits: return None
    if model:
        for h in hits:
            if model.lower() in os.path.basename(h).lower(): return h
    hits.sort(key=lambda p: ("obj format" not in p.lower(), p))
    return hits[0]

def main():
    a = sys.argv[1:]
    if not a:
        print("usage: import_assets.py <folder> [--model NAME] [--as prop|weapon|char] [--rig kenney] [--player] [--height H]")
        return
    name = a[0]
    kind = "prop"; height = None; rig = None; model = None; player = False; forward = "auto"; enemy_kind = None; weapon_slot = None
    for i, x in enumerate(a):
        if x == "--as" and i + 1 < len(a): kind = a[i + 1]
        if x == "--rig" and i + 1 < len(a): rig = a[i + 1]
        if x == "--model" and i + 1 < len(a): model = a[i + 1]
        if x == "--height" and i + 1 < len(a): height = float(a[i + 1])
        if x == "--player": player = True
        if x == "--forward" and i + 1 < len(a): forward = a[i + 1]
        if x == "--enemy" and i + 1 < len(a): enemy_kind = a[i + 1]; kind = "char"
        if x == "--weapon" and i + 1 < len(a): weapon_slot = a[i + 1]; kind = "weapon"
    if height is None: height = {"prop": 1.6, "weapon": 0.9, "char": 1.7}.get(kind, 1.6)
    folder = os.path.join(IMPORT, name)
    objp = find_obj(folder, model)
    if not objp: print("no .obj under", folder); return
    verts, uvs, norms, groups, facemat, mtllib = parse_obj(objp)
    flipped = detect_and_orient(verts, norms, groups, forward)
    mtl = parse_mtl(os.path.join(os.path.dirname(objp), mtllib)) if mtllib else {}

    outname = name if not model else (name + "_" + model)
    if rig == "kenney":
        parts, scale = build_rigged(verts, uvs, norms, groups, facemat, height, RIG_KENNEY)
        if parts is None: print("rig mapping found no matching groups; falling back to static"); rig = None
    if rig != "kenney":
        parts, scale = build_static(verts, uvs, norms, groups, facemat, height, kind != "char")
    if weapon_slot:
        scale = bake_weapon(parts)

    # textures + materials (unique group per source material)
    size = 384; tex = {}; mats_map = {}; manifest_entries = {}
    seen = {}
    for i, p in enumerate(parts):
        srcmat = p["mat"]
        mid = "imp_%s_%s" % (outname, (srcmat or "m%d" % i))
        p["mat"] = mid
        if mid in seen: continue
        seen[mid] = True
        src = mtl.get(srcmat, {}) if srcmat else {}
        grp = "impg_" + re.sub(r"[^A-Za-z0-9_]", "_", mid)
        tex[grp + "_albedo"] = enc_tex(src.get("albedo"), size, tuple(int(c * 255) for c in src.get("Kd", [0.6, 0.6, 0.62])))
        tex[grp + "_normal"] = enc_tex(src.get("normal"), size, (128, 128, 255))
        tex[grp + "_orm"] = enc_tex(src.get("rough"), size, (235, 130, 12))
        tex[grp + "_emissive"] = enc_tex(src.get("emis"), size, (0, 0, 0))
        mats_map[mid] = {"group": grp, "tint": [1, 1, 1], "emissive": 1.2 if src.get("emis") else 0.0, "uv": 1.0}
        for kind in ("albedo", "normal", "orm", "emissive"):
            manifest_entries[grp + "_" + kind] = {"path": "assets/import/%s/_embedded_%s_%s.webp" % (name, grp, kind), "w": size, "h": size, "type": kind}

    export_mesh(outname, parts)
    export_materials(mats_map, player_mesh=(outname if player else None), manifest=manifest_entries,
                     enemy=((enemy_kind, outname) if enemy_kind else None),
                     weapon=((weapon_slot, outname) if weapon_slot else None))
    append_textures(tex)
    tris = sum(len(p["idx"]) // 3 for p in parts)
    print("imported '%s'  parts=%d  tris=%d  height=%.2f  rig=%s  player=%s  flip=%s%s"
          % (outname, len(parts), tris, height, rig or "-", player, flipped,
             ("  enemy=" + enemy_kind if enemy_kind else ("  weapon=" + weapon_slot if weapon_slot else ""))))
    print("  rig parts:", ", ".join(p["name"] for p in parts))
    if player:
        print("  -> 플레이어 메시로 설정됨 (EH.CONFIG.playerMesh='%s')" % outname)
    print("  index.html 에 한 번만 추가: mesh-data-imported.js, imported-materials.js")

if __name__ == "__main__":
    main()
