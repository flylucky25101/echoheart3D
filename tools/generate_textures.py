#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ECHOHEART PBR texture generator (PIL+numpy). Chunkable + resumable."""
import numpy as np
from PIL import Image, ImageDraw
import os, math, json, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
TEX = os.path.join(ROOT, "assets", "textures")
SCRIPTS = os.path.join(ROOT, "scripts")
manifest = {}
report = []

_radial_cache = {}
def _radial(size):
    if size not in _radial_cache:
        freq = np.fft.fftfreq(size) * size
        fx, fy = np.meshgrid(freq, freq)
        _radial_cache[size] = (np.sqrt(fx*fx + fy*fy) + 1e-6).astype(np.float32)
    return _radial_cache[size]

def fft_noise(size, scale, seed):
    r = np.random.default_rng(seed)
    f = _radial(size)
    spec = (r.standard_normal((size, size)) + 1j*r.standard_normal((size, size))).astype(np.complex64)
    amp = (1.0 / (1.0 + (f/max(scale, 0.5))**2.2)).astype(np.float32)
    img = np.fft.ifft2(spec*amp).real.astype(np.float32)
    img -= img.min(); img /= (img.max() + 1e-9)
    return img

def fbm(size, octaves=4, base=4, seed=0):
    out = np.zeros((size, size), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        out += amp*fft_noise(size, base*(2**o), seed*31 + o + 1); tot += amp; amp *= 0.5
    return out/tot

def clamp01(a): return np.clip(a, 0.0, 1.0)
def to_img(arr): return Image.fromarray((clamp01(arr)*255 + 0.5).astype(np.uint8), "RGB")

def height_to_normal(h, strength=2.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1))*0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0))*0.5
    nx = -dx*strength; ny = -dy*strength; nz = np.ones_like(h)
    ln = np.sqrt(nx*nx + ny*ny + nz*nz)
    return np.stack([nx/ln*0.5 + 0.5, ny/ln*0.5 + 0.5, nz/ln*0.5 + 0.5], -1)

def scratches(size, count, length, width=1, seed=1):
    r = np.random.default_rng(seed)
    img = Image.new("L", (size, size), 0); d = ImageDraw.Draw(img)
    for _ in range(count):
        x = r.integers(0, size); y = r.integers(0, size); ang = r.uniform(0, math.tau)
        ln = r.uniform(length*0.4, length)
        d.line([(x, y), (x + math.cos(ang)*ln, y + math.sin(ang)*ln)], fill=int(r.integers(90, 255)), width=int(width))
    return np.asarray(img, np.float32)/255.0

def crack_network(size, count, steps, seed=2):
    r = np.random.default_rng(seed)
    img = Image.new("L", (size, size), 0); d = ImageDraw.Draw(img)
    for _ in range(count):
        x = r.uniform(0, size); y = r.uniform(0, size); ang = r.uniform(0, math.tau)
        for _ in range(steps):
            ang += r.uniform(-0.5, 0.5)
            nx = x + math.cos(ang)*4; ny = y + math.sin(ang)*4
            d.line([(x, y), (nx, ny)], fill=int(r.integers(120, 255)), width=1)
            x, y = nx % size, ny % size
            if r.random() < 0.04: ang += r.choice([-1, 1])*1.2
    return np.asarray(img, np.float32)/255.0

