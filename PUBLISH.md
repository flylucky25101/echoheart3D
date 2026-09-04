# GitHub에 올리기

저장소는 이미 커밋까지 끝난 상태입니다. 인증이 필요한 단계만 남아 있어서
그 부분은 직접 하셔야 합니다.

## 1. 빈 저장소 만들기

<https://github.com/new> 에서 이름만 `echoheart3D` 로 지정합니다.
**README, .gitignore, LICENSE 는 추가하지 마세요** — 이미 들어 있고,
GitHub 쪽에서 같이 만들면 첫 푸시가 충돌합니다.

## 2. 푸시

압축을 푼 폴더에서:

```bash
git remote add origin https://github.com/<본인계정>/echoheart3D.git
git branch -M main
git push -u origin main
```

## 3. GitHub Pages 켜기 (선택)

저장소 **Settings → Pages → Source: Deploy from a branch → main / (root)**.

1~2분 뒤 `https://<본인계정>.github.io/echoheart3D/` 에서 바로 플레이됩니다.
빌드 단계가 없습니다 — 루트의 `index.html` 이 그대로 실행 가능한 게임이고,
모든 경로가 상대 경로라 하위 디렉터리에 얹혀도 그대로 동작합니다.

원하시던 `github.com/<계정>/echoheart3D/blob/main/index.html` 주소는 푸시하는 순간
생깁니다. 다만 그건 소스를 *보는* 화면이라 게임이 실행되지는 않습니다 —
실제로 플레이되는 주소는 위의 Pages 쪽입니다.

## 저장소에 무엇이 들어 있나

7.9MB / 92 파일. 원본 폴더는 70MB인데, `assets/` 59MB를 뺐습니다.

게임이 실제로 쓰는 텍스처와 스프라이트는 전부 `scripts/` 안에 data URI 로
임베드돼 있습니다. `index.html` 이 서버 없이 파일 그대로 열리는 이유이기도 하고,
`assets/` 없이도 셀프테스트 71/71 · 헤드리스 89/89 가 통과하는 이유이기도 합니다.
`assets/` 는 그 임베드를 *만들어낸* 중간 산출물이라, 같이 올리면 정작
플레이하러 온 사람에게 12배 무거운 저장소가 됩니다.

아트를 다시 만들어야 할 때는 `tools/` 로 재생성합니다:

```bash
python3 tools/generate_terrain.py both   # 바닥/벽 타일
python3 tools/bake_premium.py            # 캐릭터 시트
python3 tools/bake_props.py              # 구조물 빌보드
python3 tools/recolor_sprites.py         # 딥틸 팔레트 적용
python3 tools/wire_sprites.py            # 임베드 + 접지 메타 재계산
python3 tools/embed_textures.py          # 텍스처 임베드
```

## 단일 파일로 배포하고 싶다면

```bash
python3 tools/bundle.py     # dist/echoheart.html (1.5MB, 외부 요청 0건)
```

CSS·JS 를 전부 인라인한 한 파일입니다. 아무 정적 호스팅에나 올리거나
메신저로 그냥 보내도 열립니다.
