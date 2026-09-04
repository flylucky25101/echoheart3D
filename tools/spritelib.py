#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECHOHEART sprite pre-render library.
Software rasteriser (numpy) that renders the rigged 3D meshes + PBR textures
into 2D sprite frames, using a fixed oblique top-down camera.
Classic pre-rendered-3D -> sprite-sheet pipeline.
"""
import numpy as np, re, os, math
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SCRIPTS = os.path.join(ROOT, "scripts")

# ---------------------------------------------------------------- mesh parsing
PART_RE = re.compile(
    r"\{n:'([^']+)',mat:'([^']+)',par:(-?\d+),rest:\[([^\]]*)\],"
    r"pos:new Float32Array\(\[([^\]]*)\]\),"
    r"nrm:new Float32Array\(\[([^\]]*)\]\),"
    r"uv:new Float32Array\(\[([^\]]*)\]\),"
    r"idx:new Uint16Array\(\[([^\]]*)\]\)\}")

def _nums(s):
    s = s.strip()
    return np.fromstring(s, sep=",") if s else np.array([])

def load_meshes():
    meshes = {}
    for fn in os.listdir(SCRIPTS):
        if not fn.startswith("mesh-data-"):
            continue
        src = open(os.path.join(SCRIPTS, fn), encoding="utf-8").read()
        for m in re.finditer(r"EH\.Meshes\['([^']+)'\]=\{parts:\[(.*?)\],bounds:", src, re.S):
            name, body = m.group(1), m.group(2)
            parts = []
            for p in PART_RE.finditer(body):
                parts.append({
                    "n": p.group(1), "mat": p.group(2), "par": int(p.group(3)),
                    "rest": _nums(p.group(4)),
                    "pos": _nums(p.group(5)).reshape(-1, 3),
                    "nrm": _nums(p.group(6)).reshape(-1, 3),
                    "uv":  _nums(p.group(7)).reshape(-1, 2),
                    "idx": _nums(p.group(8)).astype(np.int32),
                })
            meshes[name] = parts
    return meshes

def load_materials():
    src = open(os.path.join(SCRIPTS, "config.js"), encoding="utf-8").read()
    blk = re.search(r"EH\.MATERIALS = \{(.*?)\n  \};", src, re.S).group(1)
    mats = {}
    for m in re.finditer(r"(\w+):\s*\{\s*group:\s*'([^']+)'[^}]*?emissive:\s*([\d.]+)", blk):
        mats[m.group(1)] = {"group": m.group(2), "emissive": float(m.group(3))}
    return mats

_texcache = {}
def load_tex(group, kind):
    key = (group, kind)
    if key in _texcache:
        return _texcache[key]
    folder = {"riftSteel": "environments", "darkMetal": "environments", "energyCyan": "environments",
              "stone": "environments", "wallPanel": "environments", "cloth": "player", "leather": "player", "skin": "player",
              "crystalRed": "player", "circuit": "player", "organic": "enemies", "magenta": "enemies",
              "bossShell": "boss", "bossMetal": "boss", "bossCore": "boss", "chainMetal": "weapons"}[group]
    ext = "webp" if kind in ("albedo", "emissive") else "png"
    p = os.path.join(ROOT, "assets", "textures", folder, "%s_%s.%s" % (group, kind, ext))
    img = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0
    _texcache[key] = img
    return img

# ---------------------------------------------------------------- math
def quat_euler(x, y, z):
    cx, sx = math.cos(x*.5), math.sin(x*.5)
    cy, sy = math.cos(y*.5), math.sin(y*.5)
    cz, sz = math.cos(z*.5), math.sin(z*.5)
    return np.array([sx*cy*cz - cx*sy*sz, cx*sy*cz + sx*cy*sz,
                     cx*cy*sz - sx*sy*cz, cx*cy*cz + sx*sy*sz])

def mat_from_qts(q, t, s):
    x, y, z, w = q
    x2, y2, z2 = x+x, y+y, z+z
    xx, xy, xz = x*x2, x*y2, x*z2
    yy, yz, zz = y*y2, y*z2, z*z2
    wx, wy, wz = w*x2, w*y2, w*z2
    M = np.eye(4)
    M[0, 0] = (1-(yy+zz))*s; M[1, 0] = (xy+wz)*s;    M[2, 0] = (xz-wy)*s
    M[0, 1] = (xy-wz)*s;     M[1, 1] = (1-(xx+zz))*s; M[2, 1] = (yz+wx)*s
    M[0, 2] = (xz+wy)*s;     M[1, 2] = (yz-wx)*s;    M[2, 2] = (1-(xx+yy))*s
    M[0, 3], M[1, 3], M[2, 3] = t
    return M

def look_at(eye, target, up=(0, 1, 0)):
    eye = np.array(eye, float); target = np.array(target, float); up = np.array(up, float)
    z = eye - target; z /= np.linalg.norm(z)
    x = np.cross(up, z); nx = np.linalg.norm(x)
    x = x/nx if nx > 1e-8 else np.array([1., 0, 0])
    y = np.cross(z, x)
    M = np.eye(4)
    M[0, :3], M[1, :3], M[2, :3] = x, y, z
    M[:3, 3] = -M[:3, :3] @ eye
    return M

# fixed oblique top-down camera (matches the 3D build's framing)
CAM_H, CAM_D = 12.0, 12.5
VIEW = look_at((0, CAM_H, CAM_D), (0, 0, 0))
LIGHT = np.array([0.52, 0.70, 0.48]); LIGHT /= np.linalg.norm(LIGHT)
VIEW_DIR = np.array([0.0, CAM_H, CAM_D]); VIEW_DIR /= np.linalg.norm(VIEW_DIR)
RIM_COL  = np.array([0.35, 0.85, 1.0])   # cyan rim -> silhouette pops
KEY_COL  = np.array([1.15, 1.05, 0.92])
FILL_COL = np.array([0.32, 0.46, 0.68])
FILL_DIR = np.array([-0.62, 0.28, -0.72]); FILL_DIR /= np.linalg.norm(FILL_DIR)
AMB      = np.array([0.13, 0.16, 0.22])*0.9
EMIS_MUL = 1.9

# ---------------------------------------------------------------- posing
def compose(parts, pose, facing, root_pos=(0, 0, 0), scale=1.0):
    """pose: {partName: (rx,ry,rz[,ox,oy,oz[,scl]])} -> list of 4x4 world matrices"""
    rootM = mat_from_qts(quat_euler(0, facing, 0), root_pos, scale)
    out = [None]*len(parts)
    for i, p in enumerate(parts):
        e = pose.get(p["n"], (0, 0, 0))
        rx, ry, rz = e[0], e[1], e[2]
        ox, oy, oz = (e[3], e[4], e[5]) if len(e) >= 6 else (0, 0, 0)
        scl = e[6] if len(e) >= 7 else 1.0
        t = p["rest"] + np.array([ox, oy, oz])
        local = mat_from_qts(quat_euler(rx, ry, rz), t, scl)
        out[i] = rootM @ local if p["par"] < 0 else out[p["par"]] @ local
    return out

# ---------------------------------------------------------------- rasteriser
def render_frame(parts, mats_world, materials, size, ppu, origin_y, ss=2):
    """Returns RGBA uint8 (size,size,4). ss = supersample factor."""
    S = size*ss
    color = np.zeros((S, S, 3), np.float32)
    alpha = np.zeros((S, S), np.float32)
    zbuf = np.full((S, S), 1e9, np.float32)
    half = S*0.5
    k = ppu*ss

    for pi, part in enumerate(parts):
        M = mats_world[pi]
        if M is None or part["idx"].size == 0:
            continue
        mat = materials.get(part["mat"], {"group": "darkMetal", "emissive": 0.5})
        alb = load_tex(mat["group"], "albedo")
        emi = load_tex(mat["group"], "emissive")
        ah, aw = alb.shape[:2]
        eh, ew = emi.shape[:2]

        P = part["pos"]
        v = (M[:3, :3] @ P.T).T + M[:3, 3]
        N = (M[:3, :3] @ part["nrm"].T).T
        nl = np.linalg.norm(N, axis=1, keepdims=True); nl[nl < 1e-8] = 1
        N = N/nl
        vv = (VIEW[:3, :3] @ v.T).T + VIEW[:3, 3]
        sx = vv[:, 0]*k + half
        sy = half - vv[:, 1]*k + origin_y*ss
        sz = -vv[:, 2]
        lamb = np.clip(N @ LIGHT, 0.0, 1.0)
        rimv = np.clip(1.0 - np.abs(N @ VIEW_DIR), 0.0, 1.0)**3.2
        fillN = np.clip(N @ FILL_DIR, -1.0, 1.0)
        UV = part["uv"]

        idx = part["idx"].reshape(-1, 3)
        i0a, i1a, i2a = idx[:, 0], idx[:, 1], idx[:, 2]
        X0, Y0 = sx[i0a], sy[i0a]
        X1, Y1 = sx[i1a], sy[i1a]
        X2, Y2 = sx[i2a], sy[i2a]
        area_a = (X1-X0)*(Y2-Y0) - (X2-X0)*(Y1-Y0)
        minx_a = np.maximum(np.floor(np.minimum(np.minimum(X0, X1), X2)).astype(np.int32), 0)
        maxx_a = np.minimum(np.ceil(np.maximum(np.maximum(X0, X1), X2)).astype(np.int32), S-1)
        miny_a = np.maximum(np.floor(np.minimum(np.minimum(Y0, Y1), Y2)).astype(np.int32), 0)
        maxy_a = np.minimum(np.ceil(np.maximum(np.maximum(Y0, Y1), Y2)).astype(np.int32), S-1)
        # front-facing, non-degenerate, on-screen only
        keep = np.nonzero((area_a > 1e-9) & (minx_a <= maxx_a) & (miny_a <= maxy_a))[0]

        for t in keep:
            i0, i1, i2 = i0a[t], i1a[t], i2a[t]
            x0, y0, x1, y1, x2, y2 = X0[t], Y0[t], X1[t], Y1[t], X2[t], Y2[t]
            area = area_a[t]
            minx, maxx, miny, maxy = minx_a[t], maxx_a[t], miny_a[t], maxy_a[t]
            px, py = np.meshgrid(np.arange(minx, maxx+1)+0.5, np.arange(miny, maxy+1)+0.5)
            e01 = ((x1-x0)*(py-y0) - (px-x0)*(y1-y0))/area   # weight of v2
            e12 = ((x2-x1)*(py-y1) - (px-x1)*(y2-y1))/area   # weight of v0
            b0 = e12
            b2 = e01
            b1 = 1.0 - b0 - b2
            inside = (b0 >= 0) & (b1 >= 0) & (b2 >= 0)
            if not inside.any():
                continue
            z = b0*sz[i0] + b1*sz[i1] + b2*sz[i2]
            sub = zbuf[miny:maxy+1, minx:maxx+1]
            m = inside & (z < sub)
            if not m.any():
                continue
            u = b0*UV[i0, 0] + b1*UV[i1, 0] + b2*UV[i2, 0]
            vt = b0*UV[i0, 1] + b1*UV[i1, 1] + b2*UV[i2, 1]
            ui = (np.mod(u, 1.0)*(aw-1)).astype(np.int32)
            vi = ((1.0-np.mod(vt, 1.0))*(ah-1)).astype(np.int32)
            base = alb[vi, ui]
            uie = (np.mod(u, 1.0)*(ew-1)).astype(np.int32)
            vie = ((1.0-np.mod(vt, 1.0))*(eh-1)).astype(np.int32)
            em = emi[vie, uie]*mat["emissive"]
            lam = b0*lamb[i0] + b1*lamb[i1] + b2*lamb[i2]
            rm  = b0*rimv[i0] + b1*rimv[i1] + b2*rimv[i2]
            nfill = b0*fillN[i0] + b1*fillN[i1] + b2*fillN[i2]
            key = np.clip(lam*0.5 + 0.5, 0, 1)**1.6
            fillv = np.clip(nfill*0.5 + 0.5, 0, 1)*0.55
            col = np.clip(base*(AMB + KEY_COL*key[..., None]*1.25 + FILL_COL*fillv[..., None])
                          + em*EMIS_MUL + RIM_COL*rm[..., None]*0.75, 0, 4)
            col = np.power(col/(col+1.0), 1.0/2.2)
            color[miny:maxy+1, minx:maxx+1][m] = col[m]
            alpha[miny:maxy+1, minx:maxx+1][m] = 1.0
            sub[m] = z[m]

    rgba = np.concatenate([color, alpha[..., None]], axis=2)
    img = Image.fromarray((np.clip(rgba, 0, 1)*255).astype(np.uint8), "RGBA")
    if ss > 1:
        img = img.resize((size, size), Image.LANCZOS)
    return img

def fit_scale(parts, size, pad=0.80):
    """Uniform pixels-per-unit so the rest pose fits the frame (consistent per character)."""
    pts = []
    rest = compose(parts, {}, 0.0)
    for i, p in enumerate(parts):
        if p["pos"].size == 0:
            continue
        v = (rest[i][:3, :3] @ p["pos"].T).T + rest[i][:3, 3]
        pts.append(v)
    pts = np.concatenate(pts, 0)
    vv = (VIEW[:3, :3] @ pts.T).T + VIEW[:3, 3]
    w = max(vv[:, 0].max()-vv[:, 0].min(), 1e-3)
    h = max(vv[:, 1].max()-vv[:, 1].min(), 1e-3)
    ppu = size*pad/max(w, h)
    # vertical offset so feet sit near the bottom of the frame
    cy = (vv[:, 1].max()+vv[:, 1].min())*0.5
    return ppu, cy*ppu
