#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECHOHEART - procedural mesh generator.
Builds real multi-part 3D meshes (positions, normals, uvs, indices) for player,
enemies, boss, weapons and environment props, then exports them as plain
JavaScript TypedArray literals consumed at runtime (no fetch, no loaders).

Each character is a rigged, part-based hierarchy so the runtime can animate
individual limbs (rigid part / joint hierarchy articulation).

Output: scripts/mesh-data-*.js   (window.EchoHeart.Meshes.<name> = {...})
"""
import numpy as np
import math, os

OUT = os.path.join(os.path.dirname(__file__), "..", "scripts")
os.makedirs(OUT, exist_ok=True)

def geom():
    return {"pos": [], "nrm": [], "uv": [], "idx": []}

def _v(a): return np.array(a, dtype=np.float64)

def add_quad(g, p0, p1, p2, p3, uv=((0, 0), (1, 0), (1, 1), (0, 1)), n=None):
    base = len(g["pos"]) // 3
    if n is None:
        n = np.cross(_v(p1) - _v(p0), _v(p3) - _v(p0))
        ln = np.linalg.norm(n)
        n = n / ln if ln > 1e-9 else _v([0, 1, 0])
    for p, u in zip((p0, p1, p2, p3), uv):
        g["pos"] += [float(p[0]), float(p[1]), float(p[2])]
        g["nrm"] += [float(n[0]), float(n[1]), float(n[2])]
        g["uv"]  += [float(u[0]), float(u[1])]
    g["idx"] += [base, base + 1, base + 2, base, base + 2, base + 3]

def box(sx, sy, sz, cx=0, cy=0, cz=0):
    g = geom()
    x0, x1 = cx - sx / 2, cx + sx / 2
    y0, y1 = cy - sy / 2, cy + sy / 2
    z0, z1 = cz - sz / 2, cz + sz / 2
    add_quad(g, (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))
    add_quad(g, (x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0))
    add_quad(g, (x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1))
    add_quad(g, (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0))
    add_quad(g, (x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0))
    add_quad(g, (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1))
    return g

def taper_box(sx0, sz0, sx1, sz1, sy, cy=0, cx=0, cz=0):
    g = geom()
    y0, y1 = cy, cy + sy
    b = [(-sx0/2,-sz0/2),(sx0/2,-sz0/2),(sx0/2,sz0/2),(-sx0/2,sz0/2)]
    t = [(-sx1/2,-sz1/2),(sx1/2,-sz1/2),(sx1/2,sz1/2),(-sx1/2,sz1/2)]
    b = [(cx+p[0], cz+p[1]) for p in b]
    t = [(cx+p[0], cz+p[1]) for p in t]
    for i in range(4):
        j = (i + 1) % 4
        p0 = (b[i][0], y0, b[i][1]); p1 = (b[j][0], y0, b[j][1])
        p2 = (t[j][0], y1, t[j][1]); p3 = (t[i][0], y1, t[i][1])
        add_quad(g, p0, p1, p2, p3)
    add_quad(g, (t[0][0],y1,t[0][1]),(t[1][0],y1,t[1][1]),(t[2][0],y1,t[2][1]),(t[3][0],y1,t[3][1]))
    add_quad(g, (b[3][0],y0,b[3][1]),(b[2][0],y0,b[2][1]),(b[1][0],y0,b[1][1]),(b[0][0],y0,b[0][1]))
    return g

def cylinder(r0, r1, h, seg=16, cy=0, cap=True):
    g = geom()
    y0, y1 = cy, cy + h
    slope = (r0 - r1)
    for i in range(seg):
        a0 = (i / seg) * math.tau
        a1 = ((i + 1) / seg) * math.tau
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        p0 = (r0 * c0, y0, r0 * s0); p1 = (r0 * c1, y0, r0 * s1)
        p2 = (r1 * c1, y1, r1 * s1); p3 = (r1 * c0, y1, r1 * s0)
        def nrm(cx, sx):
            n = _v([cx, slope / max(h, 1e-4), sx]); n /= (np.linalg.norm(n) or 1); return n
        n0, n1 = nrm(c0, s0), nrm(c1, s1)
        u0, u1 = i / seg, (i + 1) / seg
        base = len(g["pos"]) // 3
        for p, u, nn in ((p0, (u0, 0), n0), (p1, (u1, 0), n1), (p2, (u1, 1), n1), (p3, (u0, 1), n0)):
            g["pos"] += [p[0], p[1], p[2]]; g["nrm"] += [float(nn[0]), float(nn[1]), float(nn[2])]; g["uv"] += [u[0], u[1]]
        g["idx"] += [base, base + 1, base + 2, base, base + 2, base + 3]
    if cap:
        if r1 > 1e-4:
            bc = len(g["pos"]) // 3
            g["pos"] += [0, y1, 0]; g["nrm"] += [0, 1, 0]; g["uv"] += [0.5, 0.5]
            for i in range(seg + 1):
                a = (i / seg) * math.tau
                g["pos"] += [r1 * math.cos(a), y1, r1 * math.sin(a)]; g["nrm"] += [0, 1, 0]
                g["uv"] += [0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a)]
            for i in range(seg):
                g["idx"] += [bc, bc + 1 + i, bc + 2 + i]
        if r0 > 1e-4:
            bc = len(g["pos"]) // 3
            g["pos"] += [0, y0, 0]; g["nrm"] += [0, -1, 0]; g["uv"] += [0.5, 0.5]
            for i in range(seg + 1):
                a = (i / seg) * math.tau
                g["pos"] += [r0 * math.cos(a), y0, r0 * math.sin(a)]; g["nrm"] += [0, -1, 0]
                g["uv"] += [0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a)]
            for i in range(seg):
                g["idx"] += [bc, bc + 2 + i, bc + 1 + i]
    return g

def sphere(r, wseg=16, hseg=12, sx=1.0, sy=1.0, sz=1.0):
    g = geom()
    verts = []
    for iy in range(hseg + 1):
        v = iy / hseg
        theta = v * math.pi
        for ix in range(wseg + 1):
            u = ix / wseg
            phi = u * math.tau
            nx = math.sin(theta) * math.cos(phi)
            ny = math.cos(theta)
            nz = math.sin(theta) * math.sin(phi)
            px, py, pz = nx * r * sx, ny * r * sy, nz * r * sz
            n = _v([nx / max(sx,1e-4), ny / max(sy,1e-4), nz / max(sz,1e-4)]); n /= (np.linalg.norm(n) or 1)
            verts.append((px, py, pz, n[0], n[1], n[2], u, 1 - v))
    row = wseg + 1
    for p in verts:
        g["pos"] += [p[0], p[1], p[2]]; g["nrm"] += [float(p[3]), float(p[4]), float(p[5])]; g["uv"] += [p[6], p[7]]
    for iy in range(hseg):
        for ix in range(wseg):
            a = iy * row + ix; b = a + 1; c = a + row; d = c + 1
            g["idx"] += [a, c, b, b, c, d]
    return g

def torus(R, r, seg=20, sides=12):
    g = geom()
    verts = []
    for i in range(seg + 1):
        u = i / seg; phi = u * math.tau
        cx, cz = math.cos(phi), math.sin(phi)
        for j in range(sides + 1):
            v = j / sides; th = v * math.tau
            ct, st = math.cos(th), math.sin(th)
            px = (R + r * ct) * cx
            py = r * st
            pz = (R + r * ct) * cz
            nx, ny, nz = ct * cx, st, ct * cz
            verts.append((px, py, pz, nx, ny, nz, u, v))
    row = sides + 1
    for p in verts:
        g["pos"] += [p[0], p[1], p[2]]; g["nrm"] += [p[3], p[4], p[5]]; g["uv"] += [p[6], p[7]]
    for i in range(seg):
        for j in range(sides):
            a = i * row + j; b = a + 1; c = a + row; d = c + 1
            g["idx"] += [a, c, b, b, c, d]
    return g


def prism(r, h, sides=6, cy=0, twist=0.0):
    """n-gon extrusion - faceted, reads as machined metal (not a smooth tube)."""
    g = geom()
    y0, y1 = cy, cy + h
    for i in range(sides):
        a0 = (i / sides) * math.tau
        a1 = ((i + 1) / sides) * math.tau
        b0 = a0 + twist; b1 = a1 + twist
        p0 = (r*math.cos(a0), y0, r*math.sin(a0)); p1 = (r*math.cos(a1), y0, r*math.sin(a1))
        p2 = (r*math.cos(b1), y1, r*math.sin(b1)); p3 = (r*math.cos(b0), y1, r*math.sin(b0))
        add_quad(g, p0, p1, p2, p3)
    ctop = [(r*math.cos(i/sides*math.tau+twist), y1, r*math.sin(i/sides*math.tau+twist)) for i in range(sides)]
    cbot = [(r*math.cos(i/sides*math.tau), y0, r*math.sin(i/sides*math.tau)) for i in range(sides)]
    for i in range(1, sides-1):
        add_quad(g, ctop[0], ctop[i], ctop[i+1], ctop[i+1])
        add_quad(g, cbot[0], cbot[i+1], cbot[i], cbot[i])
    return g

def blade(length, width, thick, taper=0.12, cy=0):
    """flat tapered blade with a sharp tip - hard silhouette."""
    g = geom()
    w0, w1 = width*0.5, width*taper*0.5
    t0, t1 = thick*0.5, thick*0.25
    y0, y1 = cy, cy+length
    quads = [
        ((-w0,y0,t0),(w0,y0,t0),(w1,y1,t1),(-w1,y1,t1)),
        ((w0,y0,-t0),(-w0,y0,-t0),(-w1,y1,-t1),(w1,y1,-t1)),
        ((w0,y0,t0),(w0,y0,-t0),(w1,y1,-t1),(w1,y1,t1)),
        ((-w0,y0,-t0),(-w0,y0,t0),(-w1,y1,t1),(-w1,y1,-t1)),
        ((-w0,y0,-t0),(w0,y0,-t0),(w0,y0,t0),(-w0,y0,t0)),
    ]
    for q in quads: add_quad(g, *q)
    return g

def spike(r, h, sides=4, cy=0):
    return cylinder(r, 0.0, h, sides, cy=cy)

def plate(w, h, t, cx=0, cy=0, cz=0, bevel=0.25):
    """angular armour plate: hexagonal slab, not a rounded box."""
    g = geom()
    b = bevel*min(w, h)*0.5
    x0,x1 = cx-w/2, cx+w/2
    y0,y1 = cy, cy+h
    z0,z1 = cz-t/2, cz+t/2
    face = [(x0+b,y0),(x1-b,y0),(x1,y0+b),(x1,y1-b),(x1-b,y1),(x0+b,y1),(x0,y1-b),(x0,y0+b)]
    for z,flip in ((z1,False),(z0,True)):
        for i in range(1, len(face)-1):
            a,bb,c = face[0], face[i], face[i+1]
            if flip: add_quad(g,(a[0],a[1],z),(c[0],c[1],z),(bb[0],bb[1],z),(bb[0],bb[1],z))
            else:    add_quad(g,(a[0],a[1],z),(bb[0],bb[1],z),(c[0],c[1],z),(c[0],c[1],z))
    for i in range(len(face)):
        p,q = face[i], face[(i+1)%len(face)]
        add_quad(g,(p[0],p[1],z0),(q[0],q[1],z0),(q[0],q[1],z1),(p[0],p[1],z1))
    return g

def mat_trs(t=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    rx, ry, rz = r
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    Rm = Rz @ Ry @ Rx
    S = np.diag(s)
    M = np.eye(4)
    M[:3, :3] = Rm @ S
    M[:3, 3] = t
    return M

def merge(dst, src, M=None):
    base = len(dst["pos"]) // 3
    if M is None:
        dst["pos"] += src["pos"]; dst["nrm"] += src["nrm"]
    else:
        N = np.linalg.inv(M[:3, :3]).T
        p = np.array(src["pos"]).reshape(-1, 3).T
        p = (M[:3, :3] @ p + M[:3, 3:4]).T
        n = np.array(src["nrm"]).reshape(-1, 3).T
        n = (N @ n).T
        n = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
        dst["pos"] += p.reshape(-1).tolist()
        dst["nrm"] += n.reshape(-1).tolist()
    dst["uv"] += src["uv"]
    dst["idx"] += [i + base for i in src["idx"]]
    return dst

class Part:
    def __init__(self, name, material, pivot, parent=None):
        self.name = name; self.material = material
        self.pivot = _v(pivot); self.parent = parent
        self.g = geom()
    def add(self, prim, t=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
        merge(self.g, prim, mat_trs(t, r, s)); return self

class Rig:
    def __init__(self):
        self.parts = []
    def part(self, name, material, pivot, parent=None):
        p = Part(name, material, pivot, parent); self.parts.append(p); return p
    def tris(self):
        return sum(len(p.g["idx"]) for p in self.parts) // 3


def fix_orientation(g):
    """Normalize orientation so BACK-face culling is safe.
    1) make each triangle's winding agree with its (analytic) vertex normals
    2) per CONNECTED COMPONENT (each merged primitive), if the closed signed
       volume is negative the component is inside-out -> flip winding+normals.
    Components are found by welding coincident positions, because flat faces
    duplicate vertices."""
    if not g["idx"]:
        return g
    P = np.array(g["pos"]).reshape(-1, 3)
    N = np.array(g["nrm"]).reshape(-1, 3)
    I = list(g["idx"])
    for t in range(0, len(I), 3):
        a, b, c = I[t], I[t+1], I[t+2]
        ng = np.cross(P[b] - P[a], P[c] - P[a])
        if np.dot(ng, N[a] + N[b] + N[c]) < 0:
            I[t+1], I[t+2] = I[t+2], I[t+1]
    key = {}
    canon = np.empty(len(P), dtype=np.int64)
    for i in range(len(P)):
        k = (round(float(P[i][0]), 5), round(float(P[i][1]), 5), round(float(P[i][2]), 5))
        if k not in key:
            key[k] = len(key)
        canon[i] = key[k]
    parent = list(range(len(key)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    for t in range(0, len(I), 3):
        a, b, c = canon[I[t]], canon[I[t+1]], canon[I[t+2]]
        union(a, b); union(b, c)
    comps = {}
    for t in range(0, len(I), 3):
        comps.setdefault(find(canon[I[t]]), []).append(t)
    for _r, tris in comps.items():
        vids = set()
        for t in tris:
            vids.update((I[t], I[t+1], I[t+2]))
        C = P[sorted(vids)].mean(axis=0)
        vol = 0.0
        for t in tris:
            a = P[I[t]] - C; b = P[I[t+1]] - C; c = P[I[t+2]] - C
            vol += float(np.dot(a, np.cross(b, c))) / 6.0
        if vol < -1e-9:
            for t in tris:
                I[t+1], I[t+2] = I[t+2], I[t+1]
            for vi in vids:
                N[vi] = -N[vi]
    g["idx"] = I
    g["nrm"] = N.reshape(-1).tolist()
    return g

def fmt(v, dec=3):
    s = f"{v:.{dec}f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s

def arr(vals, dec=3):
    return "[" + ",".join(fmt(v, dec) for v in vals) + "]"

def serialize_rig(name, rig):
    allp = []
    for p in rig.parts:
        arrp = np.array(p.g["pos"]).reshape(-1, 3) if p.g["pos"] else np.zeros((0, 3))
        allp.append(arrp + p.pivot)   # pivot = joint world position in the rest pose
    allp = np.concatenate(allp, axis=0) if allp else np.zeros((1, 3))
    mn = allp.min(axis=0); mx = allp.max(axis=0)
    for _p in rig.parts:
        fix_orientation(_p.g)
    idxmap = {p.name: i for i, p in enumerate(rig.parts)}
    parts_js = []
    for p in rig.parts:
        parent_pivot = rig.parts[idxmap[p.parent]].pivot if p.parent else _v([0, 0, 0])
        rest = (p.pivot - parent_pivot).tolist()
        local = list(p.g["pos"])   # already pivot-local
        parent_i = idxmap[p.parent] if p.parent else -1
        parts_js.append(
            "{n:'%s',mat:'%s',par:%d,rest:%s,"
            "pos:new Float32Array(%s),nrm:new Float32Array(%s),"
            "uv:new Float32Array(%s),idx:new Uint16Array(%s)}"
            % (p.name, p.material, parent_i, arr(rest, 4),
               arr(local), arr(p.g["nrm"], 4), arr(p.g["uv"], 4),
               "[" + ",".join(str(i) for i in p.g["idx"]) + "]")
        )
    bounds = "{min:%s,max:%s}" % (arr(mn.tolist(), 4), arr(mx.tolist(), 4))
    return "EH.Meshes['%s']={parts:[%s],bounds:%s};\n" % (name, ",".join(parts_js), bounds)

def serialize_simple(name, g, material="stone"):
    fix_orientation(g)
    mn = np.array(g["pos"]).reshape(-1, 3).min(axis=0).tolist()
    mx = np.array(g["pos"]).reshape(-1, 3).max(axis=0).tolist()
    part = ("{n:'root',mat:'%s',par:-1,rest:[0,0,0],pos:new Float32Array(%s),"
            "nrm:new Float32Array(%s),uv:new Float32Array(%s),idx:new Uint16Array(%s)}"
            % (material, arr(g["pos"]), arr(g["nrm"], 4), arr(g["uv"], 4),
               "[" + ",".join(str(i) for i in g["idx"]) + "]"))
    return "EH.Meshes['%s']={parts:[%s],bounds:{min:%s,max:%s}};\n" % (
        name, part, arr(mn, 4), arr(mx, 4))

def build_lian():
    r = Rig()
    pelvis = r.part("pelvis", "leather", (0, 0.92, 0))
    pelvis.add(taper_box(0.34, 0.24, 0.30, 0.22, 0.18, cy=-0.09))
    torso = r.part("torso", "cloth", (0, 1.02, 0), "pelvis")
    torso.add(taper_box(0.30, 0.22, 0.40, 0.26, 0.40, cy=0.0))
    torso.add(box(0.28, 0.20, 0.10, cy=0.20, cz=0.10))
    torso.add(box(0.16, 0.10, 0.22, cx=0.20, cy=0.34, cz=0))
    heart = r.part("heart", "crystalRed", (0, 1.30, 0.15), "torso")
    heart.add(sphere(0.06, 12, 10, 1.0, 1.3, 0.8))
    head = r.part("head", "skin", (0, 1.46, 0), "torso")
    head.add(taper_box(0.17, 0.17, 0.15, 0.16, 0.20, cy=0.0))
    head.add(box(0.18, 0.07, 0.16, cy=0.06, cz=0.01))
    head.add(taper_box(0.16, 0.16, 0.05, 0.05, 0.14, cy=0.18, cz=-0.02))
    for side, mat in ((1, "circuit"), (-1, "cloth")):
        s = "R" if side == 1 else "L"
        up = r.part("upperArm" + s, mat, (0.22 * side, 1.36, 0), "torso")
        up.add(cylinder(0.065, 0.05, 0.28, 10, cy=-0.28))
        up.add(sphere(0.075, 10, 8))
        lo = r.part("lowerArm" + s, "darkMetal" if side == 1 else "leather",
                    (0.22 * side, 1.06, 0), "upperArm" + s)
        lo.add(cylinder(0.05, 0.045, 0.26, 10, cy=-0.26))
        lo.add(box(0.09, 0.10, 0.11, cy=-0.30))
    for side in (1, -1):
        s = "R" if side == 1 else "L"
        th = r.part("thigh" + s, "leather", (0.10 * side, 0.90, 0), "pelvis")
        th.add(cylinder(0.075, 0.06, 0.40, 10, cy=-0.40))
        sh = r.part("shin" + s, "darkMetal", (0.10 * side, 0.50, 0), "thigh" + s)
        sh.add(cylinder(0.06, 0.045, 0.40, 10, cy=-0.40))
        sh.add(box(0.11, 0.07, 0.24, cy=-0.44, cz=0.05))
    cloak = r.part("cloak", "cloth", (0, 1.28, -0.14), "torso")
    cloak.add(taper_box(0.42, 0.04, 0.30, 0.02, 0.62, cy=-0.62, cz=0.0))
    wm = r.part("weaponMount", "darkMetal", (0.30, 1.06, 0.05), "lowerArmR")
    wm.add(box(0.03, 0.03, 0.03))
    return r

def build_stalker():
    """추적자: 낮게 웅크린 곤충형. 앞으로 뻗은 블레이드 팔 + 뒤로 휘는 꼬리 가시."""
    r = Rig()
    core = r.part("pelvis", "organic", (0, 0.62, -0.05))
    core.add(prism(0.17, 0.30, 6, cy=-0.15), r=(1.35, 0, 0))
    torso = r.part("torso", "organic", (0, 0.74, 0.10), "pelvis")
    torso.add(prism(0.15, 0.42, 6, cy=0, twist=0.25), r=(1.15, 0, 0))
    for i, z in enumerate((0.02, -0.06, -0.14)):                 # dorsal spines
        torso.add(spike(0.035, 0.20 - i*0.03, 4, cy=0), t=(0, 0.10, z), r=(-0.5, 0, 0))
    tail = r.part("tail", "organic", (0, 0.80, -0.16), "pelvis")
    tail.add(prism(0.055, 0.34, 5, cy=0), r=(-1.0, 0, 0))
    tail.add(spike(0.05, 0.30, 4, cy=0), t=(0, 0.30, -0.18), r=(-0.35, 0, 0))
    head = r.part("head", "organic", (0, 0.90, 0.30), "torso")
    head.add(blade(0.26, 0.15, 0.09, taper=0.30), r=(1.45, 0, 0))
    head.add(spike(0.028, 0.14, 4, cy=0), t=(0, 0.02, 0.20), r=(1.5, 0, 0))
    for side in (1, -1):
        s_ = "R" if side == 1 else "L"
        up = r.part("upperArm" + s_, "darkMetal", (0.17 * side, 0.86, 0.14), "torso")
        up.add(prism(0.045, 0.30, 5, cy=-0.30), r=(0.55, 0, -0.35 * side))
        lo = r.part("lowerArm" + s_, "darkMetal", (0.30 * side, 0.62, 0.30), "upperArm" + s_)
        lo.add(blade(0.46, 0.13, 0.05, taper=0.10), r=(1.30, 0, 0.18 * side))
        claw = r.part("claw" + s_, "crystalRed", (0.30 * side, 0.55, 0.66), "lowerArm" + s_)
        claw.add(spike(0.022, 0.12, 4, cy=0), r=(1.4, 0, 0))
    for side in (1, -1):
        s_ = "R" if side == 1 else "L"
        th = r.part("thigh" + s_, "organic", (0.15 * side, 0.66, -0.06), "pelvis")
        th.add(prism(0.055, 0.32, 5, cy=-0.32), r=(-0.85, 0, 0))
        sh = r.part("shin" + s_, "darkMetal", (0.15 * side, 0.48, -0.30), "thigh" + s_)
        sh.add(blade(0.44, 0.09, 0.05, taper=0.22), r=(2.55, 0, 0))
    return r

def build_gunner():
    """시간 사수: 가늘고 높은 몸체 + 한쪽에만 달린 거대 포신. 강한 비대칭."""
    r = Rig()
    base = r.part("pelvis", "darkMetal", (0, 0.72, 0))
    base.add(prism(0.19, 0.26, 6, cy=-0.13))
    torso = r.part("torso", "riftSteel", (0, 0.86, 0), "pelvis")
    torso.add(prism(0.13, 0.56, 5, cy=0, twist=0.3))
    torso.add(plate(0.30, 0.26, 0.06, cy=0.16, cz=0.12))
    core = r.part("core", "energyCyan", (0, 1.06, 0.15), "torso")
    core.add(prism(0.07, 0.10, 6, cy=-0.05), r=(1.57, 0, 0))
    head = r.part("head", "darkMetal", (0, 1.44, 0), "torso")
    head.add(prism(0.10, 0.20, 5, cy=0))
    head.add(spike(0.02, 0.22, 4, cy=0), t=(0, 0.18, -0.02))
    head.add(prism(0.045, 0.07, 6, cy=0), t=(0, 0.10, 0.09), r=(1.57, 0, 0))
    la = r.part("upperArmL", "darkMetal", (-0.16, 1.26, 0), "torso")
    la.add(prism(0.038, 0.40, 5, cy=-0.40), r=(0, 0, 0.22))
    ga = r.part("upperArmR", "darkMetal", (0.18, 1.26, 0), "torso")
    ga.add(prism(0.06, 0.22, 6, cy=-0.22))
    barrel = r.part("gun", "riftSteel", (0.30, 1.02, 0.06), "upperArmR")
    barrel.add(plate(0.20, 0.52, 0.16, cy=-0.10), r=(1.42, 0, 0))
    barrel.add(prism(0.055, 0.30, 6, cy=0), t=(0, 0.02, 0.30), r=(1.42, 0, 0))
    barrel.add(prism(0.075, 0.08, 6, cy=0), t=(0, 0.03, 0.52), r=(1.42, 0, 0))
    for side in (1, -1):
        s_ = "R" if side == 1 else "L"
        th = r.part("thigh" + s_, "darkMetal", (0.13 * side, 0.60, -0.02), "pelvis")
        th.add(prism(0.042, 0.42, 4, cy=-0.42), r=(-0.18, 0, -0.30 * side))
    return r

def build_orb():
    """폭주 구체: 매끈한 공이 아니라 각진 기뢰. 방사형 가시 + 갈라지는 외피."""
    r = Rig()
    core = r.part("pelvis", "energyCyan", (0, 0.78, 0))
    core.add(prism(0.15, 0.20, 6, cy=-0.10))
    core.add(prism(0.15, 0.10, 6, cy=0.10, twist=0.5))
    inner = r.part("core", "crystalRed", (0, 0.78, 0), "pelvis")
    inner.add(prism(0.085, 0.14, 5, cy=-0.07))
    for i in range(8):                                            # radial spikes
        a = i * math.tau / 8
        core.add(spike(0.032, 0.20, 4, cy=0),
                 t=(math.cos(a)*0.15, 0.0, math.sin(a)*0.15),
                 r=(math.sin(a)*1.35, -a, -math.cos(a)*1.35))
    for i in range(4):                                            # opening shell petals
        ang = i * math.pi / 2
        p = r.part("shell%d" % i, "darkMetal", (0, 0.78, 0), "pelvis")
        p.add(plate(0.26, 0.28, 0.05, cy=-0.14), t=(0, 0, 0.17), r=(0.35, ang, 0))
    ring = r.part("ring", "riftSteel", (0, 0.78, 0), "pelvis")
    ring.add(torus(0.23, 0.022, 12, 5))
    return r

def build_shield():
    """방패병: 낮고 넓은 벙커형. 몸보다 큰 각진 타워 실드가 실루엣을 지배."""
    r = Rig()
    pelvis = r.part("pelvis", "riftSteel", (0, 0.74, 0))
    pelvis.add(plate(0.56, 0.26, 0.40, cy=-0.13))
    torso = r.part("torso", "riftSteel", (0, 0.86, 0), "pelvis")
    torso.add(plate(0.52, 0.40, 0.36, cy=0))
    torso.add(plate(0.30, 0.14, 0.10, cy=0.30, cz=0.16))
    head = r.part("head", "darkMetal", (0, 1.28, -0.02), "torso")
    head.add(prism(0.13, 0.16, 5, cy=0, twist=0.4))
    head.add(plate(0.26, 0.06, 0.14, cy=0.05, cz=0.02))
    core = r.part("core", "energyCyan", (0, 1.02, -0.20), "torso")
    core.add(prism(0.08, 0.12, 6, cy=-0.06), r=(1.57, 0, 0))
    la = r.part("upperArmL", "darkMetal", (-0.30, 1.10, 0), "torso")
    la.add(prism(0.06, 0.26, 5, cy=-0.26))
    shield = r.part("shield", "darkMetal", (-0.40, 0.98, 0.20), "upperArmL")
    shield.add(plate(0.52, 1.10, 0.10, cy=-0.46))
    shield.add(plate(0.20, 0.42, 0.06, cy=-0.20, cz=0.07))
    for k in (-1, 1):                                             # shield spikes
        shield.add(spike(0.035, 0.20, 4, cy=0), t=(0.20*k, -0.52, 0.04), r=(0, 0, -0.5*k))
    ra = r.part("upperArmR", "riftSteel", (0.32, 1.10, 0), "torso")
    ra.add(prism(0.06, 0.24, 5, cy=-0.24))
    ra.add(plate(0.14, 0.16, 0.14, cy=-0.34))
    for side in (1, -1):
        s_ = "R" if side == 1 else "L"
        th = r.part("thigh" + s_, "darkMetal", (0.18 * side, 0.70, 0), "pelvis")
        th.add(prism(0.07, 0.34, 5, cy=-0.34))
        sh = r.part("shin" + s_, "riftSteel", (0.18 * side, 0.36, 0), "thigh" + s_)
        sh.add(plate(0.18, 0.34, 0.20, cy=-0.34))
    return r

def build_summoner():
    """잔향 소환사: 아주 높고 가는 부유체. 넓은 헤일로 링 + 늘어진 촉수."""
    r = Rig()
    core = r.part("pelvis", "cloth", (0, 1.10, 0))
    core.add(prism(0.20, 0.62, 6, cy=-0.62, twist=-0.35))
    for i in range(5):                                            # trailing tendrils
        a = i * math.tau / 5
        core.add(prism(0.022, 0.42, 4, cy=-1.02),
                 t=(math.cos(a)*0.10, 0, math.sin(a)*0.10), r=(math.sin(a)*0.3, 0, -math.cos(a)*0.3))
    torso = r.part("torso", "cloth", (0, 1.34, 0), "pelvis")
    torso.add(prism(0.15, 0.34, 6, cy=0))
    torso.add(plate(0.34, 0.10, 0.10, cy=0.26))
    sig = r.part("core", "magenta", (0, 1.40, 0.14), "torso")
    sig.add(prism(0.08, 0.06, 6, cy=-0.03), r=(1.57, 0, 0))
    halo = r.part("ring1", "magenta", (0, 1.62, 0), "torso")
    halo.add(torus(0.34, 0.022, 16, 5))
    halo.add(torus(0.26, 0.016, 14, 5), t=(0, 0.06, 0))
    head = r.part("head", "darkMetal", (0, 1.76, 0), "torso")
    head.add(prism(0.085, 0.20, 5, cy=-0.08, twist=0.4))
    head.add(spike(0.018, 0.24, 4, cy=0), t=(0, 0.12, 0))
    for k, (side, up) in enumerate([(1, 0.06), (-1, 0.06), (1, -0.16), (-1, -0.16)]):
        s_ = ("R" if side == 1 else "L") + str(k)
        a = r.part("arm" + s_, "darkMetal", (0.16 * side, 1.44 + up, 0), "torso")
        a.add(prism(0.026, 0.40, 4, cy=-0.40), r=(0, 0, -0.55 * side))
        a.add(spike(0.03, 0.10, 4, cy=0), t=(0.21 * side, -0.40, 0), r=(0, 0, -0.9 * side))
    return r

def build_sentinel():
    """궤도 감시자: 각진 자이로스코프. 삼각 스포크 + 기울어진 링 + 다면체 코어."""
    r = Rig()
    hub = r.part("pelvis", "riftSteel", (0, 1.00, 0))
    hub.add(prism(0.13, 0.18, 6, cy=-0.09))
    hub.add(prism(0.13, 0.09, 6, cy=0.09, twist=0.5))
    lens = r.part("core", "crystalRed", (0, 1.00, 0), "pelvis")
    lens.add(prism(0.075, 0.10, 5, cy=-0.05), r=(1.57, 0, 0))
    ring1 = r.part("ring1", "darkMetal", (0, 1.00, 0), "pelvis")
    for i in range(6):                                            # faceted ring segments
        a = i * math.tau / 6
        ring1.add(plate(0.30, 0.07, 0.05, cy=-0.035),
                  t=(math.cos(a)*0.30, 0, math.sin(a)*0.30), r=(1.57, -a, 0))
    ring2 = r.part("ring2", "riftSteel", (0, 1.00, 0), "pelvis")
    ring2.add(torus(0.36, 0.02, 14, 4), r=(1.25, 0, 0.4))
    for i in range(4):                                            # sharp emitter spokes
        ang = i * math.tau / 4
        sp = r.part("spoke%d" % i, "darkMetal", (0, 1.00, 0), "ring1")
        sp.add(blade(0.26, 0.09, 0.04, taper=0.15),
               t=(math.cos(ang)*0.16, 0, math.sin(ang)*0.16), r=(1.57, -ang, 0))
        sp.add(prism(0.035, 0.06, 5, cy=0), t=(math.cos(ang)*0.42, 0, math.sin(ang)*0.42))
    return r

def build_boss():
    r = Rig()
    base = r.part("pelvis", "bossMetal", (0, 1.3, 0))
    base.add(cylinder(0.9, 0.7, 0.5, 20, cy=-0.7))
    body = r.part("torso", "bossShell", (0, 2.0, 0), "pelvis")
    body.add(sphere(1.0, 24, 18, 1.0, 1.15, 0.9))
    body.add(cylinder(0.62, 0.60, 0.14, 24, cy=0.0), t=(0, 0.1, 0.78), r=(1.57, 0, 0))
    core = r.part("core", "bossCore", (0, 2.05, 0.55), "torso")
    core.add(sphere(0.36, 16, 14))
    ring1 = r.part("ring1", "bossMetal", (0, 2.0, 0), "torso")
    ring1.add(torus(1.35, 0.07, 28, 10))
    ring2 = r.part("ring2", "bossShell", (0, 2.0, 0), "torso")
    ring2.add(torus(1.15, 0.05, 28, 10), r=(1.2, 0, 0))
    ring3 = r.part("ring3", "bossMetal", (0, 2.0, 0), "torso")
    ring3.add(torus(1.5, 0.05, 30, 10), r=(0.6, 0.4, 0))
    for i in range(12):
        a = i * math.tau / 12
        body.add(box(0.05, 0.05, 0.14), t=(0.5 * math.cos(a + 1.57), 0.1 + 0.5 * math.sin(a + 1.57), 0.80))
    for k, (side, yy) in enumerate([(1, 2.4), (-1, 2.4), (1, 1.6), (-1, 1.6)]):
        s = str(k)
        up = r.part("arm" + s, "bossMetal", (1.0 * side, yy, 0), "torso")
        up.add(cylinder(0.14, 0.10, 0.9, 10, cy=0), r=(0, 0, 1.2 * -side))
        fo = r.part("forearm" + s, "bossShell", (1.7 * side, yy - 0.4, 0), "arm" + s)
        fo.add(cylinder(0.10, 0.06, 0.8, 10, cy=0), r=(0, 0, 0.8 * -side))
        fo.add(cylinder(0.06, 0.0, 0.4, 8, cy=0), t=(0.7 * side, -0.5, 0), r=(0, 0, 1.2 * -side))
    for i in range(6):
        a = i * math.tau / 6
        body.add(cylinder(0.05, 0.0, 0.5, 6, cy=0), t=(0.5 * math.cos(a), 1.0, 0.5 * math.sin(a)),
                 r=(0.4 * math.sin(a), 0, -0.4 * math.cos(a)))
    return r

def build_riftsword():
    r = Rig()
    hilt = r.part("root", "darkMetal", (0, 0, 0))
    merge(hilt.g, cylinder(0.03, 0.03, 0.12, 8, cy=0.0), None)
    merge(hilt.g, box(0.14, 0.03, 0.05, cy=0.13), None)
    merge(hilt.g, taper_box(0.09, 0.03, 0.02, 0.008, 0.78, cy=0.16), None)
    groove = r.part("groove", "energyCyan", (0, 0, 0), "root")
    groove.add(taper_box(0.02, 0.005, 0.01, 0.004, 0.72, cy=0.18, cz=0.016))
    return r

def build_pulsebow():
    """에너지 석궁: 수평 본체 + 좌우로 벌어진 각진 림 + 팽팽한 시위 + 볼트 홈."""
    r = Rig()
    frame = r.part("root", "riftSteel", (0, 0, 0))
    # stock / body along +Y (grip is +Y; blade-forward handled by weapon grip cfg)
    merge(frame.g, cylinder(0.032, 0.028, 0.14, 8, cy=-0.02), None)          # grip
    merge(frame.g, taper_box(0.07, 0.07, 0.05, 0.05, 0.62, cy=0.12), None)    # main rail
    merge(frame.g, box(0.10, 0.08, 0.09, cy=0.10), None)                      # trigger housing
    # the prod (bow arms) mounted across the front, angled forward
    for sgn in (1, -1):
        merge(frame.g, taper_box(0.045, 0.045, 0.02, 0.02, 0.20, cy=0),
              mat_trs(t=(0, 0.58, 0.02), r=(0.2, 0, 1.35 * sgn)))             # short angular limb
        merge(frame.g, taper_box(0.03, 0.03, 0.015, 0.015, 0.10, cy=0),
              mat_trs(t=(0.19 * sgn, 0.64, 0.05), r=(0.4, 0, 0.7 * sgn)))     # limb tip
    limbtips = r.part("limbtips", "darkMetal", (0, 0, 0), "root")
    for sgn in (1, -1):
        limbtips.add(prism(0.028, 0.05, 6, cy=0), t=(0.26 * sgn, 0.63, 0.05))
    # taut energy string between the tips + a nocked bolt
    string = r.part("string", "energyCyan", (0, 0, 0), "root")
    string.add(cylinder(0.005, 0.005, 0.54, 4, cy=0), t=(-0.26, 0.64, 0.05), r=(0, 0, 1.571))
    string.add(cylinder(0.011, 0.0, 0.34, 6, cy=0), t=(0, 0.50, 0.09), r=(-0.08, 0, 0))  # bolt/arrow
    # front sight glow
    core = r.part("core", "crystalRed", (0, 0, 0), "root")
    core.add(sphere(0.028, 8, 6), t=(0, 0.42, 0.10))
    return r

def build_chaingaunt():
    """대형 파워 클로: 두꺼운 완갑 + 손목 실린더 + 앞으로 뻗은 3개의 큰 갈퀴 발톱."""
    r = Rig()
    gaunt = r.part("root", "darkMetal", (0, 0, 0))
    gaunt.add(prism(0.075, 0.20, 6, cy=-0.02))                                # forearm cuff
    gaunt.add(prism(0.09, 0.10, 6, cy=0.18, twist=0.3))                       # knuckle block
    gaunt.add(box(0.16, 0.12, 0.14, cy=0.30))                                 # fist housing
    # wrist armour plates
    for sgn in (1, -1):
        gaunt.add(plate(0.07, 0.16, 0.05, cx=0.09 * sgn, cy=0.05, cz=0.0), )
    plate_p = r.part("plate", "riftSteel", (0, 0, 0), "root")
    plate_p.add(plate(0.20, 0.14, 0.06, cy=0.30, cz=0.06))                    # back-of-hand plate
    plate_p.add(prism(0.05, 0.10, 6, cy=0.02), t=(0, 0.0, 0.0), r=(1.571, 0, 0))
    # three big forward claws (the silhouette)
    claws = r.part("chain", "chainMetal", (0, 0, 0), "root")
    for k in (-1, 0, 1):
        claws.add(taper_box(0.05, 0.06, 0.02, 0.02, 0.34, cy=0),
                  t=(0.07 * k, 0.36, 0.08), r=(1.2, 0, 0.12 * k))             # claw base
        claws.add(cylinder(0.022, 0.0, 0.16, 6, cy=0),
                  t=(0.09 * k, 0.40, 0.34), r=(1.35, 0, 0.15 * k))            # sharp tip
    # glowing energy core in the palm
    core = r.part("core", "crystalRed", (0, 0, 0), "root")
    core.add(sphere(0.05, 10, 8), t=(0, 0.30, 0.10))
    return r

def build_floor_tile():
    g = geom()
    merge(g, box(2.0, 0.2, 2.0, cy=-0.1), None)
    merge(g, taper_box(2.0, 2.0, 1.8, 1.8, 0.06, cy=0.0), None)
    return g

def build_wall():
    g = geom()
    merge(g, box(2.0, 1.6, 0.4, cy=0.8), None)
    merge(g, box(2.0, 0.2, 0.5, cy=1.6), None)
    merge(g, box(0.2, 1.2, 0.2, cx=-0.8, cy=0.7, cz=0.18), None)
    merge(g, box(0.2, 1.2, 0.2, cx=0.8, cy=0.7, cz=0.18), None)
    return g

def build_pillar():
    g = geom()
    merge(g, cylinder(0.28, 0.22, 2.2, 12, cy=0), None)
    merge(g, cylinder(0.34, 0.30, 0.2, 12, cy=0), None)
    merge(g, cylinder(0.34, 0.30, 0.2, 12, cy=2.0), None)
    return g

def build_gear():
    g = geom()
    merge(g, cylinder(0.5, 0.5, 0.12, 24, cy=-0.06), None)
    merge(g, cylinder(0.2, 0.2, 0.2, 12, cy=-0.1), None)
    for i in range(12):
        a = i * math.tau / 12
        merge(g, box(0.14, 0.12, 0.16), mat_trs(t=(0.54 * math.cos(a), 0, 0.54 * math.sin(a)), r=(0, -a, 0)))
    return g

def build_crystal():
    g = geom()
    merge(g, cylinder(0.10, 0.0, 0.6, 6, cy=0), None)
    merge(g, cylinder(0.10, 0.0, 0.2, 6, cy=0), mat_trs(r=(math.pi, 0, 0)))
    return g

def build_door():
    r = Rig()
    frame = r.part("root", "riftSteel", (0, 0, 0))
    frame.add(box(0.3, 2.6, 0.4, cx=-1.1, cy=1.3))
    frame.add(box(0.3, 2.6, 0.4, cx=1.1, cy=1.3))
    frame.add(box(2.5, 0.4, 0.4, cy=2.6))
    portal = r.part("portal", "energyCyan", (0, 0, 0), "root")
    portal.add(box(1.9, 2.4, 0.05, cy=1.2))
    return r

def build_altar():
    g = geom()
    merge(g, cylinder(0.7, 0.6, 0.2, 8, cy=0), None)
    merge(g, cylinder(0.5, 0.4, 0.5, 8, cy=0.2), None)
    merge(g, cylinder(0.6, 0.55, 0.15, 8, cy=0.7), None)
    return g

def build_device(kind):
    g = geom()
    merge(g, box(0.8, 0.2, 0.8, cy=0.1), None)
    merge(g, cylinder(0.25, 0.2, 1.0, 10, cy=0.2), None)
    merge(g, sphere(0.28, 14, 12), mat_trs(t=(0, 1.4, 0)))
    return g

def build_forge():
    g = geom()
    merge(g, box(1.6, 0.9, 1.2, cy=0.45), None)
    merge(g, cylinder(0.4, 0.5, 0.8, 12, cy=0.9), None)
    merge(g, box(0.9, 0.7, 0.1, cy=0.5, cz=0.6), None)
    return g

def write_file(fn, header, entries):
    with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
        f.write("'use strict';\n")
        f.write("(function(){var EH=window.EchoHeart=window.EchoHeart||{};EH.Meshes=EH.Meshes||{};\n")
        f.write("// %s\n" % header)
        for e in entries:
            f.write(e)
        f.write("})();\n")

def main():
    report = {}
    lian = build_lian()
    write_file("mesh-data-player.js", "player mesh (rigged parts)", [serialize_rig("lian", lian)])
    report["lian"] = (lian.tris(), len(lian.parts))
    builders = {
        "stalker": build_stalker, "gunner": build_gunner, "orb": build_orb,
        "shield": build_shield, "summoner": build_summoner, "sentinel": build_sentinel,
    }
    ent = []
    for name, b in builders.items():
        rg = b()
        ent.append(serialize_rig(name, rg))
        report[name] = (rg.tris(), len(rg.parts))
    write_file("mesh-data-enemies.js", "enemy meshes (6 rigged)", ent)
    boss = build_boss()
    write_file("mesh-data-boss.js", "boss chronovore", [serialize_rig("chronovore", boss)])
    report["chronovore"] = (boss.tris(), len(boss.parts))
    weps = {"riftsword": build_riftsword, "pulsebow": build_pulsebow, "chaingaunt": build_chaingaunt}
    wentries = []
    for name, b in weps.items():
        rg = b()
        wentries.append(serialize_rig(name, rg))
        report[name] = (rg.tris(), len(rg.parts))
    write_file("mesh-data-weapons.js", "weapon meshes (3 rigged)", wentries)
    envs = []
    def simple(name, g, mat):
        envs.append(serialize_simple(name, g, mat))
        report[name] = (len(g["idx"]) // 3, 1)
    simple("floorTile", build_floor_tile(), "stone")
    simple("wall", build_wall(), "riftSteel")
    simple("pillar", build_pillar(), "stone")
    simple("gear", build_gear(), "darkMetal")
    simple("crystal", build_crystal(), "crystalRed")
    simple("altar", build_altar(), "stone")
    simple("device", build_device("x"), "riftSteel")
    simple("forge", build_forge(), "riftSteel")
    door = build_door()
    envs.append(serialize_rig("door", door))
    report["door"] = (door.tris(), len(door.parts))
    write_file("mesh-data-environments.js", "environment meshes", envs)
    total = sum(v[0] for v in report.values())
    print("=== MESH REPORT ===")
    for k, v in report.items():
        print(f"  {k:14s} tris={v[0]:6d} parts={v[1]}")
    print(f"  TOTAL tris = {total}")
    import json
    with open(os.path.join(OUT, "..", "tools", "mesh_report.json"), "w") as f:
        json.dump(report, f, indent=2)

if __name__ == "__main__":
    main()
