import numpy as np
from PIL import Image
import spritelib as SL, premium_shade as PS, clips
meshes=SL.load_meshes(); mats=SL.load_materials()
S=170; ss=3
_cache={}
def gbuf(name, fn, ts, fc):
    k=(name,ts,fc)
    if k in _cache: return _cache[k]
    parts=meshes[name]; ppu,oy=SL.fit_scale(parts,S,pad=0.84)
    a=clips.Pose()
    if fn: fn(a,ts,{})
    mw=SL.compose(parts,a.final(),fc)
    G=PS.rasterize(parts,mw,mats,S*ss,ppu*ss,oy*ss)
    _cache[k]=G; return G
def shot(G,**kw):
    col,mask=PS.shade(G,S*ss,ss,**kw)
    rgba=np.concatenate([col,mask[...,None]],axis=2)
    return Image.fromarray((np.clip(rgba,0,1)*255).astype('uint8'),"RGBA").resize((S,S),Image.LANCZOS)

BASE=dict(alb_lift=2.4, alb_gamma=0.75, key_mul=1.9, rim_mul=1.5, outline_dark=0.8, outline_px=2.6, bloom=0.95, sat=1.3)
VAR=[
 ("1 기존",     dict()),
 ("2 램프70",   dict(BASE, ramp_amount=0.70, ramp_gain=1.15, ramp_bias=0.02)),
 ("3 툰+램프",  dict(BASE, style='toon', bands=4, ramp_amount=0.80, ramp_gain=1.2, ramp_bias=0.03)),
 ("4 툰+램프강", dict(BASE, style='toon', bands=5, ramp_amount=0.95, ramp_gain=1.3, ramp_bias=0.04, outline_dark=1.0, outline_px=3.0, sat=1.45)),
]
T=[("lian",clips.l_idle,0.4,0.6,"cyber"),("stalker",clips.f_move,0.3,2.2,"hostile"),("sentinel",clips.f_idle,0.5,1.2,"hostile")]
pad=10
sheet=Image.new("RGBA",(pad+(S+pad)*len(VAR), pad+(S+pad)*len(T)),(14,16,22,255))
for ri,(nm,fn,ts,fc,rp) in enumerate(T):
    G=gbuf(nm,fn,ts,fc)
    for ci,(lbl,kw) in enumerate(VAR):
        kw2=dict(kw)
        if kw2.get("ramp_amount",0)>0: kw2["ramp"]=rp
        sheet.alpha_composite(shot(G,**kw2),(pad+ci*(S+pad), pad+ri*(S+pad)))
    print("행 완료:",nm,flush=True)
sheet.save("_grid.png"); print("저장",sheet.size)
