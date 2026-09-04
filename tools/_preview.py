import numpy as np, math
from PIL import Image, ImageDraw
import spritelib as SL, premium_shade as PS, clips
meshes=SL.load_meshes(); mats=SL.load_materials()
HERO = dict(alb_lift=2.4, alb_gamma=0.75, key_mul=1.9, rim_mul=1.5,
            outline_dark=0.85, outline_px=2.6, bloom=0.55, sat=1.28,
            style='toon', bands=4, ramp_amount=0.80, ramp_gain=1.18,
            ramp_bias=0.03, alb_blur=0.6, emis_mul=0.55)
def prof(r,**o):
    d=dict(HERO); d["ramp"]=r; d.update(o); return d
def render(name, fn, ts, fc, S, kw, ctx=None):
    parts=meshes[name]; ppu,oy=SL.fit_scale(parts,S,pad=0.86)
    a=clips.Pose()
    if fn: fn(a,ts,ctx or {})
    mw=SL.compose(parts,a.final(),fc)
    return PS.render_frame(parts,mw,mats,S,ppu,oy,ss=3,**kw)

S=118; pad=6
DIRS=8
rows=[]
# row1: player 8 directions (run cycle)
r=[render("lian", clips.l_run, i*0.09, i*(2*math.pi/DIRS), S, prof("cyber")) for i in range(DIRS)]
rows.append(("주인공 리안 - 8방향 달리기", r))
# row2: enemies
E=[("stalker",0.30),("gunner",0.5),("orb",0.5),("shield",0.5),("summoner",0.5),("sentinel",0.5)]
r=[]
for nm,ts in E:
    em = 0.30 if nm in ("orb","shield") else 0.55
    r.append(render(nm, clips.f_move if nm=="stalker" else clips.f_idle, ts, 2.2, S,
                    prof("hostile", ramp_amount=0.85, sat=1.18, emis_mul=em)))
r.append(render("chronovore", clips.f_idle, 0.5, 2.4, S, prof("boss", ramp_amount=0.80, emis_mul=0.5)))
rows.append(("적 6종 + 보스", r))
# row3: player attack frames
r=[render("lian", clips.l_sword3, 0.06+i*0.08, 0.7, S, prof("cyber")) for i in range(6)]
rows.append(("공격 애니메이션 프레임", r))

W = pad + max(len(x[1]) for x in rows)*(S+pad)
H = sum(S+pad+20 for _ in rows) + pad
img=Image.new("RGBA",(W,H),(13,15,21,255)); d=ImageDraw.Draw(img)
y=pad
for title, ims in rows:
    d.text((pad+2,y), title, fill=(150,190,215,255))
    y+=16
    for i,im in enumerate(ims): img.alpha_composite(im,(pad+i*(S+pad), y))
    y+=S+pad+4
img.convert("RGB").save("_preview.png"); print("저장 _preview.png", img.size)
