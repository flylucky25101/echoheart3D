# 지형 타일 + 프롭 + 캐릭터를 합쳐 실제 화면 느낌의 목업 생성
import numpy as np, json, math
from PIL import Image
S="../assets/sprites_v2"
sh=json.load(open(S+"/_sheets.json"))
def cellof(key, row, col):
    m=sh[key]; im=Image.open("%s/%s.webp"%(S,key)).convert("RGBA")
    cw,ch=m["cw"],m["ch"]
    return im.crop((col*cw, row*ch, (col+1)*cw, (row+1)*ch))

W,H=980,560
# 바닥: stone albedo + emissive 를 원근 비슷하게 타일링
alb=Image.open("../assets/textures/environments/stone_albedo.webp").convert("RGB").resize((256,256))
emi=Image.open("../assets/textures/environments/stone_emissive.webp").convert("RGB").resize((256,256))
floor=Image.new("RGB",(W,H))
for y in range(0,H,256):
    for x in range(0,W,256):
        floor.paste(alb,(x,y))
gl=Image.new("RGB",(W,H))
for y in range(0,H,256):
    for x in range(0,W,256):
        gl.paste(emi,(x,y))
f=np.asarray(floor,np.float32)/255; g=np.asarray(gl,np.float32)/255
comp=np.clip(f*0.85+g*0.9,0,1)
# 위쪽으로 갈수록 어둡게(깊이감)
grad=np.linspace(0.45,1.0,H)[:,None,None]
comp=comp*grad
scene=Image.fromarray((comp*255).astype("uint8"),"RGB").convert("RGBA")

pr=sh["props"]["propRows"]
def place(im, x, y, scale=1.0):
    w=int(im.width*scale); h=int(im.height*scale)
    scene.alpha_composite(im.resize((w,h),Image.LANCZOS),(int(x-w/2),int(y-h)))
# 프롭 배치
place(cellof("props",pr["pillar"],1), 130, 300, 1.15)
place(cellof("props",pr["pillar"],5), 850, 290, 1.1)
place(cellof("props",pr["altar"],2),  300, 250, 0.85)
place(cellof("props",pr["forge"],6),  700, 245, 0.9)
place(cellof("props",pr["crystal"],3),480, 215, 0.7)
# 적들 (이동 상태 = 상태1)
place(cellof("enemy_stalker", 1*8+2, 2), 330, 400, 1.2)
place(cellof("enemy_gunner",  1*8+6, 3), 640, 385, 1.2)
place(cellof("enemy_sentinel",0*8+0, 0), 790, 470, 1.15)
place(cellof("enemy_summoner",0*8+4, 0), 200, 460, 1.15)
# 보스
place(cellof("boss", 0*8+0, 2), 490, 330, 0.85)
# 플레이어 (공격 상태=2, 정면)
place(cellof("player_riftsword", 2*8+0, 3), 470, 505, 1.35)
scene.convert("RGB").save("_scene.png")
print("저장 _scene.png", scene.size)
