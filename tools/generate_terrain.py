#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Premium seamless terrain tiles for ECHOHEART.

Rebuilds two material groups at 2048 with purpose-built detail instead of the
generic procedural pass:

  stone      -> reactor floor plating (used by floorTile / pillar / altar)
  wallPanel  -> ribbed wall panels with conduits (new group, walls only, so
                enemies and weapons that share riftSteel are left untouched)

Outputs albedo / emissive / orm / normal into assets/textures/environments.
Run: python3 tools/generate_terrain.py [stone|wall|both]
"""
import os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from generate_textures import (fft_noise, fbm, clamp01, to_img,
                               height_to_normal, scratches, TEX)

SIZE = 2048
ENV = os.path.join(TEX, "environments")
os.makedirs(ENV, exist_ok=True)


def _grid(size):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    return x / size, y / size


def _wrap(a):
    """Distance to nearest edge of a tiled cell, in [0,0.5]."""
    return np.minimum(a % 1.0, 1.0 - (a % 1.0))


def plate_layout(size, cells, seed, jitter=0.0):
    """Rectangular plates with per-plate ids; returns (seam, plate_id, edge)."""
    rng = np.random.default_rng(seed)
    u, v = _grid(size)
    su, sv = u * cells, v * cells
    iu, iv = np.floor(su).astype(np.int32), np.floor(sv).astype(np.int32)
    # per-row offset so seams do not line up into long straight channels
    off = rng.random(cells).astype(np.float32)[iv % cells]
    su2 = su + off * jitter
    iu = np.floor(su2).astype(np.int32)
    fu, fv = su2 - iu, sv - iv
    d = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv))
    pid = (iu * 73856093 ^ iv * 19349663) % 997
    return d, pid, (iu, iv)


def bevel(d, width):
    """0 in the seam, 1 on the plate face, smooth bevel between."""
    return clamp01(d / max(width, 1e-4)) ** 0.65


def build_floor():
    S = SIZE
    u, v = _grid(S)
    rng = np.random.default_rng(4242)

    # --- two plate scales: big slabs subdivided by finer panels ---
    d_big, pid_big, _ = plate_layout(S, 4, 11, jitter=0.35)
    d_sml, pid_sml, _ = plate_layout(S, 12, 27, jitter=0.5)
    seam_big = bevel(d_big, 0.016)
    seam_sml = bevel(d_sml, 0.010)
    face = np.minimum(seam_big, seam_sml * 0.55 + 0.45)

    # --- height: plate faces slightly domed, seams recessed ---
    grain = fbm(S, octaves=5, base=6, seed=3) * 0.5 + 0.25
    micro = fft_noise(S, 90, 8) * 0.5 + 0.5
    h = face * 0.72 + grain * 0.18 + micro * 0.10
    h = h - (1.0 - seam_big) * 0.30 - (1.0 - seam_sml) * 0.12

    # --- per-plate tonal variation so the floor is not one flat colour ---
    tone = ((pid_big % 17) / 17.0 * 0.35 + (pid_sml % 11) / 11.0 * 0.25)
    tone = tone * seam_sml

    # --- wear: scratches, scuffs, grime pooling in the seams ---
    scr = scratches(S, 900, 260, width=1, seed=8)
    scuff = clamp01(fbm(S, octaves=6, base=14, seed=21) * 1.6 - 0.35)
    grime = clamp01((1.0 - seam_sml) * 1.4) * 0.55 + clamp01(1.0 - seam_big) * 0.35
    grime = clamp01(grime + fbm(S, octaves=4, base=9, seed=33) * 0.30 - 0.10)

    # --- base colour: charcoal plate, cooler in the recesses ---
    base = np.array([0.086, 0.094, 0.098], np.float32)
    warm = np.array([0.125, 0.120, 0.118], np.float32)
    alb = base[None, None, :] * (0.75 + tone[..., None] * 0.9)
    alb = alb + warm[None, None, :] * (scuff * 0.30)[..., None]
    alb = alb * (1.0 - grime[..., None] * 0.42)
    alb = alb + (scr * 0.16)[..., None] * np.array([0.58, 0.63, 0.64], np.float32)

    # --- neon seam inlay: a thin light strip inside the big seams only ---
    strip = clamp01(1.0 - np.abs(d_big - 0.008) / 0.006)
    # break the strip into dashes so it reads as installed lighting
    dash = (np.sin(u * S / 46.0) * np.sin(v * S / 46.0)) > -0.25
    strip = strip * dash
    # some segments are dead
    dead = (pid_big % 5 == 0)
    strip = strip * (~dead)
    # deep teal, not the old electric blue: at 100% saturation the seams read
    # as glowing plastic rather than installed lighting
    neon = np.array([0.20, 0.60, 0.58], np.float32)

    # NOTE: no hazard stripe here. The floor quad tiles this texture ~27 times
    # across the arena, so any large one-off decal turns into visible banding.
    # Stencil marks are kept small and confined to individual plates instead.
    stencil = ((_wrap(su_mark := u * 12.0) < 0.055) & (_wrap(v * 12.0) < 0.030)
               & ((pid_sml % 7) == 0)).astype(np.float32)
    alb = alb + (stencil * seam_sml * (1.0 - grime * 0.5))[..., None] * \
        np.array([0.26, 0.22, 0.07], np.float32)

    alb = clamp01(alb + strip[..., None] * neon * 0.30)

    # --- emissive: the neon strip plus a faint glow bleeding onto the plate ---
    bleed = clamp01(1.0 - np.abs(d_big - 0.008) / 0.055) ** 2.2 * 0.35 * (~dead) * dash
    emis = clamp01(strip[..., None] * neon * 1.0 + bleed[..., None] * neon * 0.5)

    # --- ORM ---
    ao = clamp01(0.30 + face * 0.62 + micro * 0.08 - grime * 0.22)
    rough = clamp01(0.86 - scuff * 0.30 + grime * 0.10 - strip * 0.5)
    metal = clamp01(0.10 + scuff * 0.35 + scr * 0.25)
    orm = np.stack([ao, rough, metal], axis=2)

    nrm = height_to_normal(h, strength=2.6)
    return alb, emis, orm, nrm


def build_wall():
    S = SIZE
    u, v = _grid(S)

    # --- vertical ribs ---
    ribs = np.abs(np.sin(u * np.pi * 16.0))
    rib_face = clamp01(ribs * 1.5 - 0.15)
    # horizontal band splitting the wall into stacked panels
    d_p, pid, _ = plate_layout(S, 5, 71, jitter=0.0)
    seam = bevel(d_p, 0.012)

    grain = fbm(S, octaves=5, base=7, seed=5) * 0.5 + 0.25
    h = rib_face * 0.45 + seam * 0.40 + grain * 0.15
    h = h - (1.0 - seam) * 0.28

    # --- conduit pipes running horizontally across two rows ---
    pipe_y = [0.24, 0.74]
    pipe = np.zeros_like(u)
    for py in pipe_y:
        pipe = np.maximum(pipe, clamp01(1.0 - np.abs(v - py) / 0.026))
    h = h + pipe * 0.35

    # --- rust / coolant streaks running downward from the pipes ---
    streak_mask = fft_noise(S, 14, 17) * 0.5 + 0.5
    streak = np.zeros_like(u)
    for py in pipe_y:
        fall = clamp01((v - py) / 0.22)
        streak = np.maximum(streak, clamp01(1.0 - fall) * (v > py) * streak_mask)
    streak = clamp01(streak * 1.5 - 0.35)

    scr = scratches(S, 500, 200, width=1, seed=13)
    grime = clamp01((1.0 - seam) * 1.2 * 0.5 + fbm(S, octaves=4, base=8, seed=44) * 0.35)

    base = np.array([0.068, 0.074, 0.078], np.float32)
    alb = base[None, None, :] * (0.72 + rib_face[..., None] * 0.55)
    alb = alb * (1.0 - grime[..., None] * 0.38)
    alb = alb + streak[..., None] * np.array([0.16, 0.085, 0.05], np.float32)
    alb = alb + (scr * 0.14)[..., None] * np.array([0.54, 0.58, 0.59], np.float32)
    # pipes read as darker gloss metal
    alb = alb * (1.0 - pipe[..., None] * 0.35)

    # --- neon strip along the panel seams (vertical accent) ---
    strip = clamp01(1.0 - np.abs(d_p - 0.006) / 0.0045)
    dead = (pid % 4 == 0)
    strip = strip * (~dead)
    neon = np.array([0.22, 0.56, 0.54], np.float32)
    alb = clamp01(alb + strip[..., None] * neon * 0.28)

    bleed = clamp01(1.0 - np.abs(d_p - 0.006) / 0.05) ** 2.0 * 0.30 * (~dead)
    emis = clamp01(strip[..., None] * neon * 0.95 + bleed[..., None] * neon * 0.45)

    ao = clamp01(0.28 + seam * 0.55 + rib_face * 0.18 - grime * 0.20 - pipe * 0.15)
    rough = clamp01(0.80 - rib_face * 0.18 + streak * 0.18 - pipe * 0.35 - strip * 0.5)
    metal = clamp01(0.35 + rib_face * 0.30 + pipe * 0.45 - streak * 0.25)
    orm = np.stack([ao, rough, metal], axis=2)

    nrm = height_to_normal(h, strength=2.2)
    return alb, emis, orm, nrm


def save_group(name, alb, emis, orm, nrm):
    p = lambda k, e: os.path.join(ENV, "%s_%s.%s" % (name, k, e))
    to_img(alb).save(p("albedo", "webp"), "WEBP", quality=92, method=4)
    to_img(emis).save(p("emissive", "webp"), "WEBP", quality=92, method=4)
    to_img(orm).save(p("orm", "png"), optimize=True)
    to_img(nrm).save(p("normal", "png"), optimize=True)
    tot = sum(os.path.getsize(p(k, e)) for k, e in
              (("albedo", "webp"), ("emissive", "webp"), ("orm", "png"), ("normal", "png")))
    print("%-10s %dpx  4맵 합계 %.2fMB" % (name, SIZE, tot / 1e6))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "both"
    if what in ("stone", "both"):
        save_group("stone", *build_floor())
    if what in ("wall", "both"):
        save_group("wallPanel", *build_wall())
