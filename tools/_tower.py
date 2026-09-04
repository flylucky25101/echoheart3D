import numpy as np, json, math
from PIL import Image, ImageDraw, ImageFilter
S="../assets/sprites_v2"; sh=json.load(open(S+"/_sheets.json"))
def cell(k,r,c):
    m=sh[k]; im=Image.open("%s/%s.webp"%(S,k)).convert("RGBA")
    cw,ch=m["cw"],m["ch"]; return im.crop((c*cw,r*ch,(c+1)*cw,(r+1)*ch))

W,H=1000,620
TIERS=[("하층부 9층",(0.10,0.90,0.95),7,3.4,10),
       ("중층부 27층",(0.50,0.70,1.00),9,4.6,8),
       ("첨탑 63층",(1.00,0.20,0.35),13,7.4,4)]

def render(name, acc, rings, gap, struts):
    img=Image.new("RGB",(W,H),(4,6,9)); d=ImageDraw.Draw(img,"RGBA")
    cx,cy=W//2, int(H*0.40)          # 발판 중심 (화면 상단쪽)
    RX,RY=330,132                     # 발판 타원 반경 (사선 시점)
    A=tuple(int(x*255) for x in acc)
    # --- 아래로 내려가는 링 ---
    for i in range(rings,0,-1):
        depth=i/rings
        y=cy+int(38+i*gap*7.5)
        rx=int(RX*(1+depth*0.55)); ry=int(RY*(1+depth*0.55))
        fade=max(0.03,(1-depth)**1.5*0.78+0.04)
        col=(int(A[0]*0.30*fade+8), int(A[1]*0.34*fade+10), int(A[2]*0.42*fade+14), int(210*fade))
        d.ellipse([cx-rx,y-ry//3,cx+rx,y+ry//3], outline=col, width=max(1,int(7*fade)))
    # --- 수직 지지대 ---
    drop=int(rings*gap*7.5*0.78)
    for k in range(struts):
        a=(k/struts)*math.pi*2
        sx=cx+math.cos(a)*RX*1.02; sy=cy+math.sin(a)*RY*1.02
        ex=cx+math.cos(a)*RX*1.35; ey=cy+math.sin(a)*RY*1.35+drop
        d.line([sx,sy,ex,ey], fill=(int(A[0]*0.16+10),int(A[1]*0.18+12),int(A[2]*0.24+16),150), width=5)
    # --- 발판 두께(림) ---
    for L in range(4):
        off=L*7
        col=(int(A[0]*0.26*(1-L/4)+14),int(A[1]*0.30*(1-L/4)+16),int(A[2]*0.38*(1-L/4)+22),235-L*45)
        d.ellipse([cx-RX+L*2,cy-RY+off,cx+RX-L*2,cy+RY+off], outline=col, width=6)
    # --- 발판 상면 ---
    d.ellipse([cx-RX,cy-RY,cx+RX,cy+RY], fill=(11,14,20,255))
    for i in range(1,5):
        rr=RX*i/5; rry=RY*i/5
        d.ellipse([cx-rr,cy-rry,cx+rr,cy+rry], outline=(int(A[0]*0.22+10),int(A[1]*0.26+12),int(A[2]*0.34+16),90), width=2)
    # --- 벽 고리 ---
    for k in range(22):
        a=(k/22)*math.pi*2
        wx=cx+math.cos(a)*RX*1.03; wy=cy+math.sin(a)*RY*1.03
        d.rectangle([wx-9,wy-26,wx+9,wy+4], fill=(int(A[0]*0.16+16),int(A[1]*0.19+19),int(A[2]*0.26+26),255))
    # --- 캐릭터 ---
    pl=cell("player_riftsword",0,0); w=int(pl.width*1.15); hh=int(pl.height*1.15)
    img.paste(pl.resize((w,hh),Image.LANCZOS),(cx-w//2,cy-hh+18),pl.resize((w,hh),Image.LANCZOS))
    for (ex,ez,key,row) in [(-150,-30,"enemy_stalker",1*8+2),(140,-10,"enemy_gunner",1*8+6),(40,60,"enemy_sentinel",0)]:
        im=cell(key,row,0); w2=int(im.width*0.95); h2=int(im.height*0.95)
        px=cx+ex; py=cy+ez
        img.paste(im.resize((w2,h2),Image.LANCZOS),(px-w2//2,py-h2+10),im.resize((w2,h2),Image.LANCZOS))
    # --- 블룸 ---
    a_=np.asarray(img,np.float32)/255
    l=a_.max(axis=2,keepdims=True); thr,knee=0.48,0.32
    s_=np.clip((l-thr+knee)/(2*knee),0,1); wgt=np.maximum(l-thr,s_*s_*knee)/np.maximum(l,1e-4)
    bi=Image.fromarray((np.clip(a_*wgt,0,1)*255).astype("uint8")).resize((W//4,H//4),Image.LANCZOS)
    bi=bi.filter(ImageFilter.GaussianBlur(4))
    a_=a_+np.asarray(bi.resize((W,H),Image.BICUBIC),np.float32)/255*1.35
    yy,xx=np.mgrid[0:H,0:W]; dd=((xx/W-0.5)**2+(yy/H-0.5)**2)[...,None]
    a_=a_*np.clip(1-dd*0.55,0,1)
    img=Image.fromarray((np.clip(a_,0,1)*255).astype("uint8"))
    d2=ImageDraw.Draw(img)
    d2.text((18,16), name, fill=(220,240,255))
    return img

outs=[render(*t) for t in TIERS]
sheet=Image.new("RGB",(W,H*len(outs)+16*(len(outs)-1)),(6,8,11))
for i,o in enumerate(outs): sheet.paste(o,(0,i*(H+16)))
sheet.save("_tower_preview.png"); print("저장", sheet.size)
