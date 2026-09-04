import time
from PIL import Image
import spritelib as SL, premium_shade as PS, clips

meshes = SL.load_meshes(); mats = SL.load_materials()
S = 160
def one(name, fn, ts, fc):
    parts = meshes[name]
    ppu, oy = SL.fit_scale(parts, S, pad=0.84)
    a = clips.Pose()
    if fn: fn(a, ts, {})
    mw = SL.compose(parts, a.final(), fc)
    t0=time.time(); old = SL.render_frame(parts, mw, mats, S, ppu, oy, ss=2); t1=time.time()
    new = PS.render_frame(parts, mw, mats, S, ppu, oy, ss=4); t2=time.time()
    print("%-10s  기존 %.2fs -> 고급 %.2fs" % (name, t1-t0, t2-t1), flush=True)
    return old, new

targets = [("lian", clips.l_idle, 0.4, 0.6), ("stalker", clips.f_move, 0.3, 2.2)]
rows = [(nm,)+one(nm,fn,ts,fc) for nm,fn,ts,fc in targets]

pad=14
sheet = Image.new("RGBA", (pad+(S+pad)*2, pad+(S+pad)*len(rows)), (16,18,24,255))
for i,(nm,o,n) in enumerate(rows):
    y = pad + i*(S+pad)
    sheet.alpha_composite(o, (pad, y)); sheet.alpha_composite(n, (pad*2+S, y))
sheet.save("_compare.png"); print("저장 완료", sheet.size)
