#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Re-grades the baked sprite sheets onto the deep-teal palette.

HOW, AND WHY NOT THE OBVIOUS WAY
--------------------------------
The first version of this script gradient-mapped luminance onto a per-sheet
colour ramp. That is cheap and it does unify a palette, but it throws away every
hue difference *inside* a character: armour plate, cloth, rubber and emissive
core all collapse onto one hue ribbon. The result was a screen full of identical
sepia lumps - a different kind of cheap-looking than the neon it replaced.

So this version grades instead of maps. Each sheet keeps the hue *structure* the
3D render gave it and we only:
  * rotate every hue partway toward that sheet's anchor (shortest arc), so
    relative hue differences survive at reduced spread,
  * scale saturation down and cap it, killing the neon without killing colour,
  * apply a gentle S-curve to value so silhouettes keep their contrast.

The resonance heart is protected: it is the one fully warm accent in the game.

Run: python3 tools/recolor_sprites.py [--preview]
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPR = os.path.join(ROOT, "assets", "sprites_v2")

# hue anchor (deg), hue spread, saturation scale, saturation cap,
# saturation floor at full brightness, value multiplier
#
# Three families, which is the whole readability rule of the game:
#   teal   = the hero and the architecture he moves through
#   violet = everything that wants him dead
#   ember  = the boss, the resonance heart, and every incoming telegraph
#
# The enemies are held a little darker than the hero on purpose: he should be
# the brightest thing in his own colour on screen.
GRADE = {
    "player_riftsword":  (177.0, 0.34, 0.88, 0.60, 0.34, 0.94),
    "player_pulsebow":   (177.0, 0.34, 0.88, 0.60, 0.34, 0.94),
    "player_chaingaunt": (177.0, 0.34, 0.88, 0.60, 0.34, 0.94),
    # Anchored blue-violet rather than purple: past ~275deg the highlights turn
    # pastel pink, which is exactly the cheap look this whole pass is removing.
    "enemy_stalker":     (258.0, 0.28, 0.76, 0.48, 0.28, 0.82),
    "enemy_summoner":    (274.0, 0.28, 0.76, 0.50, 0.28, 0.82),
    "enemy_gunner":      (246.0, 0.28, 0.78, 0.48, 0.30, 0.85),
    "enemy_sentinel":    (238.0, 0.28, 0.78, 0.48, 0.30, 0.85),
    "enemy_shield":      (252.0, 0.26, 0.76, 0.46, 0.28, 0.84),
    "enemy_orb":         (270.0, 0.28, 0.66, 0.40, 0.26, 0.74),
    "boss":              (20.0,  0.34, 0.84, 0.62, 0.34, 1.00),
    # Architecture has to recede behind the actors, so it runs darkest of all.
    "props":             (178.0, 0.30, 0.70, 0.46, 0.24, 0.85),
}

HEART_HUE = 14.0        # #E0603F
CONTRAST = 0.12         # strength of the value S-curve


def rgb_to_hsv(rgb):
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    d = mx - mn
    v = mx
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    safe = d > 1e-6
    with np.errstate(invalid="ignore", divide="ignore"):
        hr = np.where(safe, ((g - b) / np.maximum(d, 1e-6)) % 6.0, 0.0)
        hg = np.where(safe, (b - r) / np.maximum(d, 1e-6) + 2.0, 0.0)
        hb = np.where(safe, (r - g) / np.maximum(d, 1e-6) + 4.0, 0.0)
    h = np.where(mx == r, hr, np.where(mx == g, hg, hb))
    h = np.where(safe, h * 60.0, 0.0)
    return h, s, v


def hsv_to_rgb(h, s, v):
    h = np.mod(h, 360.0) / 60.0
    i = np.floor(h).astype(np.int32)
    f = h - i
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i = i % 6
    r = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [v, q, p, p, t, v])
    g = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [t, v, v, q, p, p])
    b = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


