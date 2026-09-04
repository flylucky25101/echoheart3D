'use strict';
// ECHOHEART - all tunable data: stats, materials, weapons, enemies, boss,
// echoes (run upgrades), meta upgrades, rooms, adaptation, hub lines.
(function () {
  var EH = window.EchoHeart;

  EH.CONFIG = {
    // world / physics (units ~ meters; player ~1.7 tall)
    floorHalf: 9.0,            // room half-size (square arena radius)
    playerRadius: 0.42,
    enemyRadiusDefault: 0.5,
    camDist: 9.8, camHeight: 9.2, camFov: 50, camPitchLead: 0.0,
    camFollowLerp: 6.0, camLookLead: 0.9,
    maxDelta: 0.05,            // clamp dt (s)
    hitStopScale: 0.075,        // seconds base
    // base player stats
    baseStats: {
      maxHp: 100, maxLifeCores: 1,
      damageMul: 1, attackSpeedMul: 1, moveSpeed: 4.4,
      dashCooldown: 1.60, dashDist: 3.4, dashSpeed: 17, dashIFrames: 0.34,
      skillCooldownMul: 1, ultMax: 100, ultChargeMul: 1,
      critChance: 0.05, critMul: 1.8, lifesteal: 0,
      projectileSpeedMul: 1,
      // flags / levels set by echoes+meta
      burnLevel: 0, burnMul: 1, dashFlame: 0, burstOnBurnDeath: 0,
      executeLowHp: 0, skillBurst: 0,
      chainLevel: 0, dashShock: 0, storm5th: 0,
      lowHpDmg: 0, killShield: 0, critHeal: 0,
      roomHeal: 0, startShards: 0, rerolls: 0, firstRareChance: 0
    }
  };

  // materialId -> texture group + look modifiers (data-driven materials)
  EH.MATERIALS = {
    riftSteel:  { group: 'riftSteel',  tint: [1, 1, 1],        emissive: 2.6, uv: 1.2 },
    darkMetal:  { group: 'darkMetal',  tint: [1, 1, 1],        emissive: 1.4, uv: 1.4 },
    cloth:      { group: 'cloth',      tint: [1, 1, 1],        emissive: 0.0, uv: 1.6 },
    leather:    { group: 'leather',    tint: [1, 1, 1],        emissive: 0.0, uv: 1.5 },
    skin:       { group: 'skin',       tint: [1.05, 0.98, 0.95], emissive: 0.0, uv: 1.0 },
    crystalRed: { group: 'crystalRed', tint: [1, 1, 1],        emissive: 2.4, uv: 1.0 },
    circuit:    { group: 'circuit',    tint: [1, 1, 1],        emissive: 3.2, uv: 1.2 },
    energyCyan: { group: 'energyCyan', tint: [1, 1, 1],        emissive: 3.4, uv: 1.0 },
    stone:      { group: 'stone',      tint: [1, 1, 1],        emissive: 1.3, uv: 1.0 },
    wallPanel:  { group: 'wallPanel',  tint: [1, 1, 1],        emissive: 1.5, uv: 1.0 },
    organic:    { group: 'organic',    tint: [1, 1, 1],        emissive: 2.4, uv: 1.2 },
    bossShell:  { group: 'bossShell',  tint: [1, 1, 1],        emissive: 2.4, uv: 1.0 },
    bossMetal:  { group: 'bossMetal',  tint: [1, 1, 1],        emissive: 1.4, uv: 1.0 },
    bossCore:   { group: 'bossCore',   tint: [1, 1, 1],        emissive: 3.6, uv: 1.0 },
    magenta:    { group: 'magenta',    tint: [1, 1, 1],        emissive: 2.6, uv: 1.0 },
    chainMetal: { group: 'chainMetal', tint: [1, 1, 1],        emissive: 1.6, uv: 1.4 }
  };

  // theme tints applied to environment materials per room theme
  EH.THEMES = {
    engine:  { name: '시간기관실', floor: 'stone', wall: 'riftSteel', accent: [0.29, 0.71, 0.69], fog: [0.028, 0.040, 0.045], amb: [0.15, 0.19, 0.20], floorTint: [0.7, 0.85, 0.95] },
    archive: { name: '기억 보관소', floor: 'stone', wall: 'darkMetal', accent: [0.36, 0.56, 0.66], fog: [0.032, 0.038, 0.048], amb: [0.16, 0.18, 0.22], floorTint: [0.75, 0.8, 1.0] },
    forge:   { name: '잿빛 용광로', floor: 'stone', wall: 'riftSteel', accent: [0.80, 0.44, 0.26], fog: [0.06, 0.03, 0.02], amb: [0.24, 0.16, 0.12], floorTint: [1.0, 0.7, 0.55] },
    heart:   { name: '심장 중심부', floor: 'stone', wall: 'bossMetal', accent: [0.78, 0.30, 0.26], fog: [0.05, 0.02, 0.04], amb: [0.22, 0.14, 0.18], floorTint: [1.0, 0.7, 0.8] }
  };

  // ---- WEAPONS ----
  // combo entries: dmg (x base), reach, arc(rad), wind, active, rec (seconds), kb
  EH.WEAPON_ORDER = ['riftsword', 'pulsebow', 'chaingaunt'];
  EH.WEAPONS = {
    riftsword: {
      dmgType: 'slash', name: '균열검', mesh: 'riftsword', icon: 'sword',
      grip: { rot: [0.55, 0, -0.1], off: [0, -0.05, 0.02], scale: 1.0 },
      desc: '3단 연속 베기. 근접에서 강력하고 균형 잡힌 무기.',
      dmg: 16, hold: true,
      combo: [
        { dmg: 1.0, reach: 2.0, arc: 1.7, wind: 0.09, active: 0.10, rec: 0.16, kb: 3 },
        { dmg: 1.1, reach: 2.0, arc: 1.9, wind: 0.08, active: 0.10, rec: 0.16, kb: 3 },
        { dmg: 1.7, reach: 2.4, arc: 2.3, wind: 0.14, active: 0.12, rec: 0.30, kb: 8 }
      ],
      skill: { name: '균열 참격', cd: 4.5, dmg: 3.4, reach: 7.0, width: 1.9, kb: 11 },
      ult: { name: '잔영 폭풍', dmg: 0.7, hits: 14, radius: 4.2, dur: 1.6 },
      trail: [0.4, 1.0, 1.0]
    },
    pulsebow: {
      dmgType: 'pierce', name: '맥동궁', mesh: 'pulsebow', icon: 'bow',
      grip: { rot: [1.30, 0, 0], off: [0, -0.02, 0.02], scale: 0.82 },
      desc: '에너지 화살을 쏘는 원거리 무기. 부드러운 자동 조준.',
      dmg: 14.6, hold: true, ranged: true,
      shot: { dmg: 1.0, speed: 16, life: 1.3, radius: 0.28, rate: 0.34, pierceChance: 0.18 },
      combo: [{ dmg: 1.0, reach: 1.5, arc: 0.6, wind: 0.05, active: 0.05, rec: 0.30, kb: 1 }],
      skill: { name: '집중 사격', cd: 5.0, dmg: 3.2, speed: 30, life: 0.8, width: 0.5, pierce: true },
      ult: { name: '에너지 강우', dmg: 0.8, hits: 18, radius: 4.6, dur: 2.0 },
      trail: [0.5, 1.0, 0.7]
    },
    chaingaunt: {
      dmgType: 'impact', name: '사슬완갑', mesh: 'chaingaunt', icon: 'gaunt',
      grip: { rot: [1.45, 0, 0], off: [0, -0.03, 0.0], scale: 1.0 },
      desc: '빠른 연타. 연속 명중 시 공격 속도가 상승한다.',
      dmg: 13.9, hold: true,
      combo: [
        { dmg: 0.7, reach: 1.7, arc: 1.4, wind: 0.05, active: 0.07, rec: 0.09, kb: 1.5 },
        { dmg: 0.7, reach: 1.7, arc: 1.4, wind: 0.05, active: 0.07, rec: 0.09, kb: 1.5 },
        { dmg: 0.9, reach: 1.8, arc: 1.5, wind: 0.05, active: 0.07, rec: 0.09, kb: 2 },
        { dmg: 1.3, reach: 2.0, arc: 1.8, wind: 0.08, active: 0.09, rec: 0.22, kb: 7 }
      ],
      ramp: { perHit: 0.05, max: 0.32, decay: 1.4 },
      skill: { name: '사슬 돌진', cd: 4.0, dmg: 2.8, dist: 6.0, radius: 1.5, kb: 9 },
      ult: { name: '진동 강타', dmg: 1.1, hits: 3, radius: 5.5, dur: 1.4, waves: 3 },
      trail: [1.0, 0.7, 0.35]
    }
  };

  // ---- ENEMIES ---- (ground-plane radius = collision; visual is 3D)
  EH.ENEMIES = {
    stalker:  { name: '추적자',   mesh: 'stalker',  hp: 34,  speed: 4.9, radius: 0.45, dmg: 10, touch: true, ai: 'charger', chargeCd: 2.7, chargeSpeed: 11, tell: 0.42, resist: { slash: 1.60, pierce: 1.00, impact: 0.40 }, xp: 1 },
    gunner:   { name: '시간 사수', mesh: 'gunner',   hp: 30,  speed: 2.2, radius: 0.5,  dmg: 9,  ai: 'shooter', range: 8.5, fireCd: 2.8, projSpeed: 7.0, tell: 0.5, resist: { slash: 0.40, pierce: 1.60, impact: 1.00 }, xp: 1 },
    orb:      { name: '폭주 구체', mesh: 'orb',      hp: 26,  speed: 3.4, radius: 0.5,  dmg: 20, ai: 'bomber', fuse: 0.85, blastR: 2.4, tell: 0.85, resist: { slash: 0.40, pierce: 1.60, impact: 1.00 }, xp: 1 },
    shield:   { name: '방패병',   mesh: 'shield',   hp: 70,  speed: 2.3, radius: 0.58, dmg: 13, touch: true, ai: 'shield', frontArc: 1.4, block: 0.50, tell: 0.6, resist: { slash: 1.00, pierce: 0.40, impact: 1.60 }, xp: 2 },
    summoner: { name: '잔향 소환사', mesh: 'summoner', hp: 46, speed: 2.0, radius: 0.5, dmg: 8, ai: 'summoner', sumCd: 6.5, sumCount: 2, sumMax: 4, blink: 3.0, tell: 0.7, resist: { slash: 1.60, pierce: 1.00, impact: 0.40 }, xp: 2, floaty: true },
    sentinel: { name: '궤도 감시자', mesh: 'sentinel', hp: 54, speed: 2.6, radius: 0.5, dmg: 8, ai: 'orbiter', orbitR: 5.0, fireCd: 3.6, ringCount: 8, projSpeed: 5.5, tell: 0.5, resist: { slash: 1.00, pierce: 0.40, impact: 1.60 }, xp: 2, floaty: true }
  };
  // Boss resistance rotates per phase so no single weapon dominates the fight.
  // Per-weapon total across the three phases is identical (3.10).
  EH.BOSS_RESIST = [
    { slash: 1.30, pierce: 1.00, impact: 0.70 },
    { slash: 0.70, pierce: 1.30, impact: 1.00 },
    { slash: 1.00, pierce: 0.70, impact: 1.30 }
  ];
  EH.DMG_TYPE_NAME = { slash: '참격', pierce: '관통', impact: '충격' };

  EH.ENEMY_ORDER = ['stalker', 'gunner', 'orb', 'shield', 'summoner', 'sentinel'];

  EH.ELITES = {
    accel:  { name: '가속', color: [1.0, 0.3, 0.2], hp: 1.5, speed: 1.60, dmg: 1.2 },
    split:  { name: '분열', color: [0.6, 1.0, 0.4], hp: 1.7, speed: 1.0, dmg: 1.1, splitInto: 'stalker', splitN: 2 },
    ward:   { name: '보호막', color: [0.4, 0.7, 1.0], hp: 1.6, speed: 0.95, dmg: 1.15, shield: 0.5 }
  };

  // ---- BOSS ----
  EH.BOSS = {
    name: '크로노보어', mesh: 'chronovore', radius: 2.4, hitRadius: 1.9,
    hp: 900, contactDmg: 16,
    phases: [
      { from: 1.0, to: 0.40, name: '균열의 태동' },
      { from: 0.40, to: 0.30, name: '가속하는 시간' },
      { from: 0.30, to: 0.0, name: '붕괴의 심장' }
    ]
  };

  // ---- ECHOES (run upgrades) ---- 19 total (>=18) across families
  function d(s) { return function (st) { return s.replace('{n}', st); }; }
  EH.ECHOES = [
    // EMBER (fire)
    { id: 'ember_burn', fam: 'ember', name: '잿불 각인', icon: 'ember', rar: 'common', max: 4, mod: { burnLevel: 1 }, desc: function (s) { return '공격 시 화상 부여 (초당 ' + (4 + s * 2) + ' 피해, ' + s + '중첩).'; } },
    { id: 'ember_burst', fam: 'ember', name: '연소 폭발', icon: 'ember', rar: 'rare', max: 2, mod: { burstOnBurnDeath: 1 }, desc: function (s) { return '화상 상태의 적 처치 시 폭발 (레벨 ' + s + ').'; } },
    { id: 'ember_dash', fam: 'ember', name: '불꽃 궤적', icon: 'ember', rar: 'common', max: 3, mod: { dashFlame: 1 }, desc: function (s) { return '대시 경로에 불길 (레벨 ' + s + ').'; } },
    { id: 'ember_exec', fam: 'ember', name: '재의 심판', icon: 'ember', rar: 'rare', max: 3, mod: { executeLowHp: 1 }, desc: function (s) { return '체력 낮은 적에게 피해 +' + (s * 10) + '%.'; } },
    { id: 'ember_skill', fam: 'ember', name: '점화 파문', icon: 'ember', rar: 'epic', max: 2, mod: { skillBurst: 1 }, desc: function (s) { return '스킬 적중 시 주변 폭발 (레벨 ' + s + ').'; } },
    // STORM (lightning/speed)
    { id: 'storm_chain', fam: 'storm', name: '연쇄 방전', icon: 'storm', rar: 'common', max: 4, mod: { chainLevel: 1 }, desc: function (s) { return '5회 공격마다 연쇄 번개 (레벨 ' + s + ').'; } },
    { id: 'storm_atk', fam: 'storm', name: '질풍 가속', icon: 'storm', rar: 'common', max: 4, mod: { attackSpeedMul: 0.08 }, desc: function (s) { return '공격 속도 +' + (s * 8) + '%.'; } },
    { id: 'storm_dash', fam: 'storm', name: '감전 잔류', icon: 'storm', rar: 'rare', max: 3, mod: { dashShock: 1 }, desc: function (s) { return '대시 종료 지점 감전 (레벨 ' + s + ').'; } },
    { id: 'storm_cdr', fam: 'storm', name: '순환 회로', icon: 'storm', rar: 'rare', max: 3, mod: { skillCooldownMul: -0.10 }, desc: function (s) { return '스킬 쿨다운 -' + (s * 10) + '%.'; } },
    { id: 'storm_ult', fam: 'storm', name: '과충전', icon: 'storm', rar: 'epic', max: 3, mod: { ultChargeMul: 0.15 }, desc: function (s) { return '궁극기 충전량 +' + (s * 15) + '%.'; } },
    // VOID (crit/leech)
    { id: 'void_crit', fam: 'void', name: '공허의 눈', icon: 'void', rar: 'common', max: 5, mod: { critChance: 0.06 }, desc: function (s) { return '치명타 확률 +' + (s * 6) + '%.'; } },
    { id: 'void_critdmg', fam: 'void', name: '심연 격발', icon: 'void', rar: 'rare', max: 4, mod: { critMul: 0.25 }, desc: function (s) { return '치명타 피해 +' + (s * 25) + '%.'; } },
    { id: 'void_leech', fam: 'void', name: '생명 흡수', icon: 'void', rar: 'rare', max: 3, mod: { lifesteal: 0.02 }, desc: function (s) { return '피해의 ' + (s * 2) + '% 만큼 회복 (제한적).'; } },
    { id: 'void_lowhp', fam: 'void', name: '벼랑의 힘', icon: 'void', rar: 'epic', max: 3, mod: { lowHpDmg: 1 }, desc: function (s) { return '체력 낮을수록 공격력 증가 (레벨 ' + s + ').'; } },
    { id: 'void_shield', fam: 'void', name: '잔멸 보호막', icon: 'void', rar: 'rare', max: 2, mod: { killShield: 1 }, desc: function (s) { return '적 처치 시 짧은 보호막 (레벨 ' + s + ').'; } },
    // NEUTRAL
    { id: 'neu_hp', fam: 'neutral', name: '강화 코어', icon: 'neutral', rar: 'common', max: 5, mod: { maxHp: 18 }, desc: function (s) { return '최대 체력 +' + (s * 18) + '.'; } },
    { id: 'neu_dmg', fam: 'neutral', name: '예리함', icon: 'neutral', rar: 'common', max: 5, mod: { damageMul: 0.08 }, desc: function (s) { return '기본 피해 +' + (s * 8) + '%.'; } },
    { id: 'neu_speed', fam: 'neutral', name: '민첩', icon: 'neutral', rar: 'common', max: 4, mod: { moveSpeed: 0.35 }, desc: function (s) { return '이동 속도 +' + (s * 8) + '%.'; } },
    { id: 'neu_dashcd', fam: 'neutral', name: '경쾌한 발놀림', icon: 'neutral', rar: 'rare', max: 3, mod: { dashCooldown: -0.16 }, desc: function (s) { return '대시 쿨다운 감소 (레벨 ' + s + ').'; } }
  ];
  EH.RARITY = { common: { w: 60, color: '#9fb2c8', name: '일반' }, rare: { w: 30, color: '#6ad0ff', name: '희귀' }, epic: { w: 12, color: '#c77bff', name: '영웅' } };

  EH.SYNERGY = {
    ember: { need: 3, name: '대화재', desc: '화상 피해 +60%' },
    storm: { need: 3, name: '폭풍우', desc: '5번째 공격마다 추가 번개' },
    void:  { need: 3, name: '공허 잠식', desc: '치명타 시 소량 회복' }
  };

  // ---- META upgrades (permanent) ---- 12
  EH.META = [
    { id: 'm_hp', name: '심장 강화', icon: 'heart', max: 6, cost: function (l) { return 20 + l * 15; }, mod: { maxHp: 12 }, desc: function (l) { return '최대 체력 +' + (l * 12); } },
    { id: 'm_dmg', name: '벼려진 의지', icon: 'sword', max: 6, cost: function (l) { return 25 + l * 18; }, mod: { damageMul: 0.05 }, desc: function (l) { return '기본 피해 +' + (l * 5) + '%'; } },
    { id: 'm_speed', name: '가벼운 육신', icon: 'star', max: 4, cost: function (l) { return 25 + l * 15; }, mod: { moveSpeed: 0.22 }, desc: function (l) { return '이동 속도 +' + (l * 5) + '%'; } },
    { id: 'm_dashcd', name: '잔상 회로', icon: 'storm', max: 4, cost: function (l) { return 30 + l * 20; }, mod: { dashCooldown: -0.12 }, desc: function (l) { return '대시 쿨다운 -' + (l * 12) + '%'; } },
    { id: 'm_skillcd', name: '공명 조율', icon: 'storm', max: 4, cost: function (l) { return 30 + l * 22; }, mod: { skillCooldownMul: -0.06 }, desc: function (l) { return '스킬 쿨다운 -' + (l * 6) + '%'; } },
    { id: 'm_ult', name: '과부하 심장', icon: 'core', max: 4, cost: function (l) { return 35 + l * 22; }, mod: { ultChargeMul: 0.1 }, desc: function (l) { return '궁극기 충전 +' + (l * 10) + '%'; } },
    { id: 'm_roomheal', name: '재생 파동', icon: 'heart', max: 5, cost: function (l) { return 30 + l * 18; }, mod: { roomHeal: 4 }, desc: function (l) { return '방 완료 시 회복 +' + (l * 4); } },
    { id: 'm_shards', name: '시간 절약가', icon: 'core', max: 5, cost: function (l) { return 25 + l * 15; }, mod: { startShards: 20 }, desc: function (l) { return '시작 시간파편 +' + (l * 20); } },
    { id: 'm_gain', name: '잔향 공명', icon: 'abyss', max: 5, cost: function (l) { return 40 + l * 25; }, mod: { crystalGain: 0.1 }, desc: function (l) { return '잔향 결정 획득 +' + (l * 10) + '%'; } },
    { id: 'm_reroll', name: '운명 재고', icon: 'void', max: 3, cost: function (l) { return 35 + l * 25; }, mod: { rerolls: 1 }, desc: function (l) { return '잔향 새로고침 +' + l + '회'; } },
    { id: 'm_rare', name: '길조', icon: 'star', max: 3, cost: function (l) { return 40 + l * 30; }, mod: { firstRareChance: 0.15 }, desc: function (l) { return '첫 잔향 희귀 확률 +' + (l * 15) + '%'; } },
    { id: 'm_core', name: '두 번째 잔향심장', icon: 'heart', max: 1, cost: function (l) { return 120; }, mod: { maxLifeCores: 1 }, desc: function (l) { return '추가 생명 코어 해금'; } }
  ];

  // ---- ADAPTATION (death cause) ----
  EH.ADAPT = {
    melee:      { name: '근접', max: 3, per: 0.04, kind: 'reduce', desc: '근접 피해 감소' },
    projectile: { name: '투사체', max: 3, per: 0.04, kind: 'reduce', desc: '투사체 피해 감소' },
    blast:      { name: '폭발', max: 3, per: 0.04, kind: 'reduce', desc: '폭발 피해 감소' },
    field:      { name: '장판', max: 3, per: 0.04, kind: 'reduce', desc: '장판 피해 감소' },
    boss:       { name: '보스', max: 3, per: 0.03, kind: 'boss', desc: '보스 대상 피해 증가' }
  };

  // ---- ROOMS ----
  EH.ROOM_TYPES = {
    combat: { name: '전투', icon: 'skull', reward: 'echo', danger: 1 },
    elite:  { name: '엘리트', icon: 'boss', reward: 'echo+', danger: 2 },
    heal:   { name: '회복실', icon: 'heart', reward: 'heal', danger: 0 },
    shop:   { name: '상점', icon: 'core', reward: 'shop', danger: 0 },
    altar:  { name: '기억의 제단', icon: 'abyss', reward: 'altar', danger: 1 },
    boss:   { name: '보스', icon: 'boss', reward: 'victory', danger: 3 }
  };
  // ---- TOWER ----
  // A run is a climb, not a series of unrelated arenas. Each room is a landing
  // on the tower, grouped into three districts plus the spire at the top. The
  // altitude feeds the parallax backdrop so the world visibly drops away as you
  // ascend, and the floor number is what the HUD reports.
  EH.TOWER = {
    floorsPerRoom: 9,          // room 0 = floors 1-9, room 1 = 10-18, ...
    tiers: [
      { id: 'lower', name: '하층부', rooms: [0, 1], theme: 'engine',
        // structures below are close and dense down here
        shaftRings: 7, ringGap: 3.4, strutCount: 10, hazeStart: 0.22,
        skyLift: 0.0, label: '기관층' },
      { id: 'mid', name: '중층부', rooms: [2, 3], theme: 'archive',
        shaftRings: 9, ringGap: 4.6, strutCount: 8, hazeStart: 0.30,
        skyLift: 0.35, label: '기록층' },
      { id: 'upper', name: '상층부', rooms: [4, 5], theme: 'forge',
        shaftRings: 11, ringGap: 6.0, strutCount: 6, hazeStart: 0.42,
        skyLift: 0.70, label: '용광로층' },
      { id: 'spire', name: '첨탑', rooms: [6], theme: 'heart',
        shaftRings: 13, ringGap: 7.4, strutCount: 4, hazeStart: 0.55,
        skyLift: 1.0, label: '심장부' }
    ]
  };
  EH.tierFor = function (roomIndex) {
    var T = EH.TOWER.tiers;
    for (var i = 0; i < T.length; i++) {
      if (T[i].rooms.indexOf(roomIndex) >= 0) return T[i];
    }
    return T[T.length - 1];
  };
  EH.floorNumber = function (roomIndex) {
    return (Math.max(0, roomIndex) + 1) * EH.TOWER.floorsPerRoom;
  };

  EH.RUN_ROOMS = 6; // + boss = 7

  // ---- HUB LINES (>=12) ----
  EH.HUB_LINES = [
    '잔향심장이 다시 뛴다. 몇 번째 밤인지 세는 것을 멈춘 지 오래다.',
    '대장간의 불은 꺼지지 않는다. 너의 실패를 기억하기 위해.',
    '도시는 같은 밤을 되풀이한다. 오직 너만이 그것을 안다.',
    '죽음은 끝이 아니라 기록이다. 심장이 그것을 삼킨다.',
    '크로노보어는 시간을 먹는다. 그러나 너의 의지는 먹지 못했다.',
    '금속이 식는 소리. 그것이 이 도시의 유일한 자장가다.',
    '이번엔 조금 더 나아갈 수 있을 것 같은 예감이 든다.',
    '떠다니는 기억 조각 하나가 네 이름을 부른다. 리안.',
    '빼앗긴 최초의 심장. 그것을 되찾으면 밤은 끝날까.',
    '패배의 수만큼 잔향이 쌓인다. 그것이 곧 힘이 된다.',
    '누군가 이 대장간을 만들었다. 그 손길만이 온기로 남아있다.',
    '시간의 균열 너머, 붉은 심장이 맥동한다. 가까워지고 있다.',
    '오늘 밤의 너는 어제의 너보다 강하다. 그것만은 확실하다.',
    '침묵하는 기계들 사이에서, 너의 발걸음만이 살아있다.'
  ];

  EH.WEAPON_UNLOCK_NOTE = '모든 무기는 처음부터 사용할 수 있습니다.';
})();
