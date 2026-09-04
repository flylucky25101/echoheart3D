#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECHOHEART premium sprite shader.

A deferred software renderer built on top of spritelib's mesh/pose loading.
Rasterises the rigged 3D meshes into G-buffers (albedo / normal / depth /
emissive / roughness / metal), then runs a full-screen shading pass with
effects that a realtime WebGL build cannot afford per frame:

  * 4x supersampling  -> clean anti-aliased silhouettes
  * screen-space AO   -> contact darkening in crevices
  * ink outline       -> depth/silhouette edges darkened, reads at small size
  * Blinn-Phong spec  -> roughness-driven highlights off the ORM map
  * emissive bloom    -> neon spill around glowing parts
  * cinematic grade   -> cool shadows / warm highlights, S-curve, saturation

This is the classic "pre-rendered 3D" pipeline (Diablo II / Baldur's Gate):
expensive offline shading baked into cheap 2D sprites.
"""
import numpy as np, math
from PIL import Image, ImageFilter
import spritelib as SL

# ------------------------------------------------------------------ lighting rig
KEY_DIR = np.array([0.50, 0.72, 0.48]); KEY_DIR /= np.linalg.norm(KEY_DIR)
KEY_COL = np.array([1.28, 1.16, 0.98])          # warm key from upper-right
FILL_DIR = np.array([-0.66, 0.24, -0.70]); FILL_DIR /= np.linalg.norm(FILL_DIR)
FILL_COL = np.array([0.26, 0.42, 0.72])         # cool bounce from lower-left
RIM_DIR = np.array([-0.30, 0.42, -0.86]); RIM_DIR /= np.linalg.norm(RIM_DIR)
RIM_COL = np.array([0.42, 0.92, 1.15])          # cyan rim -> cyberpunk separation
AMB_SKY = np.array([0.16, 0.20, 0.30])          # up-facing ambient
AMB_GND = np.array([0.07, 0.06, 0.09])          # down-facing ambient
EMIS_MUL = 2.15
SPEC_MUL = 0.85
VIEW_DIR = np.array([0.0, SL.CAM_H, SL.CAM_D]); VIEW_DIR /= np.linalg.norm(VIEW_DIR)


# ------------------------------------------------------------------ G-buffer raster
def rasterize(parts, mats_world, materials, S, ppu, origin_y):
    """Rasterise into G-buffers at resolution S (already supersampled)."""
    g = {
        "alb":   np.zeros((S, S, 3), np.float32),
        "nrm":   np.zeros((S, S, 3), np.float32),
        "emi":   np.zeros((S, S, 3), np.float32),
        "rough": np.ones((S, S), np.float32),
        "metal": np.zeros((S, S), np.float32),
        "ao":    np.ones((S, S), np.float32),
        "depth": np.full((S, S), 1e9, np.float32),
        "mask":  np.zeros((S, S), np.float32),
    }
    half = S * 0.5
    k = ppu

    for pi, part in enumerate(parts):
        M = mats_world[pi]
        if M is None or part["idx"].size == 0:
            continue
        mat = materials.get(part["mat"], {"group": "darkMetal", "emissive": 0.5})
        alb = SL.load_tex(mat["group"], "albedo")
        emi = SL.load_tex(mat["group"], "emissive")
        try:
            orm = SL.load_tex(mat["group"], "orm")
        except Exception:
            orm = None
        ah, aw = alb.shape[:2]
        eh, ew = emi.shape[:2]
        oh, ow = (orm.shape[:2] if orm is not None else (1, 1))

        P = part["pos"]
        v = (M[:3, :3] @ P.T).T + M[:3, 3]
        N = (M[:3, :3] @ part["nrm"].T).T
        nl = np.linalg.norm(N, axis=1, keepdims=True); nl[nl < 1e-8] = 1
        N = N / nl
        vv = (SL.VIEW[:3, :3] @ v.T).T + SL.VIEW[:3, 3]
        sx = vv[:, 0] * k + half
        sy = half - vv[:, 1] * k + origin_y
        sz = -vv[:, 2]
        UV = part["uv"]

        idx = part["idx"].reshape(-1, 3)
        i0a, i1a, i2a = idx[:, 0], idx[:, 1], idx[:, 2]
        X0, Y0 = sx[i0a], sy[i0a]
        X1, Y1 = sx[i1a], sy[i1a]
        X2, Y2 = sx[i2a], sy[i2a]
        area_a = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0)
        minx_a = np.maximum(np.floor(np.minimum(np.minimum(X0, X1), X2)).astype(np.int32), 0)
        maxx_a = np.minimum(np.ceil(np.maximum(np.maximum(X0, X1), X2)).astype(np.int32), S - 1)
        miny_a = np.maximum(np.floor(np.minimum(np.minimum(Y0, Y1), Y2)).astype(np.int32), 0)
        maxy_a = np.minimum(np.ceil(np.maximum(np.maximum(Y0, Y1), Y2)).astype(np.int32), S - 1)
        keep = np.nonzero((area_a > 1e-9) & (minx_a <= maxx_a) & (miny_a <= maxy_a))[0]

        for t in keep:
            i0, i1, i2 = i0a[t], i1a[t], i2a[t]
            x0, y0, x1, y1, x2, y2 = X0[t], Y0[t], X1[t], Y1[t], X2[t], Y2[t]
            area = area_a[t]
            minx, maxx, miny, maxy = minx_a[t], maxx_a[t], miny_a[t], maxy_a[t]
            px, py = np.meshgrid(np.arange(minx, maxx + 1) + 0.5,
                                 np.arange(miny, maxy + 1) + 0.5)
            e01 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area
            e12 = ((x2 - x1) * (py - y1) - (px - x1) * (y2 - y1)) / area
            b0 = e12; b2 = e01; b1 = 1.0 - b0 - b2
            inside = (b0 >= 0) & (b1 >= 0) & (b2 >= 0)
            if not inside.any():
                continue
            z = b0 * sz[i0] + b1 * sz[i1] + b2 * sz[i2]
            sub = g["depth"][miny:maxy + 1, minx:maxx + 1]
            m = inside & (z < sub)
            if not m.any():
                continue

            u = b0 * UV[i0, 0] + b1 * UV[i1, 0] + b2 * UV[i2, 0]
            vt = b0 * UV[i0, 1] + b1 * UV[i1, 1] + b2 * UV[i2, 1]
            uu = np.mod(u, 1.0); vvt = 1.0 - np.mod(vt, 1.0)
            ui = (uu * (aw - 1)).astype(np.int32); vi = (vvt * (ah - 1)).astype(np.int32)
            uie = (uu * (ew - 1)).astype(np.int32); vie = (vvt * (eh - 1)).astype(np.int32)

            nrm = (b0[..., None] * N[i0] + b1[..., None] * N[i1] + b2[..., None] * N[i2])
            nn = np.linalg.norm(nrm, axis=2, keepdims=True); nn[nn < 1e-8] = 1
            nrm = nrm / nn

            g["alb"][miny:maxy + 1, minx:maxx + 1][m] = alb[vi, ui][m]
            g["emi"][miny:maxy + 1, minx:maxx + 1][m] = emi[vie, uie][m] * mat["emissive"]
            g["nrm"][miny:maxy + 1, minx:maxx + 1][m] = nrm[m]
            if orm is not None:
                uio = (uu * (ow - 1)).astype(np.int32); vio = (vvt * (oh - 1)).astype(np.int32)
                o = orm[vio, uio]
                g["ao"][miny:maxy + 1, minx:maxx + 1][m] = o[..., 0][m]
                g["rough"][miny:maxy + 1, minx:maxx + 1][m] = o[..., 1][m]
                g["metal"][miny:maxy + 1, minx:maxx + 1][m] = o[..., 2][m]
            g["mask"][miny:maxy + 1, minx:maxx + 1][m] = 1.0
            sub[m] = z[m]
    return g


# ------------------------------------------------------------------ post effects
def _box1d(a, r, axis):
    """Box blur along one axis using a cumulative-sum sliding window."""
    if r < 1:
        return a
    n = a.shape[axis]
    w = 2 * r + 1
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode="edge")
    c = np.cumsum(p, axis=axis, dtype=np.float32)
    hi = np.take(c, np.arange(w, w + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return (hi - lo) / np.float32(w)


def _blur(a, r):
    """Separable gaussian-ish blur (3 box passes), float32, numpy only."""
    r = int(round(r))
    if r <= 0:
        return a.astype(np.float32, copy=False)
    out = a.astype(np.float32, copy=True)
    for _ in range(3):
        out = _box1d(out, r, 0)
        out = _box1d(out, r, 1)
    return out


def ssao(depth, mask, S, radius, strength):
    """Cheap screen-space AO: compare depth against a blurred neighbourhood."""
    d = np.where(mask > 0, depth, 0.0).astype(np.float32)
    valid = mask.astype(np.float32)
    num = _blur(d, radius)
    den = _blur(valid, radius)
    avg = np.where(den > 1e-4, num / np.maximum(den, 1e-4), d)
    # points further than their neighbourhood average sit in a cavity
    diff = np.clip((avg - d) * -1.0, 0.0, None)
    occ = 1.0 - np.clip(diff * strength, 0.0, 0.92)
    return np.where(mask > 0, occ, 1.0)


def outline(mask, depth, S, px, dark):
    """Ink line on silhouette + interior depth discontinuities."""
    m = mask
    # silhouette: mask minus eroded mask
    er = _blur(m, px * 0.9)
    sil = np.clip((m - er) * 2.2, 0.0, 1.0) * m
    # interior creases: local depth range
    d = np.where(m > 0, depth, np.nan)
    dmax = np.nan_to_num(_blur(np.where(m > 0, depth, 0.0), px * 0.8))
    dcnt = np.maximum(_blur(m, px * 0.8), 1e-4)
    davg = dmax / dcnt
    crease = np.clip((np.where(m > 0, depth, 0.0) - davg) * 3.0, 0.0, 1.0) * m
    line = np.clip(sil * 1.0 + crease * 0.55, 0.0, 1.0)
    return 1.0 - line * dark


# ------------------------------------------------------------------ palette ramps
def _hex(h):
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


# Art-directed luminance ramps. Mapping a grey render through one of these is
# what gives the sprites a designed palette instead of muddy charcoal.
RAMPS = {
    # cool cyberpunk: ink-blue shadow -> steel body -> pale cyan highlight
    "cyber":  [(0.00, _hex("05070E")), (0.18, _hex("101B30")), (0.38, _hex("24425F")),
               (0.60, _hex("4E7C9B")), (0.80, _hex("9CC8DE")), (1.00, _hex("EAF7FF"))],
    # hostile: same darks, but midtones swing violet/magenta for enemies
    "hostile": [(0.00, _hex("06060B")), (0.20, _hex("151A28")), (0.42, _hex("343A50")),
                (0.62, _hex("6B5570")), (0.82, _hex("C06A72")), (1.00, _hex("FFD6C4"))],
    # boss: molten amber core against deep blue shadow
    "boss":   [(0.00, _hex("08060C")), (0.18, _hex("1E1526")), (0.38, _hex("52304A")),
               (0.60, _hex("A8613F")), (0.80, _hex("E8A45C")), (1.00, _hex("FFF0C8"))],
    # environment props: colder, greener industrial tone
    "prop":   [(0.00, _hex("05070A")), (0.20, _hex("0E161C")), (0.44, _hex("1C3038")),
               (0.66, _hex("39605F")), (0.85, _hex("6E9A94")), (1.00, _hex("BFDCD6"))],
}


def _ramp_lookup(stops, lum):
    """Piecewise-linear colour lookup over a luminance map."""
    out = np.zeros(lum.shape + (3,), np.float32)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        seg = (lum >= t0) & (lum <= t1) if i == len(stops) - 2 else (lum >= t0) & (lum < t1)
        if not seg.any():
            continue
        f = ((lum[seg] - t0) / max(1e-6, t1 - t0))[:, None]
        out[seg] = c0 * (1.0 - f) + c1 * f
    out[lum < stops[0][0]] = stops[0][1]
    out[lum > stops[-1][0]] = stops[-1][1]
    return out


SAT=[1.16]
def grade(col):
    """Cinematic grade: lifted cool shadows, warm highlights, S-curve, saturation."""
    lum = (col * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2, keepdims=True)
    shadow = np.clip(1.0 - lum * 2.2, 0.0, 1.0)
    high = np.clip((lum - 0.55) * 2.2, 0.0, 1.0)
    col = col + shadow * np.array([0.012, 0.028, 0.062])     # cool shadow tint
    col = col + high * np.array([0.055, 0.030, -0.012])      # warm highlight tint
    col = np.clip(col, 0.0, 1.0)
    col = col * col * (3.0 - 2.0 * col) * 0.34 + col * 0.66  # gentle S-curve
    lum2 = (col * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2, keepdims=True)
    col = np.clip(lum2 + (col - lum2) * SAT[0], 0.0, 1.0)
    return col


def shade(g, S, ss, ao_strength=1.5, outline_px=2.0, outline_dark=0.55,
          bloom=0.65, rim_mul=1.0, key_mul=1.30, alb_lift=1.0, alb_gamma=1.0,
          sat=1.16, tint=None, style='pbr', bands=4,
          ramp='cyber', ramp_amount=0.0, ramp_gain=1.0, ramp_bias=0.0,
          alb_blur=0.0, emis_mul=1.0):
    """Deferred shading pass over the G-buffers -> float RGB + alpha."""
    mask = g["mask"]
    N = g["nrm"]
    # The source PBR albedo is near-black charcoal (mean ~0.13); lift it so the
    # material reads at sprite size instead of collapsing into mud.
    alb = np.clip(g["alb"], 0.0, 1.0)
    if alb_blur > 0:
        alb = _blur(alb, alb_blur * ss)
    if alb_gamma != 1.0:
        alb = np.power(alb, alb_gamma)
    alb = np.clip(alb * alb_lift, 0.0, 1.0)
    if tint is not None:
        alb = np.clip(alb * np.array(tint, np.float32), 0.0, 1.0)
    n_dot = lambda d: (N * d).sum(axis=2)

    # --- ambient (hemisphere) ---
    up = np.clip(N[..., 1] * 0.5 + 0.5, 0.0, 1.0)[..., None]
    amb = AMB_GND + (AMB_SKY - AMB_GND) * up

    # --- key: half-lambert keeps the dark side readable ---
    key = np.clip(n_dot(KEY_DIR) * 0.5 + 0.5, 0.0, 1.0) ** 1.55
    fill = np.clip(n_dot(FILL_DIR) * 0.5 + 0.5, 0.0, 1.0) * 0.62
    rim = np.clip(1.0 - np.abs(n_dot(VIEW_DIR)), 0.0, 1.0) ** 3.0
    rim = rim * np.clip(n_dot(RIM_DIR) * 0.5 + 0.5, 0.0, 1.0) * rim_mul

    # --- cel/toon: quantise the key into bands. Low-poly geometry reads as a
    # deliberate art style under banded light + ink lines, instead of cheap. ---
    if style == "toon":
        b = float(max(2, bands))
        key = np.floor(np.clip(key, 0.0, 0.999) * b) / (b - 1.0)
        key = np.clip(key, 0.0, 1.0) * 0.82 + 0.18
        fill = (np.floor(np.clip(fill / 0.62, 0.0, 0.999) * 2.0) / 2.0) * 0.42
        rim = (rim > 0.22).astype(np.float32) * np.clip(rim * 2.4, 0.0, 1.6)

    # --- ambient occlusion (baked ORM AO * screen-space AO) ---
    sao = ssao(g["depth"], mask, S, radius=max(2.0, ss * 1.6), strength=ao_strength)
    occ = np.clip(g["ao"] * 0.55 + 0.45, 0.0, 1.0) * sao

    # --- specular (Blinn-Phong, roughness driven) ---
    H = KEY_DIR + VIEW_DIR; H /= np.linalg.norm(H)
    rough = np.clip(g["rough"], 0.06, 1.0)
    power = np.clip(2.0 / (rough ** 3.2 + 1e-4), 4.0, 900.0)
    spec = np.clip(n_dot(H), 0.0, 1.0) ** power
    spec = spec * (1.0 - rough) * SPEC_MUL
    if style == 'toon':
        spec = (spec > 0.30).astype(np.float32) * 0.55
    spec_col = (np.array([1.0, 1.0, 1.0]) * (1.0 - g["metal"][..., None])
                + alb * g["metal"][..., None])

    # --- body lighting WITHOUT emissive, so the palette map only grades the
    # material and the neon stays pure on top ---
    body = (alb * (amb + KEY_COL * key[..., None] * key_mul + FILL_COL * fill[..., None])
            * occ[..., None]
            + spec_col * spec[..., None])

    body = body / (body + 1.0)
    body = np.power(np.clip(body, 0.0, 1.0), 1.0 / 2.2)

    # --- gradient map: push the grey render through an art-directed ramp.
    # This is what turns a washed-out charcoal render into a designed palette. ---
    if ramp_amount > 0:
        stops = RAMPS.get(ramp, RAMPS["cyber"])
        lum = (body * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(axis=2)
        lum = np.clip(lum * ramp_gain + ramp_bias, 0.0, 1.0)
        mapped = _ramp_lookup(stops, lum)
        body = body * (1.0 - ramp_amount) + mapped * ramp_amount

    emi = g["emi"] * EMIS_MUL * emis_mul
    emi = emi / (emi * 0.62 + 1.0)          # roll off so cores glow instead of blowing to white
    lit = body + RIM_COL * rim[..., None] * 0.55 + emi

    # --- emissive bloom ---
    if bloom > 0:
        glow = np.clip(emi - 0.35, 0.0, None)
        glow = _blur(glow, ss * 2.2) * bloom + _blur(glow, ss * 5.0) * bloom * 0.6
        lit = lit + glow

    # --- ink outline ---
    ink = outline(mask, g["depth"], S, outline_px * ss * 0.5, outline_dark)
    lit = lit * ink[..., None]

    col = np.clip(lit, 0.0, 1.6)
    col = col / np.maximum(1.0, col.max(axis=2, keepdims=True))   # keep neon from clipping to white
    SAT[0] = sat
    col = grade(col)
    return col, mask


def render_frame(parts, mats_world, materials, size, ppu, origin_y, ss=4, **kw):
    """Premium replacement for spritelib.render_frame. Returns RGBA PIL image."""
    S = size * ss
    g = rasterize(parts, mats_world, materials, S, ppu * ss, origin_y * ss)
    col, mask = shade(g, S, ss, **kw)
    rgba = np.concatenate([col, mask[..., None]], axis=2)
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    if ss > 1:
        img = img.resize((size, size), Image.LANCZOS)
    return img
