# 게임 셰이더와 동일한 수식으로 그림자/블룸 적용 전후 비교
import numpy as np, json, math
from PIL import Image
S="../assets/sprites_v2"
sh=json.load(open(S+"/_sheets.json"))
def cell(key,row,col):
    m=sh[key]; im=Image.open("%s/%s.webp"%(S,key)).convert("RGBA")
    cw,ch=m["cw"],m["ch"]
    return im.crop((col*cw,row*ch,(col+1)*cw,(row+1)*ch))

W,H=980,560
alb=Image.open("../assets/textures/environments/stone_albedo.webp").convert("RGB").resize((256,256))
emi=Image.open("../assets/textures/environments/stone_emissive.webp").convert("RGB").resize((256,256))
def tile(src):
    o=Image.new("RGB",(W,H))
    for y in range(0,H,256):
        for x in range(0,W,256): o.paste(src,(x,y))
    return o
f=np.asarray(tile(alb),np.float32)/255; g=np.asarray(tile(emi),np.float32)/255
base=np.clip(f*0.85+g*0.9,0,1)*np.linspace(0.45,1.0,H)[:,None,None]

pr=sh["props"]["propRows"]
ACTORS=[("props",pr["pillar"],1,130,300,1.15),("props",pr["pillar"],5,850,290,1.10),
        ("props",pr["altar"],2,300,250,0.85),("props",pr["forge"],6,700,245,0.90),
        ("props",pr["crystal"],3,480,215,0.70),
        ("enemy_stalker",1*8+2,2,330,400,1.2),("enemy_gunner",1*8+6,3,640,385,1.2),
        ("enemy_sentinel",0,0,790,470,1.15),("enemy_summoner",0*8+4,0,200,460,1.15),
        ("boss",0,2,490,330,0.85),
        ("player_riftsword",2*8+0,3,470,505,1.35)]

def build(shadows, bloom):
    scene=Image.fromarray((base*255).astype("uint8"),"RGB").convert("RGBA")
    if shadows:
        # 접지 그림자: 부드러운 타원을 곱셈 합성
        sl=Image.new("RGBA",(W,H),(0,0,0,0))
        import PIL.ImageDraw as D
        sd=D.Draw(sl)
        for key,row,col,x,y,sc in ACTORS:
            im=cell(key,row,col); w=int(im.width*sc)
            rw=int(w*0.42); rh=int(rw*0.42)
            sd.ellipse([x-rw,y-rh,x+rw,y+rh], fill=(0,0,0,150))
        sl=sl.filter(__import__("PIL.ImageFilter",fromlist=["x"]).GaussianBlur(9))
        a=np.asarray(sl,np.float32)[...,3:4]/255
        sc_=np.asarray(scene,np.float32)[...,:3]/255
        sc_=sc_*(1-a*0.75)
        scene=Image.fromarray((np.clip(sc_,0,1)*255).astype("uint8"),"RGB").convert("RGBA")
    for key,row,col,x,y,sc in ACTORS:
        im=cell(key,row,col); w=int(im.width*sc); hh=int(im.height*sc)
        scene.alpha_composite(im.resize((w,hh),Image.LANCZOS),(int(x-w/2),int(y-hh)))
    arr=np.asarray(scene.convert("RGB"),np.float32)/255
    if bloom:
        # 밝은 영역 추출(임계 0.62, soft knee) -> 1/4 해상도 블러 -> 가산
        l=arr.max(axis=2,keepdims=True)
        thr,knee=0.48,0.32
        s_=np.clip((l-thr+knee)/(2*knee),0,1)
        wgt=np.maximum(l-thr, s_*s_*knee)/np.maximum(l,1e-4)
        bright=arr*wgt
        bi=Image.fromarray((np.clip(bright,0,1)*255).astype("uint8"))
        q=bi.resize((W//4,H//4),Image.LANCZOS)
        q=q.filter(__import__("PIL.ImageFilter",fromlist=["x"]).GaussianBlur(4))
        b=np.asarray(q.resize((W,H),Image.BICUBIC),np.float32)/255
        arr=arr+b*1.35
        # 비네트
        yy,xx=np.mgrid[0:H,0:W]
        d=((xx/W-0.5)**2+(yy/H-0.5)**2)[...,None]
        arr=arr*np.clip(1-d*0.55,0,1)
    return Image.fromarray((np.clip(arr,0,1)*255).astype("uint8"),"RGB")

before=build(False,False)
after=build(True,True)
out=Image.new("RGB",(W,H*2+14),(10,12,16))
out.paste(before,(0,0)); out.paste(after,(0,H+14))
out.save("_fx_compare.png")
print("저장 _fx_compare.png (위: 이전 / 아래: 그림자+블룸)")
