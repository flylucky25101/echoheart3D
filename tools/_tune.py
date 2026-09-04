import numpy as np, time
from PIL import Image
import spritelib as SL, premium_shade as PS, clips
meshes=SL.load_meshes(); mats=SL.load_materials()
S=180
parts=meshes["lian"]; ppu,oy=SL.fit_scale(parts,S,pad=0.84)
a=clips.Pose(); clips.l_idle(a,0.4,{}); mw=SL.compose(parts,a.final(),0.6)
ss=3
G=PS.rasterize(parts,mw,mats,S*ss,ppu*ss,oy*ss)
print("mask 픽셀:",int(G["mask"].sum()),"| alb 평균:",G["alb"][G["mask"]>0].mean().round(3),
      "| emi 최대:",G["emi"].max().round(2),"| rough 평균:",G["rough"][G["mask"]>0].mean().round(2))
ink=PS.outline(G["mask"],G["depth"],S*ss,2.0*ss*0.5,0.55)
print("아웃라인 최소값:",ink.min().round(3),"(1이면 선 없음) | 어두워진 픽셀수:",int((ink<0.95).sum()))
