import numpy as np, json
from PIL import Image
import spritelib as SL, premium_shade as PS, clips
meshes=SL.load_meshes(); mats=SL.load_materials()

HERO = dict(alb_lift=2.4, alb_gamma=0.75, key_mul=1.9, rim_mul=1.5,
            outline_dark=0.85, outline_px=2.6, bloom=0.55, sat=1.28,
            style='toon', bands=4, ramp_amount=0.80, ramp_gain=1.18,
            ramp_bias=0.03, alb_blur=0.6, emis_mul=0.55)
def prof(ramp, **over):
    d=dict(HERO); d["ramp"]=ramp; d.update(over); return d

def render(name, fn, ts, fc, S, kw):
    parts=meshes[name]; ppu,oy=SL.fit_scale(parts,S,pad=0.86)
    a=clips.Pose()
    if fn: fn(a,ts,{})
    mw=SL.compose(parts,a.final(),fc)
    return PS.render_frame(parts,mw,mats,S,ppu,oy,ss=3,**kw)

S=132
LINE=[
 ("lian",      clips.l_idle, 0.4, 0.7, prof("cyber")),
 ("stalker",   clips.f_move, 0.3, 2.2, prof("hostile", ramp_amount=0.85, sat=1.18)),
 ("gunner",    clips.f_idle, 0.5, 2.2, prof("hostile", ramp_amount=0.85, sat=1.18)),
 ("orb",       clips.f_idle, 0.5, 2.2, prof("hostile", ramp_amount=0.85, sat=1.18, emis_mul=0.30)),
 ("shield",    clips.f_idle, 0.5, 2.2, prof("hostile", ramp_amount=0.85, sat=1.18, emis_mul=0.30)),
 ("summoner",  clips.f_idle, 0.5, 2.2, prof("hostile", ramp_amount=0.85, sat=1.18)),
 ("sentinel",  clips.f_idle, 0.5, 2.2, prof("hostile", ramp_amount=0.85, sat=1.18)),
 ("chronovore",clips.f_idle, 0.5, 2.4, prof("boss", ramp_amount=0.80, emis_mul=0.5)),
]
pad=8
sheet=Image.new("RGBA",(pad+(S+pad)*len(LINE), pad*2+S),(13,15,21,255))
for i,(nm,fn,ts,fc,kw) in enumerate(LINE):
    if nm not in meshes: print("없음",nm); continue
    sheet.alpha_composite(render(nm,fn,ts,fc,S,kw),(pad+i*(S+pad), pad))
    print("완료",nm,flush=True)
sheet.save("_lineup.png"); print("저장",sheet.size)