def dominant_hue(h, s, v, alpha):
    """Circular mean of the hues that actually carry the sheet's colour."""
    m = (alpha[..., 0] > 0.35) & (s > 0.18) & (v > 0.10)
    if not m.any():
        return 0.0
    a = np.radians(h[m])
    w = s[m]
    return float(np.degrees(np.arctan2((np.sin(a) * w).sum(), (np.cos(a) * w).sum())) % 360.0)


def band(h, ref, anchor, spread):
    """Compress the sheet's hues into a narrow band centred on `anchor`.

    Rotating each hue toward the anchor (the obvious approach) walks the long way
    round the wheel whenever the source and the target are near-opposite, so a
    cyan energy orb aimed at amber passes straight through lime and lands there.
    Re-centring instead is immune to that: the sheet's dominant hue maps exactly
    onto the anchor and everything else keeps its *relative* offset, scaled down
    to `spread`. Material variety survives; stray hues cannot appear.
    """
    off = (h - ref + 180.0) % 360.0 - 180.0
    return np.mod(anchor + off * spread, 360.0)


def regrade(img, key):
    anchor, spread, sat_scale, sat_cap, sat_floor, vmul = GRADE[key]
    a = np.asarray(img, np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3:]
    h, s, v = rgb_to_hsv(rgb)

    # The resonance heart / hot cores keep their own hue - they are the accent
    # the whole palette is built around, so they must not drift toward the
    # sheet anchor with everything else.
    heart = (np.abs((h - HEART_HUE + 180.0) % 360.0 - 180.0) < 30.0) & (s > 0.45) & (v > 0.40)

    h2 = band(h, dominant_hue(h, s, v, alpha), anchor, spread)
    h2 = np.where(heart, h, h2)

    s2 = np.minimum(s * sat_scale, sat_cap)
    # Rim lights and cel highlights start out only lightly saturated, so scaling
    # saturation down pushed them to near-white and every actor came out looking
    # chalky. Tie a saturation floor to brightness instead: the brighter a pixel
    # is, the more colour it is required to keep, so highlights read as lit
    # material rather than as blown-out paper.
    s2 = np.maximum(s2, sat_floor * np.clip((v - 0.30) / 0.55, 0.0, 1.0))
    s2 = np.where(heart, np.minimum(s, 0.78), s2)

    # smootherstep-ish S-curve: deepens shadows and cleans highlights without
    # crushing either end, which is what keeps the silhouettes legible once the
    # saturation that used to separate them is gone.
    v2 = np.clip(v + CONTRAST * (v * v * (3.0 - 2.0 * v) - v), 0.0, 1.0) * vmul

    out = hsv_to_rgb(h2, np.clip(s2, 0.0, 1.0), v2)
    res = np.concatenate([np.clip(out, 0.0, 1.0), alpha], axis=2)
    return Image.fromarray((res * 255.0 + 0.5).astype(np.uint8), "RGBA")


def main():
    preview = "--preview" in sys.argv
    before = after = 0
    for key in GRADE:
        path = os.path.join(SPR, key + ".webp")
        if not os.path.exists(path):
            sys.stderr.write("건너뜀 (없음): %s\n" % key)
            continue
        src = os.path.join(SPR, key + ".orig.webp")
        # one pristine copy, so re-grading is repeatable instead of cumulative
        if not os.path.exists(src):
            Image.open(path).convert("RGBA").save(src, "WEBP", quality=95, method=4)
        out = regrade(Image.open(src).convert("RGBA"), key)
        if preview:
            out.save(os.path.join(SPR, key + ".preview.webp"), "WEBP", quality=86, method=5)
        else:
            before += os.path.getsize(path)
            out.save(path, "WEBP", quality=86, method=5)
            after += os.path.getsize(path)
        sys.stderr.write("  %-20s 앵커 %5.1f°  폭 %.2f\n" % (key, GRADE[key][0], GRADE[key][1]))
    if not preview:
        sys.stderr.write("완료 %.2fMB -> %.2fMB\n" % (before / 1e6, after / 1e6))


if __name__ == "__main__":
    main()
