## 프리렌더 스프라이트 (v2)

게임의 3D 모델을 오프라인에서 고품질 셰이딩으로 구워 만든 2D 스프라이트 시트입니다.
파이프라인: `tools/premium_shade.py` (디퍼드 G버퍼 렌더러) → `tools/bake_premium.py` → `tools/wire_sprites.py`

셰이딩: 슈퍼샘플링 · 스크린스페이스 AO · 잉크 아웃라인 · 셀(밴딩) 라이팅 · 러프니스 기반 스페큘러 · 이미시브 블룸 · 팔레트 그라디언트 맵

| 시트 | 해상도 | 셀 | 방향 | 상태 | 용량 |
|---|---|---|---|---|---|
| boss | 912x4864 | 152 | 8 | idle/move/attack/death | 820KB |
| enemy_gunner | 576x3072 | 96 | 8 | idle/move/attack/death | 184KB |
| enemy_orb | 576x3072 | 96 | 8 | idle/move/attack/death | 250KB |
| enemy_sentinel | 576x3072 | 96 | 8 | idle/move/attack/death | 326KB |
| enemy_shield | 576x3072 | 96 | 8 | idle/move/attack/death | 233KB |
| enemy_stalker | 576x3072 | 96 | 8 | idle/move/attack/death | 241KB |
| enemy_summoner | 576x3072 | 96 | 8 | idle/move/attack/death | 211KB |
| player_chaingaunt | 624x3328 | 104 | 8 | idle/move/attack/death | 266KB |
| player_pulsebow | 624x3328 | 104 | 8 | idle/move/attack/death | 277KB |
| player_riftsword | 624x3328 | 104 | 8 | idle/move/attack/death | 259KB |
| props | 1152x1008 | 144 | 8 | idle | 173KB |

합계 3.32MB (WebP), 데이터URI 임베드 후 4.43MB

팔레트: 주인공 `cyber`(시안 스틸) / 적 `hostile`(냉강·적갈) / 보스 `boss`(앰버) / 구조물 `prop`(청록)

## 지형 (v2)

`tools/generate_terrain.py` 로 2048px 이음매 없는 타일을 생성합니다.

- `stone` — 원자로 바닥 플레이팅. 2단 플레이트 · 베벨 시임 · 대시 네온 인레이 · 그라임 · 스크래치 (바닥/기둥/제단)
- `wallPanel` — 새 그룹. 세로 리브 · 배관 · 냉각수 얼룩 · 시임 네온 (벽 전용, riftSteel 을 공유하는 적/무기는 영향 없음)

설정 → `스프라이트 그래픽` 을 0 으로 두면 전부 기존 실시간 3D 로 되돌아갑니다.
