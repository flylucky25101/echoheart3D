import numpy as np, json, math, colorsys
from PIL import Image, ImageDraw, ImageFilter
S="../assets/sprites_v2"; sh=json.load(open(S+"/_sheets.json"))
def cell(k,r,c):
    m=sh[k]; im=Image.open("%s/%s.webp"%(S,k)).convert("RGBA")
    cw,ch=m["cw"],m["ch"]; return im.crop((c*cw,r*ch,(c+1)*cw,(r+1)*ch))
def H(x):
    x=x.lstrip('#'); return np.array([int(x[i:i+2],16)/255 for i in (0,2,4)],np.float32)

# name, 바탕, 네온(주), 보조, 심장(강조)
PALS=[
 ("현재  채도95% / 6계열", "#05070A", "#4FE3F0", "#299EFF", "#FF4A5E"),
 ("A 딥틸  탁한 청록 + 재빛 심장", "#070A0C", "#4AB5B0", "#2E6E7A", "#E0603F"),
 ("B 강청  차분한 남청 + 자적", "#06080D", "#5C8FD6", "#2C4A78", "#D14A63"),
 ("C 회청  거의 무채색 + 심장만", "#08090B", "#7E96A6", "#3A4750", "#FF5747"),
]

W,Hh=760,470
def scene(name, bg, neon, sub, heart):
    BG,NE,SU,HE = H(bg),H(neon),H(sub),H(heart)
    img=Image.new("RGB",(W,Hh),tuple((BG*255).astype(int))); d=ImageDraw.Draw(img,"RGBA")
    cx,cy=W//2,int(Hh*0.42); RX,RY=250,100
    NEc=tuple((NE*255).astype(int)); SUc=tuple((SU*255).astype(int))
    # 샤프트
    for i in range(8,0,-1):
        dep=i/8; y=cy+int(30+i*26); rx=int(RX*(1+dep*0.5)); ry=int(RY*(1+dep*0.5))
        f=max(0.03,(1-dep)**1.5*0.7+0.04)
        d.ellipse([cx-rx,y-ry//3,cx+rx,y+ry//3],
                  outline=tuple(list((BG*255+NE*255*0.30*f).astype(int))+[int(200*f)]), width=max(1,int(5*f)))
    # 지지대
    for k in range(8):
        a=(k/8)*math.pi*2
        d.line([cx+math.cos(a)*RX,cy+math.sin(a)*RY, cx+math.cos(a)*RX*1.3, cy+math.sin(a)*RY*1.3+190],
               fill=tuple(list((BG*255+NE*255*0.16).astype(int))+[140]), width=4)
    # 림
    for L in range(4):
        d.ellipse([cx-RX+L*2,cy-RY+L*6,cx+RX-L*2,cy+RY+L*6],
                  outline=tuple(list((BG*255+NE*255*0.26*(1-L/4)).astype(int))+[230-L*45]), width=5)
    # 상판 + 시임 네온
    d.ellipse([cx-RX,cy-RY,cx+RX,cy+RY], fill=tuple(((BG+0.02)*255).astype(int)))
    for i in range(1,5):
        rr=RX*i/5; rry=RY*i/5
        d.ellipse([cx-rr,cy-rry,cx+rr,cy+rry],
                  outline=tuple(list((BG*255+NE*255*0.26).astype(int))+[95]), width=2)
    # 벽
    for k in range(22):
        a=(k/22)*math.pi*2; wx=cx+math.cos(a)*RX*1.03; wy=cy+math.sin(a)*RY*1.03
        d.rectangle([wx-7,wy-21,wx+7,wy+3], fill=tuple((BG*255+SU*255*0.55).astype(int)))
    # 캐릭터 (팔레트에 맞게 색조 이동)
    def tint(im, col, keepHeart=False):
        a=np.asarray(im,np.float32)/255
        rgb,al=a[...,:3],a[...,3:]
        lum=rgb.mean(axis=2,keepdims=True)
        # 붉은 부분(심장) 마스크
        red=(rgb[...,0:1]>rgb[...,2:3]+0.10)&(rgb[...,0:1]>0.25)
        out=lum*col*1.55
        if keepHeart: out=np.where(red, lum*HE*1.9, out)
        return Image.fromarray((np.clip(np.concatenate([out,al],2),0,1)*255).astype("uint8"),"RGBA")
    pl=tint(cell("player_riftsword",0,0), NE*0.95, True)
    w=int(pl.width*1.0); h2=int(pl.height*1.0)
    img.paste(pl.resize((w,h2),Image.LANCZOS),(cx-w//2,cy-h2+14),pl.resize((w,h2),Image.LANCZOS))
    for ex,ez,key,row in [(-120,-24,"enemy_stalker",1*8+2),(115,-8,"enemy_gunner",1*8+6)]:
        im=tint(cell(key,row,0), SU*1.45)
        w2=int(im.width*0.85); h3=int(im.height*0.85)
        img.paste(im.resize((w2,h3),Image.LANCZOS),(cx+ex-w2//2,cy+ez-h3+8),im.resize((w2,h3),Image.LANCZOS))
    # 블룸 + 비네트
    a=np.asarray(img,np.float32)/255
    l=a.max(axis=2,keepdims=True); thr,knee=0.48,0.32
    s_=np.clip((l-thr+knee)/(2*knee),0,1); wg=np.maximum(l-thr,s_*s_*knee)/np.maximum(l,1e-4)
    bi=Image.fromarray((np.clip(a*wg,0,1)*255).astype("uint8")).resize((W//4,Hh//4),Image.LANCZOS).filter(ImageFilter.GaussianBlur(4))
    a=a+np.asarray(bi.resize((W,Hh),Image.BICUBIC),np.float32)/255*1.3
    yy,xx=np.mgrid[0:Hh,0:W]; dd=((xx/W-0.5)**2+(yy/Hh-0.5)**2)[...,None]
    a=a*np.clip(1-dd*0.55,0,1)
    img=Image.fromarray((np.clip(a,0,1)*255).astype("uint8"))
    d2=ImageDraw.Draw(img); d2.text((16,14), name, fill=(225,238,248))
    # 스와치
    for i,c in enumerate([neon,sub,heart]):
        d2.rectangle([16+i*26, Hh-30, 36+i*26, Hh-12], fill=c, outline=(60,70,80))
    return img

outs=[scene(*p) for p in PALS]
sheet=Image.new("RGB",(W*2+12, Hh*2+12),(8,10,13))
for i,o in enumerate(outs):
    sheet.paste(o, ((i%2)*(W+12), (i//2)*(Hh+12)))
sheet.save("_palette_compare.png"); print("저장", sheet.size)