def circuit(size, seed=3):
    r = np.random.default_rng(seed)
    img = Image.new("L", (size, size), 0); d = ImageDraw.Draw(img)
    step = max(8, size//12)
    for gx in range(0, size, step):
        if r.random() < 0.7: d.line([(gx, 0), (gx, size)], fill=int(r.integers(120, 255)), width=2)
        for gy in range(0, size, step):
            if r.random() < 0.5: d.line([(0, gy), (size, gy)], fill=int(r.integers(120, 255)), width=2)
            if r.random() < 0.35:
                rr = r.integers(3, 7); d.ellipse([gx-rr, gy-rr, gx+rr, gy+rr], fill=255)
    return np.asarray(img, np.float32)/255.0

def weave(size, freq=48):
    xs = np.linspace(0, math.tau*freq, size, endpoint=False).astype(np.float32)
    gx = np.sin(xs)[None, :]*np.ones((size, 1), np.float32)
    gy = np.sin(xs)[:, None]*np.ones((1, size), np.float32)
    return (np.maximum(gx, gy)*0.5 + 0.5)


def panel_seams(size, cell=6, seed=11, bevel=True):
    """recessed panel grid with a lit bevel on one edge - reads as engineered plating."""
    r = np.random.default_rng(seed)
    img = Image.new("L", (size, size), 0); d = ImageDraw.Draw(img)
    step = max(16, size // cell)
    xs = list(range(0, size, step)); ys = list(range(0, size, step))
    for x in xs:
        jitter = int(r.integers(-step//6, step//6))
        d.line([(x + jitter, 0), (x + jitter, size)], fill=255, width=max(1, size // 220))
    for y in ys:
        jitter = int(r.integers(-step//6, step//6))
        d.line([(0, y + jitter), (size, y + jitter)], fill=255, width=max(1, size // 220))
    # a few larger sub-divisions so it is not a uniform grid
    for _ in range(cell):
        if r.random() < 0.6:
            x = int(r.integers(0, size)); d.line([(x, 0), (x, size)], fill=200, width=max(1, size//300))
        else:
            y = int(r.integers(0, size)); d.line([(0, y), (size, y)], fill=200, width=max(1, size//300))
    a = np.asarray(img, np.float32) / 255.0
    if bevel:
        lit = np.roll(a, -max(1, size//256), axis=0) - a     # highlight above each seam
        return a, np.clip(lit, 0, 1)
    return a, np.zeros_like(a)

def brushed(size, seed=12, strength=1.0):
    """anisotropic brushed-metal streaks (long in X, tight in Y)."""
    r = np.random.default_rng(seed)
    n = r.standard_normal((size, size)).astype(np.float32)
    k = max(3, size // 24)
    ker = np.ones(k, np.float32) / k
    for _ in range(2):
        n = np.apply_along_axis(lambda m: np.convolve(m, ker, mode='same'), axis=1, arr=n)
    n -= n.min(); n /= (n.max() + 1e-9)
    return (n - 0.5) * strength + 0.5

def crevice_grime(height, softness=2):
    """dark grime accumulating in the low areas of the height field."""
    h = height.copy()
    lo = h.min(); hi = h.max()
    hn = (h - lo) / max(hi - lo, 1e-6)
    g = np.clip(1.0 - hn * 1.6, 0.0, 1.0) ** 1.5
    return g

def edge_wear(height, amount=1.0):
    """bright worn metal on raised edges (gradient magnitude of the height field)."""
    gy, gx = np.gradient(height)
    e = np.sqrt(gx * gx + gy * gy)
    e /= (e.max() + 1e-9)
    return np.clip(e * 3.0, 0, 1) * amount


def paint_blocking(size, seed, accent, base_dark=0.55):
    """Deliberate two-tone paint: dark base, a clean accent band with trim lines,
    plus corner chevrons. This is what makes a surface read as *designed* rather
    than as noise."""
    r = np.random.default_rng(seed)
    m = np.zeros((size, size), np.float32)      # accent mask
    trim = np.zeros((size, size), np.float32)   # bright trim lines
    img = Image.new("L", (size, size), 0); d = ImageDraw.Draw(img)
    ti = Image.new("L", (size, size), 0); dt = ImageDraw.Draw(ti)
    band = int(size * (0.16 + r.random() * 0.10))
    y0 = int(size * (0.30 + r.random() * 0.30))
    d.rectangle([0, y0, size, y0 + band], fill=255)                 # horizontal accent band
    dt.rectangle([0, y0 - max(2, size//160), size, y0], fill=255)   # trim above
    dt.rectangle([0, y0 + band, size, y0 + band + max(2, size//160)], fill=255)
    # angled chevrons on one side
    cw = int(size * 0.10)
    for k in range(3):
        x = int(size * (0.06 + k * 0.10))
        d.polygon([(x, size), (x + cw, size), (x + cw*2, size - cw*2), (x + cw, size - cw*2)], fill=255)
    # a small emblem block
    ex, ey = int(size*0.68), int(size*0.10)
    es = int(size*0.13)
    dt.rectangle([ex, ey, ex+es, ey+es], outline=255, width=max(2, size//170))
    dt.line([ex+es//4, ey+es//2, ex+es*3//4, ey+es//2], fill=255, width=max(2, size//200))
    m = np.asarray(img, np.float32)/255.0
    trim = np.asarray(ti, np.float32)/255.0
    return m, trim

def apply_design(alb, rough, metal, emis, heightmap, size, seed, accent_rgb, trim_rgb, strength=1.0):
    m, trim = paint_blocking(size, seed, accent_rgb)
    acc = np.array(accent_rgb, np.float32)
    tri = np.array(trim_rgb, np.float32)
    alb = clamp01(alb*(1 - m[..., None]*0.85*strength) + acc[None, None, :]*m[..., None]*0.85*strength)
    alb = clamp01(alb*(1 - trim[..., None]) + tri[None, None, :]*trim[..., None])
    rough = clamp01(rough + m*0.12 - trim*0.35)          # painted band duller, trim polished
    metal = clamp01(metal*(1 - m*0.55) + trim*0.5)       # paint is non-metal, trim is bare metal
    emis = clamp01(emis + tri[None, None, :]*trim[..., None]*0.35)
    heightmap = heightmap + trim*0.10 - m*0.03
    return alb, rough, metal, emis, heightmap

S, H = 512, 1024
GROUPS = [
    # --- cyberpunk palette: charcoal/matte-black bodies, high-gloss metal, neon-blue LED ---
    # armour: matte-black plate, very reflective, electric-blue trim + LED
    ("riftSteel", "environments", H, [0.07, 0.08, 0.10], {"pattern": "metal", "rough": 0.30, "metal": 0.95, "oxide": [0.05, 0.10, 0.14], "scratch": 260, "hot": True, "emis_color": [0.12, 0.55, 1.0], "scale": 6, "design": ([0.05, 0.06, 0.08], [0.20, 0.62, 1.0]), "design_str": 0.9}),
    # charcoal structural metal
    ("darkMetal", "environments", S, [0.055, 0.06, 0.075], {"pattern": "metal", "rough": 0.38, "metal": 0.90, "oxide": [0.04, 0.09, 0.13], "scratch": 200, "design": ([0.04, 0.05, 0.07], [0.15, 0.50, 0.95]), "design_str": 0.8}),
    # coat: matte black cloth with a thin blue accent band
    ("cloth", "player", H, [0.055, 0.06, 0.08], {"pattern": "cloth", "rough": 0.88, "metal": 0.0, "wfreq": 90, "design": ([0.05, 0.07, 0.11], [0.16, 0.52, 1.0]), "design_str": 0.75}),
    # worn matte black leather
    ("leather", "player", S, [0.07, 0.07, 0.085], {"pattern": "leather", "rough": 0.72, "metal": 0.05}),
    # matte human skin (kept human/warm so Lian still reads as a person)
    ("skin", "player", S, [0.52, 0.42, 0.39], {"pattern": "generic", "rough": 0.82, "metal": 0.0, "scale": 8}),
    # the resonance heart: the ONE warm focal point against all the blue
    ("crystalRed", "player", H, [0.55, 0.06, 0.12], {"pattern": "crystal", "rough": 0.25, "emis_color": [1.0, 0.18, 0.24], "hot": True}),
    # arm circuitry: bright neon-blue LED grid
    ("circuit", "player", S, [0.06, 0.07, 0.09], {"pattern": "circuit", "rough": 0.4, "metal": 0.7, "emis_color": [0.15, 0.6, 1.0]}),
    # energy conduits: electric blue
    ("energyCyan", "environments", S, [0.03, 0.10, 0.22], {"pattern": "energy", "emis_color": [0.18, 0.6, 1.0], "force_emis": True}),
    # floor/wall stone: dark charcoal with faint blue seam glow
    ("stone", "environments", H, [0.10, 0.11, 0.14], {"pattern": "stone", "rough": 0.78, "metal": 0.05, "emis_color": [0.1, 0.4, 0.85], "scale": 7}),
    # enemy chassis: charcoal shell, electric-blue emissive markings
    ("organic", "enemies", S, [0.09, 0.10, 0.13], {"pattern": "organic", "rough": 0.55, "metal": 0.35, "emis_color": [0.2, 0.55, 1.0], "design": ([0.05, 0.07, 0.11], [0.2, 0.6, 1.0]), "design_str": 0.7}),
    # boss shell: gloss charcoal plate, blue LED trim
    ("bossShell", "boss", H, [0.08, 0.09, 0.12], {"pattern": "metal", "rough": 0.32, "metal": 0.94, "oxide": [0.04, 0.10, 0.16], "scratch": 240, "hot": True, "emis_color": [0.15, 0.55, 1.0], "scale": 6, "design": ([0.05, 0.06, 0.09], [0.18, 0.58, 1.0]), "design_str": 0.85}),
    ("bossMetal", "boss", S, [0.05, 0.055, 0.07], {"pattern": "metal", "rough": 0.36, "metal": 0.9, "oxide": [0.04, 0.08, 0.12], "scratch": 220, "design": ([0.04, 0.05, 0.08], [0.16, 0.5, 0.95]), "design_str": 0.8}),
    # boss core: intense electric blue-white power source
    ("bossCore", "boss", S, [0.15, 0.35, 0.7], {"pattern": "energy", "emis_color": [0.4, 0.75, 1.0], "force_emis": True}),
    # secondary enemy accent: kept a cool violet-blue so summoners stay distinct
    ("magenta", "enemies", S, [0.12, 0.06, 0.24], {"pattern": "energy", "emis_color": [0.45, 0.3, 1.0], "force_emis": True}),
    ("chainMetal", "weapons", S, [0.06, 0.065, 0.08], {"pattern": "metal", "rough": 0.34, "metal": 0.92, "oxide": [0.04, 0.09, 0.13], "scratch": 170, "design": ([0.05, 0.06, 0.09], [0.16, 0.52, 1.0]), "design_str": 0.7}),
]

GBY = {g[0]: g for g in GROUPS}
CHUNKS = {
    "a": ["riftSteel", "darkMetal", "cloth", "leather", "skin"],
    "b": ["crystalRed", "circuit", "energyCyan", "stone", "organic"],
    "c": ["bossShell", "bossMetal", "bossCore", "magenta", "chainMetal"],
}

def kind_ext(kind):
    return "webp" if kind in ("albedo", "emissive") else "png"

def out_paths(name):
    folder, size = GBY[name][1], GBY[name][2]
    fol = os.path.join(TEX, folder)
    return {k: os.path.join(fol, "%s_%s.%s" % (name, k, kind_ext(k))) for k in ("albedo", "normal", "orm", "emissive")}, folder, size

def register(name):
    paths, folder, size = out_paths(name)
    for kind, p in paths.items():
        rel = "assets/textures/%s/%s" % (folder, os.path.basename(p))
        manifest["%s_%s" % (name, kind)] = {"path": rel, "w": size, "h": size, "type": kind}
        report.append(("%s_%s" % (name, kind), rel, size, os.path.getsize(p) if os.path.exists(p) else 0))

def _save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith(".webp"): img.save(path, "WEBP", quality=90, method=4)
    else: img.save(path, "PNG", optimize=True)

def build_material(name):
    folder, size, base, spec = GBY[name][1], GBY[name][2], list(GBY[name][3]), GBY[name][4]
    paths, folder, size = out_paths(name)
    if not os.environ.get("REGEN") and all(os.path.exists(p) for p in paths.values()):
        register(name); return False
    seed = abs(hash(name)) % 100000
    h = fbm(size, spec.get("oct", 4), spec.get("scale", 5), seed)
    base = np.array(base, np.float32)
    alb = (np.ones((size, size, 3), np.float32)*base[None, None, :])*(0.75 + 0.5*h[..., None])
    heightmap = h.copy()*spec.get("bump", 0.4)
    ao = np.ones((size, size), np.float32)
    rough = np.ones((size, size), np.float32)*spec.get("rough", 0.6)
    metal = np.ones((size, size), np.float32)*spec.get("metal", 0.0)
    emis = np.zeros((size, size, 3), np.float32)
    ec = np.array(spec.get("emis_color", [0, 0, 0]), np.float32)
    pat = spec.get("pattern", "generic")
    if pat == "metal":
        # 1) brushed base
        br = brushed(size, seed + 21, 0.55)
        alb = clamp01(alb * (0.80 + 0.40 * br[..., None]))
        rough = clamp01(rough + (br - 0.5) * 0.28)
        # 2) panel plating with lit bevels
        seam, lit = panel_seams(size, spec.get("panel", 6), seed + 22)
        alb = clamp01(alb * (1 - seam[..., None] * 0.55) + lit[..., None] * 0.30)
        rough = clamp01(rough + seam * 0.30 - lit * 0.20)
        heightmap -= seam * 0.35
        heightmap += lit * 0.12
        # 3) fine scratches
        sc = scratches(size, spec.get("scratch", 260), size*0.5, 1, seed + 1)
        alb = clamp01(alb + sc[..., None]*0.16); rough = clamp01(rough - sc*0.32)
        # 4) oxidation blooms
        oxide = clamp01(fbm(size, 4, 3, seed + 2) - 0.55)*2.2
        oxc = np.array(spec.get("oxide", [0.25, 0.45, 0.42]), np.float32)
        alb = clamp01(alb*(1 - oxide[..., None]*0.8) + oxc[None, None, :]*oxide[..., None]*0.8)
        rough = clamp01(rough + oxide*0.45); metal = clamp01(metal - oxide*0.55)
        heightmap += sc*0.15 + oxide*0.22
        # 5) grime in the recesses + worn bright edges
        grime = crevice_grime(heightmap)
        alb = clamp01(alb * (1 - grime[..., None] * 0.45))
        rough = clamp01(rough + grime * 0.30)
        wear = edge_wear(heightmap, 0.9)
        alb = clamp01(alb + wear[..., None] * 0.22)
        rough = clamp01(rough - wear * 0.30); metal = clamp01(metal + wear * 0.25)
        ao = clamp01(1.0 - grime * 0.75 - seam * 0.35)
    elif pat == "cloth":
        w = weave(size, spec.get("wfreq", 60))
        alb = clamp01(alb*(0.7 + 0.35*w[..., None])); rough = clamp01(rough + w*0.1)
        heightmap += w*0.25; ao = clamp01(0.85 + 0.15*w)
    elif pat == "leather":
        cell = crack_network(size, 40, 120, seed + 3)
        alb = clamp01(alb*(1 - cell[..., None]*0.4)); rough = clamp01(rough + cell*0.2)
        heightmap += (h - 0.5)*0.3 - cell*0.3
    elif pat == "crystal":
        cr = crack_network(size, 26, 200, seed + 4)
        alb = clamp01(alb + cr[..., None]*0.5); rough = clamp01(rough - cr*0.4); metal = metal*0 + 0.1
        emis = ec[None, None, :]*(0.35 + 0.65*cr)[..., None] + ec[None, None, :]*(0.15 + 0.3*h)[..., None]
        heightmap += cr*0.4
    elif pat == "circuit":
        c = circuit(size, seed + 5)
        alb = clamp01(alb*(1 - c[..., None]*0.3)); emis = ec[None, None, :]*c[..., None]
        rough = clamp01(rough - c*0.2); metal = clamp01(metal + 0.3); heightmap += c*0.3
    elif pat == "energy":
        swirl = fbm(size, 5, 6, seed + 6)
        emis = ec[None, None, :]*(0.4 + 0.6*swirl)[..., None]
        alb = clamp01(alb*0.4 + ec[None, None, :]*0.3); rough = rough*0 + 0.3; heightmap += swirl*0.2
    elif pat == "stone":
        cr = crack_network(size, 30, 160, seed + 7); spots = clamp01(fbm(size, 5, 8, seed + 8))
        seam, lit = panel_seams(size, 5, seed + 31)
        alb = clamp01(alb*(0.7 + 0.5*spots[..., None])*(1 - cr[..., None]*0.5))
        alb = clamp01(alb*(1 - seam[..., None]*0.40) + lit[..., None]*0.18)
        rough = clamp01(rough + spots*0.2 + seam*0.2)
        heightmap += spots*0.3 - cr*0.4 - seam*0.30
        grime = crevice_grime(heightmap)
        alb = clamp01(alb*(1 - grime[..., None]*0.40))
        if ec.any(): emis = ec[None, None, :]*clamp01(cr)[..., None]
        ao = clamp01(1 - cr*0.6 - grime*0.55 - seam*0.25)
    elif pat == "organic":
        veins = crack_network(size, 22, 220, seed + 9); blotch = clamp01(fbm(size, 5, 10, seed + 10))
        alb = clamp01(alb*(0.7 + 0.5*blotch[..., None])); emis = ec[None, None, :]*clamp01(veins - 0.1)[..., None]
        rough = clamp01(rough + blotch*0.15); heightmap += veins*0.3 + (blotch - 0.5)*0.2
    else:
        gy, gx = np.gradient(h); ao = clamp01(1 - (np.abs(gx) + np.abs(gy))*1.5)
    if spec.get("design"):
        alb, rough, metal, emis, heightmap = apply_design(
            alb, rough, metal, emis, heightmap, size, seed + 77,
            spec["design"][0], spec["design"][1], spec.get("design_str", 1.0))
    if spec.get("hot") and ec.any():
        hot = clamp01(fbm(size, 4, 4, seed + 11) - 0.6)*3
        emis = clamp01(emis + ec[None, None, :]*hot[..., None])
    nrm = height_to_normal(heightmap, spec.get("nstr", 3.0))
    orm = np.stack([clamp01(ao), clamp01(rough), clamp01(metal)], -1)
    _save(to_img(alb), paths["albedo"])
    _save(to_img(nrm), paths["normal"])
    _save(to_img(orm), paths["orm"])
    _save(to_img(emis if (ec.any() or spec.get("force_emis")) else np.zeros((size, size, 3), np.float32)), paths["emissive"])
    register(name)
    return True

def ui_paths():
    fol = os.path.join(TEX, "ui")
    return {"panel": os.path.join(fol, "panel_albedo.webp"),
            "panelNormal": os.path.join(fol, "panel_normal.png"),
            "panelOrm": os.path.join(fol, "panel_orm.png"),
            "panelEmis": os.path.join(fol, "panel_emissive.webp"),
            "icons": os.path.join(fol, "icons.png")}

ICONS = ["ember", "storm", "void", "neutral", "sword", "bow", "gaunt", "heart", "core", "skull", "shield", "star", "boss", "abyss"]
ICON_COORDS = {}
for _i, _k in enumerate(ICONS):
    ICON_COORDS[_k] = [(_i % 4)*128, (_i//4)*128, 128, 128]

def register_ui():
    p = ui_paths()
    for key, path in p.items():
        rel = "assets/textures/ui/%s" % os.path.basename(path)
        if key == "icons":
            manifest["ui_icons"] = {"path": rel, "w": 512, "h": 640, "type": "atlas", "cell": 128, "coords": ICON_COORDS}
        else:
            manifest["ui_" + key] = {"path": rel, "w": 512, "h": 512, "type": key}
        report.append(("ui_" + key, rel, 512, os.path.getsize(path) if os.path.exists(path) else 0))

def draw_icon(size, kind):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    cx = cy = size//2
    col = {"ember": (255, 120, 40), "storm": (120, 200, 255), "void": (180, 80, 255), "neutral": (200, 210, 220),
           "sword": (120, 230, 240), "bow": (140, 255, 180), "gaunt": (255, 180, 90), "heart": (255, 70, 90),
           "core": (120, 255, 220), "skull": (230, 230, 240), "shield": (140, 200, 255), "star": (255, 220, 120),
           "boss": (255, 60, 70), "abyss": (170, 60, 255)}.get(kind, (200, 200, 210))
    glow = tuple(min(255, c + 30) for c in col)
    if kind == "sword":
        d.polygon([(cx, size*0.12), (cx + size*0.09, size*0.6), (cx, size*0.7), (cx - size*0.09, size*0.6)], fill=col)
        d.rectangle([cx - size*0.03, size*0.7, cx + size*0.03, size*0.86], fill=(90, 90, 100, 255))
        d.rectangle([cx - size*0.16, size*0.66, cx + size*0.16, size*0.72], fill=(120, 120, 130, 255))
    elif kind == "bow":  # crossbow
        d.rectangle([size*0.44, size*0.2, size*0.56, size*0.82], fill=col)                 # rail
        d.line([(size*0.5, size*0.32), (size*0.2, size*0.24)], fill=col, width=max(2,int(size*0.05)))  # left limb
        d.line([(size*0.5, size*0.32), (size*0.8, size*0.24)], fill=col, width=max(2,int(size*0.05)))  # right limb
        d.line([(size*0.2, size*0.24), (size*0.8, size*0.24)], fill=(255,255,255,255), width=max(1,int(size*0.02)))  # string
        d.polygon([(size*0.5,size*0.12),(size*0.44,size*0.24),(size*0.56,size*0.24)], fill=glow)       # bolt tip
    elif kind == "gaunt":  # power claw
        d.rounded_rectangle([size*0.34, size*0.5, size*0.66, size*0.84], radius=int(size*0.07), fill=col)  # gauntlet
        for i in (-1, 0, 1):
            x = size*(0.5 + i*0.14)
            d.polygon([(x-size*0.045, size*0.5), (x+size*0.045, size*0.5), (x, size*0.16)], fill=col)      # claw
            d.line([(x, size*0.5), (x, size*0.2)], fill=glow, width=max(1,int(size*0.015)))
    else:
        pts = []; n = 6 if kind in ("ember", "storm", "void", "neutral") else 8
        for i in range(n):
            a = i*math.tau/n - math.pi/2
            rr = size*0.32 if i % 2 == 0 else size*0.2
            pts.append((cx + math.cos(a)*rr, cy + math.sin(a)*rr))
        d.polygon(pts, fill=col)
        d.ellipse([cx - size*0.1, cy - size*0.1, cx + size*0.1, cy + size*0.1], fill=glow)
    return img

def build_icons():
    p = ui_paths()
    if not os.environ.get("REGEN") and os.path.exists(p["icons"]): return
    cols, cell = 4, 128; rows = (len(ICONS) + cols - 1)//cols
    atlas = Image.new("RGBA", (cols*cell, rows*cell), (0, 0, 0, 0))
    for i, k in enumerate(ICONS):
        ic = draw_icon(cell, k); atlas.paste(ic, ((i % cols)*cell, (i//cols)*cell), ic)
    os.makedirs(os.path.dirname(p["icons"]), exist_ok=True)
    atlas.save(p["icons"], "PNG", optimize=True)

def build_ui():
    size = 512; p = ui_paths()
    if os.environ.get("REGEN") or not os.path.exists(p["panel"]) or not os.path.exists(p["panelEmis"]):
        h = fbm(size, 5, 6, 101)
        alb = np.ones((size, size, 3), np.float32)*np.array([0.06, 0.08, 0.10], np.float32)
        alb = clamp01(alb*(0.7 + 0.5*h[..., None]))
        sc = scratches(size, 300, size*0.4, 1, 102); alb = clamp01(alb + sc[..., None]*0.08)
        yy, xx = np.mgrid[0:size, 0:size]; b = 0.045*size
        frame = ((xx < b) | (xx > size - b) | (yy < b) | (yy > size - b)).astype(np.float32)
        inner = ((xx < b*1.6) | (xx > size - b*1.6) | (yy < b*1.6) | (yy > size - b*1.6)).astype(np.float32)
        edge = clamp01(frame - inner)
        emis = np.array([0.0, 0.7, 0.75], np.float32)[None, None, :]*edge[..., None]
        alb = clamp01(alb + edge[..., None]*0.2)
        orm = np.stack([np.ones((size, size), np.float32)*0.9, np.ones((size, size), np.float32)*0.55, np.ones((size, size), np.float32)*0.7], -1)
        nrm = height_to_normal(h*0.3 + sc*0.1, 1.5)
        _save(to_img(alb), p["panel"]); _save(to_img(nrm), p["panelNormal"])
        _save(to_img(orm), p["panelOrm"]); _save(to_img(emis), p["panelEmis"])
    build_icons(); register_ui()

def write_manifest():
    manifest.clear(); del report[:]
    for g in GROUPS: register(g[0])
    register_ui()
    os.makedirs(SCRIPTS, exist_ok=True)
    with open(os.path.join(SCRIPTS, "asset-manifest.js"), "w", encoding="utf-8") as f:
        f.write("'use strict';\n(function(){var EH=window.EchoHeart=window.EchoHeart||{};\n")
        f.write("EH.AssetManifest=" + json.dumps(manifest) + ";\n})();\n")
    print("manifest: %d entries" % len(manifest))

def main():
    args = sys.argv[1:] or ["all"]
    todo = []; do_ui = do_manifest = False
    for a in args:
        if a == "all":
            todo = [g[0] for g in GROUPS]; do_ui = True; do_manifest = True
        elif a in CHUNKS: todo += CHUNKS[a]
        elif a in GBY: todo.append(a)
        elif a == "ui": do_ui = True
        elif a == "manifest": do_manifest = True
    for name in todo:
        made = build_material(name)
        print("  %-12s %s (%dpx)" % (name, "BUILT" if made else "skip", GBY[name][2]))
    if do_ui: build_ui(); print("  ui/icons done")
    if do_manifest: write_manifest()
    print("done:", args)

if __name__ == "__main__":
    main()
